const request = require('supertest');
const session = require('express-session');

function buildExpressMock(listenSpy) {
  const actualExpress = jest.requireActual('express');

  const expressMock = () => {
    const app = actualExpress();
    app.listen = listenSpy;
    return app;
  };

  Object.assign(expressMock, actualExpress);
  expressMock.Router = actualExpress.Router;
  expressMock.json = actualExpress.json;
  expressMock.urlencoded = actualExpress.urlencoded;
  expressMock.static = actualExpress.static;
  expressMock.request = actualExpress.request;
  expressMock.response = actualExpress.response;
  expressMock.application = actualExpress.application;

  return expressMock;
}

function loadAppModule(options = {}) {
  let loadedModule;
  let mockedAdminRouter;

  const mocks = {
    db: {
      getQuery: jest.fn(),
      initializeDatabase: jest.fn()
    },
    logger: {
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      requestLogger: (req, res, next) => next()
    },
    roundService: {
      resolveYear: jest.fn(),
      getRoundsForYear: jest.fn(),
      combineRoundsForDisplay: jest.fn((rounds) => rounds),
      normalizeRoundForDisplay: jest.fn((round) => round)
    },
    adminScriptRunner: {
      recoverInterruptedRuns: jest.fn()
    },
    eventSyncService: {
      start: jest.fn()
    },
    featuredPredictions: {
      getDefaultFeaturedPredictor: jest.fn(),
      getPredictionYearsForPredictor: jest.fn(),
      getPredictionsForRound: jest.fn()
    },
    predictionService: {
      getPredictionsWithResultsForYear: jest.fn()
    },
    predictorService: {
      getPredictorById: jest.fn()
    },
    scoringService: {
      calculateBrierScore: jest.fn(() => 0.1),
      calculateBitsScore: jest.fn(() => 0.2),
      calculateTipPoints: jest.fn(() => 1)
    }
  };

  jest.isolateModules(() => {
    const express = options.expressMock || require('express');

    mockedAdminRouter = express.Router();
    mockedAdminRouter.getExcludedPredictors = jest.fn().mockResolvedValue(['2', '3']);

    if (options.expressMock) {
      jest.doMock('express', () => options.expressMock);
    }

    jest.doMock('../models/db', () => mocks.db);
    jest.doMock('../utils/logger', () => mocks.logger);
    jest.doMock('../services/round-service', () => mocks.roundService);
    jest.doMock('../services/admin-script-runner', () => mocks.adminScriptRunner);
    jest.doMock('../services/event-sync-service', () => mocks.eventSyncService);
    jest.doMock('../services/featured-predictions', () => mocks.featuredPredictions);
    jest.doMock('../services/prediction-service', () => mocks.predictionService);
    jest.doMock('../services/predictor-service', () => mocks.predictorService);
    jest.doMock('../services/scoring-service', () => mocks.scoringService);

    jest.doMock('../routes/auth', () => express.Router());
    jest.doMock('../routes/predictions', () => express.Router());
    jest.doMock('../routes/matches', () => express.Router());
    jest.doMock('../routes/admin', () => mockedAdminRouter);
    jest.doMock('../routes/elo', () => express.Router());
    jest.doMock('../routes/simulation', () => express.Router());

    loadedModule = require('../app');
  });

  return {
    ...loadedModule,
    mocks,
    mockedAdminRouter
  };
}

function createJsonRenderApp(createApp, options = {}) {
  const app = createApp(options);
  app.response.render = function render(view, locals) {
    return this.json({
      view,
      locals
    });
  };
  return app;
}

