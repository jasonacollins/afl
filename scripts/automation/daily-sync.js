const { refreshAPIData } = require('./api-refresh');
const { runEloPredictions } = require('./elo-predictions');
const { syncGamesFromAPI } = require('./sync-games');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getQuery } = require('../../models/db');
const { logger } = require('../../utils/logger');

const ELO_HISTORY_MODEL_PATH = 'data/models/margin/afl_elo_margin_only_trained_to_2025.json';
const ELO_HISTORY_SEED_START_YEAR = 1990;
const ELO_HISTORY_OUTPUT_START_YEAR = 2000;

/**
 * Regenerate ELO historical data.
 * Default behavior is incremental append so existing historical rows remain unchanged.
 */
async function regenerateEloHistory({ mode = 'incremental' } = {}) {
  logger.info('Regenerating ELO historical data...', { mode });
  
  return new Promise((resolve, reject) => {
    // Get project root directory (two levels up from automation folder)
    const projectRoot = path.join(__dirname, '../..');
    const modelPath = path.join(projectRoot, ELO_HISTORY_MODEL_PATH);
    const dbPath = path.join(projectRoot, 'data/database/afl_predictions.db');
    const outputDir = path.join(projectRoot, 'data/historical');
    
    const pythonProcess = spawn('python3', [
      'scripts/elo_history_generator.py',
      '--model-path', modelPath,
      '--mode', mode,
      '--seed-start-year', String(ELO_HISTORY_SEED_START_YEAR),
      '--output-start-year', String(ELO_HISTORY_OUTPUT_START_YEAR),
      '--db-path', dbPath,
      '--output-dir', outputDir,
      '--output-prefix', 'afl_elo_complete_history'
    ], { cwd: projectRoot });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      logger.debug('ELO History Generator output', { output: data.toString().trim() });
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.error('ELO History Generator error', { error: data.toString().trim() });
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        logger.info('ELO historical data regeneration completed successfully', { mode });
        resolve({ success: true, message: 'ELO history updated' });
      } else {
        logger.error('ELO history generator failed', { 
          exitCode: code, 
          stderr: stderr,
          stdout: stdout 
        });
        reject(new Error(`ELO history generator failed with code ${code}: ${stderr}`));
      }
    });
    
    pythonProcess.on('error', (error) => {
      logger.error('Failed to start ELO history generator', { error: error.message });
      reject(error);
    });
  });
}

/**
 * Regenerate season simulation data with latest results and ratings context
 */
