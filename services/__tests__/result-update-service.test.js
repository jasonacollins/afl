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
