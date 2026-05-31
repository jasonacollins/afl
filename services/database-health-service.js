const dbModule = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

const DUPLICATE_PREDICTIONS_QUERY = `
  SELECT
    COUNT(*) AS duplicate_pairs,
    COALESCE(SUM(extra_rows), 0) AS duplicate_rows
  FROM (
    SELECT COUNT(*) - 1 AS extra_rows
    FROM predictions NOT INDEXED
    GROUP BY match_id, predictor_id
    HAVING COUNT(*) > 1
  )
`;

function getFirstColumnValue(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const values = Object.values(row);
  return values.length > 0 ? values[0] : null;
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : 0;
}

async function getDatabaseHealth(dbApi = dbModule) {
  const integrityRow = await dbApi.getOne('PRAGMA integrity_check(1)');
  const integrity = getFirstColumnValue(integrityRow);
  const duplicateRow = await dbApi.getOne(DUPLICATE_PREDICTIONS_QUERY);

  return {
    integrity,
    duplicatePairs: toInteger(duplicateRow?.duplicate_pairs),
    duplicateRows: toInteger(duplicateRow?.duplicate_rows)
  };
}

async function assertDatabaseHealthy(options = {}) {
  const {
    context = 'database operation',
    dbApi = dbModule
  } = options;

  const health = await getDatabaseHealth(dbApi);

  if (health.integrity !== 'ok') {
    logger.error('Database integrity check failed', {
      context,
      integrity: health.integrity
    });
    throw new AppError(
      `Database integrity check failed before ${context}: ${health.integrity || 'no result'}`,
      500,
      'DATABASE_HEALTH_ERROR'
    );
  }

  if (health.duplicatePairs > 0) {
    logger.error('Prediction uniqueness check failed', {
      context,
      duplicatePairs: health.duplicatePairs,
      duplicateRows: health.duplicateRows
    });
    throw new AppError(
      `Prediction uniqueness check failed before ${context}: ${health.duplicatePairs} duplicate match/predictor pairs`,
      500,
      'DATABASE_HEALTH_ERROR'
    );
  }

  return health;
}

module.exports = {
  assertDatabaseHealthy,
  DUPLICATE_PREDICTIONS_QUERY,
  getDatabaseHealth
};
