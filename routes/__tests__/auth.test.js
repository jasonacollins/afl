jest.mock('bcrypt', () => ({
  compare: jest.fn()
}));

jest.mock('../../services/predictor-service', () => ({
  getPredictorByName: jest.fn()
}));

jest.mock('../../services/round-service', () => ({
  resolveYear: jest.fn()
}));

jest.mock('../../services/featured-predictions', () => ({
  getDefaultFeaturedPredictor: jest.fn(),
  getPredictionsForRound: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const predictorService = require('../../services/predictor-service');
const roundService = require('../../services/round-service');
const featuredPredictionsService = require('../../services/featured-predictions');
const authRouter = require('../auth');
const { createRouterTestApp } = require('./test-app');

function createMiddlewareApp(middleware, sessionData) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      ...(sessionData || {}),
      destroy(callback) {
        if (callback) {
          callback(null);
        }
      }
    };
    next();
  });

  app.response.render = function render(view, locals) {
    return this.json({ view, locals });
  };

  app.get('/protected', middleware, (req, res) => {
    res.json({ success: true });
  });

  return app;
}

describe('auth routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    roundService.resolveYear.mockResolvedValue({ selectedYear: 2026 });
  });

  test('GET /login renders the login page for anonymous users', async () => {
    const app = createRouterTestApp(authRouter);

    const response = await request(app).get('/login');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('index');
    expect(response.body.locals).toEqual({ error: null });
  });

  test('GET /login redirects logged-in users to predictions', async () => {
    const app = createRouterTestApp(authRouter, {
      sessionData: { user: { id: 7 } }
    });

    const response = await request(app).get('/login');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/predictions');
  });

  test('POST /login rejects missing credentials', async () => {
    const app = createRouterTestApp(authRouter);

    const response = await request(app)
      .post('/login')
      .type('form')
      .send({ username: '', password: '' });

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('index');
    expect(response.body.locals.error).toBe('Username and password are required');
  });

  test('POST /login redirects admin users after successful login', async () => {
    predictorService.getPredictorByName.mockResolvedValue({
      predictor_id: 4,
      name: 'admin',
      display_name: 'Admin User',
      password: 'hashed',
      is_admin: 1
    });
    bcrypt.compare.mockResolvedValue(true);

    const app = createRouterTestApp(authRouter);
    const response = await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'secret' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin');
    expect(bcrypt.compare).toHaveBeenCalledWith('secret', 'hashed');
  });

  test('GET /logout destroys the session and redirects to login', async () => {
    const app = createRouterTestApp(authRouter, {
      sessionData: { user: { id: 12 } }
    });

    const response = await request(app).get('/logout');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('GET /featured-predictions/:round falls back to the default featured predictor', async () => {
    featuredPredictionsService.getDefaultFeaturedPredictor.mockResolvedValue({ predictor_id: 9 });
    featuredPredictionsService.getPredictionsForRound.mockResolvedValue({
      predictor: { predictor_id: 9, name: 'Default Predictor' },
      matches: [{ match_id: 11 }],
      predictions: { 11: { probability: 60 } }
    });

    const app = createRouterTestApp(authRouter);
    const response = await request(app).get('/featured-predictions/Finals%20Week%202?year=2026');

    expect(response.status).toBe(200);
    expect(featuredPredictionsService.getPredictionsForRound).toHaveBeenCalledWith(9, 'Finals Week 2', 2026);
    expect(response.body.predictor.predictor_id).toBe(9);
    expect(response.body.matches).toHaveLength(1);
  });
});

describe('auth middleware', () => {
  test('isAuthenticated redirects anonymous users', async () => {
    const app = createMiddlewareApp(authRouter.isAuthenticated);

    const response = await request(app).get('/protected');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  test('isAdmin renders a 403 error for non-admin users', async () => {
    const app = createMiddlewareApp(authRouter.isAdmin, {
      user: { id: 3 },
      isAdmin: false
    });

    const response = await request(app).get('/protected');

    expect(response.status).toBe(403);
    expect(response.body.view).toBe('error');
    expect(response.body.locals.error).toBe('Admin access required');
  });
});
