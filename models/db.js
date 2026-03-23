const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const { logger } = require('../utils/logger');

const SQLITE_BUSY_TIMEOUT_MS = Number.parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '10000', 10);

// Database path
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/database/afl_predictions.db');
const projectRoot = path.join(__dirname, '..');
const adminScriptLogsArchiveDir = path.join(projectRoot, 'logs', 'admin-scripts', 'archive');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('Error connecting to database', { error: err.message, path: dbPath });
  } else {
    db.configure('busyTimeout', SQLITE_BUSY_TIMEOUT_MS);
    logger.info('Connected to SQLite database', { path: dbPath });
  }
});

// Helper to run queries with promises
function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        logger.error('Database query error', { 
          query, 
          params, 
          error: err.message 
        });
        reject(err);
      } else {
        logger.debug('Query executed successfully', { 
          query, 
          changes: this.changes,
          lastID: this.lastID
        });
        resolve(this);
      }
    });
  });
}

// Helper to get query results with promises
function getQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        logger.error('Database query error', { 
          query, 
          params, 
          error: err.message 
        });
        reject(err);
      } else {
        logger.debug('Query returned results', { 
          query, 
          rowCount: rows.length 
        });
        resolve(rows);
      }
    });
  });
}

// Helper to get a single row
function getOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        logger.error('Database query error', { 
          query, 
          params, 
          error: err.message 
        });
        reject(err);
      } else {
        logger.debug('Query returned single row', { 
          query, 
          found: !!row 
        });
        resolve(row);
      }
    });
  });
}

