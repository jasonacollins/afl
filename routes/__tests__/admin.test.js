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
  },
  isAdmin: (req, res, next) => {
    if (req.session.user && req.session.isAdmin) {
      next();
      return;
    }

    res.status(403).render('error', { error: 'Admin access required' });
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
  combineRoundsForDisplay: jest.fn((rounds) => rounds)
}));

jest.mock('../../services/prediction-service', () => ({
  getPredictionsForUser: jest.fn(),
  savePrediction: jest.fn(),
  deletePrediction: jest.fn(),
  getAllPredictionsWithDetails: jest.fn()
}));

jest.mock('../../services/predictor-service', () => ({
  getPredictorById: jest.fn(),
  getPredictorByName: jest.fn(),
  getAllPredictors: jest.fn(),
  createPredictor: jest.fn(),
  resetPassword: jest.fn(),
  deletePredictor: jest.fn()
}));

jest.mock('../../services/password-service', () => ({
  validatePassword: jest.fn(() => ({ isValid: true, errors: [] }))
}));

jest.mock('../../services/admin-script-runner', () => ({
  getScriptMetadata: jest.fn(),
  startScriptRun: jest.fn(),
  listRuns: jest.fn(),
  getExistingActiveRun: jest.fn(),
  getRunById: jest.fn(),
  getRunLogs: jest.fn()
}));

jest.mock('../../services/result-update-service', () => ({
  getEventSyncStatus: jest.fn()
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
const { getQuery, runQuery } = require('../../models/db');
const predictorService = require('../../services/predictor-service');
const adminScriptRunner = require('../../services/admin-script-runner');
const resultUpdateService = require('../../services/result-update-service');
const adminRouter = require('../admin');
const { createRouterTestApp } = require('./test-app');

describe('admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminScriptRunner.getExistingActiveRun.mockResolvedValue(null);
    predictorService.getPredictorById.mockResolvedValue({ predictor_id: 5, active: 1 });
  });

  test('redirects anonymous users to login', async () => {
    const app = createRouterTestApp(adminRouter);

    const response = await request(app).get('/api/script-metadata');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('blocks authenticated non-admin users', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 3 }, isAdmin: false }
    });

    const response = await request(app).get('/api/script-metadata');

    expect(response.status).toBe(403);
    expect(response.body.view).toBe('error');
    expect(response.body.locals.error).toBe('Admin access required');
  });

  test('GET /api/script-metadata returns script metadata', async () => {
    adminScriptRunner.getScriptMetadata.mockResolvedValue({
      scripts: [{ key: 'sync-games' }]
    });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/script-metadata');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.scripts).toEqual([{ key: 'sync-games' }]);
  });

  test('POST /api/script-runs validates missing scriptKey', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/script-runs')
      .send({ params: {} });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('scriptKey is required');
  });

  test('POST /api/script-runs returns conflict for an existing active run', async () => {
    const activeRunError = new Error('Another run is active');
    activeRunError.code = 'ACTIVE_RUN_EXISTS';
    adminScriptRunner.startScriptRun.mockRejectedValue(activeRunError);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/script-runs')
      .send({ scriptKey: 'sync-games', params: {} });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Another run is active');
  });

  test('GET /api/script-runs/:runId validates the run id', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/script-runs/not-a-number');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid runId');
  });

  test('GET /api/script-runs/:runId returns 404 for unknown runs', async () => {
    adminScriptRunner.getRunById.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/script-runs/99');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Run not found');
  });

  test('POST /api/excluded-predictors rejects non-array payloads', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/excluded-predictors')
      .send({ predictorIds: '5' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('predictorIds must be an array');
  });

  test('POST /api/excluded-predictors updates exclusions', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/excluded-predictors')
      .send({ predictorIds: [2, 3] });

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenNthCalledWith(1, 'UPDATE predictors SET stats_excluded = 0');
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE predictors SET stats_excluded = 1 WHERE predictor_id IN (?,?)',
      [2, 3]
    );
    expect(response.body).toEqual({ success: true, excludedPredictors: [2, 3] });
  });

  test('GET /api/event-sync-status returns current status', async () => {
    resultUpdateService.getEventSyncStatus.mockResolvedValue({ connected: true });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/event-sync-status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      status: { connected: true }
    });
  });

  test('POST /api/predictors/:predictorId/toggle-active validates active input', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/predictors/7/toggle-active')
      .set('Accept', 'application/json')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Active status is required');
  });

  test('POST /api/predictors/:predictorId/toggle-active updates predictor state', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/predictors/7/toggle-active')
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      'UPDATE predictors SET active = ? WHERE predictor_id = ?',
      [0, '7']
    );
    expect(response.body).toEqual({ success: true });
  });

  test('router.getExcludedPredictors returns string ids', async () => {
    getQuery.mockResolvedValue([{ predictor_id: 8 }, { predictor_id: 9 }]);

    const result = await adminRouter.getExcludedPredictors();

    expect(result).toEqual(['8', '9']);
  });
});
