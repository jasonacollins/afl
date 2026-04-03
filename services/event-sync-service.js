// node-fetch v3 is ESM-only; use dynamic import for CommonJS services.
const fetch = (...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args));
const { logger } = require('../utils/logger');
const { getSquiggleGamesSseConfig } = require('../utils/squiggle-request');
const resultUpdateService = require('./result-update-service');

const BASE_RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const RECONCILIATION_MIN_INTERVAL_MS = Number.parseInt(
  process.env.EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS || String(30 * 60 * 1000),
  10
);

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function parseEventTimestamp(value) {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function buildGameFingerprint(game) {
  if (!game || typeof game !== 'object') {
    return null;
  }

  const parts = [
    game.id || '',
    game.complete || '',
    game.hscore ?? '',
    game.ascore ?? '',
    game.localtime || game.date || ''
  ];

  return parts.join(':');
}

function extractYearFromGame(game) {
  const rawYear = Number.parseInt(game?.year, 10);
  if (Number.isInteger(rawYear)) {
    return rawYear;
  }

  const rawDate = game?.date || game?.localtime;
  if (!rawDate) {
    return null;
  }

  const parsed = new Date(rawDate);
  const parsedYear = parsed.getUTCFullYear();
  return Number.isInteger(parsedYear) ? parsedYear : null;
}

function shouldTriggerCompletedGameFlow(eventName, game) {
  if (!game || typeof game !== 'object') {
    return false;
  }

  const completion = Number.parseFloat(game.complete);
  const isComplete = Number.isFinite(completion) && completion >= 100;

  return eventName === 'removeGame' || isComplete;
}

function isGameActiveForSync(game) {
  if (!game || typeof game !== 'object') {
    return false;
  }

  const completion = Number.parseFloat(game.complete);
  return !Number.isFinite(completion) || completion < 100;
}

function normalizeTrackedGame(game) {
  const gameId = Number.parseInt(game?.id ?? game?.gameId, 10);
  const year = extractYearFromGame(game);

  if (!Number.isInteger(gameId) || !Number.isInteger(year)) {
    return null;
  }

  return {
    gameId,
    year,
    complete: game?.complete ?? null,
    fingerprint: buildGameFingerprint(game),
    lastSeenAt: new Date().toISOString()
  };
}

class EventSyncService {
  constructor() {
    this.running = false;
    this.abortController = null;
    this.reconnectTimer = null;
    this.reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
  }

  async start() {
    const enabled = process.env.EVENT_SYNC_ENABLED !== '0'
      && process.env.NODE_ENV !== 'test';

    if (!enabled) {
      logger.info('Event sync service is disabled by environment');
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    const { url: sseUrl } = getSquiggleGamesSseConfig();
    await resultUpdateService.recordConnectionState('starting', { url: sseUrl });
    resultUpdateService.scheduleWorker();
    this.connect().catch((error) => {
      logger.error('Event sync service failed during startup connect', {
        error: error.message,
        url: sseUrl
      });
      this.scheduleReconnect(error);
    });
  }

  stop() {
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async connect() {
    if (!this.running) {
      return;
    }

    this.abortController = new AbortController();
    const { url: sseUrl, options } = getSquiggleGamesSseConfig();

    await resultUpdateService.recordConnectionState('connecting', { url: sseUrl });

    const response = await fetch(sseUrl, {
      ...options,
      signal: this.abortController.signal
    });

    if (!response.ok) {
      throw new Error(`Squiggle SSE request failed: ${response.status} ${response.statusText}`);
    }

    this.reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
    await resultUpdateService.recordConnectionState('connected', {
      url: sseUrl,
      connected_at: new Date().toISOString()
    });
    await resultUpdateService.clearState(resultUpdateService.EVENT_SYNC_STATE_KEYS.LAST_ERROR);
    await resultUpdateService.recordHeartbeat({ type: 'connected' });
    await this.maybeReconcileCurrentSeason('event-sync-startup-reconcile');

    await this.consumeStream(response.body);
  }

  async maybeReconcileCurrentSeason(source) {
    const currentYear = new Date().getFullYear();
    const lastReconciliation = await resultUpdateService.getStateValue(
      resultUpdateService.EVENT_SYNC_STATE_KEYS.LAST_RECONCILIATION
    );

    if (lastReconciliation?.updatedAt) {
      const lastEpoch = parseEventTimestamp(lastReconciliation.updatedAt);
      if (lastEpoch !== null) {
        const ageMs = Date.now() - lastEpoch;
        if (ageMs < RECONCILIATION_MIN_INTERVAL_MS) {
          logger.info('Skipping event-sync reconciliation because it ran recently', {
            source,
            currentYear,
            lastReconciliationAt: lastReconciliation.updatedAt,
            ageMs,
            minIntervalMs: RECONCILIATION_MIN_INTERVAL_MS
          });
          return;
        }
      }
    }

    await resultUpdateService.reconcileSeasonResults({
      year: currentYear,
      source
    });
  }

  async syncTrackedGamesFromSnapshot(games, eventName) {
    const trackedGames = Array.isArray(games)
      ? games.map((game) => normalizeTrackedGame(game)).filter(Boolean)
      : [];
    const activeGames = trackedGames.filter((game) => isGameActiveForSync(game));
    const previousActiveGames = await resultUpdateService.getTrackedActiveGames();
    const activeGameIds = new Set(activeGames.map((game) => game.gameId));
    const missingGames = previousActiveGames.filter((game) => !activeGameIds.has(game.gameId));

    await resultUpdateService.setTrackedActiveGames(activeGames);

    if (missingGames.length === 0) {
      return;
    }

    for (const missingGame of missingGames) {
      logger.info('Reconciling tracked game missing from Squiggle SSE snapshot', {
        eventName,
        gameId: missingGame.gameId,
        year: missingGame.year,
        previousFingerprint: missingGame.fingerprint || null
      });

      await resultUpdateService.ingestCompletedGameResult({
        year: missingGame.year,
        gameId: missingGame.gameId,
        source: 'event-sync:snapshot-missing'
      });
    }
  }

  async updateTrackedGameState(game, options = {}) {
    const normalizedGame = normalizeTrackedGame(game);
    if (!normalizedGame) {
      return null;
    }

    const trackedGames = await resultUpdateService.getTrackedActiveGames();
    const remainingGames = trackedGames.filter((trackedGame) => trackedGame.gameId !== normalizedGame.gameId);

    if (options.remove || !isGameActiveForSync(game)) {
      await resultUpdateService.setTrackedActiveGames(remainingGames);
      return normalizedGame;
    }

    remainingGames.push(normalizedGame);
    await resultUpdateService.setTrackedActiveGames(remainingGames);
    return normalizedGame;
  }

  async consumeStream(stream) {
    let buffer = '';

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        buffer += chunk.toString('utf8').replace(/\r\n/g, '\n');

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          this.handleRawEvent(rawEvent).catch((error) => {
            logger.error('Failed to process Squiggle SSE event', {
              error: error.message
            });
          });
          boundaryIndex = buffer.indexOf('\n\n');
        }
      });

      stream.on('end', () => resolve());
      stream.on('close', () => resolve());
      stream.on('error', (error) => reject(error));
    }).finally(() => {
      if (this.running) {
        this.scheduleReconnect();
      }
    });
  }

  async handleRawEvent(rawEvent) {
    if (!rawEvent || !rawEvent.trim()) {
      return;
    }

    const eventLines = rawEvent.split('\n');
    let eventName = 'message';
    const dataLines = [];

    eventLines.forEach((line) => {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        return;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    });

    if (dataLines.length === 0) {
      await resultUpdateService.recordHeartbeat({ type: 'stream-keepalive' });
      return;
    }

    const payloadText = dataLines.join('\n');
    const payload = parseJsonSafe(payloadText);
    await resultUpdateService.recordHeartbeat({ type: 'event', eventName });

    if (!payload) {
      logger.warn('Ignoring Squiggle SSE event with invalid JSON payload', { eventName });
      return;
    }

    const snapshotGames = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.games)
        ? payload.games
        : null;

    if (snapshotGames) {
      await resultUpdateService.recordLastEvent({
        eventName,
        eventType: 'snapshot',
        snapshotCount: snapshotGames.length,
        activeGameIds: snapshotGames
          .map((game) => Number.parseInt(game?.id, 10))
          .filter((gameId) => Number.isInteger(gameId))
          .slice(0, 5)
      });
      await this.syncTrackedGamesFromSnapshot(snapshotGames, eventName);

      logger.debug('Received Squiggle SSE snapshot payload', {
        eventName,
        snapshotCount: snapshotGames.length
      });
      return;
    }

    const game = payload.game || payload;
    const trackedGame = normalizeTrackedGame(game);
    const gameId = trackedGame?.gameId ?? null;
    const year = trackedGame?.year ?? null;
    const fingerprint = trackedGame?.fingerprint ?? buildGameFingerprint(game);
    const lastMeaningfulEvent = Number.isInteger(gameId)
      ? {
        eventName,
        eventType: 'game',
        gameId,
        year,
        fingerprint,
        complete: game?.complete ?? null
      }
      : {
        eventName,
        eventType: 'snapshot'
      };

    if (Number.isInteger(gameId)) {
      await resultUpdateService.recordLastEvent(lastMeaningfulEvent);
    }

    if (!Number.isInteger(gameId) || !Number.isInteger(year)) {
      logger.debug('Ignoring Squiggle SSE payload without a trackable game', {
        eventName,
        payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 10) : []
      });
      return;
    }

    if (!shouldTriggerCompletedGameFlow(eventName, game)) {
      await this.updateTrackedGameState(game);
      logger.debug('Ignoring non-terminal Squiggle game event', {
        eventName,
        gameId,
        year,
        complete: game?.complete ?? null
      });
      return;
    }

    await this.updateTrackedGameState(game, { remove: true });
    const previousFingerprintState = await resultUpdateService.getLastFingerprintForGame(gameId);
    if (previousFingerprintState?.value?.fingerprint && previousFingerprintState.value.fingerprint === fingerprint) {
      logger.debug('Ignoring duplicate completed-game fingerprint', {
        gameId,
        year,
        eventName,
        fingerprint
      });
      return;
    }

    await resultUpdateService.setLastFingerprintForGame(gameId, fingerprint);
    logger.info('Processing completed-game Squiggle event', {
      eventName,
      gameId,
      year,
      complete: game?.complete ?? null,
      fingerprint
    });
    await resultUpdateService.ingestCompletedGameResult({
      year,
      gameId,
      source: `event-sync:${eventName}`
    });
  }

  scheduleReconnect(error = null) {
    if (!this.running) {
      return;
    }

    const { url: sseUrl } = getSquiggleGamesSseConfig();

    if (error) {
      resultUpdateService.recordLastError(error, {
        url: sseUrl,
        reconnect_in_ms: this.reconnectDelayMs
      }).catch((stateError) => {
        logger.error('Failed to record event sync error state', { error: stateError.message });
      });
    }

    resultUpdateService.recordConnectionState('reconnecting', {
      url: sseUrl,
      reconnect_in_ms: this.reconnectDelayMs
    }).catch((stateError) => {
      logger.error('Failed to record event sync reconnect state', { error: stateError.message });
    });

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((connectError) => {
        logger.error('Event sync reconnect failed', {
          error: connectError.message,
          url: sseUrl
        });
        this.scheduleReconnect(connectError);
      });
    }, this.reconnectDelayMs);

    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }
}

module.exports = new EventSyncService();
module.exports.__testables = {
  buildGameFingerprint,
  extractYearFromGame,
  shouldTriggerCompletedGameFlow,
  isGameActiveForSync,
  normalizeTrackedGame
};
