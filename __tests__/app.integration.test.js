const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');
const session = require('express-session');

function loadRealAppModule(dbPath) {
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
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
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
});
