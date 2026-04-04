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
    LAST_ERROR: 'event_sync.last_error',
    LAST_RECONCILIATION: 'event_sync.last_reconciliation'
  },
  clearState: jest.fn(),
  getLastFingerprintForGame: jest.fn(),
  getStateValue: jest.fn(),
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

const { EventEmitter } = require('events');
const eventSyncService = require('../event-sync-service');
const resultUpdateService = require('../result-update-service');
const { logger } = require('../../utils/logger');
const { getSquiggleGamesSseConfig } = require('../../utils/squiggle-request');

const originalNodeEnv = process.env.NODE_ENV;
const originalEventSyncEnabled = process.env.EVENT_SYNC_ENABLED;

describe('event-sync-service helpers', () => {
  const {
    buildGameFingerprint,
    extractYearFromGame,
    isGameActiveForSync,
    normalizeTrackedGame,
    resetFetchImpl,
    setFetchImpl,
    shouldTriggerCompletedGameFlow
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

  test('uses the migrated Squiggle SSE host and shared contactable user agent', () => {
    expect(getSquiggleGamesSseConfig()).toEqual({
      url: 'https://sse.squiggle.com.au/games',
      options: {
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          'User-Agent': 'AFL Predictions - jason@jasoncollins.me'
        }
      }
    });
  });
});

