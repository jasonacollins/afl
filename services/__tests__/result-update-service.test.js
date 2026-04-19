jest.mock('../../models/db', () => ({
  getOne: jest.fn(),
  getQuery: jest.fn(),
  runQuery: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../scripts/automation/api-refresh', () => ({
  refreshAPIData: jest.fn()
}));

jest.mock('../../scripts/automation/elo-predictions', () => ({
  runEloPredictions: jest.fn()
}));

jest.mock('../../scripts/automation/daily-sync', () => ({
  runPostResultRecompute: jest.fn(),
  regenerateSeasonSimulation: jest.fn(),
  regenerateEloHistory: jest.fn(),
  evaluateSimulationSnapshotState: jest.fn(),
  hasMatchDataChanges: jest.fn(),
  hasCompletedResultChanges: jest.fn()
}));

const resultUpdateService = require('../result-update-service');
const { getOne, getQuery, runQuery } = require('../../models/db');
const { refreshAPIData } = require('../../scripts/automation/api-refresh');
const { runEloPredictions } = require('../../scripts/automation/elo-predictions');
const {
  runPostResultRecompute,
  regenerateSeasonSimulation,
  regenerateEloHistory,
  evaluateSimulationSnapshotState,
  hasMatchDataChanges,
  hasCompletedResultChanges
} = require('../../scripts/automation/daily-sync');
const { logger } = require('../../utils/logger');

