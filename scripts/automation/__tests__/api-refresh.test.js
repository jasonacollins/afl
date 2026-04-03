jest.mock('../../../models/db', () => ({
  runQuery: jest.fn(),
  getOne: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../../utils/squiggle-request', () => ({
  buildSquiggleQueryUrl: jest.fn((endpoint, params = {}) => {
    const year = params.year !== undefined ? `;year=${params.year}` : '';
    const game = params.game !== undefined && params.game !== null ? `;game=${params.game}` : '';
    return `https://api.squiggle.com.au/?q=${endpoint}${year}${game}`;
  }),
  getSquiggleRequestOptions: jest.fn(() => ({
    headers: {
      'User-Agent': 'AFL Predictions - jason@jasoncollins.me'
    }
  }))
}));

const { runQuery, getOne } = require('../../../models/db');
const { logger } = require('../../../utils/logger');
const apiRefresh = require('../api-refresh');

const {
  resolveVenueId,
  setFetchImplementationForTests,
  resetFetchImplementationForTests
} = apiRefresh.__testables;

describe('api-refresh helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetFetchImplementationForTests();
  });

  test('resolveVenueId returns null for blank values', async () => {
    await expect(resolveVenueId('')).resolves.toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  test('resolveVenueId returns the resolved venue id', async () => {
    getOne.mockResolvedValue({ venue_id: 15 });

    await expect(resolveVenueId('MCG')).resolves.toBe(15);
    expect(getOne).toHaveBeenCalledWith(expect.stringContaining('SELECT venue_id'), ['MCG', 'MCG']);
  });
});

describe('api-refresh operational flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetFetchImplementationForTests();
  });

  test('refreshAPIData updates fixture details and completed scores for matching games', async () => {
    setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        games: [
          {
            id: 38510,
            date: '2026-04-05T05:20:00Z',
            venue: 'MCG',
            hteamid: 1,
            ateamid: 2,
            complete: 100,
            hscore: 91,
            ascore: 84,
            hgoals: 13,
            hbehinds: 13,
            agoals: 12,
            abehinds: 12
          }
        ]
      })
    }));

    getOne
      .mockResolvedValueOnce({
        match_date: '2026-04-04T05:20:00Z',
        venue: 'Marvel Stadium',
        home_team_id: 1,
        away_team_id: 3
      })
      .mockResolvedValueOnce({ venue_id: 9 });
    runQuery
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const result = await apiRefresh.refreshAPIData(2026, {
      source: 'test-run'
    });

    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      'UPDATE matches SET match_date = ?, venue = ?, venue_id = ?, home_team_id = ?, away_team_id = ? WHERE match_number = ?',
      ['2026-04-05T05:20:00Z', 'MCG', 9, 1, 2, 38510]
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE matches'),
      [91, 84, 13, 13, 12, 12, 38510]
    );
    expect(result).toEqual(expect.objectContaining({
      success: true,
      updateCount: 1,
      scoresUpdated: 1,
      updatedMatchNumbers: [38510],
      updatedCompletedMatchNumbers: [38510],
      source: 'test-run',
      skippedFixtureUpdateCount: 0,
      skippedScoreUpdateCount: 0
    }));
  });

  test('refreshAPIData warns when API games exist but no DB fixtures are present yet', async () => {
    setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        games: [
          {
            id: 38511,
            date: '2026-04-12T05:20:00Z',
            venue: 'Adelaide Oval',
            hteamid: 4,
            ateamid: 5,
            complete: 0,
            hscore: null,
            ascore: null
          }
        ]
      })
    }));

    getOne.mockResolvedValue(null);

    const result = await apiRefresh.refreshAPIData(2026);

    expect(logger.warn).toHaveBeenCalledWith(
      'No existing matches found in database for API year 2026. Run sync-games for 2026 first to insert fixtures before API refresh.'
    );
    expect(result).toEqual(expect.objectContaining({
      success: true,
      updateCount: 0,
      scoresUpdated: 0
    }));
  });

  test('refreshAPIData skips invalid completed scores and reports the skip count', async () => {
    setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        games: [
          {
            id: 38512,
            date: '2026-04-19T05:20:00Z',
            venue: 'Optus Stadium',
            hteamid: 6,
            ateamid: 7,
            complete: 100,
            hscore: 'bad',
            ascore: 70
          }
        ]
      })
    }));

    getOne.mockResolvedValue({
      match_date: '2026-04-19T05:20:00Z',
      venue: 'Optus Stadium',
      home_team_id: 6,
      away_team_id: 7
    });

    const result = await apiRefresh.refreshAPIData(2026);

    expect(runQuery).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping score update for Game ID 38512: Invalid scores received from API',
      { homeScore: 'bad', awayScore: 70 }
    );
    expect(result).toEqual(expect.objectContaining({
      success: true,
      scoresUpdated: 0,
      skippedScoreUpdateCount: 1
    }));
  });

  test('refreshAPIData rethrows operational API errors from the fetch step', async () => {
    setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable'
    }));

    await expect(apiRefresh.refreshAPIData(2026)).rejects.toMatchObject({
      isOperational: true,
      statusCode: 503,
      errorCode: 'API_ERROR',
      message: 'Squiggle API request failed: 503 Service Unavailable'
    });
  });
});