describe('event-sync-service snapshot handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventSyncService.stop();
    eventSyncService.reconnectDelayMs = 5000;
    eventSyncService.__testables.resetFetchImpl();
    resultUpdateService.getStateValue = jest.fn().mockResolvedValue(null);
    resultUpdateService.recordConnectionState.mockResolvedValue();
    resultUpdateService.recordLastError.mockResolvedValue();
    resultUpdateService.recordHeartbeat.mockResolvedValue();
    resultUpdateService.recordLastEvent.mockResolvedValue();
    resultUpdateService.setTrackedActiveGames.mockResolvedValue();
    resultUpdateService.getTrackedActiveGames.mockResolvedValue([]);
    resultUpdateService.getLastFingerprintForGame.mockResolvedValue(null);
    resultUpdateService.setLastFingerprintForGame.mockResolvedValue();
    resultUpdateService.ingestCompletedGameResult.mockResolvedValue();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.EVENT_SYNC_ENABLED = originalEventSyncEnabled;
    eventSyncService.stop();
  });

  test('start skips initialization when disabled by environment', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EVENT_SYNC_ENABLED = '0';

    const connectSpy = jest.spyOn(eventSyncService, 'connect').mockResolvedValue();

    try {
      await eventSyncService.start();

      expect(logger.info).toHaveBeenCalledWith('Event sync service is disabled by environment');
      expect(connectSpy).not.toHaveBeenCalled();
      expect(resultUpdateService.recordConnectionState).not.toHaveBeenCalled();
      expect(resultUpdateService.scheduleWorker).not.toHaveBeenCalled();
    } finally {
      connectSpy.mockRestore();
    }
  });

  test('start records starting state, schedules the worker, and kicks off connect when enabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EVENT_SYNC_ENABLED = '1';

    const connectSpy = jest.spyOn(eventSyncService, 'connect').mockResolvedValue();

    try {
      await eventSyncService.start();

      expect(eventSyncService.running).toBe(true);
      expect(resultUpdateService.recordConnectionState).toHaveBeenCalledWith('starting', {
        url: 'https://sse.squiggle.com.au/games'
      });
      expect(resultUpdateService.scheduleWorker).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      connectSpy.mockRestore();
    }
  });

  test('start schedules reconnect when the initial connect attempt fails', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EVENT_SYNC_ENABLED = '1';

    const connectSpy = jest.spyOn(eventSyncService, 'connect').mockRejectedValue(new Error('startup failed'));
    const reconnectSpy = jest.spyOn(eventSyncService, 'scheduleReconnect').mockImplementation(() => {});

    try {
      await eventSyncService.start();
      await new Promise((resolve) => setImmediate(resolve));

      expect(logger.error).toHaveBeenCalledWith(
        'Event sync service failed during startup connect',
        {
          error: 'startup failed',
          url: 'https://sse.squiggle.com.au/games'
        }
      );
      expect(reconnectSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'startup failed'
      }));
    } finally {
      connectSpy.mockRestore();
      reconnectSpy.mockRestore();
    }
  });

  test('connect records connection lifecycle state and resets reconnect delay after success', async () => {
    const body = new EventEmitter();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, body });
    eventSyncService.__testables.setFetchImpl(fetchMock);
    eventSyncService.running = true;
    eventSyncService.reconnectDelayMs = 30000;

    const consumeSpy = jest.spyOn(eventSyncService, 'consumeStream').mockResolvedValue();
    const reconcileSpy = jest.spyOn(eventSyncService, 'maybeReconcileCurrentSeason').mockResolvedValue();

    try {
      await eventSyncService.connect();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sse.squiggle.com.au/games',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            'User-Agent': 'AFL Predictions - jason@jasoncollins.me'
          }),
          signal: eventSyncService.abortController.signal
        })
      );
      expect(resultUpdateService.recordConnectionState).toHaveBeenNthCalledWith(1, 'connecting', {
        url: 'https://sse.squiggle.com.au/games'
      });
      expect(resultUpdateService.recordConnectionState).toHaveBeenNthCalledWith(
        2,
        'connected',
        expect.objectContaining({
          url: 'https://sse.squiggle.com.au/games',
          connected_at: expect.any(String)
        })
      );
      expect(resultUpdateService.clearState).toHaveBeenCalledWith('event_sync.last_error');
      expect(resultUpdateService.recordHeartbeat).toHaveBeenCalledWith({ type: 'connected' });
      expect(reconcileSpy).toHaveBeenCalledWith('event-sync-startup-reconcile');
      expect(consumeSpy).toHaveBeenCalledWith(body);
      expect(eventSyncService.reconnectDelayMs).toBe(5000);
    } finally {
      consumeSpy.mockRestore();
      reconcileSpy.mockRestore();
    }
  });

  test('connect rejects non-OK SSE responses', async () => {
    eventSyncService.__testables.setFetchImpl(jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable'
    }));
    eventSyncService.running = true;

    await expect(eventSyncService.connect()).rejects.toThrow(
      'Squiggle SSE request failed: 503 Service Unavailable'
    );

    expect(resultUpdateService.recordConnectionState).toHaveBeenCalledWith('connecting', {
      url: 'https://sse.squiggle.com.au/games'
    });
    expect(resultUpdateService.clearState).not.toHaveBeenCalled();
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

  test('records reconnect state with the migrated SSE URL and failure metadata', () => {
    eventSyncService.running = true;
    eventSyncService.reconnectDelayMs = 5000;

    const error = new Error('connect failed');
    eventSyncService.scheduleReconnect(error);

    expect(resultUpdateService.recordLastError).toHaveBeenCalledWith(error, {
      url: 'https://sse.squiggle.com.au/games',
      reconnect_in_ms: 5000
    });
    expect(resultUpdateService.recordConnectionState).toHaveBeenCalledWith('reconnecting', {
      url: 'https://sse.squiggle.com.au/games',
      reconnect_in_ms: 5000
    });

    eventSyncService.stop();
  });

  test('stop aborts the in-flight SSE request controller', () => {
    const abort = jest.fn();
    eventSyncService.running = true;
    eventSyncService.abortController = { abort };

    eventSyncService.stop();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(eventSyncService.running).toBe(false);
    expect(eventSyncService.abortController).toBeNull();
  });

  test('maybeReconcileCurrentSeason skips reconciliation when the last run was recent', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-03T01:00:00.000Z'));
    resultUpdateService.getStateValue = jest.fn().mockResolvedValue({
      updatedAt: '2026-04-03T00:45:00.000Z'
    });

    try {
      await eventSyncService.maybeReconcileCurrentSeason('startup');

      expect(resultUpdateService.reconcileSeasonResults).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Skipping event-sync reconciliation because it ran recently',
        expect.objectContaining({
          source: 'startup',
          currentYear: 2026,
          ageMs: 15 * 60 * 1000
        })
      );
    } finally {
      nowSpy.mockRestore();
      delete resultUpdateService.getStateValue;
    }
  });

  test('maybeReconcileCurrentSeason triggers reconciliation when the prior run is stale', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-03T03:00:00.000Z'));
    resultUpdateService.getStateValue = jest.fn().mockResolvedValue({
      updatedAt: '2026-04-03T00:00:00.000Z'
    });

    try {
      await eventSyncService.maybeReconcileCurrentSeason('startup');

      expect(resultUpdateService.reconcileSeasonResults).toHaveBeenCalledWith({
        year: 2026,
        source: 'startup'
      });
    } finally {
      nowSpy.mockRestore();
      delete resultUpdateService.getStateValue;
    }
  });

  test('updateTrackedGameState removes completed games from tracked state', async () => {
    resultUpdateService.getTrackedActiveGames.mockResolvedValue([
      {
        gameId: 38514,
        year: 2026,
        complete: 90,
        fingerprint: '38514:90:80:72:2026-03-22T19:25:00+11:00'
      },
      {
        gameId: 38515,
        year: 2026,
        complete: 40,
        fingerprint: 'keep-me'
      }
    ]);

    const trackedGame = await eventSyncService.updateTrackedGameState({
      id: 38514,
      year: 2026,
      complete: 100,
      hscore: 88,
      ascore: 80,
      localtime: '2026-03-22T19:25:00+11:00'
    }, { remove: true });

    expect(trackedGame).toEqual(expect.objectContaining({
      gameId: 38514,
      year: 2026,
      complete: 100
    }));
    expect(resultUpdateService.setTrackedActiveGames).toHaveBeenCalledWith([
      expect.objectContaining({
        gameId: 38515,
        year: 2026
      })
    ]);
  });

  test('treats events without data payloads as keepalive heartbeats', async () => {
    await eventSyncService.handleRawEvent('event: keepalive');

    expect(resultUpdateService.recordHeartbeat).toHaveBeenCalledWith({
      type: 'stream-keepalive'
    });
    expect(resultUpdateService.recordLastEvent).not.toHaveBeenCalled();
  });

  test('ignores invalid JSON payloads after recording the event heartbeat', async () => {
    await eventSyncService.handleRawEvent('event: updateGame\ndata: {not-json}');

    expect(resultUpdateService.recordHeartbeat).toHaveBeenCalledWith({
      type: 'event',
      eventName: 'updateGame'
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Ignoring Squiggle SSE event with invalid JSON payload',
      { eventName: 'updateGame' }
    );
    expect(resultUpdateService.ingestCompletedGameResult).not.toHaveBeenCalled();
  });

  test('updates tracked active games for non-terminal game events without ingesting results', async () => {
    await eventSyncService.handleRawEvent(
      `event: updateGame\ndata: ${JSON.stringify({
        id: 38512,
        year: 2026,
        complete: 55,
        hscore: 41,
        ascore: 38,
        localtime: '2026-03-22T15:20:00+11:00'
      })}`
    );

    expect(resultUpdateService.recordLastEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'updateGame',
      eventType: 'game',
      gameId: 38512,
      year: 2026
    }));
    expect(resultUpdateService.setTrackedActiveGames).toHaveBeenCalledWith([
      expect.objectContaining({
        gameId: 38512,
        year: 2026,
        complete: 55
      })
    ]);
    expect(resultUpdateService.ingestCompletedGameResult).not.toHaveBeenCalled();
  });

  test('deduplicates repeated completed-game fingerprints', async () => {
    const fingerprint = '38513:100:88:80:2026-03-22T19:25:00+11:00';
    resultUpdateService.getLastFingerprintForGame.mockResolvedValue({
      value: { fingerprint }
    });

    await eventSyncService.handleRawEvent(
      `event: updateGame\ndata: ${JSON.stringify({
        id: 38513,
        year: 2026,
        complete: 100,
        hscore: 88,
        ascore: 80,
        localtime: '2026-03-22T19:25:00+11:00'
      })}`
    );

    expect(resultUpdateService.setTrackedActiveGames).toHaveBeenCalledWith([]);
    expect(resultUpdateService.setLastFingerprintForGame).not.toHaveBeenCalled();
    expect(resultUpdateService.ingestCompletedGameResult).not.toHaveBeenCalled();
  });

  test('records snapshot events and forwards the games to snapshot sync', async () => {
    const syncSpy = jest.spyOn(eventSyncService, 'syncTrackedGamesFromSnapshot').mockResolvedValue();

    try {
      await eventSyncService.handleRawEvent(
        `event: games\ndata: ${JSON.stringify({
          games: [
            { id: 1, year: 2026 },
            { id: 2, year: 2026 },
            { id: 'bad' }
          ]
        })}`
      );

      expect(resultUpdateService.recordLastEvent).toHaveBeenCalledWith({
        eventName: 'games',
        eventType: 'snapshot',
        snapshotCount: 3,
        activeGameIds: [1, 2]
      });
      expect(syncSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 1, year: 2026 }),
          expect.objectContaining({ id: 2, year: 2026 })
        ]),
        'games'
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Received Squiggle SSE snapshot payload',
        { eventName: 'games', snapshotCount: 3 }
      );
    } finally {
      syncSpy.mockRestore();
    }
  });

  test('ignores payloads without a trackable game id or year', async () => {
    await eventSyncService.handleRawEvent(
      `event: updateGame\ndata: ${JSON.stringify({
        id: 'bad',
        hscore: 88,
        ascore: 80
      })}`
    );

    expect(resultUpdateService.recordLastEvent).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Ignoring Squiggle SSE payload without a trackable game',
      expect.objectContaining({
        eventName: 'updateGame',
        payloadKeys: ['id', 'hscore', 'ascore']
      })
    );
  });

  test('processes completed-game events by storing the fingerprint and ingesting results', async () => {
    await eventSyncService.handleRawEvent(
      `event: removeGame\ndata: ${JSON.stringify({
        id: 38516,
        year: 2026,
        complete: 100,
        hscore: 92,
        ascore: 77,
        localtime: '2026-03-22T19:25:00+11:00'
      })}`
    );

    expect(resultUpdateService.setLastFingerprintForGame).toHaveBeenCalledWith(
      38516,
      '38516:100:92:77:2026-03-22T19:25:00+11:00'
    );
    expect(resultUpdateService.ingestCompletedGameResult).toHaveBeenCalledWith({
      year: 2026,
      gameId: 38516,
      source: 'event-sync:removeGame'
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Processing completed-game Squiggle event',
      expect.objectContaining({
        eventName: 'removeGame',
        gameId: 38516,
        year: 2026
      })
    );
  });

  test('consumeStream processes buffered events and schedules reconnect on end', async () => {
    const stream = new EventEmitter();
    const rawEvents = [];
    const handleSpy = jest.spyOn(eventSyncService, 'handleRawEvent').mockImplementation(async (rawEvent) => {
      rawEvents.push(rawEvent);
    });
    const reconnectSpy = jest.spyOn(eventSyncService, 'scheduleReconnect').mockImplementation(() => {});
    eventSyncService.running = true;

    try {
      const consumePromise = eventSyncService.consumeStream(stream);
      stream.emit('data', Buffer.from('event: updateGame\ndata: {"id":1}\n\n'));
      stream.emit('data', Buffer.from('event: removeGame\ndata: {"id":2}\n\n'));
      stream.emit('end');
      await consumePromise;

      expect(rawEvents).toEqual([
        'event: updateGame\ndata: {"id":1}',
        'event: removeGame\ndata: {"id":2}'
      ]);
      expect(reconnectSpy).toHaveBeenCalledTimes(1);
    } finally {
      eventSyncService.stop();
      handleSpy.mockRestore();
      reconnectSpy.mockRestore();
    }
  });

  test('consumeStream rejects stream errors and still schedules reconnect while running', async () => {
    const stream = new EventEmitter();
    const reconnectSpy = jest.spyOn(eventSyncService, 'scheduleReconnect').mockImplementation(() => {});
    eventSyncService.running = true;

    try {
      const consumePromise = eventSyncService.consumeStream(stream);
      const streamError = new Error('socket closed');
      stream.emit('error', streamError);

      await expect(consumePromise).rejects.toThrow('socket closed');
      expect(reconnectSpy).toHaveBeenCalledTimes(1);
    } finally {
      eventSyncService.stop();
      reconnectSpy.mockRestore();
    }
  });
});
