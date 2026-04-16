jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn()
}));

jest.mock('../auth', () => ({
  isAuthenticated: (req, res, next) => {
    if (req.session.user) {
      next();
      return;
    }

    res.redirect('/login');
  }
}));

jest.mock('../../services/scoring-service', () => ({
  calculateTipPoints: jest.fn(() => 1),
  calculateBrierScore: jest.fn(() => 0.1),
  calculateBitsScore: jest.fn(() => 0.2)
}));

jest.mock('../../services/round-service', () => ({
  resolveYear: jest.fn(),
  getRoundsForYear: jest.fn(),
  normalizeRoundForDisplay: jest.fn((round) => round),
  combineRoundsForDisplay: jest.fn((rounds) => rounds),
  expandRoundSelection: jest.fn((round) => [round])
}));

jest.mock('../../services/match-service', () => ({
  getMatchesByRoundSelectionAndYear: jest.fn(),
  getMostRecentRoundWithResults: jest.fn(),
  getCompletedMatchesForYear: jest.fn(),
  getCompletedMatchesForRoundSelection: jest.fn()
}));

jest.mock('../../services/prediction-service', () => ({
  getPredictionsForUser: jest.fn(),
  getPredictionsWithResultsForYear: jest.fn(),
  getPredictionsWithResultsForRoundSelection: jest.fn()
}));

