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
  combineRoundsForDisplay: jest.fn((rounds) => rounds)
}));

jest.mock('../../services/match-service', () => ({
  getMatchesByRoundSelectionAndYear: jest.fn()
}));

jest.mock('../../services/prediction-service', () => ({
  getPredictionsForUser: jest.fn(),
  getPredictionsWithResultsForYear: jest.fn()
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
const roundService = require('../../services/round-service');
const matchService = require('../../services/match-service');
const matchesRouter = require('../matches');
const { createRouterTestApp } = require('./test-app');

describe('matches routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    roundService.resolveYear.mockResolvedValue({ selectedYear: 2026 });
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
});
