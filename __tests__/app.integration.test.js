const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const request = require('supertest');
const session = require('express-session');

function loadRealAppModule(dbPath, mocks = {}) {
  let loaded;

  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
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
    }

    if (mocks.adminScriptRunner) {
      jest.doMock('../services/admin-script-runner', () => mocks.adminScriptRunner);
    }

    loaded = {
      appModule: require('../app'),
      dbModule: require('../models/db')
    };
  });

  return loaded;
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
});
