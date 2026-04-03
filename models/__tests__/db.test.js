const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function openSqlite(dbPath) {
  return new sqlite3.Database(dbPath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function loadDbModule(dbPath) {
  let dbModule;

  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    jest.doMock('../../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    }));

    dbModule = require('../db');
  });

  return dbModule;
}

async function unloadDbModule(dbModule) {
  if (dbModule && dbModule.db) {
    await close(dbModule.db);
  }

  jest.resetModules();
  delete process.env.DB_PATH;
}

async function waitForFile(filePath, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await fs.access(filePath);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for file: ${filePath}`);
}

describe('models/db initializeDatabase', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.DB_PATH;
    jest.clearAllMocks();
  });

  test('creates the current schema on a fresh database and enables the expected SQLite pragmas', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-fresh-'));
    const dbPath = path.join(tempDir, 'fresh.db');
    const dbModule = loadDbModule(dbPath);

    try {
      await dbModule.initializeDatabase();

      const tables = await dbModule.getQuery(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ORDER BY name`,
        [
          'admin_script_runs',
          'app_config',
          'event_sync_state',
          'matches',
          'predictions',
          'predictors',
          'result_update_jobs',
          'teams',
          'venue_aliases',
          'venues'
        ]
      );

      expect(tables.map((row) => row.name)).toEqual([
        'admin_script_runs',
        'app_config',
        'event_sync_state',
        'matches',
        'predictions',
        'predictors',
        'result_update_jobs',
        'teams',
        'venue_aliases',
        'venues'
      ]);

      const autoVacuumRow = await dbModule.getOne('PRAGMA auto_vacuum');
      expect(Object.values(autoVacuumRow)[0]).toBe(2);

      const journalModeRow = await dbModule.getOne('PRAGMA journal_mode');
      expect(String(Object.values(journalModeRow)[0]).toLowerCase()).toBe('wal');
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('migrates legacy admin script log tables into archived files and the new schema', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-migrate-'));
    const dbPath = path.join(tempDir, 'legacy.db');
    const seedDb = openSqlite(dbPath);
    const runId = 880001;
    const archivePath = path.join(
      __dirname,
      '..',
      '..',
      'logs',
      'admin-scripts',
      'archive',
      `run-${runId}.ndjson`
    );
    const backupDir = path.join(tempDir, 'backups');

    await fs.rm(archivePath, { force: true });

    try {
      await run(
        seedDb,
        `CREATE TABLE predictors (
          predictor_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL
        )`
      );
      await run(
        seedDb,
        'INSERT INTO predictors (predictor_id, name, password) VALUES (?, ?, ?)',
        [7, 'legacy-admin', 'hashed-password']
      );
      await run(
        seedDb,
        `CREATE TABLE admin_script_runs (
          run_id INTEGER PRIMARY KEY,
          script_key TEXT NOT NULL,
          status TEXT NOT NULL,
          created_by_predictor_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          exit_code INTEGER,
          error_message TEXT,
          params_json TEXT,
          command_json TEXT
        )`
      );
      await run(
        seedDb,
        `INSERT INTO admin_script_runs (
          run_id,
          script_key,
          status,
          created_by_predictor_id,
          created_at,
          params_json,
          command_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          'sync-games',
          'succeeded',
          7,
          '2026-04-01T00:00:00.000Z',
          '{"year":2026}',
          '{"command":"node"}'
        ]
      );
      await run(
        seedDb,
        `CREATE TABLE admin_script_run_logs (
          log_id INTEGER PRIMARY KEY,
          run_id INTEGER NOT NULL,
          seq INTEGER NOT NULL,
          stream TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`
      );
      await run(
        seedDb,
        `INSERT INTO admin_script_run_logs (run_id, seq, stream, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [runId, 1, 'stdout', 'first line', '2026-04-01T00:00:01.000Z']
      );
      await run(
        seedDb,
        `INSERT INTO admin_script_run_logs (run_id, seq, stream, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [runId, 2, 'stderr', 'second line', '2026-04-01T00:00:02.000Z']
      );
    } finally {
      await close(seedDb);
    }

    const dbModule = loadDbModule(dbPath);

    try {
      await dbModule.initializeDatabase();

      const legacyLogTable = await dbModule.getOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_script_run_logs'"
      );
      expect(legacyLogTable).toBeUndefined();

      const adminRunColumns = await dbModule.getQuery(
        "SELECT name FROM pragma_table_info('admin_script_runs') ORDER BY cid"
      );
      const adminRunColumnNames = adminRunColumns.map((row) => row.name);

      expect(adminRunColumnNames).toContain('log_path');
      expect(adminRunColumnNames).not.toContain('params_json');
      expect(adminRunColumnNames).not.toContain('command_json');

      const migratedRun = await dbModule.getOne(
        'SELECT run_id, script_key, created_by_predictor_id, log_path FROM admin_script_runs WHERE run_id = ?',
        [runId]
      );
      expect(migratedRun).toEqual({
        run_id: runId,
        script_key: 'sync-games',
        created_by_predictor_id: 7,
        log_path: null
      });

      await waitForFile(archivePath);

      const archiveContents = await fs.readFile(archivePath, 'utf8');
      const archivedRows = archiveContents
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(archivedRows).toEqual([
        {
          seq: 1,
          stream: 'stdout',
          message: 'first line',
          created_at: '2026-04-01T00:00:01.000Z'
        },
        {
          seq: 2,
          stream: 'stderr',
          message: 'second line',
          created_at: '2026-04-01T00:00:02.000Z'
        }
      ]);

      const backupFiles = await fs.readdir(backupDir);
      expect(
        backupFiles.some((fileName) => fileName.startsWith('admin_logging_migration_backup_'))
      ).toBe(true);

      const autoVacuumRow = await dbModule.getOne('PRAGMA auto_vacuum');
      expect(Object.values(autoVacuumRow)[0]).toBe(2);
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(archivePath, { force: true });
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