// Initialize database if needed
async function initializeDatabase() {
  try {
    logger.info('Checking database schema');

    const tableExists = async (tableName) => {
      const table = await getOne(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        [tableName]
      );
      return !!table;
    };

    const columnExists = async (tableName, columnName) => {
      if (!(await tableExists(tableName))) {
        return false;
      }

      const column = await getOne(
        `SELECT 1 FROM pragma_table_info('${tableName}') WHERE name = ?`,
        [columnName]
      );
      return !!column;
    };

    const addColumnIfMissing = async (tableName, columnName, definition) => {
      if (!(await columnExists(tableName, columnName))) {
        logger.info(`Adding ${columnName} column to ${tableName} table`);
        await runQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
      }
    };

    const getPragmaNumber = async (pragmaName) => {
      const row = await getOne(`PRAGMA ${pragmaName}`);
      if (!row) {
        return null;
      }

      const values = Object.values(row);
      if (values.length === 0) {
        return null;
      }

      const parsed = Number(values[0]);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const buildBackupPath = (tag) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return path.join(path.dirname(dbPath), 'backups', `${tag}_${timestamp}.db`);
    };

    const exportAdminScriptRunLogsArchive = async () => {
      if (!(await tableExists('admin_script_run_logs'))) {
        return { filesWritten: 0, rowsArchived: 0 };
      }

      const rows = await getQuery(
        `SELECT run_id, seq, stream, message, created_at
         FROM admin_script_run_logs
         ORDER BY run_id ASC, seq ASC`
      );

      if (rows.length === 0) {
        return { filesWritten: 0, rowsArchived: 0 };
      }

      await fs.mkdir(adminScriptLogsArchiveDir, { recursive: true });

      const groupedByRun = new Map();
      for (const row of rows) {
        if (!groupedByRun.has(row.run_id)) {
          groupedByRun.set(row.run_id, []);
        }
        groupedByRun.get(row.run_id).push(row);
      }

      let filesWritten = 0;
      for (const [runId, runRows] of groupedByRun.entries()) {
        const archivePath = path.join(adminScriptLogsArchiveDir, `run-${runId}.ndjson`);
        const payload = runRows
          .map((entry) => JSON.stringify({
            seq: entry.seq,
            stream: entry.stream,
            message: entry.message,
            created_at: entry.created_at
          }))
          .join('\n');

        await fs.writeFile(archivePath, `${payload}\n`, 'utf8');
        filesWritten += 1;
      }

      return {
        filesWritten,
        rowsArchived: rows.length
      };
    };

    const migrateAdminScriptLoggingIfNeeded = async () => {
      const hasAdminRunsTable = await tableExists('admin_script_runs');
      const hasRunLogsTable = await tableExists('admin_script_run_logs');

      if (!hasAdminRunsTable && !hasRunLogsTable) {
        return;
      }

      const hasParamsJson = await columnExists('admin_script_runs', 'params_json');
      const hasCommandJson = await columnExists('admin_script_runs', 'command_json');
      const hasLogPath = await columnExists('admin_script_runs', 'log_path');
      const needsMigration = hasRunLogsTable || hasParamsJson || hasCommandJson || !hasLogPath;

      if (!needsMigration) {
        return;
      }

      const backupPath = buildBackupPath('admin_logging_migration_backup');
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(dbPath, backupPath);
      logger.info('Created database backup before admin logging migration', { backupPath });

      const archiveResult = await exportAdminScriptRunLogsArchive();
      logger.info('Archived admin script DB logs before migration', archiveResult);

      const sourceHasLogPath = await columnExists('admin_script_runs', 'log_path');
      const logPathSelect = sourceHasLogPath ? 'log_path' : 'NULL';

      await runQuery('PRAGMA foreign_keys = OFF');
      await runQuery('BEGIN TRANSACTION');
      try {
        await runQuery(`
          CREATE TABLE admin_script_runs_new (
            run_id INTEGER PRIMARY KEY,
            script_key TEXT NOT NULL,
            status TEXT NOT NULL,
            created_by_predictor_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            exit_code INTEGER,
            error_message TEXT,
            log_path TEXT,
            FOREIGN KEY (created_by_predictor_id) REFERENCES predictors (predictor_id)
          )
        `);

        if (hasAdminRunsTable) {
          await runQuery(
            `INSERT INTO admin_script_runs_new (
              run_id,
              script_key,
              status,
              created_by_predictor_id,
              created_at,
              started_at,
              finished_at,
              exit_code,
              error_message,
              log_path
            )
            SELECT
              run_id,
              script_key,
              status,
              created_by_predictor_id,
              created_at,
              started_at,
              finished_at,
              exit_code,
              error_message,
              ${logPathSelect}
            FROM admin_script_runs`
          );
        }

        await runQuery('DROP TABLE IF EXISTS admin_script_run_logs');
        await runQuery('DROP TABLE IF EXISTS admin_script_runs');
        await runQuery('ALTER TABLE admin_script_runs_new RENAME TO admin_script_runs');
        await runQuery(
          'CREATE INDEX IF NOT EXISTS idx_admin_script_runs_status_created ON admin_script_runs(status, created_at)'
        );
        await runQuery('COMMIT');
      } catch (error) {
        await runQuery('ROLLBACK');
        throw error;
      } finally {
        await runQuery('PRAGMA foreign_keys = ON');
      }

      // Apply incremental auto-vacuum mode and reclaim dropped table pages immediately.
      await runQuery('PRAGMA auto_vacuum = INCREMENTAL');
      await runQuery('VACUUM');

      logger.info('Completed admin script logging schema migration');
    };

    const ensureIncrementalAutoVacuum = async () => {
      const autoVacuumMode = await getPragmaNumber('auto_vacuum');
      if (autoVacuumMode === 2) {
        return;
      }

      logger.info('Enabling SQLite incremental auto-vacuum mode');
      await runQuery('PRAGMA auto_vacuum = INCREMENTAL');
      await runQuery('VACUUM');
    };

    const ensureWalMode = async () => {
      const journalMode = await getOne('PRAGMA journal_mode = WAL');
      const resolvedMode = journalMode ? Object.values(journalMode)[0] : null;
      logger.info('Configured SQLite journal mode', { journalMode: resolvedMode });
      await runQuery('PRAGMA synchronous = NORMAL');
      await runQuery(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      await runQuery('PRAGMA foreign_keys = ON');
    };

    const backfillMatchVenueIds = async () => {
      if (!(await tableExists('matches')) || !(await tableExists('venues')) || !(await tableExists('venue_aliases'))) {
        return;
      }

      const result = await runQuery(`
        UPDATE matches
        SET venue_id = (
          SELECT resolved.venue_id
          FROM (
            SELECT v.venue_id AS venue_id, 0 AS priority
            FROM venues v
            WHERE TRIM(v.name) = TRIM(matches.venue) COLLATE NOCASE
            UNION ALL
            SELECT va.venue_id AS venue_id, 1 AS priority
            FROM venue_aliases va
            WHERE TRIM(va.alias_name) = TRIM(matches.venue) COLLATE NOCASE
            ORDER BY priority, venue_id
            LIMIT 1
          ) AS resolved
        )
        WHERE
          venue_id IS NULL
          AND venue IS NOT NULL
          AND TRIM(venue) <> ''
      `);

      if (result && result.changes > 0) {
        logger.info('Backfilled missing venue_id values on matches table', { rowsUpdated: result.changes });
      }
    };

    // Core tables
    await runQuery(`
      CREATE TABLE IF NOT EXISTS teams (
        team_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        abbrev TEXT,
        colour_hex TEXT,
        state TEXT
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id INTEGER PRIMARY KEY,
        match_number INTEGER NOT NULL,
        round_number TEXT NOT NULL,
        match_date TEXT,
        venue TEXT,
        home_team_id INTEGER,
        away_team_id INTEGER,
        hscore INTEGER,
        hgoals INTEGER,
        hbehinds INTEGER,
        ascore INTEGER,
        agoals INTEGER,
        abehinds INTEGER,
        year INTEGER DEFAULT 2025,
        complete INTEGER NOT NULL DEFAULT 0,
        venue_id INTEGER,
        FOREIGN KEY (home_team_id) REFERENCES teams (team_id),
        FOREIGN KEY (away_team_id) REFERENCES teams (team_id),
        FOREIGN KEY (venue_id) REFERENCES venues (venue_id)
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS predictors (
        predictor_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        year_joined INTEGER,
        display_name TEXT,
        stats_excluded INTEGER DEFAULT 0,
        homepage_available INTEGER DEFAULT 0,
        is_default_featured INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS predictions (
        prediction_id INTEGER PRIMARY KEY,
        match_id INTEGER NOT NULL,
        predictor_id INTEGER NOT NULL,
        home_win_probability NUMERIC NOT NULL,
        predicted_margin NUMERIC,
        prediction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipped_team TEXT DEFAULT 'home',
        UNIQUE(match_id, predictor_id),
        FOREIGN KEY (match_id) REFERENCES matches (match_id),
        FOREIGN KEY (predictor_id) REFERENCES predictors (predictor_id)
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS admin_script_runs (
        run_id INTEGER PRIMARY KEY,
        script_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by_predictor_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        error_message TEXT,
        log_path TEXT,
        FOREIGN KEY (created_by_predictor_id) REFERENCES predictors (predictor_id)
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS event_sync_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS result_update_jobs (
        job_id INTEGER PRIMARY KEY,
        year INTEGER NOT NULL,
        match_number INTEGER,
        status TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        trigger_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      )
    `);

    // Venue reference data used by current ELO tooling
    await runQuery(`
      CREATE TABLE IF NOT EXISTS venues (
        venue_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS venue_aliases (
        alias_id INTEGER PRIMARY KEY,
        venue_id INTEGER NOT NULL,
        alias_name TEXT NOT NULL,
        start_date DATE,
        end_date DATE,
        UNIQUE(venue_id, alias_name),
        FOREIGN KEY (venue_id) REFERENCES venues (venue_id)
      )
    `);

    await runQuery('CREATE INDEX IF NOT EXISTS idx_venue_aliases_dates ON venue_aliases(start_date, end_date)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_venue_aliases_name ON venue_aliases(alias_name)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_venues_state ON venues(state)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_matches_venue_id ON matches(venue_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_admin_script_runs_status_created ON admin_script_runs(status, created_at)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_event_sync_state_updated_at ON event_sync_state(updated_at)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_result_update_jobs_status_created ON result_update_jobs(status, created_at)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_result_update_jobs_year_match_status ON result_update_jobs(year, match_number, status)');

    await migrateAdminScriptLoggingIfNeeded();

    // Legacy schema migrations for older databases
    await addColumnIfMissing('teams', 'colour_hex', 'TEXT');
    await addColumnIfMissing('teams', 'state', 'TEXT');

    await addColumnIfMissing('matches', 'hgoals', 'INTEGER');
    await addColumnIfMissing('matches', 'hbehinds', 'INTEGER');
    await addColumnIfMissing('matches', 'agoals', 'INTEGER');
    await addColumnIfMissing('matches', 'abehinds', 'INTEGER');
    await addColumnIfMissing('matches', 'year', 'INTEGER DEFAULT 2025');
    await addColumnIfMissing('matches', 'complete', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('matches', 'venue_id', 'INTEGER');

    await addColumnIfMissing('predictors', 'year_joined', 'INTEGER');
    await addColumnIfMissing('predictors', 'display_name', 'TEXT');
    await addColumnIfMissing('predictors', 'stats_excluded', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('predictors', 'homepage_available', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('predictors', 'is_default_featured', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('predictors', 'active', 'INTEGER DEFAULT 1');

    await addColumnIfMissing('predictions', 'predicted_margin', 'NUMERIC');
    await addColumnIfMissing('predictions', 'prediction_time', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await addColumnIfMissing('predictions', 'tipped_team', "TEXT DEFAULT 'home'");

    // Normalize null values in newly-added flag columns.
    if (await tableExists('predictors')) {
      await runQuery('UPDATE predictors SET stats_excluded = 0 WHERE stats_excluded IS NULL');
      await runQuery('UPDATE predictors SET homepage_available = 0 WHERE homepage_available IS NULL');
      await runQuery('UPDATE predictors SET is_default_featured = 0 WHERE is_default_featured IS NULL');
      await runQuery('UPDATE predictors SET active = 1 WHERE active IS NULL');
    }

    if (await tableExists('matches')) {
      await runQuery('UPDATE matches SET complete = 0 WHERE complete IS NULL');
      await backfillMatchVenueIds();
    }

    await ensureIncrementalAutoVacuum();
    await ensureWalMode();

    logger.info('Database schema check completed');
  } catch (error) {
    logger.error('Error initializing database', { error: error.message });
    throw error;
  }
}

module.exports = {
  runQuery,
  getQuery,
  getOne,
  initializeDatabase,
  db,
  dbPath,
  SQLITE_BUSY_TIMEOUT_MS
};
