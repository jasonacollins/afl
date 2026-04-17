const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { AppError, createValidationError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const dbModule = require('../models/db');

const projectRoot = path.join(__dirname, '..');
const exportDir = path.join(projectRoot, 'data');
const backupDir = path.join(projectRoot, 'data', 'database', 'backups');
const REQUIRED_TABLES = ['teams', 'matches', 'predictors', 'predictions'];

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function getSnapshotFileName(prefix) {
  return `${prefix}_${getTimestamp()}.db`;
}

function escapeSqliteString(value) {
  return value.replace(/'/g, "''");
}

function execSql(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function getAll(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    if (!database || typeof database.close !== 'function') {
      resolve();
      return;
    }

    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function openReadOnlyDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(database);
    });
  });
}

async function createDatabaseSnapshot(options = {}) {
  const directory = options.directory || exportDir;
  const prefix = options.prefix || 'afl_predictions';
  const filename = options.filename || getSnapshotFileName(prefix);
  const snapshotPath = path.join(directory, filename);

  await fs.mkdir(directory, { recursive: true });
  await removeFileIfExists(snapshotPath);

  try {
    await execSql(dbModule.db, 'PRAGMA wal_checkpoint(FULL);');
    await execSql(
      dbModule.db,
      `VACUUM INTO '${escapeSqliteString(snapshotPath)}';`
    );
  } catch (error) {
    logger.error('Failed to create database snapshot', {
      snapshotPath,
      error: error.message
    });
    throw new AppError('Failed to create database snapshot', 500, 'DATABASE_SNAPSHOT_ERROR');
  }

  return {
    path: snapshotPath,
    filename
  };
}

async function validateUploadedDatabase(filePath) {
  let database;

  try {
    database = await openReadOnlyDatabase(filePath);
  } catch (error) {
    logger.warn('Uploaded database could not be opened', {
      filePath,
      error: error.message
    });
    throw createValidationError('Uploaded file is not a valid SQLite database');
  }

  try {
    const integrityRows = await getAll(database, 'PRAGMA integrity_check(1)');
    const integrityValue = integrityRows[0] ? Object.values(integrityRows[0])[0] : null;

    if (integrityValue !== 'ok') {
      throw createValidationError('Uploaded database failed integrity validation');
    }

    const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
    const tables = await getAll(
      database,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      REQUIRED_TABLES
    );
    const existingTables = new Set(tables.map((row) => row.name));
    const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTables.has(tableName));

    if (missingTables.length > 0) {
      throw createValidationError(`Uploaded database is missing required tables: ${missingTables.join(', ')}`);
    }

    return {
      integrity: integrityValue,
      requiredTables: REQUIRED_TABLES.slice()
    };
  } catch (error) {
    if (error && error.errorCode === 'VALIDATION_ERROR') {
      throw error;
    }

    if (error && error.code === 'SQLITE_NOTADB') {
      throw createValidationError('Uploaded file is not a valid SQLite database');
    }

    throw error;
  } finally {
    void closeDatabase(database).catch((error) => {
      logger.warn('Uploaded database validation connection did not close cleanly', {
        filePath,
        error: error.message
      });
    });
  }
}

async function replaceDatabaseFromUpload(filePath) {
  const resolvedDbPath = dbModule.dbPath;
  const incomingFileName = `incoming_${getTimestamp()}.db`;
  const incomingPath = path.join(path.dirname(resolvedDbPath), incomingFileName);
  let liveDatabaseClosed = false;
  try {
    await validateUploadedDatabase(filePath);

    const backup = await createDatabaseSnapshot({
      directory: backupDir,
      prefix: 'backup'
    });

    await fs.mkdir(path.dirname(resolvedDbPath), { recursive: true });
    await fs.copyFile(filePath, incomingPath);
    await closeDatabase(dbModule.db);
    liveDatabaseClosed = true;
    await Promise.all([
      removeFileIfExists(`${resolvedDbPath}-wal`),
      removeFileIfExists(`${resolvedDbPath}-shm`)
    ]);
    await fs.rename(incomingPath, resolvedDbPath);

    return {
      backupPath: backup.path,
      backupFilename: backup.filename,
      dbPath: resolvedDbPath
    };
  } catch (error) {
    if (error && error.errorCode === 'VALIDATION_ERROR') {
      logger.warn('Uploaded database validation failed', {
        filePath,
        error: error.message
      });
      throw error;
    }

    logger.error('Failed to replace database from upload', {
      filePath,
      incomingPath,
      dbPath: resolvedDbPath,
      error: error.message
    });
    const replacementError = new AppError(
      'Failed to replace database with uploaded file',
      500,
      'DATABASE_REPLACEMENT_ERROR'
    );
    if (liveDatabaseClosed) {
      replacementError.requiresProcessRestart = true;
    }
    throw replacementError;
  } finally {
    await Promise.all([
      removeFileIfExists(filePath),
      removeFileIfExists(incomingPath)
    ]);
  }
}

module.exports = {
  backupDir,
  createDatabaseSnapshot,
  removeFileIfExists,
  replaceDatabaseFromUpload,
  REQUIRED_TABLES,
  validateUploadedDatabase
};
