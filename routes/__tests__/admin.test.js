jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  dbPath: '/tmp/afl-admin-route-test.db'
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

jest.mock('../../services/featured-predictions', () => ({
  getDefaultFeaturedPredictorId: jest.fn()
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
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const dbModule = require('../../models/db');
const { getQuery, getOne, runQuery } = dbModule;
const predictorService = require('../../services/predictor-service');
const predictionService = require('../../services/prediction-service');
const passwordService = require('../../services/password-service');
const adminScriptRunner = require('../../services/admin-script-runner');
const resultUpdateService = require('../../services/result-update-service');
const featuredPredictionsService = require('../../services/featured-predictions');
const { refreshAPIData } = require('../../scripts/automation/api-refresh');
const adminRouter = require('../admin');
const { createRouterTestApp } = require('./test-app');

async function listDirSafe(directoryPath) {
  try {
    return await fsp.readdir(directoryPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

describe('admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminScriptRunner.getExistingActiveRun.mockResolvedValue(null);
    predictorService.getPredictorById.mockResolvedValue({ predictor_id: 5, active: 1 });
    featuredPredictionsService.getDefaultFeaturedPredictorId.mockResolvedValue(6);
    passwordService.validatePassword.mockReturnValue({
      isValid: true,
      errors: []
    });
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

  test('GET / renders the admin dashboard with grouped rounds and featured predictor', async () => {
    predictorService.getAllPredictors.mockResolvedValue([{ predictor_id: 5, name: 'Dad' }]);
    require('../../services/round-service').resolveYear.mockResolvedValue({
      selectedYear: 2026,
      years: [2026, 2025]
    });
    require('../../services/round-service').getRoundsForYear.mockResolvedValue([
      { round_number: '1' }
    ]);
    require('../../services/round-service').combineRoundsForDisplay.mockReturnValue([
      { round_number: 'Round 1' }
    ]);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('admin');
    expect(response.body.locals).toEqual(expect.objectContaining({
      predictors: [{ predictor_id: 5, name: 'Dad' }],
      rounds: [{ round_number: 'Round 1' }],
      years: [2026, 2025],
      selectedYear: 2026,
      featuredPredictorId: 6,
      isAdmin: true
    }));
  });

  test('GET /scripts renders the admin scripts page', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/scripts');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      view: 'admin-scripts',
      locals: {
        isAdmin: true,
        success: null,
        error: null
      }
    });
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

  test('POST /predictors redirects when required fields are missing', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictors')
      .type('form')
      .send({ username: '', password: '' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=Username%20and%20password%20are%20required');
  });

  test('POST /predictors redirects when password validation fails', async () => {
    passwordService.validatePassword.mockReturnValue({
      isValid: false,
      errors: ['Too weak']
    });

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictors')
      .type('form')
      .send({ username: 'dad', password: 'badpass' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=Too%20weak');
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

  test('POST /predictors redirects operational validation errors from the service', async () => {
    predictorService.getPredictorByName.mockResolvedValue(null);
    const validationError = new Error('Username is invalid');
    validationError.isOperational = true;
    validationError.errorCode = 'VALIDATION_ERROR';
    predictorService.createPredictor.mockRejectedValue(validationError);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictors')
      .type('form')
      .send({ username: 'dad', password: 'secret123' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=Username%20is%20invalid');
  });

  test('GET /predictions/:userId redirects when the user does not exist', async () => {
    predictorService.getPredictorById.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/predictions/5');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=User%20not%20found');
  });

  test('GET /predictions/:userId returns predictions as a match map', async () => {
    predictionService.getPredictionsForUser.mockResolvedValue([
      { match_id: 11, home_win_probability: 65 },
      { match_id: 12, home_win_probability: 40 }
    ]);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/predictions/5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      predictions: {
        11: 65,
        12: 40
      }
    });
  });

  test('POST /predictions/:userId/save validates missing required fields', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictions/5/save')
      .set('Accept', 'application/json')
      .send({ probability: 70 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Missing required fields');
  });

  test('POST /predictions/:userId/save returns not found when the target user does not exist', async () => {
    predictorService.getPredictorById.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/predictions/5/save')
      .set('Accept', 'application/json')
      .send({ matchId: 11, probability: 70 });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('User not found');
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

  test('GET /stats renders predictor accuracy stats', async () => {
    getQuery
      .mockResolvedValueOnce([
        { predictor_id: 1, name: 'Dad' },
        { predictor_id: 2, name: 'Model' }
      ])
      .mockResolvedValueOnce([
        { predictor_id: 1, count: 3 },
        { predictor_id: 2, count: 1 }
      ])
      .mockResolvedValueOnce([
        { match_id: 10, hscore: 80, ascore: 70, home_team: 'Cats', away_team: 'Swans' },
        { match_id: 11, hscore: 60, ascore: 75, home_team: 'Lions', away_team: 'Dockers' }
      ])
      .mockResolvedValueOnce([
        { match_id: 10, predictor_id: 1, home_win_probability: 55 },
        { match_id: 11, predictor_id: 1, home_win_probability: 45 },
        { match_id: 10, predictor_id: 2, home_win_probability: 20 }
      ]);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/stats');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('admin-stats');
    expect(response.body.locals.predictorStats).toEqual([
      {
        id: 1,
        name: 'Dad',
        totalPredictions: 3,
        correct: 2,
        incorrect: 0,
        accuracy: '100.0'
      },
      {
        id: 2,
        name: 'Model',
        totalPredictions: 1,
        correct: 0,
        incorrect: 1,
        accuracy: '0.0'
      }
    ]);
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

  test('POST /reset-password/:userId redirects when the user does not exist', async () => {
    predictorService.getPredictorById.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/reset-password/5')
      .type('form')
      .send({ newPassword: 'secret123' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=User%20not%20found');
  });

  test('POST /reset-password/:userId resets the password and redirects to success', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/reset-password/5')
      .type('form')
      .send({ newPassword: 'secret123' });

    expect(response.status).toBe(302);
    expect(predictorService.resetPassword).toHaveBeenCalledWith('5', 'secret123');
    expect(response.headers.location).toBe('/admin?success=Password%20reset%20successfully');
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

  test('POST /delete-user/:userId redirects when the user does not exist', async () => {
    predictorService.getPredictorById.mockResolvedValue(null);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/delete-user/8')
      .type('form')
      .send({});

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=User%20not%20found');
  });

  test('POST /delete-user/:userId deletes the target user and redirects to success', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/delete-user/8')
      .type('form')
      .send({});

    expect(response.status).toBe(302);
    expect(predictorService.deletePredictor).toHaveBeenCalledWith('8');
    expect(response.headers.location).toBe('/admin?success=User%20deleted%20successfully');
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

  test('GET /export/predictions returns CSV output with scoring columns', async () => {
    predictionService.getAllPredictionsWithDetails.mockResolvedValue([
      {
        predictor_name: "Dad's AI",
        round_number: '1',
        match_number: 14,
        match_date: '2026-03-20T09:30:00.000Z',
        home_team: 'Cats',
        away_team: 'Swans',
        home_win_probability: 50,
        tipped_team: 'away',
        hscore: 80,
        ascore: 85
      }
    ]);

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app).get('/export/predictions');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain(
      'Predictor,Round,Match Number,Match Date,Home Team,Away Team,Home Win %,Away Win %,Tipped Team,Home Score,Away Score,Correct,Tip Points,Brier Score,Bits Score'
    );
    expect(response.text).toContain('"Dad\'s AI","1",14,');
    expect(response.text).toContain('"Swans",80,85,"Yes",1.0,0.2000,0.4000');
  });

  test('GET /export/database copies the database, downloads it, and removes the temporary copy', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'afl-admin-export-'));
    const currentDbPath = path.join(tempDir, 'current.db');
    await fsp.writeFile(currentDbPath, 'current-db-content', 'utf8');
    dbModule.dbPath = currentDbPath;
    const unlinkSpy = jest.spyOn(fs, 'unlink');

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });
    app.response.download = function download(filePath, filename, callback) {
      this.json({ downloadedPath: filePath, filename });
      if (typeof callback === 'function') {
        callback(null);
      }
    };

    try {
      const response = await request(app).get('/export/database');

      expect(response.status).toBe(200);
      expect(response.body.filename).toMatch(/^afl_predictions_.*\.db$/);
      expect(response.body.downloadedPath).toContain('/data/afl_predictions_');
      expect(unlinkSpy).toHaveBeenCalledWith(response.body.downloadedPath, expect.any(Function));
    } finally {
      unlinkSpy.mockRestore();
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('POST /upload-database backs up the current database, replaces it, and exits for restart', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'afl-admin-upload-'));
    const currentDbPath = path.join(tempDir, 'current.db');
    const uploadDbPath = path.join(tempDir, 'uploaded.db');
    const backupsDir = path.join(process.cwd(), 'data', 'database', 'backups');
    const backupFilesBefore = await listDirSafe(backupsDir);
    const tempUploadsDir = path.join(process.cwd(), 'data', 'temp');
    const tempUploadsBefore = await listDirSafe(tempUploadsDir);
    const scheduledCallbacks = [];
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      scheduledCallbacks.push(callback);
      return 1;
    });

    await fsp.writeFile(currentDbPath, 'old database contents', 'utf8');
    await fsp.writeFile(uploadDbPath, 'new database contents', 'utf8');
    dbModule.dbPath = currentDbPath;

    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    try {
      const response = await request(app)
        .post('/upload-database')
        .attach('databaseFile', uploadDbPath);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Database uploaded successfully. The application will restart shortly.'
      });
      expect(scheduledCallbacks).toHaveLength(1);

      scheduledCallbacks[0]();

      expect(await fsp.readFile(currentDbPath, 'utf8')).toBe('new database contents');
      expect(exitSpy).toHaveBeenCalledWith(0);

      const backupFilesAfter = await listDirSafe(backupsDir);
      const newBackupFiles = backupFilesAfter.filter((fileName) => !backupFilesBefore.includes(fileName));
      expect(newBackupFiles.length).toBeGreaterThan(0);

      const backupContents = await fsp.readFile(path.join(backupsDir, newBackupFiles[0]), 'utf8');
      expect(backupContents).toBe('old database contents');

      const tempUploadsAfter = await listDirSafe(tempUploadsDir);
      const newTempUploads = tempUploadsAfter.filter((fileName) => !tempUploadsBefore.includes(fileName));
      expect(newTempUploads).toEqual([]);

      await Promise.all(newBackupFiles.map((fileName) =>
        fsp.rm(path.join(backupsDir, fileName), { force: true })
      ));
    } finally {
      exitSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
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

  test('POST /set-featured-predictors requires a selected predictor', async () => {
    const app = createRouterTestApp(adminRouter, {
      sessionData: { user: { id: 1 }, isAdmin: true }
    });

    const response = await request(app)
      .post('/set-featured-predictors')
      .type('form')
      .send({});

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin?error=Please%20select%20a%20featured%20predictor');
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
