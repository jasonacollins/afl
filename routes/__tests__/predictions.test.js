jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn()
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
  calculateBrierScore: jest.fn(() => 0.2),
  calculateBitsScore: jest.fn(() => 0.4)
}));

jest.mock('../../services/round-service', () => ({
  resolveYear: jest.fn(),
  getRoundsForYear: jest.fn(),
  combineRoundsForDisplay: jest.fn(),
  normalizeRoundForDisplay: jest.fn((round) => round)
}));

jest.mock('../../services/match-service', () => ({
  getMatchesByRoundSelectionAndYear: jest.fn(),
  processMatchLockStatus: jest.fn((matches) => matches)
}));

jest.mock('../../services/prediction-service', () => ({
  getPredictionsForUser: jest.fn(),
  savePrediction: jest.fn(),
  deletePrediction: jest.fn()
}));

jest.mock('../../services/predictor-service', () => ({
  getPredictorById: jest.fn()
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
const { getQuery, getOne } = require('../../models/db');
const roundService = require('../../services/round-service');
const matchService = require('../../services/match-service');
const predictionService = require('../../services/prediction-service');
const predictorService = require('../../services/predictor-service');
const predictionsRouter = require('../predictions');
const { createRouterTestApp } = require('./test-app');

describe('predictions routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    roundService.resolveYear.mockResolvedValue({
      selectedYear: 2026,
      years: [{ year: 2026 }, { year: 2025 }]
    });
    roundService.getRoundsForYear.mockResolvedValue([
      { round_number: '1' },
      { round_number: '2' }
    ]);
    roundService.combineRoundsForDisplay.mockImplementation((rounds) => rounds);
    predictorService.getPredictorById.mockResolvedValue({ predictor_id: 5, year_joined: 2022 });
    predictionService.getPredictionsForUser.mockResolvedValue([]);
    getQuery.mockResolvedValue([]);
  });

  test('redirects anonymous users before route handlers run', async () => {
    const app = createRouterTestApp(predictionsRouter);

    const response = await request(app).get('/round/1');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('GET / renders the predictions page using the next upcoming round', async () => {
    getQuery.mockResolvedValue([
      {
        match_id: 1,
        round_number: '1',
        match_date: '2020-03-01T12:00:00.000Z',
        hscore: 90,
        ascore: 80
      },
      {
        match_id: 2,
        round_number: '2',
        match_date: '2099-03-01T12:00:00.000Z',
        hscore: null,
        ascore: null
      }
    ]);
    matchService.getMatchesByRoundSelectionAndYear.mockResolvedValue([{ match_id: 2 }]);
    predictionService.getPredictionsForUser.mockResolvedValue([
      { match_id: 2, home_win_probability: 64, tipped_team: 'home' }
    ]);

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(matchService.getMatchesByRoundSelectionAndYear).toHaveBeenCalledWith('2', 2026);
    expect(response.body.view).toBe('predictions');
    expect(response.body.locals.selectedRound).toBe('2');
    expect(response.body.locals.currentRound).toBe('2');
    expect(response.body.locals.predictions).toEqual({
      2: {
        probability: 64,
        tipped_team: 'home'
      }
    });
  });

  test('GET / preserves 0 percent and 50 percent away predictions in the rendered payload', async () => {
    getQuery.mockResolvedValue([
      {
        match_id: 1,
        round_number: '1',
        match_date: '2099-03-01T12:00:00.000Z',
        hscore: null,
        ascore: null
      }
    ]);
    matchService.getMatchesByRoundSelectionAndYear.mockResolvedValue([{ match_id: 1 }]);
    predictionService.getPredictionsForUser.mockResolvedValue([
      { match_id: 1, home_win_probability: 0, tipped_team: 'away' },
      { match_id: 2, home_win_probability: 50, tipped_team: 'away' }
    ]);

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.locals.predictions).toEqual({
      1: {
        probability: 0,
        tipped_team: 'away'
      },
      2: {
        probability: 50,
        tipped_team: 'away'
      }
    });
  });

  test('GET / falls back to the most recently completed round when no future match exists', async () => {
    getQuery.mockResolvedValue([
      {
        match_id: 10,
        round_number: '1',
        match_date: '2026-03-01T12:00:00.000Z',
        hscore: 90,
        ascore: 80
      },
      {
        match_id: 11,
        round_number: '2',
        match_date: '2026-03-08T12:00:00.000Z',
        hscore: 84,
        ascore: 79
      }
    ]);
    matchService.getMatchesByRoundSelectionAndYear.mockResolvedValue([{ match_id: 11 }]);

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(matchService.getMatchesByRoundSelectionAndYear).toHaveBeenCalledWith('2', 2026);
    expect(response.body.locals.selectedRound).toBe('2');
    expect(response.body.locals.currentRound).toBeNull();
  });

  test('GET / falls back to the first round when no fixture dates can resolve a selection', async () => {
    getQuery.mockResolvedValue([
      {
        match_id: 20,
        round_number: '2',
        match_date: null,
        hscore: null,
        ascore: null
      }
    ]);
    matchService.getMatchesByRoundSelectionAndYear.mockResolvedValue([{ match_id: 99 }]);

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(matchService.getMatchesByRoundSelectionAndYear).toHaveBeenCalledWith('1', 2026);
    expect(response.body.locals.selectedRound).toBe('1');
    expect(response.body.locals.currentRound).toBe('1');
  });

  test('GET /round/:round returns processed matches for the selected round', async () => {
    matchService.getMatchesByRoundSelectionAndYear.mockResolvedValue([{ match_id: 33 }]);
    matchService.processMatchLockStatus.mockReturnValue([{ match_id: 33, isLocked: false }]);

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 } }
    });

    const response = await request(app).get('/round/Finals%20Week%202?year=2026');

    expect(response.status).toBe(200);
    expect(roundService.normalizeRoundForDisplay).toHaveBeenCalledWith('Finals Week 2', 2026);
    expect(response.body).toEqual([{ match_id: 33, isLocked: false }]);
  });

  test('POST /save rejects missing required fields', async () => {
    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .set('Accept', 'application/json')
      .send({ probability: 60 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Missing required fields');
  });

  test('POST /save returns 404 when the match does not exist', async () => {
    getOne.mockResolvedValue(null);

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .set('Accept', 'application/json')
      .send({ matchId: 44, probability: 60 });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Match not found');
  });

  test('POST /save rejects started matches for non-admin users', async () => {
    getOne.mockResolvedValue({ match_date: '2000-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .set('Accept', 'application/json')
      .send({ matchId: 44, probability: 60 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('This match has started and predictions are locked');
  });

  test('POST /save rejects invalid match date formats for non-admin users', async () => {
    getOne.mockResolvedValue({ match_date: 'not-a-date' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .set('Accept', 'application/json')
      .send({ matchId: 44, probability: 60 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid match date format');
  });

  test('POST /save lets admins bypass the started-match lock check', async () => {
    getOne.mockResolvedValue({ match_date: '2000-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/save')
      .send({ matchId: 44, probability: 65 });

    expect(response.status).toBe(200);
    expect(predictionService.savePrediction).toHaveBeenCalledWith(44, 5, 65, {
      tippedTeam: undefined
    });
  });

  test('POST /save forwards the selected tipped team for 50 percent predictions', async () => {
    getOne.mockResolvedValue({ match_date: '2099-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .send({ matchId: 44, probability: 50, tippedTeam: 'away' });

    expect(response.status).toBe(200);
    expect(predictionService.savePrediction).toHaveBeenCalledWith(44, 5, 50, {
      tippedTeam: 'away'
    });
  });

  test('POST /save deletes predictions when probability is blank', async () => {
    getOne.mockResolvedValue({ match_date: '2099-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .send({ matchId: 44, probability: '' });

    expect(response.status).toBe(200);
    expect(predictionService.deletePrediction).toHaveBeenCalledWith(44, 5);
    expect(response.body).toEqual({ success: true, action: 'deleted' });
  });

  test('POST /save deletes predictions when probability is null', async () => {
    getOne.mockResolvedValue({ match_date: '2099-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .send({ matchId: 44, probability: null });

    expect(response.status).toBe(200);
    expect(predictionService.deletePrediction).toHaveBeenCalledWith(44, 5);
    expect(response.body).toEqual({ success: true, action: 'deleted' });
  });

  test('POST /save defaults non-numeric probabilities to 50', async () => {
    getOne.mockResolvedValue({ match_date: '2099-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .send({ matchId: 44, probability: 'abc' });

    expect(response.status).toBe(200);
    expect(predictionService.savePrediction).toHaveBeenCalledWith(44, 5, 50, {
      tippedTeam: undefined
    });
    expect(response.body).toEqual({ success: true });
  });

  test('POST /save clamps probability before saving', async () => {
    getOne.mockResolvedValue({ match_date: '2099-03-01T12:00:00.000Z' });

    const app = createRouterTestApp(predictionsRouter, {
      sessionData: { user: { id: 5 }, isAdmin: false }
    });

    const response = await request(app)
      .post('/save')
      .send({ matchId: 44, probability: 140 });

    expect(response.status).toBe(200);
    expect(predictionService.savePrediction).toHaveBeenCalledWith(44, 5, 100, {
      tippedTeam: undefined
    });
    expect(response.body).toEqual({ success: true });
  });
});