async function regenerateSeasonSimulation(year) {
  logger.info(`Regenerating season simulation for ${year}...`);

  return new Promise((resolve, reject) => {
    const projectRoot = path.join(__dirname, '../..');
    const modelPath = path.join(projectRoot, 'data/models/margin/afl_elo_margin_only_trained_to_2025.json');
    const dbPath = path.join(projectRoot, 'data/database/afl_predictions.db');
    const outputPath = path.join(projectRoot, `data/simulations/season_simulation_${year}.json`);

    const pythonProcess = spawn('python3', [
      'scripts/season_simulator.py',
      '--year', String(year),
      '--model-path', modelPath,
      '--db-path', dbPath,
      '--output', outputPath
    ], { cwd: projectRoot });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      logger.debug('Season simulator output', { output: data.toString().trim() });
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.error('Season simulator error', { error: data.toString().trim() });
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        logger.info('Season simulation regeneration completed successfully', { outputPath });
        resolve({ success: true, message: 'Season simulation updated', outputPath });
      } else {
        logger.error('Season simulation generator failed', {
          exitCode: code,
          stderr: stderr,
          stdout: stdout
        });
        reject(new Error(`Season simulation generator failed with code ${code}: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      logger.error('Failed to start season simulation generator', { error: error.message });
      reject(error);
    });
  });
}

/**
 * Determine whether fixture/result data changed during sync steps.
 */
function hasMatchDataChanges(fixtureSyncResults, apiResults) {
  const fixtureInserts = Number(fixtureSyncResults?.insertCount || 0);
  const refreshInserts = Number(apiResults?.insertCount || 0);
  const refreshFixtureUpdates = Number(apiResults?.updateCount || 0);
  const refreshScoreUpdates = Number(apiResults?.scoresUpdated || 0);

  // sync-games updates existing rows as part of normalization and can be noisy.
  // Treat fixture inserts as meaningful from sync-games, and rely on api-refresh
  // update counters for true fixture/result changes.
  return (
    fixtureInserts > 0 ||
    refreshInserts > 0 ||
    refreshFixtureUpdates > 0 ||
    refreshScoreUpdates > 0
  );
}

function hasCompletedResultChanges(apiResults, fixtureSyncResults = {}) {
  const apiScoreUpdates = Number(apiResults?.scoresUpdated || 0);
  const completedFixtureInserts = Number(fixtureSyncResults?.completedInsertCount || 0);
  const newlyCompletedFixtureUpdates = Number(fixtureSyncResults?.completedUpdateCount || 0);

  return (
    apiScoreUpdates > 0 ||
    completedFixtureInserts > 0 ||
    newlyCompletedFixtureUpdates > 0
  );
}

function normalizeRoundText(roundNumber) {
  if (roundNumber === null || roundNumber === undefined) {
    return '';
  }

  const raw = String(roundNumber).trim().toLowerCase();
  if (!raw) {
    return '';
  }

  return raw.replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

const FINALS_ROUND_ALIASES = {
  'wildcard round': 'wildcard_round',
  'wild card round': 'wildcard_round',
  'wildcard finals': 'wildcard_round',
  'wild card finals': 'wildcard_round',
  'wildcard': 'wildcard_round',
  'wc': 'wildcard_round',
  'wr': 'wildcard_round',
  'qualifying final': 'qualifying_final',
  'qualifying finals': 'qualifying_final',
  'qf': 'qualifying_final',
  'elimination final': 'elimination_final',
  'elimination finals': 'elimination_final',
  'ef': 'elimination_final',
  'semi final': 'semi_final',
  'semi finals': 'semi_final',
  'sf': 'semi_final',
  'preliminary final': 'preliminary_final',
  'preliminary finals': 'preliminary_final',
  'pf': 'preliminary_final',
  'grand final': 'grand_final',
  'grand finals': 'grand_final',
  'gf': 'grand_final'
};

function slugifyText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function resolveFinalsRoundKey(roundNumber) {
  const normalized = normalizeRoundText(roundNumber);
  if (!normalized) {
    return null;
  }
  return FINALS_ROUND_ALIASES[normalized] || null;
}

function buildRoundSnapshotMetadata(roundNumber) {
  if (roundNumber === null || roundNumber === undefined) {
    return {
      roundKey: 'round-unknown',
      roundLabel: 'Current Snapshot',
      roundTabLabel: 'Current',
      roundNumber: null
    };
  }

  const raw = String(roundNumber).trim();
  if (!raw) {
    return {
      roundKey: 'round-unknown',
      roundLabel: 'Current Snapshot',
      roundTabLabel: 'Current',
      roundNumber: null
    };
  }

  if (raw.toUpperCase() === 'OR') {
    return {
      roundKey: 'round-or',
      roundLabel: 'Before Opening Round',
      roundTabLabel: 'OR',
      roundNumber: 'OR'
    };
  }

  const numericMatch = raw.match(/^(?:r(?:ound)?)?\s*(\d+)$/i);
  if (numericMatch) {
    const roundValue = Number.parseInt(numericMatch[1], 10);
    return {
      roundKey: `round-${roundValue}`,
      roundLabel: `Before Round ${roundValue}`,
      roundTabLabel: `R${roundValue}`,
      roundNumber: String(roundValue)
    };
  }

  const finalsRoundKey = resolveFinalsRoundKey(raw);
  if (finalsRoundKey) {
    const finalsLabelMap = {
      wildcard_round: 'Wildcard Finals',
      qualifying_final: 'Qualifying Final',
      elimination_final: 'Elimination Final',
      semi_final: 'Semi Final',
      preliminary_final: 'Preliminary Final',
      grand_final: 'Grand Final'
    };
    return {
      roundKey: `finals-${finalsRoundKey}`,
      roundLabel: `Before ${finalsLabelMap[finalsRoundKey]}`,
      roundTabLabel: finalsLabelMap[finalsRoundKey],
      roundNumber: finalsLabelMap[finalsRoundKey]
    };
  }

  const normalizedRound = normalizeRoundText(raw);
  const titleRound = normalizedRound
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

  return {
    roundKey: `round-${slugifyText(normalizedRound)}`,
    roundLabel: `Before ${titleRound || 'Current Snapshot'}`,
    roundTabLabel: titleRound || 'Current',
    roundNumber: titleRound || null
  };
}

function buildPostSeasonSnapshotMetadata() {
  return {
    roundKey: 'season-complete',
    roundLabel: 'Season Complete',
    roundTabLabel: 'Post'
  };
}

function stripCurrentSnapshotSuffix(roundKey) {
  const value = String(roundKey || '');
  return value.endsWith('-current') ? value.slice(0, -8) : value;
}

function buildCurrentRoundSnapshotMetadata(roundNumber) {
  const baseMetadata = buildRoundSnapshotMetadata(roundNumber);
  const baseRoundKey = stripCurrentSnapshotSuffix(baseMetadata.roundKey);
  const roundNumberValue = baseMetadata.roundNumber;

  let currentLabel = 'Current Snapshot';
  if (roundNumberValue === 'OR') {
    currentLabel = 'Current Opening Round';
  } else if (baseRoundKey.startsWith('finals-')) {
    currentLabel = String(baseMetadata.roundLabel || 'Current Snapshot').replace(/^Before\s+/, 'Current ');
  } else if (roundNumberValue !== null && roundNumberValue !== undefined) {
    currentLabel = `Current Round ${roundNumberValue}`;
  }

  return {
    ...baseMetadata,
    roundKey: `${baseRoundKey}-current`,
    roundLabel: currentLabel,
    roundTabLabel: 'Current'
  };
}

function isMatchCompleted(match) {
  const completion = Number.parseFloat(match.complete);
  const completionIsNumber = Number.isFinite(completion);
  const completionComplete = completionIsNumber && completion >= 100;
  const completionUnknown = !completionIsNumber;

  const hasScores = match.hscore !== null && match.hscore !== undefined &&
    match.ascore !== null && match.ascore !== undefined;

  const zeroPlaceholder =
    Number(match.hscore) === 0 &&
    Number(match.ascore) === 0 &&
    (!completionIsNumber || completion < 100);

  const reliableScores = hasScores && !zeroPlaceholder;

  return completionComplete || (completionUnknown && reliableScores);
}

function parseSortDate(matchDate) {
  if (!matchDate) {
    return null;
  }
  const parsed = Date.parse(matchDate);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSortNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareMatchesForProgression(a, b) {
  const aDate = parseSortDate(a.match_date);
  const bDate = parseSortDate(b.match_date);

  if (aDate !== null && bDate !== null && aDate !== bDate) {
    return aDate - bDate;
  }
  if (aDate !== null && bDate === null) {
    return -1;
  }
  if (aDate === null && bDate !== null) {
    return 1;
  }

  const aMatchNumber = parseSortNumber(a.match_number);
  const bMatchNumber = parseSortNumber(b.match_number);
  if (aMatchNumber !== bMatchNumber) {
    return aMatchNumber - bMatchNumber;
  }

  const aMatchId = parseSortNumber(a.match_id);
  const bMatchId = parseSortNumber(b.match_id);
  return aMatchId - bMatchId;
}

async function determineCurrentRoundSnapshotMetadata(year) {
  const matches = await getQuery(
    `SELECT match_id, match_number, round_number, match_date, complete, hscore, ascore
     FROM matches
     WHERE year = ?`,
    [year]
  );

  if (!Array.isArray(matches) || matches.length === 0) {
    return buildRoundSnapshotMetadata('OR');
  }

  const sortedMatches = [...matches].sort(compareMatchesForProgression);
  const completedMatches = sortedMatches.filter(isMatchCompleted);
  const upcomingMatches = sortedMatches.filter((match) => !isMatchCompleted(match));

  if (upcomingMatches.length > 0) {
    const nextRound = upcomingMatches[0].round_number;
    const nextRoundMetadata = buildRoundSnapshotMetadata(nextRound);
    const nextRoundKey = stripCurrentSnapshotSuffix(nextRoundMetadata.roundKey);
    // If a round has both completed and upcoming matches, track a dedicated
    // "-current" snapshot so the before-round snapshot remains historical.
    const hasCompletedInSameRound = completedMatches.some((match) =>
      stripCurrentSnapshotSuffix(buildRoundSnapshotMetadata(match.round_number).roundKey) === nextRoundKey
    );

    if (hasCompletedInSameRound) {
      return buildCurrentRoundSnapshotMetadata(nextRound);
    }

    return nextRoundMetadata;
  }

  if (completedMatches.length > 0) {
    return buildPostSeasonSnapshotMetadata();
  }

  return buildRoundSnapshotMetadata('OR');
}

function loadExistingRoundSnapshots(outputPath, year) {
  if (!fs.existsSync(outputPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }

    if (parsed.year !== undefined && Number.parseInt(parsed.year, 10) !== Number.parseInt(year, 10)) {
      return [];
    }

    if (!Array.isArray(parsed.round_snapshots)) {
      return [];
    }

    return parsed.round_snapshots.filter((snapshot) =>
      snapshot && typeof snapshot === 'object' && typeof snapshot.round_key === 'string'
    );
  } catch (error) {
    logger.warn('Failed to parse existing season simulation file, treating snapshots as missing', {
      outputPath,
      error: error.message
    });
    return [];
  }
}

async function evaluateSimulationSnapshotState(year, outputPath) {
  const currentRound = await determineCurrentRoundSnapshotMetadata(year);
  const snapshots = loadExistingRoundSnapshots(outputPath, year);
  const hasCurrentRoundSnapshot = snapshots.some((snapshot) => snapshot.round_key === currentRound.roundKey);

  return {
    currentRoundKey: currentRound.roundKey,
    currentRoundLabel: currentRound.roundLabel,
    hasCurrentRoundSnapshot,
    existingSnapshotCount: snapshots.length
  };
}

async function runPostResultRecompute(year, options = {}) {
  const source = options.source || 'manual';
  const currentYear = new Date().getFullYear();
  const isCurrentSeason = Number.parseInt(year, 10) === currentYear;
  const projectRoot = path.join(__dirname, '../..');
  const simulationOutputPath = path.join(projectRoot, `data/simulations/season_simulation_${year}.json`);

  logger.info('Starting post-result recompute', {
    year,
    source,
    isCurrentSeason
  });

  let snapshotState = null;
  let snapshotMissing = false;
  if (isCurrentSeason) {
    snapshotState = await evaluateSimulationSnapshotState(year, simulationOutputPath);
    snapshotMissing = !snapshotState.hasCurrentRoundSnapshot;

    logger.info('Season snapshot state evaluation complete', {
      currentRoundKey: snapshotState.currentRoundKey,
      currentRoundLabel: snapshotState.currentRoundLabel,
      hasCurrentRoundSnapshot: snapshotState.hasCurrentRoundSnapshot,
      existingSnapshotCount: snapshotState.existingSnapshotCount,
      source
    });
  }

  logger.info('Starting ELO predictions...', { source, year });
  const eloResults = await runEloPredictions();
  logger.info('ELO predictions complete', {
    source,
    year,
    message: eloResults.message,
    predictionsCount: eloResults.predictionsCount
  });

  let simulationResults = null;
  if (isCurrentSeason) {
    logger.info('Regenerating season simulation...', {
      source,
      year,
      reasons: snapshotMissing
        ? ['completed_result_update', `missing_snapshot_${snapshotState.currentRoundKey}`]
        : ['completed_result_update']
    });
    simulationResults = await regenerateSeasonSimulation(year);
    logger.info('Season simulation regeneration complete', {
      source,
      year,
      message: simulationResults.message,
      outputPath: simulationResults.outputPath
    });
  } else {
    logger.info('Skipping season simulation regeneration for non-current season', {
      source,
      year,
      currentYear
    });
  }

  const historyCsvPath = path.join(projectRoot, 'data/historical/afl_elo_complete_history.csv');
  const hasHistoryFile = fs.existsSync(historyCsvPath);
  const historyReasons = ['completed_result_update'];
  if (!hasHistoryFile) {
    historyReasons.push('history_file_missing_bootstrap');
  }

  logger.info('Updating ELO historical data incrementally...', {
    source,
    year,
    reasons: historyReasons
  });
  const historyResults = await regenerateEloHistory({ mode: 'incremental' });
  logger.info('ELO history regeneration complete', {
    source,
    year,
    message: historyResults.message,
    mode: 'incremental'
  });

  return {
    year,
    source,
    eloResults,
    simulationResults,
    historyResults
  };
}

async function runFallbackReconciliation(year, options = {}) {
  const source = options.source || 'scheduled-fallback';
  logger.info('Starting fallback reconciliation', { source, year });

  logger.info(`Syncing current season fixtures for ${year}...`, { source });
  const fixtureSyncResults = await syncGamesFromAPI({ year });
  logger.info('Fixture sync complete', { source, results: fixtureSyncResults });

  logger.info('Starting API data refresh...', { source, year });
  const apiResults = await refreshAPIData(year, {
    forceScoreUpdate: false,
    source
  });
  logger.info('API refresh complete', { source, results: apiResults });

  const matchDataChanged = hasMatchDataChanges(fixtureSyncResults, apiResults);
  const fixtureSyncUpdates = Number(fixtureSyncResults?.updateCount || 0);
  const resultChangesDetected = hasCompletedResultChanges(apiResults, fixtureSyncResults);
  const projectRoot = path.join(__dirname, '../..');
  const simulationOutputPath = path.join(projectRoot, `data/simulations/season_simulation_${year}.json`);
  const snapshotState = await evaluateSimulationSnapshotState(year, simulationOutputPath);
  const snapshotMissing = !snapshotState.hasCurrentRoundSnapshot;
  const historyCsvPath = path.join(projectRoot, 'data/historical/afl_elo_complete_history.csv');
  const hasHistoryFile = fs.existsSync(historyCsvPath);
  let recomputeResults = null;

  logger.info('Match data change evaluation complete', {
    source,
    year,
    matchDataChanged,
    fixtureSyncInserts: Number(fixtureSyncResults?.insertCount || 0),
    fixtureSyncUpdates,
    fixtureSyncCompletedInserts: Number(fixtureSyncResults?.completedInsertCount || 0),
    fixtureSyncCompletedUpdates: Number(fixtureSyncResults?.completedUpdateCount || 0),
    apiRefreshInserts: Number(apiResults?.insertCount || 0),
    apiRefreshFixtureUpdates: Number(apiResults?.updateCount || 0),
    apiRefreshScoreUpdates: Number(apiResults?.scoresUpdated || 0),
    ignoredNoisySyncGameUpdates: fixtureSyncUpdates > 0 && !matchDataChanged
  });

  logger.info('Season snapshot state evaluation complete', {
    source,
    year,
    currentRoundKey: snapshotState.currentRoundKey,
    currentRoundLabel: snapshotState.currentRoundLabel,
    hasCurrentRoundSnapshot: snapshotState.hasCurrentRoundSnapshot,
    existingSnapshotCount: snapshotState.existingSnapshotCount
  });

  if (resultChangesDetected) {
    recomputeResults = await runPostResultRecompute(year, { source });
  } else if (matchDataChanged || snapshotMissing) {
    logger.info('Refreshing predictions/simulation without completed result changes', {
      source,
      year,
      matchDataChanged,
      snapshotMissing
    });

    const eloResults = await runEloPredictions();
    logger.info('ELO predictions complete', {
      source,
      year,
      message: eloResults.message,
      predictionsCount: eloResults.predictionsCount
    });

    let simulationResults = null;
    if (matchDataChanged || snapshotMissing) {
      simulationResults = await regenerateSeasonSimulation(year);
      logger.info('Season simulation regeneration complete', {
        source,
        year,
        message: simulationResults.message,
        outputPath: simulationResults.outputPath
      });
    }

    let historyResults = null;
    if (!hasHistoryFile) {
      historyResults = await regenerateEloHistory({ mode: 'incremental' });
      logger.info('ELO history regeneration complete', {
        source,
        year,
        message: historyResults.message,
        mode: 'incremental'
      });
    }

    recomputeResults = {
      year,
      source,
      eloResults,
      simulationResults,
      historyResults
    };
  } else {
    logger.info('Skipping post-result recompute during fallback reconciliation', {
      source,
      year,
      matchDataChanged,
      resultChangesDetected
    });
  }

  return {
    source,
    year,
    fixtureSyncResults,
    apiResults,
    matchDataChanged,
    resultChangesDetected,
    recomputeResults
  };
}

async function dailySync() {
  logger.info(`Running daily sync at ${new Date().toISOString()}`);
  try {
    // Get current year
    const currentYear = new Date().getFullYear();
    await runFallbackReconciliation(currentYear, { source: 'daily-sync' });
    
    logger.info('Daily sync completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Daily sync failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  dailySync();
}

module.exports = {
  normalizeRoundText,
  resolveFinalsRoundKey,
  buildRoundSnapshotMetadata,
  buildCurrentRoundSnapshotMetadata,
  buildPostSeasonSnapshotMetadata,
  stripCurrentSnapshotSuffix,
  isMatchCompleted,
  compareMatchesForProgression,
  determineCurrentRoundSnapshotMetadata,
  loadExistingRoundSnapshots,
  evaluateSimulationSnapshotState,
  hasMatchDataChanges,
  hasCompletedResultChanges,
  regenerateEloHistory,
  regenerateSeasonSimulation,
  runPostResultRecompute,
  runFallbackReconciliation,
  dailySync
};
