const fs = require('fs').promises;
const path = require('path');
const { getOne, getQuery, runQuery, dbPath, db } = require('../../models/db');
const { logger } = require('../../utils/logger');

const PROJECT_ROOT = path.join(__dirname, '../..');
const LOG_ROOT = path.join(PROJECT_ROOT, 'logs', 'admin-scripts');
const DEFAULT_RETENTION_DAYS = 30;

function nowIso() {
  return new Date().toISOString();
}

function parseArguments(argv) {
  const parsed = {
    mode: 'cleanup',
    retentionDays: DEFAULT_RETENTION_DAYS
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--mode=')) {
      parsed.mode = String(arg.slice('--mode='.length)).trim().toLowerCase();
      return;
    }

    if (arg === '--vacuum') {
      parsed.mode = 'vacuum';
      return;
    }

    if (arg.startsWith('--retention-days=')) {
      const value = Number.parseInt(arg.slice('--retention-days='.length), 10);
      if (Number.isInteger(value) && value > 0) {
        parsed.retentionDays = value;
      }
    }
  });

  return parsed;
}

function ensurePathWithinProject(relativeOrAbsolutePath) {
  const absolutePath = path.resolve(PROJECT_ROOT, relativeOrAbsolutePath);
  const relativePath = path.relative(PROJECT_ROOT, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path resolves outside project root: ${relativeOrAbsolutePath}`);
  }
  return absolutePath;
}

async function tableExists(tableName) {
  const row = await getOne(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
    [tableName]
  );
  return !!row;
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function walkFiles(rootDir, collector = []) {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return collector;
    }
    throw error;
  }

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, collector);
      continue;
    }
    if (entry.isFile()) {
      collector.push(absolutePath);
    }
  }

  return collector;
}

async function cleanupOldAdminRunRows(retentionDays) {
  if (!(await tableExists('admin_script_runs'))) {
    return { deletedRows: 0, deletedRunLogFiles: 0 };
  }

  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const staleRuns = await getQuery(
    `SELECT run_id, log_path
     FROM admin_script_runs
     WHERE finished_at IS NOT NULL AND finished_at < ?`,
    [cutoffIso]
  );

  const deleteResult = await runQuery(
    `DELETE FROM admin_script_runs
     WHERE finished_at IS NOT NULL AND finished_at < ?`,
    [cutoffIso]
  );

  let deletedRunLogFiles = 0;
  for (const run of staleRuns) {
    if (!run.log_path) {
      continue;
    }

    let absolutePath;
    try {
      absolutePath = ensurePathWithinProject(run.log_path);
    } catch (error) {
      logger.warn('Skipping stale run log path outside project', {
        runId: run.run_id,
        logPath: run.log_path,
        error: error.message
      });
      continue;
    }

    if (absolutePath.includes(`${path.sep}archive${path.sep}`)) {
      continue;
    }

    if (await unlinkIfExists(absolutePath)) {
      deletedRunLogFiles += 1;
    }
  }

  return {
    deletedRows: deleteResult.changes || 0,
    deletedRunLogFiles
  };
}

async function cleanupOrphanRunLogFiles(retentionDays) {
  const cutoffEpoch = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const allFiles = await walkFiles(LOG_ROOT);
  let deletedOrphanFiles = 0;

  for (const filePath of allFiles) {
    const basename = path.basename(filePath);
    if (!/^run-\d+\.log$/.test(basename)) {
      continue;
    }
    if (filePath.includes(`${path.sep}archive${path.sep}`)) {
      continue;
    }

    const stats = await fs.stat(filePath);
    if (stats.mtimeMs >= cutoffEpoch) {
      continue;
    }

    if (await unlinkIfExists(filePath)) {
      deletedOrphanFiles += 1;
    }
  }

  return { deletedOrphanFiles };
}

async function runCleanup(retentionDays) {
  const runCleanupResults = await cleanupOldAdminRunRows(retentionDays);
  const orphanCleanupResults = await cleanupOrphanRunLogFiles(retentionDays);
  await runQuery('PRAGMA incremental_vacuum');

  return {
    ...runCleanupResults,
    ...orphanCleanupResults,
    retentionDays
  };
}

async function runVacuum() {
  await runQuery('VACUUM');
  return { vacuumed: true };
}

function closeDbConnection() {
  return new Promise((resolve) => {
    db.close(() => resolve());
  });
}

async function main() {
  const { mode, retentionDays } = parseArguments(process.argv.slice(2));

  if (!['cleanup', 'vacuum'].includes(mode)) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  logger.info('Starting DB maintenance task', {
    mode,
    retentionDays,
    dbPath,
    timestamp: nowIso()
  });

  if (mode === 'vacuum') {
    const result = await runVacuum();
    logger.info('DB maintenance vacuum completed', result);
    console.log(JSON.stringify(result));
    return;
  }

  const result = await runCleanup(retentionDays);
  logger.info('DB maintenance cleanup completed', result);
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main()
    .catch((error) => {
      logger.error('DB maintenance failed', {
        error: error.message,
        stack: error.stack
      });
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDbConnection();
    });
}

module.exports = {
  main,
  __testables: {
    DEFAULT_RETENTION_DAYS,
    LOG_ROOT,
    PROJECT_ROOT,
    nowIso,
    parseArguments,
    ensurePathWithinProject,
    tableExists,
    unlinkIfExists,
    walkFiles,
    cleanupOldAdminRunRows,
    cleanupOrphanRunLogFiles,
    runCleanup,
    runVacuum,
    closeDbConnection
  }
};
