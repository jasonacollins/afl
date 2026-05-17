const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../utils/logger');

const PROJECT_ROOT = path.join(__dirname, '..');

const MODEL_DIRECTORIES = [
  'data/models/win',
  'data/models/margin'
];

const OUTPUT_DIRECTORIES = [
  'data/predictions/win',
  'data/predictions/margin',
  'data/predictions/combined',
  'data/historical',
  'data/simulations'
];

const ARTIFACT_KIND_LABELS = {
  trained_win_model: 'Win model',
  trained_margin_model: 'Margin model',
  win_params: 'Win params',
  margin_params: 'Margin params',
  win_margin_methods: 'Win margin methods',
  unknown_model_artifact: 'Model artifact'
};

const OUTPUT_KIND_LABELS = {
  win_predictions: 'Win predictions',
  win_training_predictions: 'Win training predictions',
  win_margin_method_predictions: 'Win margin-method predictions',
  margin_predictions: 'Margin predictions',
  combined_predictions: 'Combined predictions',
  rating_history: 'Rating history',
  elo_history: 'ELO history',
  season_simulation: 'Season simulation',
  unknown_output: 'Output file'
};

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function resolveRepoPath(relativePath) {
  return path.resolve(PROJECT_ROOT, relativePath);
}

function getFileName(relativePath) {
  return path.posix.basename(toPosixPath(relativePath));
}

function parseYear(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1800 && parsed <= 3000 ? parsed : null;
}

function extractTrainedToYearFromPath(relativePath) {
  const match = String(relativePath || '').match(/trained_to_(\d{4})/i);
  return match ? parseYear(match[1]) : null;
}

function extractSeasonRangeFromPath(relativePath) {
  const filename = getFileName(relativePath);
  const match = filename.match(/(?:predictions|simulation|history)(?:_from)?_(\d{4})(?:_(\d{4}))?/i)
    || filename.match(/_(\d{4})_(\d{4})\./);

  if (!match) {
    const singleYear = filename.match(/(\d{4})/);
    const year = singleYear ? parseYear(singleYear[1]) : null;
    return year ? { startYear: year, endYear: year } : null;
  }

  const startYear = parseYear(match[1]);
  const endYear = parseYear(match[2]) || startYear;
  return startYear ? { startYear, endYear } : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 4) {
  const number = numberOrNull(value);
  if (number === null) {
    return null;
  }

  return number.toFixed(digits);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function getNestedNumber(object, pathParts) {
  let cursor = object;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object') {
      return null;
    }
    cursor = cursor[part];
  }
  return numberOrNull(cursor);
}

function inferTrainWindow(modelData, relativePath) {
  const trainWindow = modelData && typeof modelData.train_window === 'object'
    ? modelData.train_window
    : null;
  const trainingWindow = modelData && typeof modelData.training_window === 'object'
    ? modelData.training_window
    : null;
  const optimizationDetails = modelData && typeof modelData.optimization_details === 'object'
    ? modelData.optimization_details
    : null;

  const startYear = parseYear(
    trainWindow?.start_year
      || trainingWindow?.start_year
      || optimizationDetails?.start_year
  );

  const endYear = parseYear(
    modelData?.trained_through_year
      || trainWindow?.end_year
      || trainWindow?.trained_through_year
      || trainingWindow?.end_year
      || trainingWindow?.trained_through_year
      || optimizationDetails?.end_year
      || optimizationDetails?.trained_through_year
      || modelData?.required_win_model?.train_end_year
      || extractTrainedToYearFromPath(relativePath)
  );

  if (!startYear && !endYear) {
    return null;
  }

  return { startYear, endYear };
}

