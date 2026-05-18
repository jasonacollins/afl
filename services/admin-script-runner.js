const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { runQuery, getQuery, getOne } = require('../models/db');
const { buildChildProcessEnv } = require('../config');
const { logger } = require('../utils/logger');
const modelCatalogService = require('./model-catalog-service');
const {
  YEAR_MIN,
  getYearMax,
  ALLOWED_PATH_BASES,
  getScriptDefinition,
  getScriptCatalog
} = require('./admin-script-definitions');

const PROJECT_ROOT = path.join(__dirname, '..');
const LEGACY_MARGIN_OPTIMIZE_OUTPUT_PATH = 'data/models/margin/optimal_margin_only_elo_params.json';
const LEGACY_WIN_MARGIN_METHODS_OUTPUT_PATH = 'data/models/win/optimal_margin_methods.json';
const DEFAULTS = {
  dbPath: 'data/database/afl_predictions.db',
  combinedOutputDir: 'data/predictions/combined',
  marginPredictionsOutputDir: 'data/predictions/margin',
  winMarginMethodsOutputDir: 'data/predictions/win',
  winModelOutputDir: 'data/models/win',
  marginModelOutputDir: 'data/models/margin',
  marginOptimizeOutputPath: LEGACY_MARGIN_OPTIMIZE_OUTPUT_PATH,
  winMarginMethodsOptimizeOutputPath: LEGACY_WIN_MARGIN_METHODS_OUTPUT_PATH,
  historicalOutputDir: 'data/historical',
  historicalOutputPrefix: 'afl_elo_complete_history',
  historicalMode: 'incremental',
  historicalSeedStartYear: 1990,
  historicalOutputStartYear: 2000
};

const MAX_LOG_MESSAGE_LENGTH = 4000;
const RUN_HEARTBEAT_INTERVAL_MS = 15000;

const RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted'
};

const allowedAbsBases = ALLOWED_PATH_BASES.map((relativeBase) =>
  path.resolve(PROJECT_ROOT, relativeBase)
);

let activeProcess = null;

function nowIso() {
  return new Date().toISOString();
}

function getDefaultMarginOptimizeEndYear() {
  return new Date().getFullYear() - 1;
}

function getMarginOptimizeOutputPath(endYear) {
  return path.posix.join(
    'data/models/margin',
    `optimal_margin_only_elo_params_trained_to_${endYear}.json`
  );
}

function getDefaultWinMarginMethodsOptimizeEndYear() {
  return new Date().getFullYear() - 1;
}

function getWinMarginMethodsOptimizeOutputPath(endYear) {
  return path.posix.join(
    'data/models/win',
    `optimal_margin_methods_trained_to_${endYear}.json`
  );
}

function isWinMarginMethodsFile(filePath) {
  return /optimal_margin_methods(?:_trained_to_\d{4})?\.json$/i.test(path.posix.basename(filePath));
}

function isWinParamsFile(filePath) {
  return /optimal_elo_params_win(?:_trained_to_\d{4})?\.json$/i.test(path.posix.basename(filePath));
}

function isWinTrainedModelFile(filePath) {
  return /afl_elo_win_trained_to_\d{4}\.json$/i.test(path.posix.basename(filePath));
}

function extractTrainedToYearFromPath(filePath) {
  const match = String(filePath || '').match(/trained_to_(\d{4})/i);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function trimToNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error('Invalid boolean value');
}

