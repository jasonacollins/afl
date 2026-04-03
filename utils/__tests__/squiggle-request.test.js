describe('squiggle-request', () => {
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

  test('builds standard Squiggle query URLs from shared config', () => {
    const { buildSquiggleQueryUrl } = require('../squiggle-request');

    expect(buildSquiggleQueryUrl('teams')).toBe('https://api.squiggle.com.au/?q=teams');
    expect(buildSquiggleQueryUrl('games', { year: 2026, game: 38510 })).toBe(
      'https://api.squiggle.com.au/?q=games;year=2026;game=38510'
    );
  });

  test('builds shared standard request options with the contactable user agent', () => {
    const { getSquiggleRequestOptions } = require('../squiggle-request');

    expect(getSquiggleRequestOptions()).toEqual({
      headers: {
        'User-Agent': 'AFL Predictions - jason@jasoncollins.me'
      }
    });
  });

  test('builds the migrated Squiggle SSE config from shared config', () => {
    const { getSquiggleGamesSseConfig } = require('../squiggle-request');

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
