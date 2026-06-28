const path = require('path');

const {
  DEFAULTS,
  buildChildProcessEnv,
  buildConfig,
  validateConfig
} = require('../index');

describe('runtime config', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('applies defaults for missing optional environment variables', () => {
    const config = buildConfig({});

    expect(config).toMatchObject({
      nodeEnv: 'development',
      isDevelopment: true,
      isProduction: false,
      isTest: false,
      port: 3001,
      sessionSecret: null,
      assetVersion: null,
      database: {
        path: path.join(__dirname, '../../data/database/afl_predictions.db'),
        sqliteBusyTimeoutMs: 10000
      },
      squiggle: {
        apiBaseUrl: 'https://api.squiggle.com.au/',
        sseGamesUrl: 'https://sse.squiggle.com.au/games',
        userAgent: 'AFL Predictions - jason@jasoncollins.me'
      },
      eventSync: {
        enabled: true,
        reconciliationMinIntervalMs: 30 * 60 * 1000,
        streamInactivityTimeoutMs: 10 * 60 * 1000
      }
    });
  });

  test('normalizes string overrides and parses numeric settings', () => {
    const config = buildConfig({
      NODE_ENV: ' production ',
      PORT: '4000',
      SESSION_SECRET: ' secret ',
      ASSET_VERSION: ' build-123 ',
      DB_PATH: ' /tmp/afl.db ',
      SQLITE_BUSY_TIMEOUT_MS: '2500',
      SQUIGGLE_API_BASE_URL: ' https://example.com/api ',
      SQUIGGLE_SSE_GAMES_URL: ' https://example.com/sse ',
      SQUIGGLE_USER_AGENT: ' Example App - ops@example.com ',
      EVENT_SYNC_ENABLED: '0',
      EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS: '120000',
      EVENT_SYNC_STREAM_INACTIVITY_TIMEOUT_MS: '900000'
    });

    expect(config).toMatchObject({
      nodeEnv: 'production',
      isProduction: true,
      port: 4000,
      sessionSecret: 'secret',
      assetVersion: 'build-123',
      database: {
        path: '/tmp/afl.db',
        sqliteBusyTimeoutMs: 2500
      },
      squiggle: {
        apiBaseUrl: 'https://example.com/api/',
        sseGamesUrl: 'https://example.com/sse',
        userAgent: 'Example App - ops@example.com'
      },
      eventSync: {
        enabled: false,
        reconciliationMinIntervalMs: 120000,
        streamInactivityTimeoutMs: 900000
      }
    });
  });

  test('disables event sync in test mode even when enabled explicitly', () => {
    const config = buildConfig({
      NODE_ENV: 'test',
      EVENT_SYNC_ENABLED: '1'
    });

    expect(config.eventSync.enabled).toBe(false);
  });

  test('validates production session secret and numeric settings', () => {
    expect(() => validateConfig(buildConfig({
      NODE_ENV: 'production',
      PORT: 'abc',
      SQLITE_BUSY_TIMEOUT_MS: '0',
      EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS: '-1',
      EVENT_SYNC_STREAM_INACTIVITY_TIMEOUT_MS: '0'
    }))).toThrow(
      'Invalid runtime configuration: SESSION_SECRET environment variable is required in production; PORT must be a positive integer; SQLITE_BUSY_TIMEOUT_MS must be a positive integer; EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS must be a positive integer; EVENT_SYNC_STREAM_INACTIVITY_TIMEOUT_MS must be a positive integer'
    );
  });

  test('builds child-process env from parsed app-owned settings plus overrides', () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      DB_PATH: '/tmp/source.db',
      SQLITE_BUSY_TIMEOUT_MS: '5000',
      SQUIGGLE_API_BASE_URL: 'https://example.com/api',
      SQUIGGLE_SSE_GAMES_URL: 'https://example.com/sse',
      SQUIGGLE_USER_AGENT: 'Example Agent'
    };

    const env = buildChildProcessEnv({ PYTHONUNBUFFERED: '1' });

    expect(env).toEqual(expect.objectContaining({
      NODE_ENV: 'development',
      DB_PATH: '/tmp/source.db',
      SQLITE_BUSY_TIMEOUT_MS: '5000',
      SQUIGGLE_API_BASE_URL: 'https://example.com/api/',
      SQUIGGLE_SSE_GAMES_URL: 'https://example.com/sse',
      SQUIGGLE_USER_AGENT: 'Example Agent',
      EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS: String(
        DEFAULTS.eventSyncReconciliationMinIntervalMs
      ),
      EVENT_SYNC_STREAM_INACTIVITY_TIMEOUT_MS: String(
        DEFAULTS.eventSyncStreamInactivityTimeoutMs
      ),
      PYTHONUNBUFFERED: '1'
    }));
  });
});
