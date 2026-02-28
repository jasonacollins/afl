const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const { logger } = require('../utils/logger');

// Database path
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/database/afl_predictions.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('Error connecting to database', { error: err.message, path: dbPath });
  } else {
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
    }

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
  dbPath
};
