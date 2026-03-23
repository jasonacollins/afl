jest.mock('../../models/db', () => ({
  getOne: jest.fn(),
  getQuery: jest.fn(),
  runQuery: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../scripts/automation/api-refresh', () => ({
  refreshAPIData: jest.fn()
}));

jest.mock('../../scripts/automation/elo-predictions', () => ({
  runEloPredictions: jest.fn()
}));

jest.mock('../../scripts/automation/daily-sync', () => ({
  runPostResultRecompute: jest.fn(),
  regenerateSeasonSimulation: jest.fn(),
  regenerateEloHistory: jest.fn(),
  evaluateSimulationSnapshotState: jest.fn(),
  hasMatchDataChanges: jest.fn(),
  hasCompletedResultChanges: jest.fn()
}));

const resultUpdateService = require('../result-update-service');

describe('result-update-service test helpers', () => {
  const { isSqliteBusyError, toNullableInteger } = resultUpdateService.__testables;

  test('detects transient SQLite lock errors', () => {
    expect(isSqliteBusyError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('database is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('some other failure'))).toBe(false);
  });

  test('normalizes nullable integers', () => {
    expect(toNullableInteger(undefined)).toBeNull();
    expect(toNullableInteger(null)).toBeNull();
    expect(toNullableInteger('')).toBeNull();
    expect(toNullableInteger('42')).toBe(42);
    expect(toNullableInteger('not-a-number')).toBeNull();
  });
});
