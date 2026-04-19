const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const mockRefreshAPIData = jest.fn();
const mockRunEloPredictions = jest.fn();
const mockRunPostResultRecompute = jest.fn();
const mockRegenerateSeasonSimulation = jest.fn();
const mockRegenerateEloHistory = jest.fn();
const mockEvaluateSimulationSnapshotState = jest.fn();
const mockHasMatchDataChanges = jest.fn();
const mockHasCompletedResultChanges = jest.fn();

function loadModules(dbPath) {
  let loaded;

  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;

    jest.doMock('../../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    }));

    jest.doMock('../../scripts/automation/api-refresh', () => ({
      refreshAPIData: mockRefreshAPIData
    }));

    jest.doMock('../../scripts/automation/elo-predictions', () => ({
      runEloPredictions: mockRunEloPredictions
    }));

    jest.doMock('../../scripts/automation/daily-sync', () => ({
      runPostResultRecompute: mockRunPostResultRecompute,
      regenerateSeasonSimulation: mockRegenerateSeasonSimulation,
      regenerateEloHistory: mockRegenerateEloHistory,
      evaluateSimulationSnapshotState: mockEvaluateSimulationSnapshotState,
      hasMatchDataChanges: mockHasMatchDataChanges,
      hasCompletedResultChanges: mockHasCompletedResultChanges
    }));

    loaded = {
      dbModule: require('../../models/db'),
      resultUpdateService: require('../result-update-service'),
      eventSyncService: require('../event-sync-service')
    };
  });

  return loaded;
}

