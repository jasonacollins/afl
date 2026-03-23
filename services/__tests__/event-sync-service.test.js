jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../result-update-service', () => ({
  EVENT_SYNC_STATE_KEYS: {
    LAST_ERROR: 'event_sync.last_error'
  },
  clearState: jest.fn(),
  getLastFingerprintForGame: jest.fn(),
  getTrackedActiveGames: jest.fn(),
  ingestCompletedGameResult: jest.fn(),
  recordConnectionState: jest.fn(),
  recordHeartbeat: jest.fn(),
  recordLastError: jest.fn(),
  recordLastEvent: jest.fn(),
  reconcileSeasonResults: jest.fn(),
  scheduleWorker: jest.fn(),
  setLastFingerprintForGame: jest.fn(),
  setTrackedActiveGames: jest.fn()
}));

const eventSyncService = require('../event-sync-service');
const resultUpdateService = require('../result-update-service');

describe('event-sync-service helpers', () => {
  const {
    buildGameFingerprint,
    extractYearFromGame,
    shouldTriggerCompletedGameFlow,
    isGameActiveForSync,
    normalizeTrackedGame
  } = eventSyncService.__testables;

  test('builds stable game fingerprints from completed game state', () => {
    expect(buildGameFingerprint({
      id: 123,
      complete: 100,
      hscore: 98,
      ascore: 76,
      date: '2026-03-19T09:30:00Z'
    })).toBe('123:100:98:76:2026-03-19T09:30:00Z');
  });

  test('extracts year from explicit year or game date', () => {
    expect(extractYearFromGame({ year: 2026 })).toBe(2026);
    expect(extractYearFromGame({ date: '2026-03-19T09:30:00Z' })).toBe(2026);
    expect(extractYearFromGame({})).toBeNull();
  });

  test('treats removeGame and complete=100 updates as completed-game triggers', () => {
    expect(shouldTriggerCompletedGameFlow('removeGame', { complete: 0 })).toBe(true);
    expect(shouldTriggerCompletedGameFlow('updateGame', { complete: 100 })).toBe(true);
    expect(shouldTriggerCompletedGameFlow('updateGame', { complete: 50 })).toBe(false);
  });

  test('tracks active games until they are complete', () => {
    expect(isGameActiveForSync({ complete: 0 })).toBe(true);
    expect(isGameActiveForSync({ complete: 75 })).toBe(true);
    expect(isGameActiveForSync({ complete: 100 })).toBe(false);
  });

  test('normalizes tracked games from Squiggle payloads', () => {
    expect(normalizeTrackedGame({
      id: 38510,
      year: 2026,
      complete: 50,
      hscore: 40,
      ascore: 35,
      localtime: '2026-03-21T19:30:00+11:00'
    })).toMatchObject({
      gameId: 38510,
      year: 2026,
      complete: 50,
      fingerprint: '38510:50:40:35:2026-03-21T19:30:00+11:00'
    });
  });
});

describe('event-sync-service snapshot handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reconciles previously tracked games that disappear from a snapshot', async () => {
    resultUpdateService.getTrackedActiveGames.mockResolvedValue([
      {
        gameId: 38509,
        year: 2026,
        complete: 85,
        fingerprint: '38509:85:80:75:2026-03-20T19:40:00+11:00'
      }
    ]);

    await eventSyncService.syncTrackedGamesFromSnapshot([], 'games');

    expect(resultUpdateService.setTrackedActiveGames).toHaveBeenCalledWith([]);
    expect(resultUpdateService.ingestCompletedGameResult).toHaveBeenCalledWith({
      year: 2026,
      gameId: 38509,
      source: 'event-sync:snapshot-missing'
    });
  });

  test('stores active games from snapshots without reconciling them', async () => {
    resultUpdateService.getTrackedActiveGames.mockResolvedValue([]);

    await eventSyncService.syncTrackedGamesFromSnapshot([
      {
        id: 38511,
        year: 2026,
        complete: 25,
        hscore: 20,
        ascore: 18,
        localtime: '2026-03-21T19:30:00+11:00'
      }
    ], 'games');

    expect(resultUpdateService.ingestCompletedGameResult).not.toHaveBeenCalled();
    expect(resultUpdateService.setTrackedActiveGames).toHaveBeenCalledWith([
      expect.objectContaining({
        gameId: 38511,
        year: 2026,
        complete: 25
      })
    ]);
  });
});
