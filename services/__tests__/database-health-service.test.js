jest.mock('../../models/db', () => ({
  getOne: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    error: jest.fn()
  }
}));

const dbModule = require('../../models/db');
const databaseHealthService = require('../database-health-service');

describe('database-health-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('assertDatabaseHealthy passes for a healthy database', async () => {
    dbModule.getOne
      .mockResolvedValueOnce({ 'integrity_check(1)': 'ok' })
      .mockResolvedValueOnce({ duplicate_pairs: 0, duplicate_rows: 0 });

    await expect(
      databaseHealthService.assertDatabaseHealthy({ context: 'test write' })
    ).resolves.toEqual({
      integrity: 'ok',
      duplicatePairs: 0,
      duplicateRows: 0
    });
  });

  test('assertDatabaseHealthy fails when SQLite integrity check fails', async () => {
    dbModule.getOne
      .mockResolvedValueOnce({ 'integrity_check(1)': 'non-unique entry in index sqlite_autoindex_predictions_1' })
      .mockResolvedValueOnce({ duplicate_pairs: 0, duplicate_rows: 0 });

    await expect(
      databaseHealthService.assertDatabaseHealthy({ context: 'startup' })
    ).rejects.toMatchObject({
      message: expect.stringContaining('Database integrity check failed before startup'),
      errorCode: 'DATABASE_HEALTH_ERROR'
    });
  });

  test('assertDatabaseHealthy fails when duplicate prediction rows exist', async () => {
    dbModule.getOne
      .mockResolvedValueOnce({ 'integrity_check(1)': 'ok' })
      .mockResolvedValueOnce({ duplicate_pairs: 2, duplicate_rows: 3 });

    await expect(
      databaseHealthService.assertDatabaseHealthy({ context: 'saving prediction' })
    ).rejects.toMatchObject({
      message: 'Prediction uniqueness check failed before saving prediction: 2 duplicate match/predictor pairs',
      errorCode: 'DATABASE_HEALTH_ERROR'
    });
  });
});
