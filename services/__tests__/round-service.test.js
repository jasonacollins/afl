
// Mock dependencies
jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../../utils/error-handler', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode, errorCode) {
      super(message);
      this.statusCode = statusCode;
      this.errorCode = errorCode;
    }
  },
}));

const { getQuery } = require('../../models/db');
const { AppError } = require('../../utils/error-handler');
const {
  ROUND_ORDER,
  ROUND_ORDER_SQL,
  getRoundsForYear,
  getRoundDisplayName,
} = require('../round-service');

describe('Round Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRoundDisplayName', () => {
    test('should return "Opening Round" for "OR"', () => {
      expect(getRoundDisplayName('OR')).toBe('Opening Round');
    });

    test('should return the round name for a known final', () => {
      expect(getRoundDisplayName('Grand Final')).toBe('Grand Final');
    });

    test('should return "Round X" for a numeric round number', () => {
      expect(getRoundDisplayName('15')).toBe('Round 15');
    });

    test('should handle string numbers', () => {
      expect(getRoundDisplayName('3')).toBe('Round 3');
    });
  });

  describe('getRoundsForYear', () => {
    test('should fetch and return rounds for a given year', async () => {
      const mockRounds = [{ round_number: '1' }, { round_number: '2' }];
      getQuery.mockResolvedValue(mockRounds);

      const year = 2024;
      const result = await getRoundsForYear(year);

      expect(getQuery).toHaveBeenCalledTimes(1);
      expect(getQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT round_number'),
        [year]
      );
      expect(result).toEqual(mockRounds);
    });

    test('should throw an AppError if the database query fails', async () => {
      const dbError = new Error('Database connection failed');
      getQuery.mockRejectedValue(dbError);

      const year = 2025;

      await expect(getRoundsForYear(year)).rejects.toThrow(AppError);
      await expect(getRoundsForYear(year)).rejects.toThrow('Failed to fetch rounds');
    });
  });

  describe('Constants', () => {
    test('ROUND_ORDER should be exported correctly', () => {
      expect(ROUND_ORDER).toBeDefined();
      expect(ROUND_ORDER['Grand Final']).toBe(104);
    });

    test('ROUND_ORDER_SQL should be a non-empty string', () => {
      expect(typeof ROUND_ORDER_SQL).toBe('string');
      expect(ROUND_ORDER_SQL.length).toBeGreaterThan(0);
      expect(ROUND_ORDER_SQL).toContain('CASE');
    });
  });
});
