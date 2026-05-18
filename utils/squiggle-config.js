const { DEFAULTS, getConfig } = require('../config');

const DEFAULT_SQUIGGLE_API_BASE_URL = DEFAULTS.squiggleApiBaseUrl;
const DEFAULT_SQUIGGLE_SSE_GAMES_URL = DEFAULTS.squiggleSseGamesUrl;
const DEFAULT_SQUIGGLE_USER_AGENT = DEFAULTS.squiggleUserAgent;

function getSquiggleApiBaseUrl() {
  return getConfig().squiggle.apiBaseUrl;
}

function getSquiggleSseGamesUrl() {
  return getConfig().squiggle.sseGamesUrl;
}

function getSquiggleUserAgent() {
  return getConfig().squiggle.userAgent;
}

function buildSquiggleHeaders(extraHeaders = {}) {
  return {
    'User-Agent': getSquiggleUserAgent(),
    ...extraHeaders
  };
}

module.exports = {
  DEFAULT_SQUIGGLE_API_BASE_URL,
  DEFAULT_SQUIGGLE_SSE_GAMES_URL,
  DEFAULT_SQUIGGLE_USER_AGENT,
  buildSquiggleHeaders,
  getSquiggleApiBaseUrl,
  getSquiggleSseGamesUrl,
  getSquiggleUserAgent
};