function inferArtifactKind(relativePath, modelData = {}) {
  const filename = getFileName(relativePath).toLowerCase();
  const artifactType = String(modelData.artifact_type || '').toLowerCase();
  const modelType = String(modelData.model_type || '').toLowerCase();
  const hasTeamRatings = Boolean(modelData.team_ratings && typeof modelData.team_ratings === 'object');

  if (artifactType === 'win_margin_methods' || /^optimal_margin_methods(?:_trained_to_\d{4})?\.json$/i.test(filename)) {
    return 'win_margin_methods';
  }
  if (/^optimal_elo_params_win(?:_trained_to_\d{4})?\.json$/i.test(filename)) {
    return 'win_params';
  }
  if (/^optimal_margin_only_elo_params(?:_trained_to_\d{4})?\.json$/i.test(filename)) {
    return 'margin_params';
  }
  if (/^afl_elo_win_trained_to_\d{4}\.json$/i.test(filename)) {
    return 'trained_win_model';
  }
  if (/^afl_elo_margin_only_trained_to_\d{4}\.json$/i.test(filename)) {
    return 'trained_margin_model';
  }
  if (modelType === 'win_elo' && hasTeamRatings) {
    return 'trained_win_model';
  }
  if (['margin_only_elo', 'margin_elo'].includes(modelType) && hasTeamRatings) {
    return 'trained_margin_model';
  }
  if (['margin_only_elo', 'margin_elo'].includes(modelType)) {
    return 'margin_params';
  }

  return 'unknown_model_artifact';
}

function getArtifactFamily(kind) {
  if (kind === 'trained_margin_model' || kind === 'margin_params') {
    return 'margin';
  }
  if (kind === 'trained_win_model' || kind === 'win_params' || kind === 'win_margin_methods') {
    return 'win';
  }
  return 'unknown';
}

function inferArtifactMetrics(kind, modelData = {}) {
  const metrics = [];

  const addMetric = (key, label, value, digits = 4) => {
    const number = numberOrNull(value);
    if (number === null) {
      return;
    }
    metrics.push({
      key,
      label,
      value: number,
      displayValue: formatNumber(number, digits)
    });
  };

  if (kind === 'trained_win_model') {
    addMetric('brier_score', 'Brier', getNestedNumber(modelData, ['performance_metrics', 'brier_score']));
    addMetric('accuracy', 'Accuracy', getNestedNumber(modelData, ['performance_metrics', 'accuracy']));
    addMetric('bits_score_per_game', 'Bits/game', getNestedNumber(modelData, ['performance_metrics', 'bits_score_per_game']));
  } else if (kind === 'trained_margin_model') {
    addMetric('mae', 'MAE', firstNumber(modelData.mae, getNestedNumber(modelData, ['performance', 'mae'])), 2);
    addMetric('rmse', 'RMSE', getNestedNumber(modelData, ['performance', 'rmse']), 2);
  } else if (kind === 'win_params') {
    addMetric('best_log_loss', 'Log loss', firstNumber(modelData.best_log_loss, modelData.best_score));
  } else if (kind === 'margin_params') {
    addMetric('mae', 'MAE', firstNumber(modelData.mae, modelData.best_score), 2);
  } else if (kind === 'win_margin_methods') {
    addMetric('best_score', 'MAE', modelData.best_score, 2);
    addMetric('best_unweighted_split_mae', 'Split MAE', modelData.best_unweighted_split_mae, 2);
  }

  return metrics;
}

function formatTrainWindow(trainWindow) {
  if (!trainWindow) {
    return null;
  }
  if (trainWindow.startYear && trainWindow.endYear) {
    return `${trainWindow.startYear}-${trainWindow.endYear}`;
  }
  if (trainWindow.endYear) {
    return `through ${trainWindow.endYear}`;
  }
  if (trainWindow.startYear) {
    return `from ${trainWindow.startYear}`;
  }
  return null;
}

function buildArtifactLabel(entry) {
  const parts = [entry.kindLabel];
  const trainedLabel = formatTrainWindow(entry.trainWindow);
  if (trainedLabel) {
    parts.push(`trained ${trainedLabel}`);
  }
  if (entry.metrics.length > 0) {
    const metric = entry.metrics[0];
    parts.push(`${metric.label} ${metric.displayValue}`);
  }
  return `${parts.join(' - ')} (${entry.fileName})`;
}

function buildArtifactDetail(entry) {
  const details = [];
  if (entry.trainWindow) {
    details.push(`training ${formatTrainWindow(entry.trainWindow)}`);
  }
  if (entry.metrics.length > 0) {
    details.push(entry.metrics.map((metric) => `${metric.label} ${metric.displayValue}`).join(', '));
  }
  if (entry.compatibility?.requiredWinModelTrainEndYear) {
    details.push(`requires win model through ${entry.compatibility.requiredWinModelTrainEndYear}`);
  }
  if (entry.isLegacy) {
    details.push('legacy metadata');
  }
  return details.join(' | ');
}

