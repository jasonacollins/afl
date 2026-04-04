const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
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

function loadRealAppModule(dbPath, mocks = {}) {
  let loaded;

  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    if (mocks.expressMock) {
      jest.doMock('express', () => mocks.expressMock);
    }

    jest.doMock('../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      requestLogger: (req, res, next) => next()
    }));

    if (mocks.predictorService) {
      jest.doMock('../services/predictor-service', () => mocks.predictorService);
    } else {
      jest.unmock('../services/predictor-service');
    }

    if (mocks.adminScriptRunner) {
      jest.doMock('../services/admin-script-runner', () => mocks.adminScriptRunner);
    } else {
      jest.unmock('../services/admin-script-runner');
    }

    if (mocks.eventSyncService) {
      jest.doMock('../services/event-sync-service', () => mocks.eventSyncService);
    } else {
      jest.unmock('../services/event-sync-service');
    }

    if (mocks.roundService) {
      jest.doMock('../services/round-service', () => mocks.roundService);
    } else {
      jest.unmock('../services/round-service');
    }

    if (mocks.featuredPredictions) {
      jest.doMock('../services/featured-predictions', () => mocks.featuredPredictions);
    } else {
      jest.unmock('../services/featured-predictions');
    }

    if (mocks.predictionService) {
      jest.doMock('../services/prediction-service', () => mocks.predictionService);
    } else {
      jest.unmock('../services/prediction-service');
    }

    loaded = {
      appModule: require('../app'),
      dbModule: require('../models/db')
    };
  });

  return loaded;
}

function loadRenderedAppModule(mocks = {}) {
  let appModule;

  jest.isolateModules(() => {
    jest.doMock('../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      requestLogger: (req, res, next) => next()
    }));

    if (mocks.db) {
      jest.doMock('../models/db', () => mocks.db);
    } else {
      jest.unmock('../models/db');
    }

    if (mocks.roundService) {
      jest.doMock('../services/round-service', () => mocks.roundService);
    } else {
      jest.unmock('../services/round-service');
    }

    if (mocks.featuredPredictions) {
      jest.doMock('../services/featured-predictions', () => mocks.featuredPredictions);
    } else {
      jest.unmock('../services/featured-predictions');
    }

    if (mocks.predictionService) {
      jest.doMock('../services/prediction-service', () => mocks.predictionService);
    } else {
      jest.unmock('../services/prediction-service');
    }

    if (mocks.predictorService) {
      jest.doMock('../services/predictor-service', () => mocks.predictorService);
    } else {
      jest.unmock('../services/predictor-service');
    }

    if (mocks.adminScriptRunner) {
      jest.doMock('../services/admin-script-runner', () => mocks.adminScriptRunner);
    } else {
      jest.unmock('../services/admin-script-runner');
    }

    appModule = require('../app');
  });

  return appModule;
}

