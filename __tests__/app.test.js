const request = require('supertest');
const session = require('express-session');

function loadAppModule() {
  let loadedModule;
  let mockedAdminRouter;

  jest.isolateModules(() => {
    const express = require('express');

    mockedAdminRouter = express.Router();
    mockedAdminRouter.getExcludedPredictors = jest.fn().mockResolvedValue(['2', '3']);

    jest.doMock('../models/db', () => ({
      getQuery: jest.fn(),
      initializeDatabase: jest.fn()
    }));

    jest.doMock('../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      requestLogger: (req, res, next) => next()
    }));

    jest.doMock('../services/round-service', () => ({
      resolveYear: jest.fn(),
      getRoundsForYear: jest.fn(),
      combineRoundsForDisplay: jest.fn(),
      normalizeRoundForDisplay: jest.fn()
    }));

    jest.doMock('../services/admin-script-runner', () => ({
      recoverInterruptedRuns: jest.fn()
    }));

    jest.doMock('../services/event-sync-service', () => ({
      start: jest.fn()
    }));

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
    mockedAdminRouter
  };
}

describe('app', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.SESSION_SECRET;
  });

  test('createApp requires a session secret', () => {
    const { createApp } = loadAppModule();
    delete process.env.SESSION_SECRET;

    expect(() => createApp({ sessionStore: new session.MemoryStore() })).toThrow(
      'SESSION_SECRET environment variable is required'
    );
  });

  test('createApp serves global excluded predictors through the admin router helper', async () => {
    const { createApp, mockedAdminRouter } = loadAppModule();
    const app = createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/api/excluded-predictors');

    expect(response.status).toBe(200);
    expect(mockedAdminRouter.getExcludedPredictors).toHaveBeenCalled();
    expect(response.body).toEqual({ excludedPredictors: ['2', '3'] });
  });
});