jest.mock('../../services/predictor-service', () => ({
  getPredictorsWithAdminStatus: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const request = require('supertest');
const { getQuery, getOne, runQuery } = require('../../models/db');
const roundService = require('../../services/round-service');
const matchService = require('../../services/match-service');
const predictionService = require('../../services/prediction-service');
const predictorService = require('../../services/predictor-service');
const matchesRouter = require('../matches');
const { createRouterTestApp } = require('./test-app');

describe('matches routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    roundService.resolveYear.mockResolvedValue({ selectedYear: 2026, years: [{ year: 2026 }] });
  });

  test('redirects anonymous users to login', async () => {
    const app = createRouterTestApp(matchesRouter);

    const response = await request(app).get('/round/1');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('GET /round/:round returns matches for the selected round', async () => {
    matchService.getMatchesByRoundSelectionAndYear.mockResolvedValue([{ match_id: 77 }]);

    const app = createRouterTestApp(matchesRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/round/Finals%20Week%202?year=2026');

    expect(response.status).toBe(200);
    expect(roundService.normalizeRoundForDisplay).toHaveBeenCalledWith('Finals Week 2', 2026);
    expect(response.body).toEqual([{ match_id: 77 }]);
  });

  test('GET / resolves available rounds with the non-admin minimum year', async () => {
    roundService.getRoundsForYear.mockResolvedValue([{ round_number: '1' }]);

    const app = createRouterTestApp(matchesRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/?year=2026');

    expect(response.status).toBe(200);
    expect(roundService.resolveYear).toHaveBeenCalledWith('2026', { minYear: 2022 });
    expect(response.body).toEqual([{ round_number: '1' }]);
  });

  test('GET /stats renders leaderboard data, creates missing default predictions, and filters excluded or inactive predictors', async () => {
    roundService.getRoundsForYear.mockResolvedValue([
      { round_number: '1' },
      { round_number: '2' }
    ]);
    roundService.normalizeRoundForDisplay.mockImplementation((round) => round);
    roundService.combineRoundsForDisplay.mockImplementation((rounds) => rounds);

    getQuery
      .mockResolvedValueOnce([
        {
          match_id: 11,
          round_number: '1',
          match_date: '2026-03-10T19:30:00.000Z',
          hscore: 100,
          ascore: 80,
          home_team: 'Cats',
          away_team: 'Swans'
        },
        {
          match_id: 12,
          round_number: '2',
          match_date: '2099-03-17T19:30:00.000Z',
          hscore: null,
          ascore: null,
          home_team: 'Lions',
          away_team: 'Dockers'
        }
      ])
      .mockResolvedValueOnce([
        { predictor_id: 1, year_joined: 2020 },
        { predictor_id: 2, year_joined: 2027 }
      ])
      .mockResolvedValueOnce([
        { match_id: 11, match_date: '2026-03-10T19:30:00.000Z' },
        { match_id: 12, match_date: '2099-03-17T19:30:00.000Z' }
      ]);
    getOne.mockResolvedValue(null);

    matchService.getMostRecentRoundWithResults.mockResolvedValue({ year: 2026, round: '1' });
    matchService.getCompletedMatchesForYear.mockResolvedValue([
      { match_id: 11, match_date: '2026-03-10T19:30:00.000Z', hscore: 100, ascore: 80 }
    ]);
    matchService.getCompletedMatchesForRoundSelection.mockResolvedValue([
      { match_id: 11, match_date: '2026-03-10T19:30:00.000Z', hscore: 100, ascore: 80 }
    ]);

    predictorService.getPredictorsWithAdminStatus.mockResolvedValue([
      {
        predictor_id: 1,
        name: 'dad',
        display_name: 'Dad',
        stats_excluded: 0,
        active: 1,
        is_admin: 0
      },
      {
        predictor_id: 2,
        name: 'hidden',
        display_name: 'Hidden',
        stats_excluded: 1,
        active: 1,
        is_admin: 0
      },
      {
        predictor_id: 3,
        name: 'inactive',
        display_name: 'Inactive',
        stats_excluded: 0,
        active: 0,
        is_admin: 0
      },
      {
        predictor_id: 4,
        name: 'admin',
        display_name: 'Admin',
        stats_excluded: 0,
        active: 1,
        is_admin: 1
      }
    ]);

    predictionService.getPredictionsForUser.mockResolvedValue([{ match_id: 11, home_win_probability: 60 }]);
    predictionService.getPredictionsWithResultsForYear.mockImplementation(async (predictorId) => {
      if (predictorId === 1) {
        return [
          {
            home_win_probability: 65,
            hscore: 100,
            ascore: 80,
            round_number: '1',
            tipped_team: 'home',
            predicted_margin: 15
          }
        ];
      }
      if (predictorId === 3) {
        return [];
      }
      if (predictorId === 4) {
        return [
          {
            home_win_probability: 55,
            hscore: 100,
            ascore: 80,
            round_number: '1',
            tipped_team: 'home',
            predicted_margin: null
          }
        ];
      }
      return [];
    });
    predictionService.getPredictionsWithResultsForRoundSelection.mockImplementation(async (predictorId) => {
      if (predictorId === 1) {
        return [
          {
            home_win_probability: 65,
            hscore: 100,
            ascore: 80,
            tipped_team: 'home',
            predicted_margin: 15
          }
        ];
      }
      return [];
    });

    const app = createRouterTestApp(matchesRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/stats?year=2026');

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO predictions'),
      [11, 1]
    );
    expect(response.body.view).toBe('stats');
    expect(response.body.locals.selectedRound).toBe('1');
    expect(response.body.locals.currentRound).toBe('2');
    expect(response.body.locals.defaultRound).toBe('1');
    expect(response.body.locals.predictorStats).toEqual([
      expect.objectContaining({
        id: 1,
        display_name: 'Dad',
        brierScore: '0.1000',
        bitsScore: '0.2000',
        marginMAE: '5.00'
      })
    ]);
    expect(response.body.locals.allPredictors).toEqual([
      { id: 1, name: 'dad', display_name: 'Dad', stats_excluded: 0 },
      { id: 2, name: 'hidden', display_name: 'Hidden', stats_excluded: 1 },
      { id: 3, name: 'inactive', display_name: 'Inactive', stats_excluded: 0 }
    ]);
    expect(response.body.locals.roundPredictorStats).toEqual([
      expect.objectContaining({
        id: 3,
        display_name: 'Inactive',
        totalPredictions: 0,
        marginMAE: null
      }),
      expect.objectContaining({
        id: 1,
        display_name: 'Dad',
        totalPredictions: 1,
        marginMAE: '5.00'
      })
    ]);
    expect(response.body.locals.cumulativePredictorStats).toEqual([
      expect.objectContaining({
        id: 3,
        display_name: 'Inactive',
        totalPredictions: 0,
        marginMAE: null
      }),
      expect.objectContaining({
        id: 1,
        display_name: 'Dad',
        totalPredictions: 1,
        marginMAE: '5.00'
      })
    ]);
  });

  test('GET /stats/round/:round returns round and cumulative stats for non-excluded non-admin predictors', async () => {
    roundService.normalizeRoundForDisplay.mockReturnValue('Finals Week 2');
    roundService.expandRoundSelection.mockReturnValue(['Elimination Final', 'Qualifying Final']);
    roundService.getRoundsForYear.mockResolvedValue([
      { round_number: '1' },
      {
        round_number: 'Finals Week 2',
        source_round_numbers: ['Elimination Final', 'Qualifying Final']
      }
    ]);
    predictorService.getPredictorsWithAdminStatus.mockResolvedValue([
      {
        predictor_id: 1,
        name: 'dad',
        display_name: 'Dad',
        stats_excluded: 0,
        active: 1,
        is_admin: 0
      },
      {
        predictor_id: 2,
        name: 'admin',
        display_name: 'Admin',
        stats_excluded: 0,
        active: 1,
        is_admin: 1
      }
    ]);
    matchService.getCompletedMatchesForRoundSelection.mockResolvedValue([
      { match_id: 22, hscore: 90, ascore: 70 }
    ]);
    predictionService.getPredictionsWithResultsForYear.mockImplementation(async (predictorId) => {
      if (predictorId === 1) {
        return [
          {
            home_win_probability: 55,
            hscore: 85,
            ascore: 70,
            round_number: '1',
            tipped_team: 'home',
            predicted_margin: 10
          },
          {
            home_win_probability: 60,
            hscore: 90,
            ascore: 70,
            round_number: 'Elimination Final',
            tipped_team: 'home',
            predicted_margin: 12
          }
        ];
      }
      return [
        {
          home_win_probability: 40,
          hscore: 90,
          ascore: 70,
          round_number: 'Qualifying Final',
          tipped_team: 'away',
          predicted_margin: null
        }
      ];
    });

    const app = createRouterTestApp(matchesRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/stats/round/Finals%20Week%202?year=2026');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      roundPredictorStats: [
        {
          id: 1,
          name: 'dad',
          display_name: 'Dad',
          tipPoints: 1,
          totalPredictions: 1,
          tipAccuracy: '100.0',
          brierScore: '0.1000',
          bitsScore: '0.2000',
          marginMAE: '8.00',
          marginPredictionCount: 1
        }
      ],
      cumulativePredictorStats: [
        {
          id: 1,
          name: 'dad',
          display_name: 'Dad',
          tipPoints: 2,
          totalPredictions: 2,
          tipAccuracy: '100.0',
          brierScore: '0.1000',
          bitsScore: '0.4000',
          marginMAE: '6.50',
          marginPredictionCount: 2
        }
      ],
      completedMatchesForRound: [{ match_id: 22, hscore: 90, ascore: 70 }],
      selectedRound: 'Finals Week 2',
      selectedYear: 2026,
      currentUser: { id: 5 }
    });
  });
});
