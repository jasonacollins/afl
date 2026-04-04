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
  let loggerMock;

  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    loggerMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    jest.doMock('../../utils/logger', () => ({
      logger: loggerMock
    }));

    dbModule = require('../db');
  });

  dbModule.__testLogger = loggerMock;
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

describe('models/db query error paths', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.DB_PATH;
    jest.clearAllMocks();
  });

  test('runQuery rejects and logs when the database returns an error', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-err-'));
    const dbPath = path.join(tempDir, 'err.db');
    const dbModule = loadDbModule(dbPath);

    try {
      await expect(
        dbModule.runQuery('INSERT INTO nonexistent_table (col) VALUES (?)', ['val'])
      ).rejects.toThrow(/no such table/);

      expect(dbModule.__testLogger.error).toHaveBeenCalledWith(
        'Database query error',
        expect.objectContaining({ error: expect.stringContaining('no such table') })
      );
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('getQuery rejects and logs when the database returns an error', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-err-'));
    const dbPath = path.join(tempDir, 'err.db');
    const dbModule = loadDbModule(dbPath);

    try {
      await expect(
        dbModule.getQuery('SELECT * FROM nonexistent_table')
      ).rejects.toThrow(/no such table/);

      expect(dbModule.__testLogger.error).toHaveBeenCalledWith(
        'Database query error',
        expect.objectContaining({ error: expect.stringContaining('no such table') })
      );
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('getOne rejects and logs when the database returns an error', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-err-'));
    const dbPath = path.join(tempDir, 'err.db');
    const dbModule = loadDbModule(dbPath);

    try {
      await expect(
        dbModule.getOne('SELECT * FROM nonexistent_table WHERE id = ?', [1])
      ).rejects.toThrow(/no such table/);

      expect(dbModule.__testLogger.error).toHaveBeenCalledWith(
        'Database query error',
        expect.objectContaining({ error: expect.stringContaining('no such table') })
      );
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

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

      const expectedColumns = {
        teams: ['team_id', 'name', 'abbrev', 'colour_hex', 'state'],
        venues: ['venue_id', 'name', 'city', 'state'],
        matches: [
          'match_id',
          'match_number',
          'round_number',
          'match_date',
          'venue',
          'home_team_id',
          'away_team_id',
          'hscore',
          'hgoals',
          'hbehinds',
          'ascore',
          'agoals',
          'abehinds',
          'year',
          'complete',
          'venue_id'
        ],
        predictors: [
          'predictor_id',
          'name',
          'password',
          'is_admin',
          'year_joined',
          'display_name',
          'stats_excluded',
          'homepage_available',
          'is_default_featured',
          'active'
        ],
        predictions: [
          'prediction_id',
          'match_id',
          'predictor_id',
          'home_win_probability',
          'predicted_margin',
          'prediction_time',
          'tipped_team'
        ]
      };

      for (const [tableName, columnNames] of Object.entries(expectedColumns)) {
        const pragmaRows = await dbModule.getQuery(
          `SELECT name FROM pragma_table_info('${tableName}') ORDER BY cid`
        );

        expect(pragmaRows.map((row) => row.name)).toEqual(columnNames);
      }

      await dbModule.runQuery(
        'INSERT INTO teams (team_id, name, state) VALUES (?, ?, ?), (?, ?, ?)',
        [1, 'Richmond', 'VIC', 2, 'Carlton', 'VIC']
      );
      await dbModule.runQuery(
        'INSERT INTO venues (venue_id, name, city, state) VALUES (?, ?, ?, ?)',
        [1, 'MCG', 'Melbourne', 'VIC']
      );
      await dbModule.runQuery(
        `INSERT INTO matches (
          match_id, match_number, round_number, match_date, venue,
          home_team_id, away_team_id, year, complete, venue_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [1, 1, '1', '2026-03-15T19:20:00', 'MCG', 1, 2, 2026, 0, 1]
      );
      await dbModule.runQuery(
        `INSERT INTO predictors (
          predictor_id, name, password, display_name, active
        ) VALUES (?, ?, ?, ?, ?)`,
        [7, 'schema-smoke', 'hashed-password', 'Schema Smoke', 1]
      );
      await dbModule.runQuery(
        `INSERT INTO predictions (
          prediction_id, match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [1, 1, 7, 62, 12.5, 'home']
      );

      const insertedPrediction = await dbModule.getOne(
        `SELECT
           p.match_id,
           p.predictor_id,
           p.home_win_probability,
           p.predicted_margin,
           p.tipped_team,
           m.complete,
           t1.state AS home_state,
           t2.state AS away_state,
           v.state AS venue_state
         FROM predictions p
         JOIN matches m ON m.match_id = p.match_id
         JOIN teams t1 ON t1.team_id = m.home_team_id
         JOIN teams t2 ON t2.team_id = m.away_team_id
         LEFT JOIN venues v ON v.venue_id = m.venue_id
         WHERE p.prediction_id = ?`,
        [1]
      );

      expect(insertedPrediction).toEqual({
        match_id: 1,
        predictor_id: 7,
        home_win_probability: 62,
        predicted_margin: 12.5,
        tipped_team: 'home',
        complete: 0,
        home_state: 'VIC',
        away_state: 'VIC',
        venue_state: 'VIC'
      });

      const autoVacuumRow = await dbModule.getOne('PRAGMA auto_vacuum');
      expect(Object.values(autoVacuumRow)[0]).toBe(2);

      const journalModeRow = await dbModule.getOne('PRAGMA journal_mode');
      expect(String(Object.values(journalModeRow)[0]).toLowerCase()).toBe('wal');
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('backfills venue_id on matches with a matching venue name', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-backfill-'));
    const dbPath = path.join(tempDir, 'backfill.db');
    const dbModule = loadDbModule(dbPath);

    try {
      await dbModule.initializeDatabase();

      // Seed venue and a match with a venue name but no venue_id
      await dbModule.runQuery(
        'INSERT INTO venues (venue_id, name, city, state) VALUES (?, ?, ?, ?)',
        [1, 'MCG', 'Melbourne', 'VIC']
      );
      await dbModule.runQuery(
        'INSERT INTO teams (team_id, name) VALUES (?, ?), (?, ?)',
        [1, 'Richmond', 2, 'Carlton']
      );
      await dbModule.runQuery(
        `INSERT INTO matches (match_id, match_number, round_number, venue, home_team_id, away_team_id, year, complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [1, 100, '1', 'MCG', 1, 2, 2026, 0]
      );

      // Verify venue_id is NULL before re-initialization
      const before = await dbModule.getOne('SELECT venue_id FROM matches WHERE match_id = ?', [1]);
      expect(before.venue_id).toBeNull();

      // Re-run initialization to trigger backfill
      dbModule.__testLogger.info.mockClear();
      await dbModule.initializeDatabase();

      const after = await dbModule.getOne('SELECT venue_id FROM matches WHERE match_id = ?', [1]);
      expect(after.venue_id).toBe(1);

      expect(dbModule.__testLogger.info).toHaveBeenCalledWith(
        'Backfilled missing venue_id values on matches table',
        expect.objectContaining({ rowsUpdated: 1 })
      );
    } finally {
      await unloadDbModule(dbModule);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('rolls back migration and propagates error when legacy data violates the new schema', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-db-rollback-'));
    const dbPath = path.join(tempDir, 'rollback.db');
    const seedDb = openSqlite(dbPath);

    try {
      // Create legacy tables with a row that has NULL script_key,
      // which violates NOT NULL on the new schema and triggers ROLLBACK.
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
        [7, 'rollback-admin', 'hashed-password']
      );
      await run(
        seedDb,
        `CREATE TABLE admin_script_runs (
          run_id INTEGER PRIMARY KEY,
          script_key TEXT,
          status TEXT,
          created_by_predictor_id INTEGER,
          created_at TEXT,
          started_at TEXT,
          finished_at TEXT,
          exit_code INTEGER,
          error_message TEXT,
          params_json TEXT,
          command_json TEXT
        )`
      );
      // Insert a row with NULL script_key to cause NOT NULL violation during migration
      await run(
        seedDb,
        `INSERT INTO admin_script_runs (
          run_id, script_key, status, created_by_predictor_id, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
        [1, null, 'succeeded', 7, '2026-04-01T00:00:00.000Z']
      );
    } finally {
      await close(seedDb);
    }

    const dbModule = loadDbModule(dbPath);

    try {
      await expect(dbModule.initializeDatabase()).rejects.toThrow();

      // Verify the error was logged at the top-level catch
      expect(dbModule.__testLogger.error).toHaveBeenCalledWith(
        'Error initializing database',
        expect.objectContaining({ error: expect.any(String) })
      );

      // Verify the original table was preserved (rollback worked)
      const originalTable = await dbModule.getOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_script_runs'"
      );
      expect(originalTable).toBeDefined();

      // Verify the original row is still intact
      const originalRow = await dbModule.getOne(
        'SELECT run_id, script_key FROM admin_script_runs WHERE run_id = ?',
        [1]
      );
      expect(originalRow).toEqual({ run_id: 1, script_key: null });
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
