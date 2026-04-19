const { getOne, getQuery, runQuery } = require('../models/db');
const { logger } = require('../utils/logger');
const { refreshAPIData } = require('../scripts/automation/api-refresh');
const { runEloPredictions } = require('../scripts/automation/elo-predictions');
const {
  runPostResultRecompute,
  regenerateSeasonSimulation,
  regenerateEloHistory,
  evaluateSimulationSnapshotState,
  hasMatchDataChanges,
  hasCompletedResultChanges
} = require('../scripts/automation/daily-sync');
const path = require('path');
const fs = require('fs');

const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
};

const EVENT_SYNC_STATE_KEYS = {
  CONNECTION: 'event_sync.connection',
  HEARTBEAT: 'event_sync.heartbeat',
  LAST_ERROR: 'event_sync.last_error',
  LAST_EVENT: 'event_sync.last_event',
  LAST_RECONCILIATION: 'event_sync.last_reconciliation',
  ACTIVE_GAMES: 'event_sync.active_games'
};

const MAX_JOB_ATTEMPTS = 4;
const SQLITE_BUSY_RETRY_MS = [250, 1000, 2500];

let workerPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNullableInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number.parseInt(value, 10);
  return Number.isInteger(numeric) ? numeric : null;
}

function isSqliteBusyError(error) {
  if (!error || typeof error.message !== 'string') {
    return false;
  }

  return error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked');
}

async function withBusyRetry(task, context) {
  let attempt = 0;

  while (true) {
    try {
      return await task();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= SQLITE_BUSY_RETRY_MS.length) {
        throw error;
      }

      const retryInMs = SQLITE_BUSY_RETRY_MS[attempt];
      attempt += 1;

      logger.warn('Retrying after transient SQLite lock', {
        context,
        retryInMs,
        attempt,
        error: error.message
      });

      await sleep(retryInMs);
    }
  }
}

async function setState(stateKey, value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  const timestamp = nowIso();

  await runQuery(
    `INSERT INTO event_sync_state (state_key, state_value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(state_key)
     DO UPDATE SET
       state_value = excluded.state_value,
       updated_at = excluded.updated_at`,
    [stateKey, payload, timestamp]
  );
}

async function clearState(stateKey) {
  await runQuery('DELETE FROM event_sync_state WHERE state_key = ?', [stateKey]);
}

async function getStateValue(stateKey) {
  const row = await getOne(
    'SELECT state_value, updated_at FROM event_sync_state WHERE state_key = ?',
    [stateKey]
  );

  if (!row) {
    return null;
  }

  try {
    return {
      value: JSON.parse(row.state_value),
      updatedAt: row.updated_at
    };
  } catch (error) {
    return {
      value: row.state_value,
      updatedAt: row.updated_at
    };
  }
}

async function recordHeartbeat(metadata = {}) {
  await setState(EVENT_SYNC_STATE_KEYS.HEARTBEAT, {
    ...metadata,
    recorded_at: nowIso()
  });
}

async function recordConnectionState(status, metadata = {}) {
  await setState(EVENT_SYNC_STATE_KEYS.CONNECTION, {
    status,
    ...metadata,
    recorded_at: nowIso()
  });
}

async function recordLastError(error, metadata = {}) {
  await setState(EVENT_SYNC_STATE_KEYS.LAST_ERROR, {
    ...metadata,
    message: error && error.message ? error.message : String(error),
    recorded_at: nowIso()
  });
}

async function recordLastEvent(eventPayload) {
  await setState(EVENT_SYNC_STATE_KEYS.LAST_EVENT, {
    ...eventPayload,
    recorded_at: nowIso()
  });
}

async function getLastFingerprintForGame(gameId) {
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return null;
  }

  return getStateValue(`event_sync.game.${gameId}.fingerprint`);
}

async function setLastFingerprintForGame(gameId, fingerprint) {
  if (!Number.isInteger(gameId) || gameId <= 0 || !fingerprint) {
    return;
  }

  await setState(`event_sync.game.${gameId}.fingerprint`, {
    fingerprint,
    gameId
  });
}

