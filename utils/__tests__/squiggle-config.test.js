describe('squiggle-config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SQUIGGLE_API_BASE_URL;
    delete process.env.SQUIGGLE_SSE_GAMES_URL;
    delete process.env.SQUIGGLE_USER_AGENT;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('uses the documented default Squiggle endpoints and contactable user agent', () => {
    const config = require('../squiggle-config');

    expect(config.getSquiggleApiBaseUrl()).toBe('https://api.squiggle.com.au/');
    expect(config.getSquiggleSseGamesUrl()).toBe('https://sse.squiggle.com.au/games');
    expect(config.getSquiggleUserAgent()).toBe('AFL Predictions - jason@jasoncollins.me');
    expect(config.buildSquiggleHeaders()).toEqual({
      'User-Agent': 'AFL Predictions - jason@jasoncollins.me'
    });
  });

  test('allows env overrides and normalizes the API base URL trailing slash', () => {
    process.env.SQUIGGLE_API_BASE_URL = 'https://example.com/api';
    process.env.SQUIGGLE_SSE_GAMES_URL = 'https://example.com/sse/games';
    process.env.SQUIGGLE_USER_AGENT = 'Example App - ops@example.com';

    const config = require('../squiggle-config');

    expect(config.getSquiggleApiBaseUrl()).toBe('https://example.com/api/');
    expect(config.getSquiggleSseGamesUrl()).toBe('https://example.com/sse/games');
    expect(config.getSquiggleUserAgent()).toBe('Example App - ops@example.com');
    expect(config.buildSquiggleHeaders({ Accept: 'application/json' })).toEqual({
      'User-Agent': 'Example App - ops@example.com',
      Accept: 'application/json'
    });
  });
});
