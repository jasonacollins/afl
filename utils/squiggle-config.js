const DEFAULT_SQUIGGLE_API_BASE_URL = 'https://api.squiggle.com.au/';
const DEFAULT_SQUIGGLE_SSE_GAMES_URL = 'https://sse.squiggle.com.au/games';
const DEFAULT_SQUIGGLE_USER_AGENT = 'AFL Predictions - jason@jasoncollins.me';

function normalizeApiBaseUrl(url) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) {
    return DEFAULT_SQUIGGLE_API_BASE_URL;
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeValue(value, fallback) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function getSquiggleApiBaseUrl() {
  return normalizeApiBaseUrl(process.env.SQUIGGLE_API_BASE_URL);
}

function getSquiggleSseGamesUrl() {
  return normalizeValue(process.env.SQUIGGLE_SSE_GAMES_URL, DEFAULT_SQUIGGLE_SSE_GAMES_URL);
}

function getSquiggleUserAgent() {
  return normalizeValue(process.env.SQUIGGLE_USER_AGENT, DEFAULT_SQUIGGLE_USER_AGENT);
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