describe('app', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.SESSION_SECRET;
  });

  test('createApp requires a session secret', () => {
    const { createApp } = loadAppModule();
    process.env.SESSION_SECRET = '';

    expect(() => createApp({ sessionStore: new session.MemoryStore() })).toThrow(
      'SESSION_SECRET environment variable is required'
    );
  });

  test('createApp serves global excluded predictors through the admin router helper', async () => {
    const { createApp, mockedAdminRouter } = loadAppModule();
    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/api/excluded-predictors');

    expect(response.status).toBe(200);
    expect(mockedAdminRouter.getExcludedPredictors).toHaveBeenCalled();
    expect(response.body).toEqual({ excludedPredictors: ['2', '3'] });
  });

  test('serves the browser scoring service asset', async () => {
    const { createApp } = loadAppModule();
    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/js/scoring-service.js');

    expect(response.status).toBe(200);
    expect(response.text).toContain('function calculateBrierScore');
    expect(response.text).toContain('window.calculateTipPoints = calculateTipPoints');
  });

  test('home route renders featured predictions for the requested available year and next upcoming round', async () => {
    const { createApp, mocks } = loadAppModule();

    mocks.featuredPredictions.getDefaultFeaturedPredictor.mockResolvedValue({
      predictor_id: 6,
      display_name: "Dad's AI"
    });
    mocks.featuredPredictions.getPredictionYearsForPredictor.mockResolvedValue([
      { year: '2026' },
      { year: '2025' }
    ]);
    mocks.roundService.getRoundsForYear.mockResolvedValue([
      { round_number: '1' },
      { round_number: '2' }
    ]);
    mocks.db.getQuery.mockResolvedValue([
      {
        match_id: 1,
        round_number: '1',
        match_date: '2025-03-10T19:30:00.000Z',
        hscore: 88,
        ascore: 75,
        home_team: 'Cats',
        away_team: 'Swans'
      },
      {
        match_id: 2,
        round_number: '2',
        match_date: '2099-03-20T19:30:00.000Z',
        hscore: null,
        ascore: null,
        home_team: 'Lions',
        away_team: 'Dockers'
      }
    ]);
    mocks.featuredPredictions.getPredictionsForRound.mockResolvedValue({
      predictor: { predictor_id: 6, display_name: "Dad's AI" },
      matches: [{ match_id: 2 }],
      predictions: [{ match_id: 2, home_win_probability: 60 }]
    });
    mocks.predictionService.getPredictionsWithResultsForYear.mockResolvedValue([
      {
        home_win_probability: 60,
        hscore: 90,
        ascore: 80,
        tipped_team: 'home',
        predicted_margin: 15
      },
      {
        home_win_probability: 40,
        hscore: 70,
        ascore: 75,
        tipped_team: 'away',
        predicted_margin: null
      }
    ]);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/?year=2025');

    expect(response.status).toBe(200);
    expect(mocks.db.getQuery).toHaveBeenCalledWith(expect.any(String), [2025]);
    expect(mocks.featuredPredictions.getPredictionsForRound).toHaveBeenCalledWith(6, '2', 2025);
    expect(response.body.view).toBe('home');
    expect(response.body.locals.selectedYear).toBe(2025);
    expect(response.body.locals.selectedRound).toBe('2');
    expect(response.body.locals.currentRound).toBe('2');
    expect(response.body.locals.featuredPredictorStats).toEqual({
      tipPoints: 2,
      totalPredictions: 2,
      tipAccuracy: '100.0',
      brierScore: '0.1000',
      bitsScore: '0.40',
      marginMAE: '5.00',
      marginPredictionCount: 1
    });
  });

  test('home route falls back to round-service year when featured predictor has no prediction years', async () => {
    const { createApp, mocks } = loadAppModule();

    mocks.featuredPredictions.getDefaultFeaturedPredictor.mockResolvedValue({ predictor_id: 6 });
    mocks.featuredPredictions.getPredictionYearsForPredictor.mockResolvedValue([]);
    mocks.roundService.resolveYear.mockResolvedValue({ selectedYear: 2024 });
    mocks.roundService.getRoundsForYear.mockResolvedValue([{ round_number: 'OR' }]);
    mocks.db.getQuery.mockResolvedValue([]);
    mocks.featuredPredictions.getPredictionsForRound.mockResolvedValue({
      predictor: { predictor_id: 6 },
      matches: [],
      predictions: []
    });
    mocks.predictionService.getPredictionsWithResultsForYear.mockResolvedValue([]);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(mocks.roundService.resolveYear).toHaveBeenCalledWith(undefined);
    expect(response.body.locals.selectedYear).toBe(2024);
    expect(response.body.locals.selectedRound).toBe('OR');
    expect(response.body.locals.featuredPredictorStats).toBeNull();
  });

  test('home route falls back to the most recent completed round when there are no upcoming matches', async () => {
    const { createApp, mocks } = loadAppModule();

    mocks.featuredPredictions.getDefaultFeaturedPredictor.mockResolvedValue({ predictor_id: 6 });
    mocks.featuredPredictions.getPredictionYearsForPredictor.mockResolvedValue([{ year: '2026' }]);
    mocks.roundService.getRoundsForYear.mockResolvedValue([
      { round_number: '1' },
      { round_number: '2' },
      { round_number: '3' }
    ]);
    mocks.db.getQuery.mockResolvedValue([
      {
        match_id: 1,
        round_number: '1',
        match_date: '2026-03-10T19:30:00.000Z',
        hscore: 75,
        ascore: 60,
        home_team: 'Cats',
        away_team: 'Swans'
      },
      {
        match_id: 2,
        round_number: '3',
        match_date: '2026-03-28T19:30:00.000Z',
        hscore: 88,
        ascore: 81,
        home_team: 'Lions',
        away_team: 'Dockers'
      }
    ]);
    mocks.featuredPredictions.getPredictionsForRound.mockResolvedValue({
      predictor: { predictor_id: 6 },
      matches: [],
      predictions: []
    });
    mocks.predictionService.getPredictionsWithResultsForYear.mockResolvedValue([]);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/?year=2026');

    expect(mocks.roundService.normalizeRoundForDisplay).toHaveBeenCalledWith('3', 2026);
    expect(mocks.featuredPredictions.getPredictionsForRound).toHaveBeenCalledWith(6, '3', 2026);
    expect(response.body.locals.selectedRound).toBe('3');
  });

  test('home route ignores invalid dates and falls back to opening round when no suitable round can be inferred', async () => {
    const { createApp, mocks } = loadAppModule();

    mocks.featuredPredictions.getDefaultFeaturedPredictor.mockResolvedValue({ predictor_id: 6 });
    mocks.featuredPredictions.getPredictionYearsForPredictor.mockResolvedValue([{ year: '2026' }]);
    mocks.roundService.normalizeRoundForDisplay.mockImplementation((round) => (
      round === '1' ? null : round
    ));
    mocks.roundService.getRoundsForYear.mockResolvedValue([
      { round_number: '1' },
      { round_number: 'OR' }
    ]);
    mocks.db.getQuery.mockResolvedValue([
      {
        match_id: 1,
        round_number: '1',
        match_date: 'not-a-date',
        hscore: null,
        ascore: null,
        home_team: 'Cats',
        away_team: 'Swans'
      },
      {
        match_id: 2,
        round_number: '1',
        match_date: null,
        hscore: null,
        ascore: null,
        home_team: 'Lions',
        away_team: 'Dockers'
      }
    ]);
    mocks.featuredPredictions.getPredictionsForRound.mockResolvedValue({
      predictor: { predictor_id: 6 },
      matches: [],
      predictions: []
    });
    mocks.predictionService.getPredictionsWithResultsForYear.mockResolvedValue([]);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/?year=2026');

    expect(mocks.logger.logger.warn).toHaveBeenCalledWith(
      'Falling back to Opening Round as no suitable round found'
    );
    expect(mocks.featuredPredictions.getPredictionsForRound).toHaveBeenCalledWith(6, 'OR', 2026);
    expect(response.body.locals.selectedRound).toBe('OR');
  });

  test('predictor stats endpoint rejects missing predictor id', async () => {
    const { createApp, mocks } = loadAppModule();
    mocks.roundService.resolveYear.mockResolvedValue({ selectedYear: 2026 });

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/api/predictor-stats?year=2026');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: false,
      message: 'Predictor ID is required'
    });
  });

  test('predictor stats endpoint rejects unknown predictors', async () => {
    const { createApp, mocks } = loadAppModule();
    mocks.roundService.resolveYear.mockResolvedValue({ selectedYear: 2026 });
    mocks.predictorService.getPredictorById.mockResolvedValue(null);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/api/predictor-stats?year=2026&predictorId=99');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: false,
      message: 'Predictor not found'
    });
  });

  test('predictor stats endpoint rejects predictors with no results', async () => {
    const { createApp, mocks } = loadAppModule();
    mocks.roundService.resolveYear.mockResolvedValue({ selectedYear: 2026 });
    mocks.predictorService.getPredictorById.mockResolvedValue({ predictor_id: 9 });
    mocks.predictionService.getPredictionsWithResultsForYear.mockResolvedValue([]);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/api/predictor-stats?year=2026&predictorId=9');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: false,
      message: 'No prediction data available for this year'
    });
  });

  test('predictor stats endpoint returns computed metrics', async () => {
    const { createApp, mocks } = loadAppModule();
    mocks.roundService.resolveYear.mockResolvedValue({ selectedYear: 2026 });
    mocks.predictorService.getPredictorById.mockResolvedValue({ predictor_id: 9 });
    mocks.predictionService.getPredictionsWithResultsForYear.mockResolvedValue([
      {
        home_win_probability: 60,
        hscore: 100,
        ascore: 85,
        tipped_team: 'home',
        predicted_margin: 10
      },
      {
        home_win_probability: 45,
        hscore: 70,
        ascore: 80,
        tipped_team: 'away',
        predicted_margin: null
      }
    ]);

    const app = createJsonRenderApp(createApp, {
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/api/predictor-stats?year=2026&predictorId=9');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      stats: {
        tipPoints: 2,
        totalPredictions: 2,
        tipAccuracy: '100.0',
        brierScore: '0.1000',
        bitsScore: '0.40',
        marginMAE: '5.00',
        marginPredictionCount: 1
      }
    });
  });

  test('startServer initializes dependencies and begins listening', async () => {
    const listenSpy = jest.fn((port, host, callback) => {
      if (typeof callback === 'function') {
        callback();
      }
      return { close: jest.fn() };
    });
    const { startServer, mocks } = loadAppModule({
      expressMock: buildExpressMock(listenSpy)
    });

    mocks.db.initializeDatabase.mockResolvedValue();
    mocks.adminScriptRunner.recoverInterruptedRuns.mockResolvedValue();
    mocks.eventSyncService.start.mockResolvedValue();

    await startServer({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    expect(mocks.db.initializeDatabase).toHaveBeenCalled();
    expect(mocks.adminScriptRunner.recoverInterruptedRuns).toHaveBeenCalled();
    expect(mocks.eventSyncService.start).toHaveBeenCalled();
    expect(listenSpy).toHaveBeenCalledWith(3001, '0.0.0.0', expect.any(Function));
  });

  test('startServer exits the process when initialization fails', async () => {
    const listenSpy = jest.fn();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const { startServer, mocks } = loadAppModule({
      expressMock: buildExpressMock(listenSpy)
    });

    mocks.db.initializeDatabase.mockRejectedValue(new Error('db unavailable'));

    await startServer({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    expect(mocks.logger.logger.error).toHaveBeenCalledWith(
      'Failed to initialize database during startup',
      { error: 'db unavailable' }
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
