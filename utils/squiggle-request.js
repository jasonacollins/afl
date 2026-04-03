const {
  buildSquiggleHeaders,
  getSquiggleApiBaseUrl,
  getSquiggleSseGamesUrl
} = require('./squiggle-config');

function buildSquiggleQueryUrl(endpoint, params = {}) {
  const queryParams = Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(';');

  return `${getSquiggleApiBaseUrl()}?q=${endpoint}${queryParams ? `;${queryParams}` : ''}`;
}

function getSquiggleRequestOptions(extraHeaders = {}) {
  return {
    headers: buildSquiggleHeaders(extraHeaders)
  };
}

function getSquiggleGamesSseConfig() {
  return {
    url: getSquiggleSseGamesUrl(),
    options: getSquiggleRequestOptions({
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache'
    })
  };
}

module.exports = {
  buildSquiggleQueryUrl,
  getSquiggleGamesSseConfig,
  getSquiggleRequestOptions
};