async function getTrackedActiveGames() {
  const state = await getStateValue(EVENT_SYNC_STATE_KEYS.ACTIVE_GAMES);
  const games = Array.isArray(state?.value?.games) ? state.value.games : [];
  return games
    .map((game) => ({
      gameId: toNullableInteger(game?.gameId),
      year: toNullableInteger(game?.year),
      complete: game?.complete ?? null,
      fingerprint: game?.fingerprint || null,
      lastSeenAt: game?.lastSeenAt || null
    }))
    .filter((game) => Number.isInteger(game.gameId) && Number.isInteger(game.year));
}

async function setTrackedActiveGames(games) {
  const normalizedGames = Array.isArray(games)
    ? games
      .map((game) => ({
        gameId: toNullableInteger(game?.gameId),
        year: toNullableInteger(game?.year),
        complete: game?.complete ?? null,
        fingerprint: game?.fingerprint || null,
        lastSeenAt: game?.lastSeenAt || nowIso()
      }))
      .filter((game) => Number.isInteger(game.gameId) && Number.isInteger(game.year))
    : [];

  await setState(EVENT_SYNC_STATE_KEYS.ACTIVE_GAMES, {
    games: normalizedGames,
    recorded_at: nowIso()
  });
}

async function findActiveJob(year, matchNumber) {
  const safeMatchNumber = toNullableInteger(matchNumber);
  const params = [Number.parseInt(year, 10)];
  let query = `
    SELECT *
    FROM result_update_jobs
    WHERE year = ?
      AND status IN (?, ?)`;
  params.push(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING);

  query += ' ORDER BY created_at ASC LIMIT 1';
  const job = await getOne(query, params);

  if (job && safeMatchNumber !== null && job.match_number === null) {
    await runQuery(
      `UPDATE result_update_jobs
       SET match_number = COALESCE(match_number, ?), updated_at = ?
       WHERE job_id = ?`,
      [safeMatchNumber, nowIso(), job.job_id]
    );
    return getOne('SELECT * FROM result_update_jobs WHERE job_id = ?', [job.job_id]);
  }

  return job;
}

