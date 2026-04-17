function loadService(options = {}) {
  const fsMocks = {
    mkdir: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    copyFile: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    ...(options.fsMocks || {})
  };

  const liveDb = {
    exec: jest.fn((sql, callback) => callback(null)),
    close: jest.fn((callback) => callback(null))
  };

  const dbModuleMock = {
    db: liveDb,
    dbPath: '/tmp/live.db',
    ...(options.dbModuleMock || {})
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  const sqliteFactory = options.sqliteFactory || createAsyncSqliteFactory({
    all: jest.fn((sql, _params, innerCallback) => {
      if (sql.includes('integrity_check')) {
        innerCallback(null, [{ integrity_check: 'ok' }]);
        return;
      }

      innerCallback(null, [
        { name: 'teams' },
        { name: 'matches' },
        { name: 'predictors' },
        { name: 'predictions' }
      ]);
    }),
    close: jest.fn((innerCallback) => innerCallback(null))
  });

  let service;

  jest.isolateModules(() => {
    jest.doMock('fs', () => ({
      promises: fsMocks
    }));
    jest.doMock('sqlite3', () => ({
      verbose: () => ({
        Database: sqliteFactory
      })
    }));
    jest.doMock('../../models/db', () => dbModuleMock);
    jest.doMock('../../utils/logger', () => ({ logger }));
    service = require('../admin-database-service');
  });

  return {
    service,
    mocks: {
      dbModuleMock,
      fsMocks,
      liveDb,
      logger,
      sqliteFactory
    }
  };
}

function createAsyncSqliteFactory(databaseOrError) {
  return jest.fn(function sqliteDatabase(_filePath, _flags, callback) {
    process.nextTick(() => {
      if (databaseOrError instanceof Error) {
        callback(databaseOrError);
        return;
      }

      callback(null);
    });

    return databaseOrError;
  });
}

describe('admin-database-service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createDatabaseSnapshot checkpoints WAL and vacuums into the snapshot path', async () => {
    const { service, mocks } = loadService();

    const snapshot = await service.createDatabaseSnapshot({
      directory: '/tmp/export',
      filename: 'afl_predictions_2026.db'
    });

    expect(mocks.fsMocks.mkdir).toHaveBeenCalledWith('/tmp/export', { recursive: true });
    expect(mocks.liveDb.exec).toHaveBeenNthCalledWith(1, 'PRAGMA wal_checkpoint(FULL);', expect.any(Function));
    expect(mocks.liveDb.exec).toHaveBeenNthCalledWith(
      2,
      "VACUUM INTO '/tmp/export/afl_predictions_2026.db';",
      expect.any(Function)
    );
    expect(snapshot).toEqual({
      path: '/tmp/export/afl_predictions_2026.db',
      filename: 'afl_predictions_2026.db'
    });
  });

  test('createDatabaseSnapshot wraps snapshot failures in an app error', async () => {
    const failingDb = {
      exec: jest
        .fn()
        .mockImplementationOnce((_sql, callback) => callback(null))
        .mockImplementationOnce((_sql, callback) => callback(new Error('vacuum failed'))),
      close: jest.fn((callback) => callback(null))
    };
    const { service, mocks } = loadService({
      dbModuleMock: {
        db: failingDb,
        dbPath: '/tmp/live.db'
      }
    });

    await expect(service.createDatabaseSnapshot({
      directory: '/tmp/export',
      filename: 'afl_predictions_2026.db'
    })).rejects.toMatchObject({
      errorCode: 'DATABASE_SNAPSHOT_ERROR',
      message: 'Failed to create database snapshot'
    });

    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to create database snapshot', {
      snapshotPath: '/tmp/export/afl_predictions_2026.db',
      error: 'vacuum failed'
    });
  });

  test('validateUploadedDatabase rejects files that cannot be opened as SQLite databases', async () => {
    const openError = Object.assign(new Error('not a database'), { code: 'SQLITE_NOTADB' });
    const sqliteFactory = createAsyncSqliteFactory(openError);
    const { service } = loadService({ sqliteFactory });

    await expect(service.validateUploadedDatabase('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'VALIDATION_ERROR',
      message: 'Uploaded file is not a valid SQLite database'
    });
  });

  test('validateUploadedDatabase rejects failed integrity checks', async () => {
    const validationDb = {
      all: jest.fn((_sql, _params, callback) => callback(null, [{ integrity_check: 'corrupt' }])),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service } = loadService({ sqliteFactory });

    await expect(service.validateUploadedDatabase('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'VALIDATION_ERROR',
      message: 'Uploaded database failed integrity validation'
    });
  });

  test('validateUploadedDatabase rejects sqlite files that are missing required tables', async () => {
    const validationDb = {
      all: jest
        .fn()
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ integrity_check: 'ok' }]))
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ name: 'teams' }])),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service } = loadService({ sqliteFactory });

    await expect(service.validateUploadedDatabase('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'VALIDATION_ERROR',
      message: 'Uploaded database is missing required tables: matches, predictors, predictions'
    });
  });

  test('validateUploadedDatabase maps SQLITE_NOTADB errors raised during validation queries', async () => {
    const validationDb = {
      all: jest.fn((_sql, _params, callback) => callback(Object.assign(new Error('not a db'), {
        code: 'SQLITE_NOTADB'
      }))),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service } = loadService({ sqliteFactory });

    await expect(service.validateUploadedDatabase('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'VALIDATION_ERROR',
      message: 'Uploaded file is not a valid SQLite database'
    });
  });

  test('validateUploadedDatabase logs a warning when the validation connection fails to close cleanly', async () => {
    const validationDb = {
      all: jest
        .fn()
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ integrity_check: 'ok' }]))
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [
          { name: 'teams' },
          { name: 'matches' },
          { name: 'predictors' },
          { name: 'predictions' }
        ])),
      close: jest.fn((callback) => callback(new Error('close failed')))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service, mocks } = loadService({ sqliteFactory });

    await service.validateUploadedDatabase('/tmp/upload.db');
    await new Promise((resolve) => process.nextTick(resolve));

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Uploaded database validation connection did not close cleanly',
      {
        filePath: '/tmp/upload.db',
        error: 'close failed'
      }
    );
  });

  test('replaceDatabaseFromUpload validates, snapshots, replaces the database, and cleans up files', async () => {
    const validationDb = {
      all: jest
        .fn()
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ integrity_check: 'ok' }]))
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [
          { name: 'teams' },
          { name: 'matches' },
          { name: 'predictors' },
          { name: 'predictions' }
        ])),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service, mocks } = loadService({ sqliteFactory });

    const result = await service.replaceDatabaseFromUpload('/tmp/upload.db');

    expect(mocks.fsMocks.copyFile).toHaveBeenCalledWith(
      '/tmp/upload.db',
      expect.stringContaining('/tmp/incoming_')
    );
    expect(mocks.liveDb.close).toHaveBeenCalledTimes(1);
    expect(mocks.fsMocks.rename).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/incoming_'),
      '/tmp/live.db'
    );
    expect(mocks.fsMocks.unlink).toHaveBeenCalledWith('/tmp/live.db-wal');
    expect(mocks.fsMocks.unlink).toHaveBeenCalledWith('/tmp/live.db-shm');
    expect(mocks.fsMocks.unlink).toHaveBeenCalledWith('/tmp/upload.db');
    expect(result.backupPath).toContain('/data/database/backups/backup_');
    expect(result.dbPath).toBe('/tmp/live.db');
  });

  test('replaceDatabaseFromUpload preserves validation failures and still cleans up the upload file', async () => {
    const validationDb = {
      all: jest
        .fn()
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ integrity_check: 'ok' }]))
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ name: 'teams' }])),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service, mocks } = loadService({ sqliteFactory });

    await expect(service.replaceDatabaseFromUpload('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'VALIDATION_ERROR',
      message: 'Uploaded database is missing required tables: matches, predictors, predictions'
    });

    expect(mocks.fsMocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.fsMocks.unlink).toHaveBeenCalledWith('/tmp/upload.db');
  });

  test('replaceDatabaseFromUpload wraps unexpected replacement failures', async () => {
    const validationDb = {
      all: jest
        .fn()
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ integrity_check: 'ok' }]))
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [
          { name: 'teams' },
          { name: 'matches' },
          { name: 'predictors' },
          { name: 'predictions' }
        ])),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service, mocks } = loadService({
      sqliteFactory,
      fsMocks: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
        copyFile: jest.fn().mockRejectedValue(new Error('copy failed')),
        rename: jest.fn().mockResolvedValue(undefined)
      }
    });

    await expect(service.replaceDatabaseFromUpload('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'DATABASE_REPLACEMENT_ERROR',
      message: 'Failed to replace database with uploaded file'
    });

    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to replace database from upload', {
      filePath: '/tmp/upload.db',
      incomingPath: expect.stringContaining('/tmp/incoming_'),
      dbPath: '/tmp/live.db',
      error: 'copy failed'
    });
  });

  test('replaceDatabaseFromUpload marks failures after closing the live database as requiring restart', async () => {
    const validationDb = {
      all: jest
        .fn()
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [{ integrity_check: 'ok' }]))
        .mockImplementationOnce((_sql, _params, callback) => callback(null, [
          { name: 'teams' },
          { name: 'matches' },
          { name: 'predictors' },
          { name: 'predictions' }
        ])),
      close: jest.fn((callback) => callback(null))
    };
    const sqliteFactory = createAsyncSqliteFactory(validationDb);
    const { service } = loadService({
      sqliteFactory,
      fsMocks: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
        copyFile: jest.fn().mockResolvedValue(undefined),
        rename: jest.fn().mockRejectedValue(new Error('rename failed'))
      }
    });

    await expect(service.replaceDatabaseFromUpload('/tmp/upload.db')).rejects.toMatchObject({
      errorCode: 'DATABASE_REPLACEMENT_ERROR',
      message: 'Failed to replace database with uploaded file',
      requiresProcessRestart: true
    });
  });

  test('removeFileIfExists ignores missing files but rethrows other filesystem errors', async () => {
    const { service } = loadService({
      fsMocks: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn()
          .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
          .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' })),
        copyFile: jest.fn().mockResolvedValue(undefined),
        rename: jest.fn().mockResolvedValue(undefined)
      }
    });

    await expect(service.removeFileIfExists('/tmp/missing.db')).resolves.toBeUndefined();
    await expect(service.removeFileIfExists('/tmp/protected.db')).rejects.toMatchObject({
      code: 'EACCES'
    });
  });
});
