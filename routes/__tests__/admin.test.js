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

jest.mock('../../scripts/automation/api-refresh', () => ({
  refreshAPIData: jest.fn()
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
const predictorService = require('../../services/predictor-service');
const predictionService = require('../../services/prediction-service');
const passwordService = require('../../services/password-service');
const adminScriptRunner = require('../../services/admin-script-runner');
const resultUpdateService = require('../../services/result-update-service');
const { refreshAPIData } = require('../../scripts/automation/api-refresh');
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

  test('POST /api/script-runs starts a run for the current admin', async () => {
    adminScriptRunner.startScriptRun.mockResolvedValue({ run_id: 12, status: 'running' });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 7 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api/script-runs')
      .send({ scriptKey: 'sync-games', params: { year: 2026 } });

    expect(response.status).toBe(202);
    expect(adminScriptRunner.startScriptRun).toHaveBeenCalledWith('sync-games', { year: 2026 }, 7);
    expect(response.body).toEqual({
      success: true,
      run: { run_id: 12, status: 'running' }
    });
  });

  test('GET /api/script-runs lists runs and active run id', async () => {
    adminScriptRunner.listRuns.mockResolvedValue([{ run_id: 2, status: 'running' }]);
    adminScriptRunner.getExistingActiveRun.mockResolvedValue({ run_id: 2 });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/script-runs?limit=5');

    expect(response.status).toBe(200);
    expect(adminScriptRunner.listRuns).toHaveBeenCalledWith(5);
    expect(response.body).toEqual({
      success: true,
      runs: [{ run_id: 2, status: 'running' }],
      activeRunId: 2
    });
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

  test('GET /api/script-runs/:runId/logs returns run logs and last sequence', async () => {
    adminScriptRunner.getRunById.mockResolvedValue({ run_id: 4 });
    adminScriptRunner.getRunLogs.mockResolvedValue([
      { seq: 8, message: 'line 1' },
      { seq: 9, message: 'line 2' }
    ]);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/script-runs/4/logs?afterSeq=7&limit=2');

    expect(response.status).toBe(200);
    expect(adminScriptRunner.getRunLogs).toHaveBeenCalledWith(4, 7, 2);
    expect(response.body).toEqual({
      success: true,
      runId: 4,
      logs: [
        { seq: 8, message: 'line 1' },
        { seq: 9, message: 'line 2' }
      ],
      lastSeq: 9
    });
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

  test('POST /predictors redirects when the user already exists', async () => {
    predictorService.getPredictorByName.mockResolvedValue({ predictor_id: 3 });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictors')
      .type('form')
      .send({ username: 'dad', password: 'secret123', displayName: 'Dad' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=User%20already%20exists');
  });

  test('POST /predictors creates a new predictor and redirects to success', async () => {
    predictorService.getPredictorByName.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictors')
      .type('form')
      .send({
        username: 'dad',
        password: 'secret123',
        displayName: 'Dad',
        isAdmin: 'on',
        yearJoined: '2026'
      });

    expect(response.status).toBe(302);
    expect(predictorService.createPredictor).toHaveBeenCalledWith('dad', 'secret123', 'Dad', true, '2026');
    expect(response.headers.location).toBe('/admin?success=Predictor%20added%20successfully');
  });

  test('POST /predictions/:userId/save deletes a prediction for empty probability', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictions/5/save')
      .set('Accept', 'application/json')
      .send({ matchId: 11, probability: '' });

    expect(response.status).toBe(200);
    expect(predictionService.deletePrediction).toHaveBeenCalledWith(11, '5');
    expect(response.body).toEqual({ success: true, action: 'deleted' });
  });

  test('POST /predictions/:userId/save clamps probability and saves with admin override', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictions/5/save')
      .set('Accept', 'application/json')
      .send({ matchId: 11, probability: 150 });

    expect(response.status).toBe(200);
    expect(predictionService.savePrediction).toHaveBeenCalledWith(11, '5', 100, { adminOverride: true });
    expect(response.body).toEqual({ success: true });
  });

  test('POST /reset-password/:userId redirects when password validation fails', async () => {
    passwordService.validatePassword.mockReturnValue({
      isValid: false,
      errors: ['Password must be longer']
    });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/reset-password/5')
      .type('form')
      .send({ newPassword: 'short' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=Password%20must%20be%20longer');
  });

  test('POST /delete-user/:userId blocks deleting the current admin account', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 5 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/delete-user/5')
      .type('form')
      .send({});

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=You%20cannot%20delete%20your%20own%20account');
  });

  test('POST /api-refresh returns refresh results', async () => {
    refreshAPIData.mockResolvedValue({
      success: true,
      insertCount: 1,
      updateCount: 2,
      scoresUpdated: 3
    });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/api-refresh')
      .send({ year: 2026, forceScoreUpdate: true });

    expect(response.status).toBe(200);
    expect(refreshAPIData).toHaveBeenCalledWith(2026, { forceScoreUpdate: true });
    expect(response.body).toEqual({
      success: true,
      insertCount: 1,
      updateCount: 2,
      scoresUpdated: 3
    });
  });

  test('POST /set-featured-predictors requires an active predictor', async () => {
    getOne.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/set-featured-predictors')
      .type('form')
      .send({ predictorId: '9' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=Selected%20predictor%20must%20be%20active');
  });

  test('POST /set-featured-predictors updates the featured predictor', async () => {
    getOne.mockResolvedValue({ predictor_id: 9 });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/set-featured-predictors')
      .type('form')
      .send({ predictorId: '9' });

    expect(response.status).toBe(302);
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      'UPDATE predictors SET homepage_available = 0, is_default_featured = 0'
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE predictors SET homepage_available = 1, is_default_featured = 1 WHERE predictor_id = ?',
      ['9']
    );
    expect(response.headers.location).toBe('/admin?success=Featured%20predictor%20updated%20successfully');
  });

  test('GET /api/predictors returns predictors with active flags', async () => {
    getQuery.mockResolvedValue([
      { predictor_id: 1, name: 'dad', display_name: 'Dad', active: 1, year_joined: 2020 }
    ]);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/api/predictors');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      predictors: [
        { predictor_id: 1, name: 'dad', display_name: 'Dad', active: 1, year_joined: 2020 }
      ]
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