async function unloadDbModule(dbModule) {
  if (dbModule && dbModule.db) {
    await new Promise((resolve, reject) => {
      dbModule.db.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  jest.resetModules();
  delete process.env.DB_PATH;
}

async function waitFor(assertion, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  await assertion();
}

async function getQueueSummary(dbModule) {
  const rows = await dbModule.getQuery(
    `SELECT status, COUNT(*) AS count
     FROM result_update_jobs
     GROUP BY status`
  );

  return rows.reduce((summary, row) => {
    summary[row.status] = Number.parseInt(row.count, 10) || 0;
    return summary;
  }, {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0
  });
}

describe('event sync and result update integration', () => {
  let tempDir;
  let loaded;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockRefreshAPIData.mockResolvedValue({
      success: true,
      updateCount: 1,
      scoresUpdated: 1,
      updatedCompletedMatchNumbers: [38516]
    });
    mockRunEloPredictions.mockResolvedValue({ success: true });
    mockRunPostResultRecompute.mockResolvedValue({ success: true });
    mockRegenerateSeasonSimulation.mockResolvedValue({ success: true });
    mockRegenerateEloHistory.mockResolvedValue({ success: true });
    mockEvaluateSimulationSnapshotState.mockResolvedValue({ hasCurrentRoundSnapshot: true });
    mockHasMatchDataChanges.mockReturnValue(false);
    mockHasCompletedResultChanges.mockImplementation(
      (apiResults) => Boolean(apiResults?.scoresUpdated || apiResults?.updatedCompletedMatchNumbers?.length)
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-event-sync-'));
    loaded = loadModules(path.join(tempDir, 'integration.db'));
    await loaded.dbModule.initializeDatabase();
  });

  afterEach(async () => {
    if (loaded && loaded.eventSyncService) {
      loaded.eventSyncService.stop();
    }

    await new Promise((resolve) => setImmediate(resolve));
    await unloadDbModule(loaded && loaded.dbModule);
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('persists tracked active games from non-terminal SSE events', async () => {
    await loaded.eventSyncService.handleRawEvent(
      `event: updateGame\ndata: ${JSON.stringify({
        id: 38512,
        year: 2026,
        complete: 55,
        hscore: 41,
        ascore: 38,
        localtime: '2026-03-22T15:20:00+11:00'
      })}`
    );

    const activeGamesState = await loaded.dbModule.getOne(
      'SELECT state_value FROM event_sync_state WHERE state_key = ?',
      [loaded.resultUpdateService.EVENT_SYNC_STATE_KEYS.ACTIVE_GAMES]
    );
    const queueSummary = await getQueueSummary(loaded.dbModule);

    expect(JSON.parse(activeGamesState.state_value)).toEqual(expect.objectContaining({
      games: [
        expect.objectContaining({
          gameId: 38512,
          year: 2026,
          complete: 55,
          fingerprint: '38512:55:41:38:2026-03-22T15:20:00+11:00'
        })
      ]
    }));
    expect(queueSummary).toEqual({
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0
    });
  });

  test('recoverInterruptedJobs requeues stale active work in the real SQLite queue', async () => {
    await loaded.dbModule.runQuery(
      `INSERT INTO result_update_jobs (
        job_id, year, match_number, status, trigger_source, trigger_reason,
        attempt_count, created_at, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1, 2026, 38510, 'running', 'event-sync', 'completed_game_event',
        2, '2026-04-18T00:00:00.000Z', '2026-04-18T00:01:00.000Z', '2026-04-18T00:01:00.000Z'
      ]
    );
    await loaded.dbModule.runQuery(
      `INSERT INTO result_update_jobs (
        job_id, year, match_number, status, trigger_source, trigger_reason,
        attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        2, 2026, 38511, 'queued', 'event-sync', 'completed_game_event',
        0, '2026-04-18T00:02:00.000Z', '2026-04-18T00:02:00.000Z'
      ]
    );
    await loaded.dbModule.runQuery(
      `INSERT INTO result_update_jobs (
        job_id, year, match_number, status, trigger_source, trigger_reason,
        attempt_count, created_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        3, 2026, 38512, 'succeeded', 'event-sync', 'completed_game_event',
        1, '2026-04-18T00:03:00.000Z', '2026-04-18T00:04:00.000Z', '2026-04-18T00:04:00.000Z'
      ]
    );

    const recoveredCount = await loaded.resultUpdateService.recoverInterruptedJobs();
    const rows = await loaded.dbModule.getQuery(
      `SELECT job_id, status, started_at, finished_at, error_message
       FROM result_update_jobs
       ORDER BY job_id ASC`
    );

    expect(recoveredCount).toBe(2);
    expect(rows).toEqual([
      {
        job_id: 1,
        status: 'queued',
        started_at: null,
        finished_at: null,
        error_message: 'Recovered after process restart'
      },
      {
        job_id: 2,
        status: 'queued',
        started_at: null,
        finished_at: null,
        error_message: 'Recovered after process restart'
      },
      {
        job_id: 3,
        status: 'succeeded',
        started_at: null,
        finished_at: '2026-04-18T00:04:00.000Z',
        error_message: null
      }
    ]);
  });

  test('queues completed-game recompute work once and suppresses duplicate fingerprints', async () => {
    await loaded.eventSyncService.handleRawEvent(
      `event: updateGame\ndata: ${JSON.stringify({
        id: 38516,
        year: 2026,
        complete: 60,
        hscore: 70,
        ascore: 63,
        localtime: '2026-03-22T19:20:00+11:00'
      })}`
    );

    await loaded.eventSyncService.handleRawEvent(
      `event: removeGame\ndata: ${JSON.stringify({
        id: 38516,
        year: 2026,
        complete: 100,
        hscore: 92,
        ascore: 77,
        localtime: '2026-03-22T19:25:00+11:00'
      })}`
    );

    await waitFor(async () => {
      const queueSummary = await getQueueSummary(loaded.dbModule);
      expect(queueSummary.succeeded).toBe(1);
    });

    const fingerprintState = await loaded.dbModule.getOne(
      'SELECT state_value FROM event_sync_state WHERE state_key = ?',
      ['event_sync.game.38516.fingerprint']
    );
    const activeGamesState = await loaded.dbModule.getOne(
      'SELECT state_value FROM event_sync_state WHERE state_key = ?',
      [loaded.resultUpdateService.EVENT_SYNC_STATE_KEYS.ACTIVE_GAMES]
    );
    const reconciliationState = await loaded.dbModule.getOne(
      'SELECT state_value FROM event_sync_state WHERE state_key = ?',
      [loaded.resultUpdateService.EVENT_SYNC_STATE_KEYS.LAST_RECONCILIATION]
    );
    const jobs = await loaded.dbModule.getQuery(
      `SELECT match_number, status, trigger_source, trigger_reason, attempt_count
       FROM result_update_jobs
       ORDER BY job_id ASC`
    );

    expect(mockRefreshAPIData).toHaveBeenCalledTimes(1);
    expect(mockRefreshAPIData).toHaveBeenCalledWith(2026, {
      forceScoreUpdate: false,
      gameId: 38516,
      source: 'event-sync:removeGame'
    });
    expect(mockRunPostResultRecompute).toHaveBeenCalledWith(2026, {
      source: 'result-update-job:1'
    });
    expect(JSON.parse(fingerprintState.state_value)).toEqual({
      fingerprint: '38516:100:92:77:2026-03-22T19:25:00+11:00',
      gameId: 38516
    });
    expect(JSON.parse(activeGamesState.state_value)).toEqual(expect.objectContaining({
      games: []
    }));
    expect(JSON.parse(reconciliationState.state_value)).toEqual(expect.objectContaining({
      year: 2026,
      gameId: 38516,
      source: 'event-sync:removeGame',
      resultChangesDetected: true,
      matchDataChanged: false
    }));
    expect(jobs).toEqual([
      {
        match_number: 38516,
        status: 'succeeded',
        trigger_source: 'event-sync:removeGame',
        trigger_reason: 'completed_game_event',
        attempt_count: 1
      }
    ]);

    await loaded.eventSyncService.handleRawEvent(
      `event: removeGame\ndata: ${JSON.stringify({
        id: 38516,
        year: 2026,
        complete: 100,
        hscore: 92,
        ascore: 77,
        localtime: '2026-03-22T19:25:00+11:00'
      })}`
    );

    const queueSummary = await getQueueSummary(loaded.dbModule);
    const jobCountRow = await loaded.dbModule.getOne(
      'SELECT COUNT(*) AS count FROM result_update_jobs'
    );

    expect(mockRefreshAPIData).toHaveBeenCalledTimes(1);
    expect(queueSummary).toEqual({
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0
    });
    expect(jobCountRow.count).toBe(1);
  });
});