async function readJson(relativePath) {
  try {
    const raw = await fs.readFile(resolveRepoPath(relativePath), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    logger.warn('Unable to read catalog JSON file', {
      path: relativePath,
      error: error.message
    });
    return null;
  }
}

async function statPath(relativePath) {
  try {
    return await fs.stat(resolveRepoPath(relativePath));
  } catch (error) {
    return null;
  }
}

async function listDirectoryFiles(relativeDir, predicate) {
  try {
    const entries = await fs.readdir(resolveRepoPath(relativeDir), { withFileTypes: true });
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .filter((entry) => entry.isFile && entry.isFile())
      .map((entry) => path.posix.join(relativeDir, entry.name))
      .filter((relativePath) => !predicate || predicate(relativePath))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    logger.warn('Unable to list catalog directory', {
      directory: relativeDir,
      error: error.message
    });
    return [];
  }
}

async function listModelFiles() {
  const nested = await Promise.all(MODEL_DIRECTORIES.map((directory) =>
    listDirectoryFiles(directory, (relativePath) => relativePath.endsWith('.json'))
  ));
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

async function buildModelArtifactEntry(relativePath) {
  const [modelData, stat] = await Promise.all([
    readJson(relativePath),
    statPath(relativePath)
  ]);
  const data = modelData || {};
  const kind = inferArtifactKind(relativePath, data);
  const trainWindow = inferTrainWindow(data, relativePath);
  const metrics = inferArtifactMetrics(kind, data);
  const entry = {
    id: relativePath,
    path: relativePath,
    fileName: getFileName(relativePath),
    kind,
    kindLabel: ARTIFACT_KIND_LABELS[kind] || ARTIFACT_KIND_LABELS.unknown_model_artifact,
    family: getArtifactFamily(kind),
    trainWindow,
    trainedThroughYear: trainWindow?.endYear || extractTrainedToYearFromPath(relativePath),
    metrics,
    compatibility: {
      requiredWinModelTrainEndYear: parseYear(data.required_win_model?.train_end_year)
    },
    createdAt: data.created_at || null,
    modifiedAt: stat ? stat.mtime.toISOString() : null,
    sizeBytes: stat ? stat.size : null,
    isLegacy: !data.artifact_type && !data.trained_through_year && !data.train_window,
    source: modelData ? 'json' : 'filename'
  };

  return {
    ...entry,
    label: buildArtifactLabel(entry),
    detail: buildArtifactDetail(entry)
  };
}

function sortArtifacts(artifacts) {
  return [...artifacts].sort((left, right) => {
    const yearDiff = (right.trainedThroughYear || 0) - (left.trainedThroughYear || 0);
    if (yearDiff !== 0) {
      return yearDiff;
    }
    const kindDiff = left.kindLabel.localeCompare(right.kindLabel);
    if (kindDiff !== 0) {
      return kindDiff;
    }
    return left.path.localeCompare(right.path);
  });
}

function groupArtifactsByKind(artifacts) {
  return artifacts.reduce((groups, artifact) => {
    if (!groups[artifact.kind]) {
      groups[artifact.kind] = [];
    }
    groups[artifact.kind].push(artifact);
    return groups;
  }, {});
}

async function getModelCatalog(options = {}) {
  const providedModelFiles = options.modelFiles
    ? Object.values(options.modelFiles).flat().filter(Boolean)
    : null;
  const modelFiles = providedModelFiles
    ? [...new Set(providedModelFiles)].sort((a, b) => a.localeCompare(b))
    : await listModelFiles();
  const artifacts = sortArtifacts(await Promise.all(modelFiles.map(buildModelArtifactEntry)));

  return {
    artifacts,
    byKind: groupArtifactsByKind(artifacts)
  };
}

async function readTextMetadata(relativePath) {
  try {
    const raw = await fs.readFile(resolveRepoPath(relativePath), 'utf8');
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    return {
      header: lines[0] || null,
      rowCount: Math.max(0, lines.length - 1)
    };
  } catch (error) {
    logger.warn('Unable to read catalog text file', {
      path: relativePath,
      error: error.message
    });
    return {
      header: null,
      rowCount: null
    };
  }
}

function inferOutputKind(relativePath) {
  const filename = getFileName(relativePath).toLowerCase();
  if (filename.endsWith('.json') && filename.startsWith('season_simulation_')) {
    return 'season_simulation';
  }
  if (filename === 'afl_elo_complete_history.csv') {
    return 'elo_history';
  }
  if (filename.includes('rating_history')) {
    return 'rating_history';
  }
  if (filename.startsWith('combined_elo_predictions')) {
    return 'combined_predictions';
  }
  if (filename.startsWith('margin_elo_predictions')) {
    return 'margin_predictions';
  }
  if (/^afl_elo_win_trained_to_\d{4}_predictions\.csv$/i.test(filename)) {
    return 'win_training_predictions';
  }
  if (filename.startsWith('win_margin_methods_predictions')) {
    return 'win_margin_method_predictions';
  }
  if (filename.startsWith('win_elo_predictions')) {
    return 'win_predictions';
  }
  return 'unknown_output';
}

function getOutputFamily(kind) {
  if (kind === 'combined_predictions') {
    return 'combined';
  }
  if (kind === 'margin_predictions' || kind === 'season_simulation') {
    return 'margin';
  }
  if (kind === 'win_predictions' || kind === 'win_training_predictions' || kind === 'win_margin_method_predictions') {
    return 'win';
  }
  return 'shared';
}

function buildOutputLabel(entry) {
  const parts = [entry.kindLabel];
  if (entry.kind === 'win_training_predictions' && entry.trainedThroughYear) {
    parts.push(`trained through ${entry.trainedThroughYear}`);
  } else if (entry.seasonRange?.startYear) {
    const { startYear, endYear } = entry.seasonRange;
    parts.push(startYear === endYear ? String(startYear) : `${startYear}-${endYear}`);
  }
  if (entry.rowCount !== null && entry.rowCount !== undefined) {
    parts.push(`${entry.rowCount} rows`);
  }
  return `${parts.join(' - ')} (${entry.fileName})`;
}

async function buildOutputEntry(relativePath) {
  const kind = inferOutputKind(relativePath);
  const stat = await statPath(relativePath);
  let rowCount = null;
  let metadata = {};

  if (relativePath.endsWith('.csv')) {
    const textMetadata = await readTextMetadata(relativePath);
    rowCount = textMetadata.rowCount;
  } else if (relativePath.endsWith('.json')) {
    metadata = await readJson(relativePath) || {};
  }

  const seasonRange = metadata.year
    ? { startYear: parseYear(metadata.year), endYear: parseYear(metadata.year) }
    : extractSeasonRangeFromPath(relativePath);

  const entry = {
    id: relativePath,
    path: relativePath,
    fileName: getFileName(relativePath),
    kind,
    kindLabel: OUTPUT_KIND_LABELS[kind] || OUTPUT_KIND_LABELS.unknown_output,
    family: getOutputFamily(kind),
    seasonRange,
    trainedThroughYear: extractTrainedToYearFromPath(relativePath),
    rowCount,
    modelMode: metadata.model_mode || null,
    inputModels: {
      winModelPath: metadata.win_model_path || null,
      marginModelPath: metadata.margin_model_path || null
    },
    modifiedAt: stat ? stat.mtime.toISOString() : null,
    sizeBytes: stat ? stat.size : null
  };

  return {
    ...entry,
    label: buildOutputLabel(entry),
    detail: [
      entry.modelMode ? `mode ${entry.modelMode}` : null,
      entry.inputModels.winModelPath ? `win ${entry.inputModels.winModelPath}` : null,
      entry.inputModels.marginModelPath ? `margin ${entry.inputModels.marginModelPath}` : null
    ].filter(Boolean).join(' | ')
  };
}

async function listOutputFiles() {
  const nested = await Promise.all(OUTPUT_DIRECTORIES.map((directory) =>
    listDirectoryFiles(directory, (relativePath) => relativePath.endsWith('.csv') || relativePath.endsWith('.json'))
  ));
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

async function getOutputCatalog() {
  const outputFiles = await listOutputFiles();
  const outputs = await Promise.all(outputFiles.map(buildOutputEntry));

  return {
    outputs: outputs.sort((left, right) => {
      const yearDiff = (right.seasonRange?.endYear || 0) - (left.seasonRange?.endYear || 0);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      return left.path.localeCompare(right.path);
    })
  };
}

module.exports = {
  getModelCatalog,
  getOutputCatalog,
  __testables: {
    inferArtifactKind,
    inferArtifactMetrics,
    inferTrainWindow,
    buildModelArtifactEntry,
    inferOutputKind,
    buildOutputEntry
  }
};