async function unloadDbModule(dbModule) {
  if (dbModule && dbModule.db) {
    await new Promise((resolve, reject) => {
      dbModule.db.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  jest.resetModules();
  delete process.env.DB_PATH;
}

function extractCsrfToken(html) {
  const formTokenMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (formTokenMatch) {
    return formTokenMatch[1];
  }

  const metaTokenMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  return metaTokenMatch ? metaTokenMatch[1] : null;
}

function hasInlineScriptTag(html) {
  return /<script(?![^>]*\bsrc=)[^>]*>/i.test(html);
}

async function seedAuthenticatedRouteData(dbModule) {
  const passwordHash = bcrypt.hashSync('member-secret', 4);

  await dbModule.initializeDatabase();
  await dbModule.runQuery(
    `INSERT INTO teams (team_id, name, abbrev, state)
     VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
    [
      1, 'Cats', 'CAT', 'VIC',
      2, 'Swans', 'SWA', 'NSW',
      3, 'Lions', 'LIO', 'QLD'
    ]
  );
  await dbModule.runQuery(
    `INSERT INTO predictors (
      predictor_id, name, password, is_admin, year_joined, display_name, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [7, 'member', passwordHash, 0, 2022, 'Member', 1]
  );
  await dbModule.runQuery(
    `INSERT INTO matches (
      match_id, match_number, round_number, match_date, venue,
      home_team_id, away_team_id, hscore, hgoals, hbehinds,
      ascore, agoals, abehinds, year, complete, venue_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1001, 38501, '1', '2001-03-15T09:30:00Z', 'MCG',
      1, 2, 91, 13, 13,
      84, 12, 12, 2026, 100, null,
      1002, 38502, '2', '2099-04-20T09:30:00Z', 'SCG',
      2, 3, null, null, null,
      null, null, null, 2026, 0, null
    ]
  );
  await dbModule.runQuery(
    `INSERT INTO predictions (
      prediction_id, match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [1, 1001, 7, 65, 7.5, 'home']
  );
}

async function loginAsMember(agent) {
  const loginPage = await agent.get('/login').expect(200);
  const csrfToken = extractCsrfToken(loginPage.text);

  await agent
    .post('/login')
    .type('form')
    .send({ _csrf: csrfToken, username: 'member', password: 'member-secret' })
    .expect(302)
    .expect('Location', '/predictions');
}

describe('app integration security stack', () => {
  let tempDir;
  let loaded;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-app-integration-'));
    loaded = loadRealAppModule(path.join(tempDir, 'app.db'));
  });

  afterEach(async () => {
    await unloadDbModule(loaded && loaded.dbModule);
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('GET /login renders a CSRF-protected form and applies CSP/session headers', async () => {
    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const response = await request(app).get('/login');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self' https://cdn.jsdelivr.net");
    const cookieHeader = (response.headers['set-cookie'] || []).join(';');
    expect(cookieHeader).toContain('connect.sid=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(extractCsrfToken(response.text)).toEqual(expect.any(String));
  });

  test('POST /login rejects requests without a CSRF token before route handling', async () => {
    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    await agent.get('/login').expect(200);
    const response = await agent
      .post('/login')
      .type('form')
      .send({ username: 'any', password: 'secret' });

    expect(response.status).toBe(403);
    expect(response.text).toContain('CSRF token validation failed');
  });

  test('POST /login with a valid CSRF token reaches the auth route and emits rate-limit headers', async () => {
    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    const loginPage = await agent.get('/login').expect(200);
    const csrfToken = extractCsrfToken(loginPage.text);

    const response = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: '', password: '' });

    expect(response.status).toBe(200);
    expect(response.text).toContain('Username and password are required');
    expect(response.headers['ratelimit-policy']).toBeDefined();
    expect(response.headers['ratelimit-limit']).toBeDefined();
  });

  test('authenticated non-admin users are blocked from admin routes after real login', async () => {
    const passwordHash = bcrypt.hashSync('member-secret', 4);
    await unloadDbModule(loaded && loaded.dbModule);
    loaded = loadRealAppModule(path.join(tempDir, 'app.db'), {
      predictorService: {
        getPredictorByName: jest.fn().mockResolvedValue({
          predictor_id: 7,
          name: 'member',
          display_name: 'Member',
          password: passwordHash,
          is_admin: 0
        })
      },
      adminScriptRunner: {
        recoverInterruptedRuns: jest.fn(),
        getScriptMetadata: jest.fn().mockResolvedValue({ scripts: [] })
      }
    });

    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    const loginPage = await agent.get('/login').expect(200);
    const csrfToken = extractCsrfToken(loginPage.text);

    await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: 'member', password: 'member-secret' })
      .expect(302)
      .expect('Location', '/predictions');

    const response = await agent.get('/admin/api/script-metadata');

    expect(response.status).toBe(403);
    expect(response.text).toContain('Admin access required');
  });

  test('admin script run POST requires CSRF and succeeds with a valid token after login', async () => {
    const passwordHash = bcrypt.hashSync('admin-secret', 4);
    const startScriptRun = jest.fn().mockResolvedValue({ run_id: 12, status: 'running' });
    await unloadDbModule(loaded && loaded.dbModule);
    loaded = loadRealAppModule(path.join(tempDir, 'app.db'), {
      predictorService: {
        getPredictorByName: jest.fn().mockResolvedValue({
          predictor_id: 1,
          name: 'admin',
          display_name: 'Admin',
          password: passwordHash,
          is_admin: 1
        })
      },
      adminScriptRunner: {
        recoverInterruptedRuns: jest.fn(),
        getScriptMetadata: jest.fn().mockResolvedValue({ scripts: [] }),
        startScriptRun
      }
    });

    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    const loginPage = await agent.get('/login').expect(200);
    const loginCsrfToken = extractCsrfToken(loginPage.text);

    await agent
      .post('/login')
      .type('form')
      .send({ _csrf: loginCsrfToken, username: 'admin', password: 'admin-secret' })
      .expect(302)
      .expect('Location', '/admin');

    const csrfFailure = await agent
      .post('/admin/api/script-runs')
      .send({ scriptKey: 'sync-games', params: { year: 2026 } });

    expect(csrfFailure.status).toBe(403);
    expect(csrfFailure.text).toContain('CSRF token validation failed');

    const scriptsPage = await agent.get('/admin/scripts').expect(200);
    const pageCsrfToken = extractCsrfToken(scriptsPage.text);

    const success = await agent
      .post('/admin/api/script-runs')
      .set('X-CSRF-Token', pageCsrfToken)
      .send({ scriptKey: 'sync-games', params: { year: 2026 } });

    expect(success.status).toBe(202);
    expect(startScriptRun).toHaveBeenCalledWith('sync-games', { year: 2026 }, 1);
    expect(success.body).toEqual({
      success: true,
      run: { run_id: 12, status: 'running' }
    });
  });

  test('admin pages render CSP-safe HTML with page-specific assets after real admin login', async () => {
    const passwordHash = bcrypt.hashSync('admin-secret', 4);
    await unloadDbModule(loaded && loaded.dbModule);
    loaded = loadRenderedAppModule({
      predictorService: {
        getPredictorByName: jest.fn().mockResolvedValue({
          predictor_id: 1,
          name: 'admin',
          display_name: 'Admin',
          password: passwordHash,
          is_admin: 1
        }),
        getAllPredictors: jest.fn().mockResolvedValue([
          {
            predictor_id: 1,
            name: 'admin',
            display_name: 'Admin',
            is_admin: 1,
            year_joined: 2024,
            active: 1
          },
          {
            predictor_id: 6,
            name: 'dad-ai',
            display_name: "Dad's AI",
            is_admin: 0,
            year_joined: 2025,
            active: 1
          }
        ])
      },
      roundService: {
        resolveYear: jest.fn().mockResolvedValue({
          selectedYear: 2026,
          years: [{ year: 2026 }, { year: 2025 }]
        }),
        getRoundsForYear: jest.fn().mockResolvedValue([
          { round_number: 'OR' },
          { round_number: '2' }
        ]),
        combineRoundsForDisplay: jest.fn((rounds) => rounds)
      },
      featuredPredictions: {
        getDefaultFeaturedPredictorId: jest.fn().mockResolvedValue(6)
      },
      adminScriptRunner: {
        recoverInterruptedRuns: jest.fn()
      }
    });

    const app = loaded.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    const loginPage = await agent.get('/login').expect(200);
    const csrfToken = extractCsrfToken(loginPage.text);

    await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: 'admin', password: 'admin-secret' })
      .expect(302)
      .expect('Location', '/admin');

    const adminResponse = await agent.get('/admin').expect(200);
    const scriptsResponse = await agent.get('/admin/scripts').expect(200);

    for (const response of [adminResponse, scriptsResponse]) {
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.text).toContain('<meta name="csrf-token" content="');
      expect(response.text).toContain('Admin panel');
      expect(response.text).toContain('/js/mobile-nav.js');
      expect(response.text).not.toContain('onclick=');
      expect(hasInlineScriptTag(response.text)).toBe(false);
    }

    expect(adminResponse.text).toContain('Admin Dashboard');
    expect(adminResponse.text).toContain('Featured Predictor');
    expect(adminResponse.text).toContain('Dad&#39;s AI');
    expect(adminResponse.text).toContain('/js/admin.js');

    expect(scriptsResponse.text).toContain('Admin Scripts');
    expect(scriptsResponse.text).toContain('Run Sync Games');
    expect(scriptsResponse.text).toContain('Run Predictions');
    expect(scriptsResponse.text).toContain('/js/admin-scripts.js');
  });
});