describe('result-update-service test helpers', () => {
  const { isSqliteBusyError, toNullableInteger } = resultUpdateService.__testables;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('detects transient SQLite lock errors', () => {
    expect(isSqliteBusyError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('database is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('some other failure'))).toBe(false);
  });

  test('normalizes nullable integers', () => {
    expect(toNullableInteger(undefined)).toBeNull();
    expect(toNullableInteger(null)).toBeNull();
    expect(toNullableInteger('')).toBeNull();
    expect(toNullableInteger('42')).toBe(42);
    expect(toNullableInteger('not-a-number')).toBeNull();
  });
});

describe('result-update-service state and queue behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('withBusyRetry retries transient SQLite errors before succeeding', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 0;
    });

    const task = jest.fn()
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValue('ok');

    await expect(
      resultUpdateService.withBusyRetry(task, 'test-context')
    ).resolves.toBe('ok');

    expect(task).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    setTimeoutSpy.mockRestore();
  });

  test('setState stringifies objects and getStateValue parses JSON payloads', async () => {
    runQuery.mockResolvedValue({});
    getOne.mockResolvedValue({
      state_value: JSON.stringify({ connected: true }),
      updated_at: '2026-04-03T00:00:00.000Z'
    });

    await resultUpdateService.setState('event_sync.connection', { connected: true });
    const state = await resultUpdateService.getStateValue('event_sync.connection');

    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO event_sync_state'), [
      'event_sync.connection',
      JSON.stringify({ connected: true }),
      expect.any(String)
    ]);
    expect(state).toEqual({
      value: { connected: true },
      updatedAt: '2026-04-03T00:00:00.000Z'
    });
  });

  test('getStateValue returns raw string when state_value is not JSON', async () => {
    getOne.mockResolvedValue({
      state_value: 'plain-text',
      updated_at: '2026-04-03T00:00:00.000Z'
    });

    await expect(
      resultUpdateService.getStateValue('event_sync.last_error')
    ).resolves.toEqual({
      value: 'plain-text',
      updatedAt: '2026-04-03T00:00:00.000Z'
    });
  });

  test('tracked active games are normalized to valid integer game and year values', async () => {
    getOne.mockResolvedValue({
      state_value: JSON.stringify({
        games: [
          { gameId: '10', year: '2026', complete: 100, fingerprint: 'abc', lastSeenAt: 'seen' },
          { gameId: 'bad', year: '2026', complete: 0, fingerprint: 'skip' }
        ]
      }),
      updated_at: '2026-04-03T00:00:00.000Z'
    });

    await expect(resultUpdateService.getTrackedActiveGames()).resolves.toEqual([
      {
        gameId: 10,
        year: 2026,
        complete: 100,
        fingerprint: 'abc',
        lastSeenAt: 'seen'
      }
    ]);
  });

  test('setTrackedActiveGames stores only valid game records', async () => {
    runQuery.mockResolvedValue({});

    await resultUpdateService.setTrackedActiveGames([
      { gameId: '10', year: '2026', complete: 100, fingerprint: 'abc', lastSeenAt: 'seen' },
      { gameId: 'bad', year: '2026', complete: 0 }
    ]);

    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO event_sync_state'), [
      resultUpdateService.EVENT_SYNC_STATE_KEYS.ACTIVE_GAMES,
      expect.stringContaining('"gameId":10'),
      expect.any(String)
    ]);
    expect(runQuery.mock.calls[0][1][1]).not.toContain('"gameId":null');
  });

  test('setLastFingerprintForGame ignores invalid inputs and persists valid fingerprints', async () => {
    runQuery.mockResolvedValue({});

    await resultUpdateService.setLastFingerprintForGame(null, 'abc');
    await resultUpdateService.setLastFingerprintForGame(15, '');
    await resultUpdateService.setLastFingerprintForGame(15, 'abc');

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO event_sync_state'), [
      'event_sync.game.15.fingerprint',
      JSON.stringify({ fingerprint: 'abc', gameId: 15 }),
      expect.any(String)
    ]);
  });

  test('enqueuePostResultRecompute rejects invalid years', async () => {
    await expect(
      resultUpdateService.enqueuePostResultRecompute({
        year: 'not-a-year',
        triggerSource: 'event-sync'
      })
    ).rejects.toThrow('year must be an integer');
  });

  test('enqueuePostResultRecompute reuses an existing active job and backfills the match number', async () => {
    getOne
      .mockResolvedValueOnce({
        job_id: 7,
        year: 2026,
        match_number: null,
        status: 'queued'
      })
      .mockResolvedValueOnce({
        job_id: 7,
        year: 2026,
        match_number: 88,
        status: 'queued'
      });
    runQuery.mockResolvedValue({});

    const job = await resultUpdateService.enqueuePostResultRecompute({
      year: 2026,
      matchNumber: 88,
      triggerSource: 'event-sync'
    });

    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE result_update_jobs'),
      [88, expect.any(String), 7]
    );
    expect(job).toEqual({
      job_id: 7,
      year: 2026,
      match_number: 88,
      status: 'queued'
    });
  });

  test('recoverInterruptedJobs requeues stale queued and running rows', async () => {
    runQuery.mockResolvedValue({ changes: 2 });

    await expect(resultUpdateService.recoverInterruptedJobs()).resolves.toBe(2);

    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE result_update_jobs'),
      [
        'queued',
        expect.any(String),
        'Recovered after process restart',
        'queued',
        'running'
      ]
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Recovered interrupted result update jobs',
      { recoveredCount: 2 }
    );
  });

  test('recoverInterruptedJobs stays quiet when nothing needs recovery', async () => {
    runQuery.mockResolvedValue({ changes: 0 });

    await expect(resultUpdateService.recoverInterruptedJobs()).resolves.toBe(0);

    expect(logger.warn).not.toHaveBeenCalledWith(
      'Recovered interrupted result update jobs',
      expect.anything()
    );
  });

  test('enqueuePostResultRecompute runs the queued worker and marks the job succeeded', async () => {
    getOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        job_id: 21,
        year: 2026,
        match_number: 77,
        status: 'queued',
        attempt_count: 0
      })
      .mockResolvedValueOnce({
        job_id: 21,
        year: 2026,
        match_number: 77,
        status: 'queued',
        attempt_count: 0
      })
      .mockResolvedValueOnce({
        job_id: 21,
        year: 2026,
        match_number: 77,
        status: 'running',
        attempt_count: 1
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    runQuery
      .mockResolvedValueOnce({ lastID: 21 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    runPostResultRecompute.mockResolvedValue();

    const job = await resultUpdateService.enqueuePostResultRecompute({
      year: 2026,
      matchNumber: 77,
      triggerSource: 'event-sync',
      triggerReason: 'completed_game_event'
    });
    await resultUpdateService.scheduleWorker();
    await new Promise((resolve) => setImmediate(resolve));

    expect(job).toEqual({
      job_id: 21,
      year: 2026,
      match_number: 77,
      status: 'queued',
      attempt_count: 0
    });
    expect(runPostResultRecompute).toHaveBeenCalledWith(2026, {
      source: 'result-update-job:21'
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO result_update_jobs'),
      [2026, 77, 'queued', 'event-sync', 'completed_game_event', expect.any(String), expect.any(String)]
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE result_update_jobs'),
      ['running', expect.any(String), expect.any(String), 21]
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE result_update_jobs'),
      ['succeeded', expect.any(String), expect.any(String), null, 21]
    );
  });

  test('scheduleWorker marks jobs failed permanently after the final retry attempt', async () => {
    getOne
      .mockResolvedValueOnce({
        job_id: 22,
        year: 2026,
        match_number: 88,
        status: 'queued',
        attempt_count: 3
      })
      .mockResolvedValueOnce({
        job_id: 22,
        year: 2026,
        match_number: 88,
        status: 'running',
        attempt_count: 4
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    runQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    runPostResultRecompute.mockRejectedValue(new Error('recompute exploded'));

    resultUpdateService.scheduleWorker();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(runPostResultRecompute).toHaveBeenCalledWith(2026, {
      source: 'result-update-job:22'
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE result_update_jobs'),
      ['failed', expect.any(String), expect.any(String), 'recompute exploded', 22]
    );
    expect(logger.error).toHaveBeenCalledWith('Result update job failed permanently', expect.objectContaining({
      jobId: 22,
      attemptCount: 4,
      error: 'recompute exploded'
    }));
  });

  test('scheduleWorker restarts when queued work appears after the worker exits', async () => {
    getOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ job_id: 31 })
      .mockResolvedValueOnce({
        job_id: 31,
        year: 2026,
        match_number: null,
        status: 'queued',
        attempt_count: 0
      })
      .mockResolvedValueOnce({
        job_id: 31,
        year: 2026,
        match_number: null,
        status: 'running',
        attempt_count: 1
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    runQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    runPostResultRecompute.mockResolvedValue();

    resultUpdateService.scheduleWorker();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(runPostResultRecompute).toHaveBeenCalledWith(2026, {
      source: 'result-update-job:31'
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE result_update_jobs'),
      ['running', expect.any(String), expect.any(String), 31]
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE result_update_jobs'),
      ['succeeded', expect.any(String), expect.any(String), null, 31]
    );
  });

  test('scheduleWorker logs queued-job probe failures after the worker exits', async () => {
    getOne
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('probe failed'));

    resultUpdateService.scheduleWorker();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to inspect queued result update jobs after worker exit',
      { error: 'probe failed' }
    );
  });

  test('reconcileSeasonResults queues recompute work when completed results changed', async () => {
    refreshAPIData.mockResolvedValue({
      updatedCompletedMatchNumbers: [91],
      scoresUpdated: 1
    });
    hasCompletedResultChanges.mockReturnValue(true);
    hasMatchDataChanges.mockReturnValue(false);
    getOne
      .mockResolvedValueOnce({
        job_id: 12,
        year: 2026,
        match_number: null,
        status: 'queued'
      })
      .mockResolvedValueOnce({
        job_id: 12,
        year: 2026,
        match_number: 91,
        status: 'queued'
      });
    runQuery.mockResolvedValue({});

    const result = await resultUpdateService.reconcileSeasonResults({
      year: 2026,
      source: 'event-sync'
    });

    expect(result).toMatchObject({
      resultChangesDetected: true,
      matchDataChanged: false,
      jobQueued: true,
      job: {
        job_id: 12,
        match_number: 91,
        status: 'queued'
      }
    });
    expect(runEloPredictions).not.toHaveBeenCalled();
    expect(regenerateSeasonSimulation).not.toHaveBeenCalled();
  });

  test('reconcileSeasonResults runs fallback refresh when only non-final match data changed', async () => {
    refreshAPIData.mockResolvedValue({ scoresUpdated: 0 });
    hasCompletedResultChanges.mockReturnValue(false);
    hasMatchDataChanges.mockReturnValue(true);
    evaluateSimulationSnapshotState.mockResolvedValue({ hasCurrentRoundSnapshot: false });
    runEloPredictions.mockResolvedValue({ success: true });
    regenerateSeasonSimulation.mockResolvedValue({ success: true });
    regenerateEloHistory.mockResolvedValue({ success: true });

    const result = await resultUpdateService.reconcileSeasonResults({
      year: new Date().getFullYear(),
      source: 'event-sync'
    });

    expect(runEloPredictions).toHaveBeenCalled();
    expect(regenerateSeasonSimulation).toHaveBeenCalled();
    expect(result).toMatchObject({
      resultChangesDetected: false,
      matchDataChanged: true,
      jobQueued: false
    });
  });

  test('getEventSyncStatus aggregates state, queue summary, and active job', async () => {
    getOne
      .mockResolvedValueOnce({
        state_value: JSON.stringify({ status: 'connected' }),
        updated_at: '2026-04-03T00:00:00.000Z'
      })
      .mockResolvedValueOnce({
        state_value: JSON.stringify({ recorded_at: '2026-04-03T00:00:00.000Z' }),
        updated_at: '2026-04-03T00:00:01.000Z'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        state_value: JSON.stringify({ event: 'complete' }),
        updated_at: '2026-04-03T00:00:02.000Z'
      })
      .mockResolvedValueOnce({
        state_value: JSON.stringify({ year: 2026 }),
        updated_at: '2026-04-03T00:00:03.000Z'
      })
      .mockResolvedValueOnce({
        job_id: 4,
        year: 2026,
        match_number: 77,
        status: 'running'
      });
    getQuery.mockResolvedValue([
      { status: 'queued', count: '2' },
      { status: 'running', count: '1' }
    ]);

    const status = await resultUpdateService.getEventSyncStatus();

    expect(status).toEqual({
      connection: {
        value: { status: 'connected' },
        updatedAt: '2026-04-03T00:00:00.000Z'
      },
      heartbeat: {
        value: { recorded_at: '2026-04-03T00:00:00.000Z' },
        updatedAt: '2026-04-03T00:00:01.000Z'
      },
      lastError: null,
      lastEvent: {
        value: { event: 'complete' },
        updatedAt: '2026-04-03T00:00:02.000Z'
      },
      lastReconciliation: {
        value: { year: 2026 },
        updatedAt: '2026-04-03T00:00:03.000Z'
      },
      queueSummary: {
        queued: 2,
        running: 1,
        succeeded: 0,
        failed: 0
      },
      activeJob: {
        job_id: 4,
        year: 2026,
        match_number: 77,
        status: 'running'
      }
    });
  });
});
