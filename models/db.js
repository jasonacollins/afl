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
    
    // Check if schema exists
    const tableExists = await getOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='predictors'"
    );

    if (!tableExists) {
      logger.info('Creating database schema');
      
      // Create tables
      await runQuery(`
        CREATE TABLE IF NOT EXISTS teams (
          team_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          abbrev TEXT
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
          complete INTEGER,
          FOREIGN KEY (home_team_id) REFERENCES teams (team_id),
          FOREIGN KEY (away_team_id) REFERENCES teams (team_id)
        )
      `);
      
      await runQuery(`
        CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Rest of the table creation...
      logger.info('Database schema created successfully');
    } else {
      // Check for missing columns and add them if needed
      logger.info('Checking for schema updates');
      
      // Check if 'year' column exists in matches table
      const yearColumnExists = await getOne(
        "SELECT 1 FROM pragma_table_info('matches') WHERE name='year'"
      );
      
      if (!yearColumnExists) {
        logger.info('Adding year column to matches table');
        await runQuery("ALTER TABLE matches ADD COLUMN year INTEGER DEFAULT 2025");
      }
      
      // Check if 'complete' column exists in matches table
      const completeColumnExists = await getOne(
        "SELECT 1 FROM pragma_table_info('matches') WHERE name='complete'"
      );
      
      if (!completeColumnExists) {
        logger.info('Adding complete column to matches table');
        await runQuery("ALTER TABLE matches ADD COLUMN complete INTEGER");
      }
      
      // Check if 'stats_excluded' column exists in predictors table
      const statsExcludedColumnExists = await getOne(
        "SELECT 1 FROM pragma_table_info('predictors') WHERE name='stats_excluded'"
      );
      
      if (!statsExcludedColumnExists) {
        logger.info('Adding stats_excluded column to predictors table');
        await runQuery("ALTER TABLE predictors ADD COLUMN stats_excluded INTEGER DEFAULT 0");
      }
      
      logger.info('Schema update check completed');
    }
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