describe('app integration startup path', () => {
  let tempDir;
  let loaded;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-app-startup-'));
  });

  afterEach(async () => {
    await unloadDbModule(loaded && loaded.dbModule);
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('startServer initializes the real database before recovery and event sync, then begins listening', async () => {
    const lifecycle = [];
    const listenSpy = jest.fn((port, host, callback) => {
      lifecycle.push(`listen:${port}:${host}`);
      if (typeof callback === 'function') {
        callback();
      }
      return { close: jest.fn() };
    });

    const recoverInterruptedRuns = jest.fn(async () => {
      const predictorsTable = await loaded.dbModule.getOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        ['predictors']
      );
      expect(predictorsTable).toEqual({ name: 'predictors' });
      lifecycle.push('recover');
    });
    const eventSyncStart = jest.fn(async () => {
      lifecycle.push('event-sync');
    });

    loaded = loadRealAppModule(path.join(tempDir, 'startup.db'), {
      expressMock: buildExpressMock(listenSpy),
      adminScriptRunner: {
        recoverInterruptedRuns
      },
      eventSyncService: {
        start: eventSyncStart,
        stop: jest.fn()
      }
    });

    await loaded.appModule.startServer({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    expect(recoverInterruptedRuns).toHaveBeenCalledTimes(1);
    expect(eventSyncStart).toHaveBeenCalledTimes(1);
    expect(listenSpy).toHaveBeenCalledWith(3001, '0.0.0.0', expect.any(Function));
    expect(lifecycle).toEqual([
      'recover',
      'event-sync',
      'listen:3001:0.0.0.0'
    ]);
  });
});

describe('app integration route stack', () => {
  let tempDir;
  let loaded;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-app-routes-'));
    loaded = loadRealAppModule(path.join(tempDir, 'app.db'));
  });

  afterEach(async () => {
    await unloadDbModule(loaded && loaded.dbModule);
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('authenticated users can render /predictions with real DB-backed match content', async () => {
    await seedAuthenticatedRouteData(loaded.dbModule);

    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    await loginAsMember(agent);

    const response = await agent.get('/predictions?year=2026&round=2');

    expect(response.status).toBe(200);
    expect(response.text).toContain('AFL Match Predictions');
    expect(response.text).toContain('Select Round');
    expect(response.text).toContain('Swans');
    expect(response.text).toContain('Lions');
    expect(response.text).toContain('data-round="2"');
    expect(response.text).toContain('<meta name="csrf-token" content="');
  });

  test('authenticated users can save predictions through the real CSRF-protected app stack', async () => {
    await seedAuthenticatedRouteData(loaded.dbModule);

    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    await loginAsMember(agent);

    const predictionsPage = await agent.get('/predictions?year=2026&round=2').expect(200);
    const csrfToken = extractCsrfToken(predictionsPage.text);

    const csrfFailure = await agent
      .post('/predictions/save')
      .send({ matchId: 1002, probability: 72 });

    expect(csrfFailure.status).toBe(403);
    expect(csrfFailure.text).toContain('CSRF token validation failed');

    const success = await agent
      .post('/predictions/save')
      .set('X-CSRF-Token', csrfToken)
      .send({ matchId: 1002, probability: 72 });

    const savedPrediction = await loaded.dbModule.getOne(
      'SELECT home_win_probability FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [1002, 7]
    );

    expect(success.status).toBe(200);
    expect(success.body).toEqual({ success: true });
    expect(savedPrediction).toEqual({ home_win_probability: 72 });
  });

  test('authenticated users can render /matches/stats with leaderboard content from real data', async () => {
    await seedAuthenticatedRouteData(loaded.dbModule);

    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });
    const agent = request.agent(app);

    await loginAsMember(agent);

    const response = await agent.get('/matches/stats?year=2026&round=1');

    expect(response.status).toBe(200);
    expect(response.text).toContain('AFL Prediction Statistics');
    expect(response.text).toContain('Predictor Leaderboard - 2026 Season');
    expect(response.text).toContain('Member (You)');
    expect(response.text).toContain('Round Performance - 2026');
  });

  test('public /elo and /simulation pages render their page-specific content through createApp', async () => {
    const app = loaded.appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const eloResponse = await request(app).get('/elo');
    const simulationResponse = await request(app).get('/simulation');

    expect(eloResponse.status).toBe(200);
    expect(eloResponse.text).toContain('ELO Team Ratings');
    expect(eloResponse.text).toContain('Model predictions');
    expect(eloResponse.text).toContain('/js/elo-chart.js');

    expect(simulationResponse.status).toBe(200);
    expect(simulationResponse.text).toContain('Season Simulation');
    expect(simulationResponse.text).toContain('Before-Round Snapshots');
    expect(simulationResponse.text).toContain('/js/simulation.js');
  });

  test('public page templates keep navigation and scripts CSP-safe through rendered HTML', async () => {
    const appModule = loadRenderedAppModule({
      db: {
        getQuery: jest.fn().mockResolvedValue([
          {
            match_id: 2001,
            round_number: '2',
            match_date: '2099-04-20T09:30:00.000Z',
            hscore: null,
            ascore: null,
            home_team: 'Cats',
            away_team: 'Swans',
            venue: 'MCG'
          }
        ]),
        initializeDatabase: jest.fn()
      },
      roundService: {
        resolveYear: jest.fn().mockResolvedValue({ selectedYear: 2026 }),
        getRoundsForYear: jest.fn().mockResolvedValue([
          { round_number: '1' },
          { round_number: '2' }
        ]),
        combineRoundsForDisplay: jest.fn((rounds) => rounds),
        normalizeRoundForDisplay: jest.fn((round) => round)
      },
      featuredPredictions: {
        getDefaultFeaturedPredictor: jest.fn().mockResolvedValue({
          predictor_id: 6,
          display_name: "Dad's AI"
        }),
        getPredictionYearsForPredictor: jest.fn().mockResolvedValue([{ year: '2026' }]),
        getPredictionsForRound: jest.fn().mockResolvedValue({
          predictor: { predictor_id: 6, display_name: "Dad's AI" },
          matches: [{ match_id: 2001, home_team: 'Cats', away_team: 'Swans', venue: 'MCG', match_date: '2099-04-20T09:30:00.000Z' }],
          predictions: { 2001: { probability: 64, predicted_margin: 11.2, tipped_team: 'home' } }
        })
      },
      predictionService: {
        getPredictionsWithResultsForYear: jest.fn().mockResolvedValue([
          {
            home_win_probability: 64,
            hscore: 95,
            ascore: 80,
            tipped_team: 'home',
            predicted_margin: 10
          }
        ])
      },
      predictorService: {
        getPredictorByName: jest.fn(),
        getPredictorById: jest.fn()
      },
      adminScriptRunner: {
        recoverInterruptedRuns: jest.fn()
      }
    });

    const app = appModule.createApp({
      sessionSecret: 'test-secret',
      sessionStore: new session.MemoryStore()
    });

    const homeResponse = await request(app).get('/?year=2026');
    const eloResponse = await request(app).get('/elo');
    const simulationResponse = await request(app).get('/simulation');

    for (const response of [homeResponse, eloResponse, simulationResponse]) {
      expect(response.status).toBe(200);
      expect(response.text).toContain('Model predictions');
      expect(response.text).toContain('ELO');
      expect(response.text).toContain('Simulation');
      expect(response.text).toContain('/js/mobile-nav.js');
      expect(response.text).not.toContain('onclick=');
      expect(hasInlineScriptTag(response.text)).toBe(false);
    }

    expect(homeResponse.text).toContain('Select Season');
    expect(homeResponse.text).toContain('Select Round');
    expect(homeResponse.text).toContain('/js/home.js');
    expect(eloResponse.text).toContain('/js/elo-chart.js');
    expect(simulationResponse.text).toContain('/js/simulation.js');
  });
});