function toInteger(value, fieldName, options = {}) {
  const { required = false, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  const text = trimToNull(value);

  if (text === null) {
    if (!required) {
      return null;
    }
    throw new Error(`${fieldName} is required`);
  }

  const numeric = Number.parseInt(text, 10);
  if (Number.isNaN(numeric)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  if (numeric < min || numeric > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }

  return numeric;
}

function ensureInsideProject(resolvedPath) {
  const relativePath = path.relative(PROJECT_ROOT, resolvedPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function ensureAllowedBase(resolvedPath, fieldName) {
  const allowed = allowedAbsBases.some((basePath) =>
    resolvedPath === basePath || resolvedPath.startsWith(basePath + path.sep)
  );

  if (!allowed) {
    throw new Error(`${fieldName} must be under an approved data directory`);
  }
}

function normalizeRepoPath(inputPath, fieldName, fallbackValue) {
  const rawPath = trimToNull(inputPath) || fallbackValue;
  if (!rawPath) {
    throw new Error(`${fieldName} is required`);
  }

  const resolvedPath = path.resolve(PROJECT_ROOT, rawPath);
  if (!ensureInsideProject(resolvedPath)) {
    throw new Error(`${fieldName} must resolve inside the project root`);
  }
  ensureAllowedBase(resolvedPath, fieldName);

  const relativePath = path.relative(PROJECT_ROOT, resolvedPath);
  return relativePath || '.';
}

function normalizeOptionalRepoPath(inputPath, fieldName, fallbackValue) {
  const candidate = trimToNull(inputPath);
  if (!candidate && !fallbackValue) {
    return null;
  }
  return normalizeRepoPath(candidate, fieldName, fallbackValue);
}

function normalizeOutputPathForSimulation(year, fromScratch, providedOutput) {
  const fallback = `data/simulations/season_simulation_${year}${fromScratch ? '_from_scratch' : ''}.json`;
  return normalizeRepoPath(providedOutput, 'output', fallback);
}

async function getActivePredictors() {
  return getQuery(
    `SELECT predictor_id, name, COALESCE(display_name, name) AS display_name
     FROM predictors
     WHERE active = 1
     ORDER BY COALESCE(display_name, name) ASC`
  );
}

function chooseDefaultPredictorId(activePredictors, preferredPredictorId = 6) {
  if (!Array.isArray(activePredictors) || activePredictors.length === 0) {
    return null;
  }

  const preferred = activePredictors.find((predictor) => predictor.predictor_id === preferredPredictorId);
  return preferred ? preferred.predictor_id : activePredictors[0].predictor_id;
}

async function assertActivePredictor(predictorId) {
  const predictor = await getOne(
    `SELECT predictor_id, name, COALESCE(display_name, name) AS display_name
     FROM predictors
     WHERE predictor_id = ? AND active = 1`,
    [predictorId]
  );

  if (!predictor) {
    throw new Error('predictorId must reference an active predictor');
  }

  return predictor;
}

async function listJsonFiles(relativeDir) {
  const directoryPath = path.resolve(PROJECT_ROOT, relativeDir);

  try {
    const files = await fs.readdir(directoryPath, { withFileTypes: true });
    return files
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(relativeDir, entry.name).replace(/\\/g, '/'))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    logger.warn('Unable to list model files', {
      directory: directoryPath,
      error: error.message
    });
    return [];
  }
}

async function getModelFiles() {
  const [win, margin] = await Promise.all([
    listJsonFiles('data/models/win'),
    listJsonFiles('data/models/margin')
  ]);

  const winMarginMethods = win.filter((filePath) => isWinMarginMethodsFile(filePath));
  const winParams = win.filter((filePath) => isWinParamsFile(filePath));
  const winModels = win.filter((filePath) => isWinTrainedModelFile(filePath));
  const winModelOrParams = win.filter((filePath) => isWinTrainedModelFile(filePath) || isWinParamsFile(filePath));
  const history = [...new Set([...margin, ...win])].sort((a, b) => a.localeCompare(b));

  return { win, margin, history, winMarginMethods, winParams, winModels, winModelOrParams };
}

function summarizeCatalogArtifact(artifact) {
  if (!artifact) {
    return null;
  }

  return {
    path: artifact.path,
    label: artifact.label,
    detail: artifact.detail,
    kind: artifact.kind,
    kindLabel: artifact.kindLabel,
    trainedThroughYear: artifact.trainedThroughYear || null,
    fileSha256: artifact.fileSha256 || null,
    compatibility: artifact.compatibility || {}
  };
}

function getLatestCatalogArtifact(modelCatalog, kind, predicate = () => true) {
  const artifacts = Array.isArray(modelCatalog?.artifacts) ? modelCatalog.artifacts : [];
  return artifacts.find((artifact) => artifact.kind === kind && predicate(artifact)) || null;
}

function getCatalogArtifactsByKind(modelCatalog, kind) {
  const artifacts = Array.isArray(modelCatalog?.artifacts) ? modelCatalog.artifacts : [];
  return artifacts.filter((artifact) => artifact.kind === kind);
}

function getCatalogArtifactByPath(modelCatalog, artifactPath) {
  const artifacts = Array.isArray(modelCatalog?.artifacts) ? modelCatalog.artifacts : [];
  return artifacts.find((artifact) => artifact.path === artifactPath) || null;
}

function normalizeCatalogPathForComparison(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isCompatibleWinFirstPair(winModel, marginMethods) {
  if (!winModel || !marginMethods) {
    return false;
  }

  const compatibility = marginMethods.compatibility || {};
  const requiredPath = normalizeCatalogPathForComparison(compatibility.requiredWinModelPath);
  if (requiredPath && requiredPath !== normalizeCatalogPathForComparison(winModel.path)) {
    return false;
  }

  const requiredHash = compatibility.requiredWinModelFileSha256;
  if (requiredHash && winModel.fileSha256 && requiredHash !== winModel.fileSha256) {
    return false;
  }

  const requiredYear = compatibility.requiredWinModelTrainEndYear;
  if (requiredYear) {
    return requiredYear === winModel.trainedThroughYear;
  }

  return Boolean(marginMethods.trainedThroughYear && marginMethods.trainedThroughYear === winModel.trainedThroughYear);
}

function getCompatibleMarginMethodsForWinModel(modelCatalog, winModel) {
  if (!winModel) {
    return null;
  }

  return getLatestCatalogArtifact(modelCatalog, 'win_margin_methods', (artifact) =>
    isCompatibleWinFirstPair(winModel, artifact)
  );
}

function buildWinFirstAdaptersByModelPath(modelCatalog) {
  return getCatalogArtifactsByKind(modelCatalog, 'trained_win_model').reduce((map, winModel) => {
    const marginMethods = getCompatibleMarginMethodsForWinModel(modelCatalog, winModel);
    map[winModel.path] = {
      winModel: summarizeCatalogArtifact(winModel),
      marginMethods: summarizeCatalogArtifact(marginMethods),
      isCompatible: Boolean(marginMethods),
      warning: marginMethods ? null : 'No compatible margin adapter is available for this win-first model.'
    };
    return map;
  }, {});
}

async function getCurrentModelCatalog() {
  const modelFiles = await getModelFiles();
  const modelCatalog = await modelCatalogService.getModelCatalog({ modelFiles });
  return { modelFiles, modelCatalog };
}

function buildFallbackArtifact(relativePath, kind) {
  if (!relativePath) {
    return null;
  }

  return {
    path: relativePath,
    kind,
    trainedThroughYear: extractTrainedToYearFromPath(relativePath),
    compatibility: {}
  };
}

async function resolveCompatibleMarginMethodsPath(winModelPath, allowModelMismatch = false) {
  const { modelFiles, modelCatalog } = await getCurrentModelCatalog();
  const winModel = getCatalogArtifactByPath(modelCatalog, winModelPath)
    || buildFallbackArtifact(winModelPath, 'trained_win_model');
  const compatibleMarginMethods = getCompatibleMarginMethodsForWinModel(modelCatalog, winModel);

  if (compatibleMarginMethods) {
    return compatibleMarginMethods.path;
  }

  if (allowModelMismatch) {
    const latestMarginMethods = getLatestCatalogArtifact(modelCatalog, 'win_margin_methods');
    if (latestMarginMethods) {
      return latestMarginMethods.path;
    }
    if (Array.isArray(modelFiles.winMarginMethods) && modelFiles.winMarginMethods.length > 0) {
      return modelFiles.winMarginMethods[0];
    }
  }

  throw new Error(
    'No compatible margin adapter is available for the selected win-first model. '
    + 'Retrain the win-first model or run the adapter backfill before generating predictions.'
  );
}

async function assertCompatibleWinFirstArtifacts(winModelPath, marginMethodsPath, allowModelMismatch = false) {
  if (allowModelMismatch) {
    return;
  }

  const { modelCatalog } = await getCurrentModelCatalog();
  const winModel = getCatalogArtifactByPath(modelCatalog, winModelPath)
    || buildFallbackArtifact(winModelPath, 'trained_win_model');
  const marginMethods = getCatalogArtifactByPath(modelCatalog, marginMethodsPath)
    || buildFallbackArtifact(marginMethodsPath, 'win_margin_methods');

  if (isCompatibleWinFirstPair(winModel, marginMethods)) {
    return;
  }

  throw new Error(
    'marginMethodsPath is not compatible with winModelPath. '
    + 'Use the matching margin adapter for the selected win-first model or enable allowModelMismatch.'
  );
}

function getPredictionProfiles(modelCatalog, activePredictors, currentYear) {
  const latestWinModel = getLatestCatalogArtifact(modelCatalog, 'trained_win_model');
  const adaptersByWinModelPath = buildWinFirstAdaptersByModelPath(modelCatalog);
  let selectedWinModel = null;
  let compatibleMarginMethods = null;
  for (const winModel of getCatalogArtifactsByKind(modelCatalog, 'trained_win_model')) {
    const marginMethods = getCompatibleMarginMethodsForWinModel(modelCatalog, winModel);
    if (marginMethods) {
      selectedWinModel = winModel;
      compatibleMarginMethods = marginMethods;
      break;
    }
  }

  const latestMarginMethods = getLatestCatalogArtifact(modelCatalog, 'win_margin_methods');
  const latestMarginModel = getLatestCatalogArtifact(modelCatalog, 'trained_margin_model');
  const winFirstWarnings = [];
  if (!compatibleMarginMethods) {
    if (latestWinModel && latestMarginMethods) {
      winFirstWarnings.push('No compatible win-first ratings and margin adapter pair could be inferred from metadata.');
    } else if (latestWinModel && !latestMarginMethods) {
      winFirstWarnings.push('No margin adapter artifact is available for the latest win-first ratings.');
    } else if (!latestWinModel) {
      winFirstWarnings.push('No trained win-first ratings artifact is available.');
    }
  }

  return {
    winFirst: {
      mode: 'winFirst',
      scriptKey: 'win-margin-methods-predictions',
      label: 'Win-first model',
      description: 'Trained win-first ratings plus a compatible margin adapter. Produces win probability and predicted margin.',
      season: currentYear,
      predictorId: chooseDefaultPredictorId(activePredictors, 8),
      outputDir: DEFAULTS.winMarginMethodsOutputDir,
      saveToDb: true,
      futureOnly: true,
      overrideCompleted: false,
      allowModelMismatch: false,
      winModel: summarizeCatalogArtifact(selectedWinModel),
      marginMethods: summarizeCatalogArtifact(compatibleMarginMethods),
      adaptersByWinModelPath,
      fallbackWinModel: summarizeCatalogArtifact(latestWinModel),
      fallbackMarginMethods: summarizeCatalogArtifact(latestMarginMethods),
      isCompatible: Boolean(selectedWinModel && compatibleMarginMethods),
      produces: ['home_win_probability', 'predicted_margin'],
      warnings: winFirstWarnings
    },
    marginFirst: {
      mode: 'marginFirst',
      scriptKey: 'margin-predictions',
      label: 'Margin-first model',
      description: 'Trained margin-first model that derives win probability from margin output. Produces predicted margin and win probability.',
      season: currentYear,
      predictorId: chooseDefaultPredictorId(activePredictors, 7),
      outputDir: DEFAULTS.marginPredictionsOutputDir,
      saveToDb: true,
      overrideCompleted: false,
      model: summarizeCatalogArtifact(latestMarginModel),
      isCompatible: Boolean(latestMarginModel),
      produces: ['home_win_probability', 'predicted_margin'],
      warnings: latestMarginModel ? [] : ['No trained margin-first model artifact is available.']
    }
  };
}

function getRecommendedPredictionBundles(predictionProfiles) {
  return {
    predictions: {
      primary: {
        ...predictionProfiles.winFirst,
        mode: 'recommended',
        label: 'Win-first model'
      },
      marginOnly: {
        ...predictionProfiles.marginFirst,
        mode: 'marginOnly',
        label: 'Margin-first model'
      }
    }
  };
}

function getWorkflowMetadata(currentYear) {
  return {
    predictions: {
      label: 'Make predictions',
      summary: 'Generate future match predictions and optionally publish them to a predictor in the database.',
      defaultSeason: currentYear,
      dangerousFields: [
        'overrideCompleted',
        'allowModelMismatch',
        'dbPath',
        'outputDir',
        'methodOverride'
      ]
    },
    training: {
      label: 'Train model',
      summary: 'Optimise parameters, then train a model artifact from those parameters.',
      defaultStartYear: 1990,
      defaultEndYear: currentYear - 1
    },
    data: {
      label: 'Update data',
      summary: 'Refresh fixture and score data without changing model artifacts.'
    },
    simulation: {
      label: 'Run simulation',
      summary: 'Run the season simulator and write the normal simulation JSON output.',
      defaultSeason: currentYear
    },
    history: {
      label: 'Update ELO history',
      summary: 'Append or rebuild the historical ELO chart data from a selected model.'
    }
  };
}

async function getScriptMetadata() {
  const [modelFiles, activePredictors] = await Promise.all([
    getModelFiles(),
    getActivePredictors()
  ]);
  const [modelCatalog, outputCatalog] = await Promise.all([
    modelCatalogService.getModelCatalog({ modelFiles }),
    modelCatalogService.getOutputCatalog()
  ]);
  const currentYear = new Date().getFullYear();
  const defaultMarginOptimizeEndYear = getDefaultMarginOptimizeEndYear();
  const defaultWinMarginMethodsOptimizeEndYear = getDefaultWinMarginMethodsOptimizeEndYear();
  const predictionProfiles = getPredictionProfiles(modelCatalog, activePredictors, currentYear);

  return {
    scripts: getScriptCatalog(),
    modelFiles,
    modelCatalog,
    outputCatalog,
    predictionProfiles,
    recommendedBundles: getRecommendedPredictionBundles(predictionProfiles),
    workflows: getWorkflowMetadata(currentYear),
    activePredictors,
    defaults: {
      currentYear,
      yearMax: getYearMax(),
      predictorId: chooseDefaultPredictorId(activePredictors, 6),
      marginPredictorId: chooseDefaultPredictorId(activePredictors, 7),
      winMarginMethodsPredictorId: chooseDefaultPredictorId(activePredictors, 8),
      dbPath: DEFAULTS.dbPath,
      combinedOutputDir: DEFAULTS.combinedOutputDir,
      marginPredictionsOutputDir: DEFAULTS.marginPredictionsOutputDir,
      winMarginMethodsOutputDir: DEFAULTS.winMarginMethodsOutputDir,
      winModelOutputDir: DEFAULTS.winModelOutputDir,
      marginModelOutputDir: DEFAULTS.marginModelOutputDir,
      marginOptimizeOutputPath: getMarginOptimizeOutputPath(defaultMarginOptimizeEndYear),
      winMarginMethodsOptimizeOutputPath: getWinMarginMethodsOptimizeOutputPath(defaultWinMarginMethodsOptimizeEndYear),
      historicalOutputDir: DEFAULTS.historicalOutputDir,
      historicalOutputPrefix: DEFAULTS.historicalOutputPrefix,
      historicalMode: DEFAULTS.historicalMode,
      historicalSeedStartYear: DEFAULTS.historicalSeedStartYear,
      historicalOutputStartYear: DEFAULTS.historicalOutputStartYear
    }
  };
}

function toPosixRelativePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function buildRunLogRelativePath(runId, timestampIso) {
  const timestamp = new Date(timestampIso);
  const year = String(timestamp.getUTCFullYear());
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');

  return path.posix.join('logs', 'admin-scripts', year, month, `run-${runId}.log`);
}

function resolveRunLogAbsolutePath(logPath) {
  const absolutePath = path.resolve(PROJECT_ROOT, logPath);
  if (!ensureInsideProject(absolutePath)) {
    throw new Error('Run log path resolves outside project root');
  }
  return absolutePath;
}

async function ensureRunLogFile(logPath) {
  const absolutePath = resolveRunLogAbsolutePath(logPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.appendFile(absolutePath, '');
  return absolutePath;
}

function sanitizeLogMessage(message) {
  if (message === undefined || message === null) {
    return '';
  }

  const text = String(message).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (text.length === 0) {
    return '';
  }

  if (text.length <= MAX_LOG_MESSAGE_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_LOG_MESSAGE_LENGTH)}...`;
}

async function appendLog(logAbsolutePath, stream, message) {
  const sanitizedMessage = sanitizeLogMessage(message);
  if (!sanitizedMessage) {
    return;
  }

  const entry = {
    created_at: nowIso(),
    stream,
    message: sanitizedMessage
  };
  await fs.appendFile(logAbsolutePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function splitOutputLines(outputChunk) {
  if (outputChunk === undefined || outputChunk === null) {
    return [];
  }

  return String(outputChunk)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function getExistingActiveRun() {
  return getOne(
    `SELECT run_id, script_key, status, created_at
     FROM admin_script_runs
     WHERE status IN (?, ?)
     ORDER BY created_at ASC
     LIMIT 1`,
    [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING]
  );
}

function getCommandString(command, args) {
  return [command, ...args].join(' ');
}

function isPythonCommand(command) {
  const basename = path.basename(String(command || '')).toLowerCase();
  return /^python(\d+(?:\.\d+)?)?$/.test(basename);
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function extractProgressSnapshot(line) {
  if (!line) {
    return null;
  }

  const progressIndex = line.toLowerCase().indexOf('progress');
  if (progressIndex === -1) {
    return null;
  }

  const fractionMatch = line.match(/(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    const numerator = Number.parseInt(fractionMatch[1], 10);
    const denominator = Number.parseInt(fractionMatch[2], 10);
    if (Number.isInteger(numerator) && Number.isInteger(denominator) && denominator > 0) {
      const pct = ((numerator / denominator) * 100).toFixed(0);
      return `${numerator}/${denominator} (${pct}%)`;
    }
  }

  const percentMatch = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    return `${percentMatch[1]}%`;
  }

  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

function parseLogLine(rawLine, runId, seq) {
  const fallbackTimestamp = nowIso();

  try {
    const parsed = JSON.parse(rawLine);
    return {
      log_id: null,
      run_id: runId,
      seq,
      stream: trimToNull(parsed.stream) || 'system',
      message: trimToNull(parsed.message) || '',
      created_at: trimToNull(parsed.created_at) || fallbackTimestamp
    };
  } catch (error) {
    return {
      log_id: null,
      run_id: runId,
      seq,
      stream: 'system',
      message: rawLine,
      created_at: fallbackTimestamp
    };
  }
}

async function buildScriptCommand(scriptKey, params = {}) {
  const yearMax = getYearMax();
  const definition = getScriptDefinition(scriptKey);

  if (!definition) {
    throw new Error('Unsupported script key');
  }

  const normalizedParams = {};

  if (scriptKey === 'sync-games') {
    const year = toInteger(params.year, 'year', { required: false, min: YEAR_MIN, max: yearMax });
    const round = trimToNull(params.round);
    const gameId = toInteger(params.gameId, 'gameId', { required: false, min: 1, max: Number.MAX_SAFE_INTEGER });
    const teamId = toInteger(params.teamId, 'teamId', { required: false, min: 1, max: Number.MAX_SAFE_INTEGER });
    const complete = toInteger(params.complete, 'complete', { required: false, min: 0, max: 100 });

    const args = ['scripts/automation/sync-games.js'];

    if (year !== null) {
      args.push('year', String(year));
      normalizedParams.year = year;
    }
    if (round) {
      args.push('round', round);
      normalizedParams.round = round;
    }
    if (gameId !== null) {
      args.push('game', String(gameId));
      normalizedParams.gameId = gameId;
    }
    if (teamId !== null) {
      args.push('team', String(teamId));
      normalizedParams.teamId = teamId;
    }
    if (complete !== null) {
      args.push('complete', String(complete));
      normalizedParams.complete = complete;
    }

    if (Object.keys(normalizedParams).length === 0) {
      const currentYear = new Date().getFullYear();
      args.push('year', String(currentYear));
      normalizedParams.year = currentYear;
    }

    return {
      command: 'node',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'api-refresh') {
    const year = toInteger(params.year, 'year', { required: true, min: YEAR_MIN, max: yearMax });
    const forceScoreUpdate = normalizeBoolean(params.forceScoreUpdate, false);

    const args = ['scripts/automation/api-refresh.js', '--year', String(year)];
    if (forceScoreUpdate) {
      args.push('--force-score-update');
    }

    normalizedParams.year = year;
    normalizedParams.forceScoreUpdate = forceScoreUpdate;

    return {
      command: 'node',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'combined-predictions') {
    const startYear = toInteger(params.startYear, 'startYear', { required: true, min: YEAR_MIN, max: yearMax });
    const winModelPath = normalizeRepoPath(params.winModelPath, 'winModelPath');
    if (!isWinTrainedModelFile(winModelPath)) {
      throw new Error('winModelPath must reference a trained win model artifact');
    }
    const marginModelPath = normalizeRepoPath(params.marginModelPath, 'marginModelPath');
    const predictorId = toInteger(params.predictorId, 'predictorId', { required: true, min: 1, max: Number.MAX_SAFE_INTEGER });

    await assertActivePredictor(predictorId);

    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const outputDir = normalizeOptionalRepoPath(params.outputDir, 'outputDir', DEFAULTS.combinedOutputDir);
    const futureOnly = normalizeBoolean(params.futureOnly, false);
    const saveToDb = normalizeBoolean(params.saveToDb, true);

    normalizedParams.startYear = startYear;
    normalizedParams.winModelPath = winModelPath;
    normalizedParams.marginModelPath = marginModelPath;
    normalizedParams.predictorId = predictorId;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputDir = outputDir;
    normalizedParams.futureOnly = futureOnly;
    normalizedParams.saveToDb = saveToDb;

    const args = [
      'scripts/elo_predict_combined.py',
      '--start-year', String(startYear),
      '--win-model', winModelPath,
      '--margin-model', marginModelPath,
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--predictor-id', String(predictorId)
    ];

    if (!saveToDb) {
      args.push('--no-save-to-db');
    }
    if (futureOnly) {
      args.push('--future-only');
    }

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'margin-predictions') {
    const startYear = toInteger(params.startYear, 'startYear', { required: true, min: YEAR_MIN, max: yearMax });
    const modelPath = normalizeRepoPath(params.modelPath, 'modelPath');
    const predictorId = toInteger(params.predictorId, 'predictorId', {
      required: true,
      min: 1,
      max: Number.MAX_SAFE_INTEGER
    });

    await assertActivePredictor(predictorId);

    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const outputDir = normalizeOptionalRepoPath(
      params.outputDir,
      'outputDir',
      DEFAULTS.marginPredictionsOutputDir
    );
    const saveToDb = normalizeBoolean(params.saveToDb, true);
    const overrideCompleted = normalizeBoolean(params.overrideCompleted, false);

    normalizedParams.startYear = startYear;
    normalizedParams.modelPath = modelPath;
    normalizedParams.predictorId = predictorId;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputDir = outputDir;
    normalizedParams.saveToDb = saveToDb;
    normalizedParams.overrideCompleted = overrideCompleted;

    const args = [
      'scripts/elo_margin_predict.py',
      '--start-year', String(startYear),
      '--model-path', modelPath,
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--predictor-id', String(predictorId)
    ];

    if (!saveToDb) {
      args.push('--no-save-to-db');
    }
    if (overrideCompleted) {
      args.push('--override-completed');
    }

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'win-margin-methods-predictions') {
    const startYear = toInteger(params.startYear, 'startYear', { required: true, min: YEAR_MIN, max: yearMax });
    const winModelPath = normalizeRepoPath(params.winModelPath, 'winModelPath');
    if (isWinParamsFile(winModelPath) || isWinMarginMethodsFile(winModelPath)) {
      throw new Error('winModelPath must reference a trained win model artifact');
    }
    const allowModelMismatch = normalizeBoolean(params.allowModelMismatch, false);
    const suppliedMarginMethodsPath = normalizeOptionalRepoPath(params.marginMethodsPath, 'marginMethodsPath');
    const marginMethodsPath = suppliedMarginMethodsPath
      || await resolveCompatibleMarginMethodsPath(winModelPath, allowModelMismatch);
    if (!isWinMarginMethodsFile(marginMethodsPath)) {
      throw new Error('marginMethodsPath must reference an optimal_margin_methods artifact');
    }
    await assertCompatibleWinFirstArtifacts(winModelPath, marginMethodsPath, allowModelMismatch);
    const predictorId = toInteger(params.predictorId, 'predictorId', {
      required: true,
      min: 1,
      max: Number.MAX_SAFE_INTEGER
    });
    await assertActivePredictor(predictorId);

    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const outputDir = normalizeOptionalRepoPath(
      params.outputDir,
      'outputDir',
      DEFAULTS.winMarginMethodsOutputDir
    );
    const saveToDb = normalizeBoolean(params.saveToDb, true);
    const futureOnly = normalizeBoolean(params.futureOnly, false);
    const overrideCompleted = normalizeBoolean(params.overrideCompleted, false);
    const methodOverrideRaw = trimToNull(params.methodOverride);
    const allowedMethodOverrides = new Set(['simple', 'linear', 'diminishing_returns']);
    const methodOverride = methodOverrideRaw ? methodOverrideRaw.toLowerCase() : null;

    if (methodOverride && !allowedMethodOverrides.has(methodOverride)) {
      throw new Error('methodOverride must be one of: simple, linear, diminishing_returns');
    }

    normalizedParams.startYear = startYear;
    normalizedParams.winModelPath = winModelPath;
    normalizedParams.marginMethodsPath = marginMethodsPath;
    normalizedParams.predictorId = predictorId;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputDir = outputDir;
    normalizedParams.saveToDb = saveToDb;
    normalizedParams.futureOnly = futureOnly;
    normalizedParams.overrideCompleted = overrideCompleted;
    normalizedParams.methodOverride = methodOverride;
    normalizedParams.allowModelMismatch = allowModelMismatch;

    const args = [
      'scripts/elo_margin_methods_predict.py',
      '--start-year', String(startYear),
      '--elo-model', winModelPath,
      '--margin-methods', marginMethodsPath,
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--predictor-id', String(predictorId)
    ];

    if (!saveToDb) {
      args.push('--no-save-to-db');
    }
    if (futureOnly) {
      args.push('--future-only');
    }
    if (overrideCompleted) {
      args.push('--override-completed');
    }
    if (methodOverride) {
      args.push('--method-override', methodOverride);
    }
    if (allowModelMismatch) {
      args.push('--allow-model-mismatch');
    }

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'win-margin-methods-optimize') {
    const startYear = toInteger(params.startYear, 'startYear', { required: false, min: YEAR_MIN, max: yearMax }) || YEAR_MIN;
    const endYear = toInteger(params.endYear, 'endYear', { required: false, min: YEAR_MIN, max: yearMax })
      || getDefaultWinMarginMethodsOptimizeEndYear();
    if (startYear > endYear) {
      throw new Error('startYear cannot be greater than endYear');
    }

    const eloParamsPath = normalizeRepoPath(params.eloParamsPath, 'eloParamsPath');
    if (isWinMarginMethodsFile(eloParamsPath)) {
      throw new Error('eloParamsPath must reference a win model/params artifact, not a margin methods artifact');
    }
    const nCalls = toInteger(params.nCalls, 'nCalls', { required: false, min: 1, max: 5000 }) ?? 100;
    const randomSeed = toInteger(
      params.randomSeed,
      'randomSeed',
      { required: false, min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }
    ) ?? 42;
    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const requestedOutputPath = trimToNull(params.outputPath);
    const outputPathInput = requestedOutputPath === LEGACY_WIN_MARGIN_METHODS_OUTPUT_PATH
      ? null
      : requestedOutputPath;
    const outputPath = normalizeOptionalRepoPath(
      outputPathInput,
      'outputPath',
      getWinMarginMethodsOptimizeOutputPath(endYear)
    );

    normalizedParams.eloParamsPath = eloParamsPath;
    normalizedParams.startYear = startYear;
    normalizedParams.endYear = endYear;
    normalizedParams.nCalls = nCalls;
    normalizedParams.randomSeed = randomSeed;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputPath = outputPath;

    const args = [
      'scripts/elo_margin_methods_optimize.py',
      '--elo-params', eloParamsPath,
      '--start-year', String(startYear),
      '--end-year', String(endYear),
      '--n-calls', String(nCalls),
      '--random-seed', String(randomSeed),
      '--db-path', dbPath,
      '--output-path', outputPath
    ];

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'win-train') {
    const startYear = toInteger(params.startYear, 'startYear', { required: false, min: YEAR_MIN, max: yearMax }) || YEAR_MIN;
    const endYear = toInteger(params.endYear, 'endYear', { required: false, min: YEAR_MIN, max: yearMax }) || new Date().getFullYear();
    if (startYear > endYear) {
      throw new Error('startYear cannot be greater than endYear');
    }

    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const outputDir = normalizeOptionalRepoPath(params.outputDir, 'outputDir', DEFAULTS.winModelOutputDir);
    const noTuneParameters = normalizeBoolean(params.noTuneParameters, false);
    const cvFolds = toInteger(params.cvFolds, 'cvFolds', { required: false, min: 2, max: 10 }) || 3;
    const maxCombinations = toInteger(params.maxCombinations, 'maxCombinations', { required: false, min: 1, max: 5000 }) || 500;
    const paramsFile = normalizeOptionalRepoPath(params.paramsFile, 'paramsFile');
    const marginMethodsNCalls = toInteger(params.marginMethodsNCalls, 'marginMethodsNCalls', { required: false, min: 1, max: 5000 }) || 100;
    const marginMethodsRandomSeed = toInteger(
      params.marginMethodsRandomSeed,
      'marginMethodsRandomSeed',
      { required: false, min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }
    ) ?? 42;
    if (paramsFile && (isWinTrainedModelFile(paramsFile) || isWinMarginMethodsFile(paramsFile))) {
      throw new Error('paramsFile must reference an optimal_elo_params_win artifact');
    }

    normalizedParams.startYear = startYear;
    normalizedParams.endYear = endYear;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputDir = outputDir;
    normalizedParams.noTuneParameters = noTuneParameters;
    normalizedParams.cvFolds = cvFolds;
    normalizedParams.maxCombinations = maxCombinations;
    normalizedParams.paramsFile = paramsFile;
    normalizedParams.marginMethodsNCalls = marginMethodsNCalls;
    normalizedParams.marginMethodsRandomSeed = marginMethodsRandomSeed;

    const args = [
      'scripts/elo_win_train.py',
      '--start-year', String(startYear),
      '--end-year', String(endYear),
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--cv-folds', String(cvFolds),
      '--max-combinations', String(maxCombinations),
      '--margin-methods-n-calls', String(marginMethodsNCalls),
      '--margin-methods-random-seed', String(marginMethodsRandomSeed)
    ];

    if (noTuneParameters) {
      args.push('--no-tune-parameters');
    }
    if (paramsFile) {
      args.push('--params-file', paramsFile);
    }

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'margin-optimize') {
    const startYear = toInteger(params.startYear, 'startYear', { required: false, min: YEAR_MIN, max: yearMax }) || YEAR_MIN;
    const endYear = toInteger(params.endYear, 'endYear', { required: false, min: YEAR_MIN, max: yearMax })
      || getDefaultMarginOptimizeEndYear();
    if (startYear > endYear) {
      throw new Error('startYear cannot be greater than endYear');
    }

    const maxCombinations = toInteger(params.maxCombinations, 'maxCombinations', {
      required: false,
      min: 1,
      max: 5000
    }) || 500;
    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const requestedOutputPath = trimToNull(params.outputPath);
    const outputPathInput = requestedOutputPath === LEGACY_MARGIN_OPTIMIZE_OUTPUT_PATH
      ? null
      : requestedOutputPath;
    const outputPath = normalizeOptionalRepoPath(
      outputPathInput,
      'outputPath',
      getMarginOptimizeOutputPath(endYear)
    );

    normalizedParams.startYear = startYear;
    normalizedParams.endYear = endYear;
    normalizedParams.maxCombinations = maxCombinations;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputPath = outputPath;

    const args = [
      'scripts/elo_margin_optimize.py',
      '--start-year', String(startYear),
      '--end-year', String(endYear),
      '--max-combinations', String(maxCombinations),
      '--db-path', dbPath,
      '--output-path', outputPath
    ];

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'margin-train') {
    const paramsFile = normalizeRepoPath(params.paramsFile, 'paramsFile');
    const startYear = toInteger(params.startYear, 'startYear', { required: false, min: YEAR_MIN, max: yearMax }) || YEAR_MIN;
    const endYear = toInteger(params.endYear, 'endYear', { required: false, min: YEAR_MIN, max: yearMax }) || 2024;
    if (startYear > endYear) {
      throw new Error('startYear cannot be greater than endYear');
    }

    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const outputDir = normalizeOptionalRepoPath(params.outputDir, 'outputDir', DEFAULTS.marginModelOutputDir);

    normalizedParams.paramsFile = paramsFile;
    normalizedParams.startYear = startYear;
    normalizedParams.endYear = endYear;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputDir = outputDir;

    const args = [
      'scripts/elo_margin_train.py',
      '--params-file', paramsFile,
      '--start-year', String(startYear),
      '--end-year', String(endYear),
      '--db-path', dbPath,
      '--output-dir', outputDir
    ];

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'elo-history') {
    const modelPath = normalizeRepoPath(params.modelPath, 'modelPath');
    const modeRaw = trimToNull(params.mode) || DEFAULTS.historicalMode;
    const mode = ['full', 'incremental'].includes(modeRaw) ? modeRaw : null;
    if (!mode) {
      throw new Error('mode must be one of: full, incremental');
    }

    const legacyStartYear = toInteger(params.startYear, 'startYear', { required: false, min: YEAR_MIN, max: yearMax });
    const legacyEndYear = toInteger(params.endYear, 'endYear', { required: false, min: YEAR_MIN, max: yearMax });
    const seedStartYear = toInteger(params.seedStartYear, 'seedStartYear', {
      required: false,
      min: YEAR_MIN,
      max: yearMax
    }) || legacyStartYear || DEFAULTS.historicalSeedStartYear;
    const seedEndYear = toInteger(params.seedEndYear, 'seedEndYear', {
      required: false,
      min: YEAR_MIN,
      max: yearMax
    }) || legacyEndYear;
    const outputStartYear = toInteger(params.outputStartYear, 'outputStartYear', {
      required: false,
      min: YEAR_MIN,
      max: yearMax
    }) || legacyStartYear || DEFAULTS.historicalOutputStartYear;
    const outputEndYear = toInteger(params.outputEndYear, 'outputEndYear', {
      required: false,
      min: YEAR_MIN,
      max: yearMax
    }) || legacyEndYear;

    if (seedEndYear !== null && seedStartYear > seedEndYear) {
      throw new Error('seedStartYear cannot be greater than seedEndYear');
    }
    if (outputEndYear !== null && outputStartYear > outputEndYear) {
      throw new Error('outputStartYear cannot be greater than outputEndYear');
    }

    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const outputDir = normalizeOptionalRepoPath(params.outputDir, 'outputDir', DEFAULTS.historicalOutputDir);
    const outputPrefix = trimToNull(params.outputPrefix) || DEFAULTS.historicalOutputPrefix;

    normalizedParams.modelPath = modelPath;
    normalizedParams.mode = mode;
    normalizedParams.seedStartYear = seedStartYear;
    normalizedParams.seedEndYear = seedEndYear;
    normalizedParams.outputStartYear = outputStartYear;
    normalizedParams.outputEndYear = outputEndYear;
    normalizedParams.startYear = legacyStartYear;
    normalizedParams.endYear = legacyEndYear;
    normalizedParams.dbPath = dbPath;
    normalizedParams.outputDir = outputDir;
    normalizedParams.outputPrefix = outputPrefix;

    const args = [
      'scripts/elo_history_generator.py',
      '--model-path', modelPath,
      '--mode', mode,
      '--seed-start-year', String(seedStartYear),
      '--output-start-year', String(outputStartYear),
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--output-prefix', outputPrefix
    ];

    if (seedEndYear !== null) {
      args.push('--seed-end-year', String(seedEndYear));
    }
    if (outputEndYear !== null) {
      args.push('--output-end-year', String(outputEndYear));
    }

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  if (scriptKey === 'season-simulation') {
    const year = toInteger(params.year, 'year', { required: true, min: YEAR_MIN, max: yearMax });
    const modelPath = normalizeRepoPath(params.modelPath, 'modelPath');
    const winModelPath = normalizeOptionalRepoPath(params.winModelPath, 'winModelPath');
    if (winModelPath && (isWinParamsFile(winModelPath) || isWinMarginMethodsFile(winModelPath))) {
      throw new Error('winModelPath must reference a trained win model artifact');
    }
    const dbPath = normalizeOptionalRepoPath(params.dbPath, 'dbPath', DEFAULTS.dbPath);
    const numSimulations = toInteger(params.numSimulations, 'numSimulations', {
      required: false,
      min: 1000,
      max: 200000
    }) || 50000;
    const fromScratch = normalizeBoolean(params.fromScratch, false);
    const backfillRoundSnapshots = normalizeBoolean(params.backfillRoundSnapshots, false);

    if (fromScratch && backfillRoundSnapshots) {
      throw new Error('fromScratch cannot be combined with backfillRoundSnapshots');
    }

    const output = normalizeOutputPathForSimulation(year, fromScratch, params.output);

    normalizedParams.year = year;
    normalizedParams.modelPath = modelPath;
    normalizedParams.winModelPath = winModelPath;
    normalizedParams.dbPath = dbPath;
    normalizedParams.numSimulations = numSimulations;
    normalizedParams.fromScratch = fromScratch;
    normalizedParams.backfillRoundSnapshots = backfillRoundSnapshots;
    normalizedParams.output = output;

    const args = [
      'scripts/season_simulator.py',
      '--year', String(year),
      '--model-path', modelPath,
      '--db-path', dbPath,
      '--num-simulations', String(numSimulations),
      '--output', output
    ];

    if (winModelPath) {
      args.push('--win-model', winModelPath);
    }
    if (fromScratch) {
      args.push('--from-scratch');
    }
    if (backfillRoundSnapshots) {
      args.push('--backfill-round-snapshots');
    }

    return {
      command: 'python3',
      args,
      normalizedParams
    };
  }

  throw new Error('Unsupported script key');
}

async function startScriptRun(scriptKey, params, adminUserId) {
  if (!adminUserId) {
    throw new Error('Admin user is required');
  }

  if (activeProcess) {
    const conflictError = new Error('An admin script is already running');
    conflictError.code = 'ACTIVE_RUN_EXISTS';
    throw conflictError;
  }

  const dbActiveRun = await getExistingActiveRun();
  if (dbActiveRun) {
    const conflictError = new Error('An admin script is already running');
    conflictError.code = 'ACTIVE_RUN_EXISTS';
    throw conflictError;
  }

  const commandSpec = await buildScriptCommand(scriptKey, params || {});

  const createdAt = nowIso();
  const insertResult = await runQuery(
    `INSERT INTO admin_script_runs (
      script_key,
      status,
      created_by_predictor_id,
      created_at
    ) VALUES (?, ?, ?, ?)`,
    [
      scriptKey,
      RUN_STATUS.QUEUED,
      adminUserId,
      createdAt
    ]
  );

  const runId = insertResult.lastID;
  const startedAt = nowIso();
  const runLogPath = buildRunLogRelativePath(runId, startedAt);
  let runLogAbsolutePath;

  try {
    runLogAbsolutePath = await ensureRunLogFile(runLogPath);
  } catch (error) {
    const message = `Failed to initialise run log file: ${error.message}`;
    await runQuery(
      `UPDATE admin_script_runs
       SET status = ?, started_at = ?, finished_at = ?, error_message = ?, log_path = ?
       WHERE run_id = ?`,
      [RUN_STATUS.FAILED, startedAt, nowIso(), message, runLogPath, runId]
    );
    throw new Error(message);
  }

  await runQuery(
    `UPDATE admin_script_runs
     SET status = ?, started_at = ?, log_path = ?
     WHERE run_id = ?`,
    [RUN_STATUS.RUNNING, startedAt, runLogPath, runId]
  );

  let logQueue = Promise.resolve();
  let logWriteFailureMessage = null;
  let child = null;
  let finalized = false;
  let heartbeatTimer = null;
  const runStartedAtMs = Date.now();
  let lastOutputAtMs = runStartedAtMs;
  let stdoutLineCount = 0;
  let stderrLineCount = 0;
  let lastHeartbeatStdoutCount = 0;
  let lastHeartbeatStderrCount = 0;
  let lastProgressSnapshot = null;

  const queueLog = (stream, message) => {
    if (logWriteFailureMessage) {
      return;
    }

    logQueue = logQueue
      .then(() => appendLog(runLogAbsolutePath, stream, message))
      .catch((error) => {
        logWriteFailureMessage = `Failed to write run log: ${error.message}`;
        logger.error('Failed to write admin script run log file', {
          runId,
          error: error.message
        });

        if (child && !child.killed) {
          child.kill('SIGTERM');
        }
      });
  };

  const spawnArgs = [...commandSpec.args];
  if (isPythonCommand(commandSpec.command) && spawnArgs[0] !== '-u') {
    spawnArgs.unshift('-u');
  }

  child = spawn(commandSpec.command, spawnArgs, {
    cwd: PROJECT_ROOT,
    env: buildChildProcessEnv({ PYTHONUNBUFFERED: '1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  activeProcess = {
    runId,
    scriptKey,
    command: commandSpec.command,
    args: spawnArgs,
    child
  };

  queueLog('system', `Starting command: ${getCommandString(commandSpec.command, spawnArgs)}`);

  heartbeatTimer = setInterval(() => {
    if (finalized) {
      return;
    }

    const now = Date.now();
    const elapsed = formatDurationMs(now - runStartedAtMs);
    const idle = formatDurationMs(now - lastOutputAtMs);
    const stdoutDelta = stdoutLineCount - lastHeartbeatStdoutCount;
    const stderrDelta = stderrLineCount - lastHeartbeatStderrCount;
    const progressSuffix = lastProgressSnapshot ? ` | latest progress ${lastProgressSnapshot}` : '';

    queueLog(
      'system',
      `Progress snapshot: elapsed ${elapsed} | stdout lines ${stdoutLineCount} (+${stdoutDelta}) `
      + `| stderr lines ${stderrLineCount} (+${stderrDelta}) | idle ${idle}${progressSuffix}`
    );

    lastHeartbeatStdoutCount = stdoutLineCount;
    lastHeartbeatStderrCount = stderrLineCount;
  }, RUN_HEARTBEAT_INTERVAL_MS);

  const finalizeRun = async (status, exitCode, errorMessage) => {
    if (finalized) {
      return;
    }
    finalized = true;

    if (status === RUN_STATUS.SUCCEEDED) {
      queueLog('system', `Run completed successfully (exit code ${exitCode})`);
    } else {
      queueLog('system', errorMessage || `Run failed (exit code ${exitCode})`);
    }

    try {
      await logQueue;

      await runQuery(
        `UPDATE admin_script_runs
         SET status = ?, exit_code = ?, error_message = ?, finished_at = ?
         WHERE run_id = ?`,
        [status, exitCode, errorMessage || null, nowIso(), runId]
      );
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (activeProcess && activeProcess.runId === runId) {
        activeProcess = null;
      }
    }
  };

  child.stdout.on('data', (buffer) => {
    lastOutputAtMs = Date.now();
    splitOutputLines(buffer).forEach((line) => {
      stdoutLineCount += 1;
      const snapshot = extractProgressSnapshot(line);
      if (snapshot) {
        lastProgressSnapshot = snapshot;
      }
      queueLog('stdout', line);
    });
  });

  child.stderr.on('data', (buffer) => {
    lastOutputAtMs = Date.now();
    splitOutputLines(buffer).forEach((line) => {
      stderrLineCount += 1;
      const snapshot = extractProgressSnapshot(line);
      if (snapshot) {
        lastProgressSnapshot = snapshot;
      }
      queueLog('stderr', line);
    });
  });

  child.on('error', (error) => {
    const message = `Process failed to start: ${error.message}`;
    finalizeRun(RUN_STATUS.FAILED, null, message).catch((finalizeError) => {
      logger.error('Failed finalizing errored run', {
        runId,
        error: finalizeError.message
      });
    });
  });

  child.on('close', (code) => {
    const exitCode = Number.isInteger(code) ? code : null;
    const effectiveError = logWriteFailureMessage;

    if (effectiveError) {
      finalizeRun(RUN_STATUS.FAILED, exitCode, effectiveError).catch((error) => {
        logger.error('Failed finalizing log-write-failed run', {
          runId,
          error: error.message
        });
      });
      return;
    }

    if (exitCode === 0) {
      finalizeRun(RUN_STATUS.SUCCEEDED, exitCode, null).catch((error) => {
        logger.error('Failed finalizing successful run', {
          runId,
          error: error.message
        });
      });
      return;
    }

    const message = `Process exited with code ${exitCode === null ? 'unknown' : exitCode}`;
    finalizeRun(RUN_STATUS.FAILED, exitCode, message).catch((error) => {
      logger.error('Failed finalizing failed run', {
        runId,
        error: error.message
      });
    });
  });

  logger.info('Started admin script run', {
    runId,
    scriptKey,
    adminUserId,
    logPath: toPosixRelativePath(path.relative(PROJECT_ROOT, runLogAbsolutePath)),
    command: commandSpec.command,
    args: spawnArgs
  });

  return {
    runId,
    scriptKey,
    status: RUN_STATUS.RUNNING,
    startedAt
  };
}

async function listRuns(limit = 20, options = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
  const scriptKeys = Array.isArray(options.scriptKeys)
    ? options.scriptKeys.filter((key) => typeof key === 'string' && key.length > 0)
    : [];
  const excludeScriptKeys = Array.isArray(options.excludeScriptKeys)
    ? options.excludeScriptKeys.filter((key) => typeof key === 'string' && key.length > 0)
    : [];
  const whereClauses = [];
  const params = [];

  if (scriptKeys.length > 0) {
    whereClauses.push(`r.script_key IN (${scriptKeys.map(() => '?').join(', ')})`);
    params.push(...scriptKeys);
  }

  if (excludeScriptKeys.length > 0) {
    whereClauses.push(`r.script_key NOT IN (${excludeScriptKeys.map(() => '?').join(', ')})`);
    params.push(...excludeScriptKeys);
  }

  params.push(safeLimit);

  const rows = await getQuery(
    `SELECT
      r.run_id,
      r.script_key,
      r.status,
      r.created_by_predictor_id,
      r.created_at,
      r.started_at,
      r.finished_at,
      r.exit_code,
      r.error_message,
      r.log_path,
      COALESCE(p.display_name, p.name) AS created_by_name
     FROM admin_script_runs r
     LEFT JOIN predictors p ON p.predictor_id = r.created_by_predictor_id
     ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC
     LIMIT ?`,
    params
  );

  return rows.map((row) => ({
    run_id: row.run_id,
    script_key: row.script_key,
    status: row.status,
    created_by_predictor_id: row.created_by_predictor_id,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    exit_code: row.exit_code,
    error_message: row.error_message,
    log_path: row.log_path
  }));
}

async function getRunById(runId) {
  const row = await getOne(
    `SELECT
      r.run_id,
      r.script_key,
      r.status,
      r.created_by_predictor_id,
      r.created_at,
      r.started_at,
      r.finished_at,
      r.exit_code,
      r.error_message,
      r.log_path,
      COALESCE(p.display_name, p.name) AS created_by_name
     FROM admin_script_runs r
     LEFT JOIN predictors p ON p.predictor_id = r.created_by_predictor_id
     WHERE r.run_id = ?`,
    [runId]
  );

  if (!row) {
    return null;
  }

  return {
    run_id: row.run_id,
    script_key: row.script_key,
    status: row.status,
    created_by_predictor_id: row.created_by_predictor_id,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    exit_code: row.exit_code,
    error_message: row.error_message,
    log_path: row.log_path
  };
}

async function getRunLogs(runId, afterSeq = 0, limit = 300) {
  const safeAfterSeq = Number.isInteger(afterSeq) ? Math.max(0, afterSeq) : 0;
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 2000)) : 300;
  const run = await getOne(
    'SELECT run_id, log_path FROM admin_script_runs WHERE run_id = ?',
    [runId]
  );

  if (!run || !run.log_path) {
    return safeAfterSeq >= 1
      ? []
      : [{
        log_id: null,
        run_id: runId,
        seq: 1,
        stream: 'system',
        message: 'No log file is available for this run.',
        created_at: nowIso()
      }];
  }

  let logAbsolutePath;
  try {
    logAbsolutePath = resolveRunLogAbsolutePath(run.log_path);
  } catch (error) {
    logger.error('Invalid run log path', { runId, logPath: run.log_path, error: error.message });
    return safeAfterSeq >= 1
      ? []
      : [{
        log_id: null,
        run_id: runId,
        seq: 1,
        stream: 'system',
        message: 'Run log path is invalid.',
        created_at: nowIso()
      }];
  }

  let fileContents;
  try {
    fileContents = await fs.readFile(logAbsolutePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return safeAfterSeq >= 1
        ? []
        : [{
          log_id: null,
          run_id: runId,
          seq: 1,
          stream: 'system',
          message: 'Log file is unavailable for this run.',
          created_at: nowIso()
        }];
    }

    throw error;
  }

  const allLines = fileContents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const output = [];
  for (let index = safeAfterSeq; index < allLines.length; index += 1) {
    output.push(parseLogLine(allLines[index], runId, index + 1));
    if (output.length >= safeLimit) {
      break;
    }
  }

  return output;
}

async function recoverInterruptedRuns() {
  const interruptedAt = nowIso();
  const result = await runQuery(
    `UPDATE admin_script_runs
     SET
      status = ?,
      finished_at = ?,
      error_message = COALESCE(error_message, 'Server restarted before completion')
     WHERE status IN (?, ?) AND finished_at IS NULL`,
    [RUN_STATUS.INTERRUPTED, interruptedAt, RUN_STATUS.QUEUED, RUN_STATUS.RUNNING]
  );

  if (result.changes > 0) {
    logger.warn('Recovered interrupted admin script runs', {
      count: result.changes
    });
  }

  activeProcess = null;
  return result.changes;
}

module.exports = {
  RUN_STATUS,
  getScriptMetadata,
  startScriptRun,
  listRuns,
  getRunById,
  getRunLogs,
  recoverInterruptedRuns,
  getExistingActiveRun,
  __testables: {
    assertActivePredictor,
    buildScriptCommand,
    chooseDefaultPredictorId,
    normalizeBoolean,
    normalizeRepoPath,
    toInteger
  }
};
