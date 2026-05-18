const path = require('path');

require('dotenv').config({ quiet: true });

const PROJECT_ROOT = path.join(__dirname, '..');

const DEFAULTS = {
  nodeEnv: 'development',
  port: 3001,
  databasePath: path.join(PROJECT_ROOT, 'data/database/afl_predictions.db'),
  sqliteBusyTimeoutMs: 10000,
  squiggleApiBaseUrl: 'https://api.squiggle.com.au/',
  squiggleSseGamesUrl: 'https://sse.squiggle.com.au/games',
  squiggleUserAgent: 'AFL Predictions - jason@jasoncollins.me',
  eventSyncReconciliationMinIntervalMs: 30 * 60 * 1000
};

function normalizeOptionalString(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function normalizeApiBaseUrl(value) {
  const normalized = normalizeOptionalString(value) || DEFAULTS.squiggleApiBaseUrl;
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function parseIntegerEnv(env, name, fallback) {
  const rawValue = normalizeOptionalString(env[name]);
  if (!rawValue) {
    return fallback;
  }

  return Number.parseInt(rawValue, 10);
}

function buildConfig(env = process.env) {
  const nodeEnv = normalizeOptionalString(env.NODE_ENV) || DEFAULTS.nodeEnv;

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    port: parseIntegerEnv(env, 'PORT', DEFAULTS.port),
    sessionSecret: normalizeOptionalString(env.SESSION_SECRET),
    assetVersion: normalizeOptionalString(env.ASSET_VERSION),
    database: {
      path: normalizeOptionalString(env.DB_PATH) || DEFAULTS.databasePath,
      sqliteBusyTimeoutMs: parseIntegerEnv(
        env,
        'SQLITE_BUSY_TIMEOUT_MS',
        DEFAULTS.sqliteBusyTimeoutMs
      )
    },
    squiggle: {
      apiBaseUrl: normalizeApiBaseUrl(env.SQUIGGLE_API_BASE_URL),
      sseGamesUrl: normalizeOptionalString(env.SQUIGGLE_SSE_GAMES_URL)
        || DEFAULTS.squiggleSseGamesUrl,
      userAgent: normalizeOptionalString(env.SQUIGGLE_USER_AGENT)
        || DEFAULTS.squiggleUserAgent
    },
    eventSync: {
      enabled: normalizeOptionalString(env.EVENT_SYNC_ENABLED) !== '0'
        && nodeEnv !== 'test',
      reconciliationMinIntervalMs: parseIntegerEnv(
        env,
        'EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS',
        DEFAULTS.eventSyncReconciliationMinIntervalMs
      )
    }
  };
}

function assertPositiveInteger(configValue, envName, errors) {
  if (!Number.isInteger(configValue) || configValue <= 0) {
    errors.push(`${envName} must be a positive integer`);
  }
}

function validateConfig(config = buildConfig()) {
  const errors = [];

  if (config.isProduction && !config.sessionSecret) {
    errors.push('SESSION_SECRET environment variable is required in production');
  }

  assertPositiveInteger(config.port, 'PORT', errors);
  assertPositiveInteger(
    config.database.sqliteBusyTimeoutMs,
    'SQLITE_BUSY_TIMEOUT_MS',
    errors
  );
  assertPositiveInteger(
    config.eventSync.reconciliationMinIntervalMs,
    'EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS',
    errors
  );

  if (errors.length > 0) {
    throw new Error(`Invalid runtime configuration: ${errors.join('; ')}`);
  }

  return config;
}

function getConfig() {
  return buildConfig();
}

function getValidatedConfig() {
  return validateConfig(getConfig());
}

function buildChildProcessEnv(overrides = {}) {
  const config = getConfig();

  return {
    ...process.env,
    NODE_ENV: config.nodeEnv,
    DB_PATH: config.database.path,
    SQLITE_BUSY_TIMEOUT_MS: String(config.database.sqliteBusyTimeoutMs),
    SQUIGGLE_API_BASE_URL: config.squiggle.apiBaseUrl,
    SQUIGGLE_SSE_GAMES_URL: config.squiggle.sseGamesUrl,
    SQUIGGLE_USER_AGENT: config.squiggle.userAgent,
    EVENT_SYNC_RECONCILIATION_MIN_INTERVAL_MS: String(
      config.eventSync.reconciliationMinIntervalMs
    ),
    ...overrides
  };
}

module.exports = {
  DEFAULTS,
  buildChildProcessEnv,
  buildConfig,
  getConfig,
  getValidatedConfig,
  validateConfig
};