async function enqueuePostResultRecompute({ year, matchNumber = null, triggerSource, triggerReason }) {
  const safeYear = Number.parseInt(year, 10);
  if (!Number.isInteger(safeYear)) {
    throw new Error('year must be an integer');
  }

  const safeMatchNumber = toNullableInteger(matchNumber);
  const existing = await findActiveJob(safeYear, safeMatchNumber);
  if (existing) {
    logger.info('Reusing existing result update job', {
      jobId: existing.job_id,
      year: safeYear,
      matchNumber: safeMatchNumber,
      triggerSource
    });
    return existing;
  }

  const timestamp = nowIso();
  const insertResult = await runQuery(
    `INSERT INTO result_update_jobs (
      year,
      match_number,
      status,
      trigger_source,
      trigger_reason,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      safeYear,
      safeMatchNumber,
      JOB_STATUS.QUEUED,
      triggerSource || 'manual',
      triggerReason || null,
      timestamp,
      timestamp
    ]
  );

  const job = await getOne('SELECT * FROM result_update_jobs WHERE job_id = ?', [insertResult.lastID]);
  scheduleWorker();
  return job;
}

async function markJobRunning(jobId) {
  const startedAt = nowIso();
  await runQuery(
    `UPDATE result_update_jobs
     SET status = ?, started_at = ?, updated_at = ?, attempt_count = attempt_count + 1, error_message = NULL
     WHERE job_id = ?`,
    [JOB_STATUS.RUNNING, startedAt, startedAt, jobId]
  );
}

async function markJobFinished(jobId, status, errorMessage = null) {
  const finishedAt = nowIso();
  await runQuery(
    `UPDATE result_update_jobs
     SET status = ?, finished_at = ?, updated_at = ?, error_message = ?
     WHERE job_id = ?`,
    [status, finishedAt, finishedAt, errorMessage, jobId]
  );
}

async function requeueJob(jobId, errorMessage = null) {
  const updatedAt = nowIso();
  await runQuery(
    `UPDATE result_update_jobs
     SET status = ?, updated_at = ?, error_message = ?
     WHERE job_id = ?`,
    [JOB_STATUS.QUEUED, updatedAt, errorMessage, jobId]
  );
}

async function recoverInterruptedJobs() {
  const updatedAt = nowIso();
  const recoveryMessage = 'Recovered after process restart';
  const result = await runQuery(
    `UPDATE result_update_jobs
     SET status = ?,
         started_at = NULL,
         finished_at = NULL,
         updated_at = ?,
         error_message = ?
     WHERE status IN (?, ?)`,
    [
      JOB_STATUS.QUEUED,
      updatedAt,
      recoveryMessage,
      JOB_STATUS.QUEUED,
      JOB_STATUS.RUNNING
    ]
  );

  if (result.changes > 0) {
    logger.warn('Recovered interrupted result update jobs', {
      recoveredCount: result.changes
    });
  }

  return result.changes;
}

async function claimNextJob() {
  const nextJob = await getOne(
    `SELECT *
     FROM result_update_jobs
     WHERE status = ?
     ORDER BY created_at ASC
     LIMIT 1`,
    [JOB_STATUS.QUEUED]
  );

  if (!nextJob) {
    return null;
  }

  await markJobRunning(nextJob.job_id);
  return getOne('SELECT * FROM result_update_jobs WHERE job_id = ?', [nextJob.job_id]);
}

async function runFallbackStyleRefresh(year, source, options = {}) {
  const currentYear = new Date().getFullYear();
  const matchDataChanged = Boolean(options.matchDataChanged);
  const projectRoot = path.join(__dirname, '..');
  const historyCsvPath = path.join(projectRoot, 'data/historical/afl_elo_complete_history.csv');
  const hasHistoryFile = fs.existsSync(historyCsvPath);
  const simulationOutputPath = path.join(projectRoot, `data/simulations/season_simulation_${year}.json`);
  const snapshotState = year === currentYear
    ? await evaluateSimulationSnapshotState(year, simulationOutputPath)
    : null;
  const snapshotMissing = snapshotState ? !snapshotState.hasCurrentRoundSnapshot : false;

  logger.info('Running fallback-style refresh after non-final data changes', {
    source,
    year,
    matchDataChanged,
    snapshotMissing
  });

  const eloResults = await withBusyRetry(
    () => runEloPredictions(),
    `${source}:elo-predictions:${year}`
  );

  let simulationResults = null;
  if (year === currentYear && (snapshotMissing || matchDataChanged)) {
    simulationResults = await withBusyRetry(
      () => regenerateSeasonSimulation(year),
      `${source}:season-simulation:${year}`
    );
  }

  let historyResults = null;
  if (!hasHistoryFile) {
    historyResults = await withBusyRetry(
      () => regenerateEloHistory({ mode: 'incremental' }),
      `${source}:elo-history:${year}`
    );
  }

  return {
    eloResults,
    simulationResults,
    historyResults
  };
}

async function processJob(job) {
  const safeYear = Number.parseInt(job.year, 10);
  const source = `result-update-job:${job.job_id}`;

  try {
    await withBusyRetry(
      () => runPostResultRecompute(safeYear, { source }),
      `${source}:post-result-recompute`
    );
    await markJobFinished(job.job_id, JOB_STATUS.SUCCEEDED);
    logger.info('Completed result update job', {
      jobId: job.job_id,
      year: safeYear,
      matchNumber: job.match_number
    });
  } catch (error) {
    const attempts = Number.parseInt(job.attempt_count, 10) || 0;
    const willRetry = attempts < MAX_JOB_ATTEMPTS;

    if (willRetry) {
      await requeueJob(job.job_id, error.message);
      logger.warn('Requeued result update job after failure', {
        jobId: job.job_id,
        year: safeYear,
        matchNumber: job.match_number,
        attemptCount: attempts,
        error: error.message
      });
      return;
    }

    await markJobFinished(job.job_id, JOB_STATUS.FAILED, error.message);
    logger.error('Result update job failed permanently', {
      jobId: job.job_id,
      year: safeYear,
      matchNumber: job.match_number,
      attemptCount: attempts,
      error: error.message
    });
  }
}

async function runWorkerLoop() {
  while (true) {
    const job = await claimNextJob();
    if (!job) {
      return;
    }

    await processJob(job);
  }
}

function scheduleWorker() {
  if (workerPromise) {
    return workerPromise;
  }

  workerPromise = runWorkerLoop()
    .catch((error) => {
      logger.error('Result update worker loop failed', {
        error: error.message,
        stack: error.stack
      });
    })
    .finally(() => {
      workerPromise = null;
      setImmediate(() => {
        getOne(
          `SELECT job_id
           FROM result_update_jobs
           WHERE status = ?
           ORDER BY created_at ASC
           LIMIT 1`,
          [JOB_STATUS.QUEUED]
        ).then((row) => {
          if (row) {
            scheduleWorker();
          }
        }).catch((error) => {
          logger.error('Failed to inspect queued result update jobs after worker exit', {
            error: error.message
          });
        });
      });
    });

  return workerPromise;
}

async function reconcileSeasonResults({ year, gameId = null, source = 'event-sync-reconcile' }) {
  const safeYear = Number.parseInt(year, 10);
  if (!Number.isInteger(safeYear)) {
    throw new Error('year must be an integer');
  }

  const apiResults = await refreshAPIData(safeYear, {
    forceScoreUpdate: false,
    gameId,
    source
  });

  const resultChangesDetected = hasCompletedResultChanges(apiResults, {});
  const matchDataChanged = hasMatchDataChanges({ insertCount: 0 }, apiResults);

  await setState(EVENT_SYNC_STATE_KEYS.LAST_RECONCILIATION, {
    year: safeYear,
    gameId: toNullableInteger(gameId),
    source,
    apiResults,
    resultChangesDetected,
    matchDataChanged,
    recorded_at: nowIso()
  });

  if (resultChangesDetected) {
    const targetMatchNumber = toNullableInteger(gameId)
      || toNullableInteger(apiResults.updatedCompletedMatchNumbers?.[0])
      || null;
    const job = await enqueuePostResultRecompute({
      year: safeYear,
      matchNumber: targetMatchNumber,
      triggerSource: source,
      triggerReason: gameId ? 'completed_game_event' : 'season_reconciliation'
    });

    return {
      apiResults,
      resultChangesDetected,
      matchDataChanged,
      jobQueued: true,
      job
    };
  }

  if (matchDataChanged) {
    await runFallbackStyleRefresh(safeYear, source, { matchDataChanged });
  }

  return {
    apiResults,
    resultChangesDetected,
    matchDataChanged,
    jobQueued: false
  };
}

async function ingestCompletedGameResult({ year, gameId, source = 'event-sync' }) {
  const safeGameId = Number.parseInt(gameId, 10);
  if (!Number.isInteger(safeGameId)) {
    throw new Error('gameId must be an integer');
  }

  return reconcileSeasonResults({
    year,
    gameId: safeGameId,
    source
  });
}

async function getQueueSummary() {
  const rows = await getQuery(
    `SELECT status, COUNT(*) AS count
     FROM result_update_jobs
     GROUP BY status`
  );

  return rows.reduce((accumulator, row) => {
    accumulator[row.status] = Number.parseInt(row.count, 10) || 0;
    return accumulator;
  }, {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0
  });
}

async function getEventSyncStatus() {
  const [connection, heartbeat, lastError, lastEvent, lastReconciliation, queueSummary, activeJob] = await Promise.all([
    getStateValue(EVENT_SYNC_STATE_KEYS.CONNECTION),
    getStateValue(EVENT_SYNC_STATE_KEYS.HEARTBEAT),
    getStateValue(EVENT_SYNC_STATE_KEYS.LAST_ERROR),
    getStateValue(EVENT_SYNC_STATE_KEYS.LAST_EVENT),
    getStateValue(EVENT_SYNC_STATE_KEYS.LAST_RECONCILIATION),
    getQueueSummary(),
    getOne(
      `SELECT job_id, year, match_number, status, trigger_source, trigger_reason, created_at, started_at, attempt_count
       FROM result_update_jobs
       WHERE status IN (?, ?)
       ORDER BY created_at ASC
       LIMIT 1`,
      [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]
    )
  ]);

  return {
    connection,
    heartbeat,
    lastError,
    lastEvent,
    lastReconciliation,
    queueSummary,
    activeJob
  };
}

module.exports = {
  JOB_STATUS,
  EVENT_SYNC_STATE_KEYS,
  clearState,
  getEventSyncStatus,
  getStateValue,
  getLastFingerprintForGame,
  getTrackedActiveGames,
  ingestCompletedGameResult,
  enqueuePostResultRecompute,
  recoverInterruptedJobs,
  recordConnectionState,
  recordHeartbeat,
  recordLastError,
  recordLastEvent,
  reconcileSeasonResults,
  scheduleWorker,
  setTrackedActiveGames,
  setLastFingerprintForGame,
  setState,
  withBusyRetry,
  __testables: {
    isSqliteBusyError,
    toNullableInteger
  }
};
