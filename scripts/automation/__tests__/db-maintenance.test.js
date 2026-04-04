jest.mock('../../../models/db', () => ({
  getOne: jest.fn(),
  getQuery: jest.fn(),
  runQuery: jest.fn(),
  dbPath: '/tmp/afl-maintenance-test.db',
  db: {
    close: jest.fn((callback) => callback())
  }
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const path = require('path');
const fs = require('fs').promises;
const dbModule = require('../../../models/db');
const { logger } = require('../../../utils/logger');
const dbMaintenance = require('../db-maintenance');
const { main } = dbMaintenance;

const {
  DEFAULT_RETENTION_DAYS,
  LOG_ROOT,
  PROJECT_ROOT,
  parseArguments,
  ensurePathWithinProject,
  cleanupOldAdminRunRows,
  cleanupOrphanRunLogFiles,
  runCleanup,
  runVacuum,
  closeDbConnection
} = dbMaintenance.__testables;

describe('db-maintenance helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseArguments keeps cleanup defaults', () => {
    expect(parseArguments([])).toEqual({
      mode: 'cleanup',
      retentionDays: DEFAULT_RETENTION_DAYS
    });
  });

  test('parseArguments handles vacuum and valid retention overrides', () => {
    expect(parseArguments(['--vacuum', '--retention-days=14'])).toEqual({
      mode: 'vacuum',
      retentionDays: 14
    });
  });

  test('parseArguments ignores invalid retention override values', () => {
    expect(parseArguments(['--retention-days=0'])).toEqual({
      mode: 'cleanup',
      retentionDays: DEFAULT_RETENTION_DAYS
    });
  });

  test('ensurePathWithinProject resolves project-local paths and rejects traversal', () => {
    expect(ensurePathWithinProject('logs/admin-scripts/run-1.log')).toBe(
      path.join(PROJECT_ROOT, 'logs/admin-scripts/run-1.log')
    );
    expect(() => ensurePathWithinProject('../../outside.log')).toThrow(
      'Path resolves outside project root: ../../outside.log'
    );
  });
});

describe('db-maintenance cleanup flows', () => {
  let readdirSpy;
  let statSpy;
  let unlinkSpy;
  let originalArgv;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    readdirSpy = jest.spyOn(fs, 'readdir');
    statSpy = jest.spyOn(fs, 'stat');
    unlinkSpy = jest.spyOn(fs, 'unlink');
    originalArgv = process.argv;
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    consoleLogSpy.mockRestore();
    readdirSpy.mockRestore();
    statSpy.mockRestore();
    unlinkSpy.mockRestore();
  });

  test('cleanupOldAdminRunRows deletes stale rows and eligible log files only', async () => {
    dbModule.getOne.mockResolvedValue({ exists: 1 });
    dbModule.getQuery.mockResolvedValue([
      { run_id: 1, log_path: 'logs/admin-scripts/2026/01/run-1.log' },
      { run_id: 2, log_path: 'logs/admin-scripts/archive/run-2.log' },
      { run_id: 3, log_path: '../../bad.log' },
      { run_id: 4, log_path: null }
    ]);
    dbModule.runQuery.mockResolvedValue({ changes: 3 });
    unlinkSpy.mockResolvedValue();

    const result = await cleanupOldAdminRunRows(30);

    expect(dbModule.runQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM admin_script_runs'),
      [expect.any(String)]
    );
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).toHaveBeenCalledWith(
      path.join(PROJECT_ROOT, 'logs/admin-scripts/2026/01/run-1.log')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping stale run log path outside project',
      expect.objectContaining({
        runId: 3,
        logPath: '../../bad.log'
      })
    );
    expect(result).toEqual({
      deletedRows: 3,
      deletedRunLogFiles: 1
    });
  });

  test('cleanupOrphanRunLogFiles deletes only stale non-archived run logs', async () => {
    const staleLogPath = path.join(LOG_ROOT, '2026', '01', 'run-1.log');
    const recentLogPath = path.join(LOG_ROOT, '2026', '01', 'run-2.log');
    const archiveLogPath = path.join(LOG_ROOT, 'archive', 'run-3.log');
    const ignoredPath = path.join(LOG_ROOT, '2026', '01', 'notes.txt');

    readdirSpy
      .mockResolvedValueOnce([
        { name: '2026', isDirectory: () => true, isFile: () => false },
        { name: 'archive', isDirectory: () => true, isFile: () => false }
      ])
      .mockResolvedValueOnce([
        { name: '01', isDirectory: () => true, isFile: () => false }
      ])
      .mockResolvedValueOnce([
        { name: 'run-1.log', isDirectory: () => false, isFile: () => true },
        { name: 'run-2.log', isDirectory: () => false, isFile: () => true },
        { name: 'notes.txt', isDirectory: () => false, isFile: () => true }
      ])
      .mockResolvedValueOnce([
        { name: 'run-3.log', isDirectory: () => false, isFile: () => true }
      ]);

    const staleTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const recentTime = Date.now() - 5 * 24 * 60 * 60 * 1000;
    statSpy.mockImplementation(async (targetPath) => {
      if (targetPath === staleLogPath) {
        return { mtimeMs: staleTime };
      }
      if (targetPath === recentLogPath) {
        return { mtimeMs: recentTime };
      }
      if (targetPath === archiveLogPath) {
        return { mtimeMs: staleTime };
      }
      if (targetPath === ignoredPath) {
        return { mtimeMs: staleTime };
      }
      throw new Error(`Unexpected stat path: ${targetPath}`);
    });
    unlinkSpy.mockResolvedValue();

    const result = await cleanupOrphanRunLogFiles(30);

    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).toHaveBeenCalledWith(staleLogPath);
    expect(result).toEqual({ deletedOrphanFiles: 1 });
  });

  test('runCleanup combines row cleanup, orphan cleanup, and incremental vacuum', async () => {
    const staleLogPath = path.join(PROJECT_ROOT, 'logs/admin-scripts/2026/01/run-1.log');

    dbModule.getOne.mockResolvedValue({ exists: 1 });
    dbModule.getQuery.mockResolvedValue([
      { run_id: 1, log_path: 'logs/admin-scripts/2026/01/run-1.log' }
    ]);
    dbModule.runQuery
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({});

    readdirSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    unlinkSpy.mockResolvedValue();

    const result = await runCleanup(30);

    expect(unlinkSpy).toHaveBeenCalledWith(staleLogPath);
    expect(dbModule.runQuery).toHaveBeenLastCalledWith('PRAGMA incremental_vacuum');
    expect(result).toEqual({
      deletedRows: 1,
      deletedRunLogFiles: 1,
      deletedOrphanFiles: 0,
      retentionDays: 30
    });
  });

  test('runVacuum issues SQLite VACUUM', async () => {
    dbModule.runQuery.mockResolvedValue({});

    await expect(runVacuum()).resolves.toEqual({ vacuumed: true });
    expect(dbModule.runQuery).toHaveBeenCalledWith('VACUUM');
  });

  test('main writes cleanup result JSON for cleanup mode', async () => {
    process.argv = ['node', 'db-maintenance.js', '--mode=cleanup', '--retention-days=14'];
    dbModule.getOne.mockResolvedValue(null);
    readdirSpy.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    dbModule.runQuery.mockResolvedValue({});

    await main();

    expect(dbModule.runQuery).toHaveBeenLastCalledWith('PRAGMA incremental_vacuum');
    expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify({
      deletedRows: 0,
      deletedRunLogFiles: 0,
      deletedOrphanFiles: 0,
      retentionDays: 14
    }));
    expect(logger.info).toHaveBeenCalledWith(
      'DB maintenance cleanup completed',
      expect.objectContaining({
        deletedRows: 0,
        deletedRunLogFiles: 0,
        deletedOrphanFiles: 0,
        retentionDays: 14
      })
    );
  });

  test('main writes vacuum result JSON for vacuum mode', async () => {
    process.argv = ['node', 'db-maintenance.js', '--mode=vacuum'];
    dbModule.runQuery.mockResolvedValue({});

    await main();

    expect(dbModule.runQuery).toHaveBeenCalledWith('VACUUM');
    expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify({ vacuumed: true }));
    expect(logger.info).toHaveBeenCalledWith('DB maintenance vacuum completed', { vacuumed: true });
  });

  test('main rejects unsupported modes before performing work', async () => {
    process.argv = ['node', 'db-maintenance.js', '--mode=invalid'];

    await expect(main()).rejects.toThrow('Unsupported mode: invalid');
    expect(dbModule.runQuery).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test('closeDbConnection resolves after db.close callback', async () => {
    await expect(closeDbConnection()).resolves.toBeUndefined();
    expect(dbModule.db.close).toHaveBeenCalled();
  });
});
