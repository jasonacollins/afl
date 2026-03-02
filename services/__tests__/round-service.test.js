
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
  FINALS_WEEK_1_LABEL,
  FINALS_WEEK_1_ROUNDS,
  FINALS_WEEK_2_LABEL,
  FINALS_WEEK_2_ROUNDS,
  WILDCARD_FINALS_LABEL,
  WILDCARD_ROUND_LABEL,
  ROUND_ORDER,
  ROUND_ORDER_SQL,
  getRoundsForYear,
  getRoundDisplayName,
  normalizeRoundForDisplay,
  expandRoundSelection,
  combineRoundsForDisplay
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

    test('should return wildcard finals label unchanged', () => {
      expect(getRoundDisplayName('Wildcard Finals')).toBe('Wildcard Finals');
      expect(getRoundDisplayName('Wildcard Round')).toBe('Wildcard Finals');
    });

    test('should return year-aware label for grouped finals round', () => {
      expect(getRoundDisplayName('Finals Week 1', 2025)).toBe('Finals Week 1');
      expect(getRoundDisplayName('Finals Week 2', 2026)).toBe('Finals Week 2');
      expect(getRoundDisplayName('Finals Week 2', 2025)).toBe('Finals Week 1');
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

    test('should inject wildcard finals row for 2026+ when finals exist', async () => {
      const mockRounds = [
        { round_number: '24' },
        { round_number: 'Elimination Final' },
        { round_number: 'Qualifying Final' },
        { round_number: 'Semi Final' }
      ];
      getQuery.mockResolvedValue(mockRounds);

      const result = await getRoundsForYear(2026);

      expect(result).toEqual([
        { round_number: '24' },
        { round_number: 'Wildcard Finals' },
        { round_number: 'Elimination Final' },
        { round_number: 'Qualifying Final' },
        { round_number: 'Semi Final' }
      ]);
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
      expect(ROUND_ORDER['Wildcard Finals']).toBe(100);
      expect(ROUND_ORDER['Wildcard Round']).toBe(100);
      expect(ROUND_ORDER['Grand Final']).toBe(105);
    });

    test('Finals week and wildcard constants should be exported correctly', () => {
      expect(FINALS_WEEK_1_LABEL).toBe('Finals Week 1');
      expect(FINALS_WEEK_2_LABEL).toBe('Finals Week 2');
      expect(FINALS_WEEK_1_ROUNDS).toEqual(['Elimination Final', 'Qualifying Final']);
      expect(FINALS_WEEK_2_ROUNDS).toEqual(['Elimination Final', 'Qualifying Final']);
      expect(WILDCARD_FINALS_LABEL).toBe('Wildcard Finals');
      expect(WILDCARD_ROUND_LABEL).toBe('Wildcard Finals');
    });

    test('ROUND_ORDER_SQL should be a non-empty string', () => {
      expect(typeof ROUND_ORDER_SQL).toBe('string');
      expect(ROUND_ORDER_SQL.length).toBeGreaterThan(0);
      expect(ROUND_ORDER_SQL).toContain('CASE');
    });
  });

  describe('finals week round helpers', () => {
    test('normalizeRoundForDisplay should map finals week rounds using season year', () => {
      expect(normalizeRoundForDisplay('Elimination Final', 2025)).toBe('Finals Week 1');
      expect(normalizeRoundForDisplay('Qualifying Final', 2025)).toBe('Finals Week 1');
      expect(normalizeRoundForDisplay('Elimination Final', 2026)).toBe('Finals Week 2');
      expect(normalizeRoundForDisplay('Qualifying Final', 2026)).toBe('Finals Week 2');
      expect(normalizeRoundForDisplay('Finals Week 2', 2025)).toBe('Finals Week 1');
      expect(normalizeRoundForDisplay('Wildcard Round')).toBe('Wildcard Finals');
      expect(normalizeRoundForDisplay('Wildcard Finals')).toBe('Wildcard Finals');
      expect(normalizeRoundForDisplay('Semi Final')).toBe('Semi Final');
    });

    test('expandRoundSelection should expand finals week and wildcard selections', () => {
      expect(expandRoundSelection(FINALS_WEEK_1_LABEL)).toEqual(FINALS_WEEK_1_ROUNDS);
      expect(expandRoundSelection('Finals Week 1')).toEqual(FINALS_WEEK_1_ROUNDS);
      expect(expandRoundSelection('Elimination Final')).toEqual(FINALS_WEEK_1_ROUNDS);
      expect(expandRoundSelection('Wildcard Finals')).toEqual(['Wildcard Finals', 'Wildcard Round']);
      expect(expandRoundSelection('Wildcard Round')).toEqual(['Wildcard Finals', 'Wildcard Round']);
      expect(expandRoundSelection('Semi Final')).toEqual(['Semi Final']);
    });

    test('combineRoundsForDisplay should merge elimination and qualifying finals for 2026+', () => {
      const rounds = [
        { round_number: '24', isCompleted: true },
        { round_number: 'Wildcard Finals', isCompleted: true },
        { round_number: 'Elimination Final', isCompleted: true },
        { round_number: 'Qualifying Final', isCompleted: false },
        { round_number: 'Semi Final', isCompleted: false }
      ];

      const result = combineRoundsForDisplay(rounds, 2026);

      expect(result).toEqual([
        { round_number: '24', isCompleted: true, source_round_numbers: ['24'] },
        { round_number: 'Wildcard Finals', isCompleted: true, source_round_numbers: ['Wildcard Finals', 'Wildcard Round'], isSynthetic: false },
        {
          round_number: FINALS_WEEK_2_LABEL,
          isCompleted: false,
          source_round_numbers: FINALS_WEEK_1_ROUNDS
        },
        { round_number: 'Semi Final', isCompleted: false, source_round_numbers: ['Semi Final'] }
      ]);
    });

    test('combineRoundsForDisplay should use Finals Week 1 before wildcard era', () => {
      const rounds = [
        { round_number: '24', isCompleted: true },
        { round_number: 'Elimination Final', isCompleted: true },
        { round_number: 'Qualifying Final', isCompleted: false },
        { round_number: 'Semi Final', isCompleted: false }
      ];

      const result = combineRoundsForDisplay(rounds, 2025);

      expect(result).toEqual([
        { round_number: '24', isCompleted: true, source_round_numbers: ['24'] },
        {
          round_number: FINALS_WEEK_1_LABEL,
          isCompleted: false,
          source_round_numbers: FINALS_WEEK_1_ROUNDS
        },
        { round_number: 'Semi Final', isCompleted: false, source_round_numbers: ['Semi Final'] }
      ]);
    });
  });
});
