jest.mock('../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../round-service', () => ({
  expandRoundSelection: jest.fn()
}));

const { getQuery, getOne } = require('../../models/db');
const roundService = require('../round-service');
const matchService = require('../match-service');

describe('match-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getMatchesByRoundSelectionAndYear returns an empty list when no rounds resolve', async () => {
    roundService.expandRoundSelection.mockReturnValue([]);

    const result = await matchService.getMatchesByRoundSelectionAndYear('Finals Week 2', 2026);

    expect(result).toEqual([]);
    expect(getQuery).not.toHaveBeenCalled();
  });

  test('getMatchesByRoundSelectionAndYear fetches matches using expanded round selections', async () => {
    roundService.expandRoundSelection.mockReturnValue(['Qualifying Final', 'Elimination Final']);
    getQuery.mockResolvedValue([{ match_id: 1 }]);

    const result = await matchService.getMatchesByRoundSelectionAndYear('Finals Week 2', 2026);

    expect(getQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE m.round_number IN (?, ?) AND m.year = ? ORDER BY m.match_date'),
      ['Qualifying Final', 'Elimination Final', 2026]
    );
    expect(result).toEqual([{ match_id: 1 }]);
  });

  test('getMatchesWithTeams converts database failures into AppError responses', async () => {
    getQuery.mockRejectedValue(new Error('database unavailable'));

    await expect(matchService.getMatchesWithTeams('WHERE m.year = ?', [2026])).rejects.toMatchObject({
      message: 'Failed to fetch matches',
      statusCode: 500,
      errorCode: 'DATABASE_ERROR'
    });
  });

  test('getCompletedMatchesForYear queries only completed scores for the selected year', async () => {
    getQuery.mockResolvedValue([{ match_id: 22 }]);

    const result = await matchService.getCompletedMatchesForYear(2025);

    expect(getQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL AND m.year = ? ORDER BY m.match_date DESC'),
      [2025]
    );
    expect(result).toEqual([{ match_id: 22 }]);
  });

  test('getCompletedMatchesForRoundSelection expands grouped rounds and keeps year first in params', async () => {
    roundService.expandRoundSelection.mockReturnValue(['Elimination Final', 'Qualifying Final']);
    getQuery.mockResolvedValue([{ match_id: 7 }]);

    const result = await matchService.getCompletedMatchesForRoundSelection(2026, 'Finals Week 2');

    expect(getQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL AND m.year = ? AND m.round_number IN (?, ?) ORDER BY m.match_date DESC'),
      [2026, 'Elimination Final', 'Qualifying Final']
    );
    expect(result).toEqual([{ match_id: 7 }]);
  });

  test('processMatchLockStatus marks past matches as locked and future matches as unlocked', () => {
    const results = matchService.processMatchLockStatus([
      { match_id: 1, match_date: '2000-01-01T00:00:00.000Z' },
      { match_id: 2, match_date: '2099-01-01T00:00:00.000Z' }
    ]);

    expect(results).toEqual([
      expect.objectContaining({ match_id: 1, isLocked: true }),
      expect.objectContaining({ match_id: 2, isLocked: false })
    ]);
  });

  test('processMatchLockStatus leaves invalid dates unlocked without throwing', () => {
    const results = matchService.processMatchLockStatus([
      { match_id: 3, match_date: 'not-a-date' },
      { match_id: 4, match_date: null }
    ]);

    expect(results).toEqual([
      expect.objectContaining({ match_id: 3, isLocked: false }),
      expect.objectContaining({ match_id: 4, isLocked: false })
    ]);
  });

  test('getMostRecentRoundWithResults returns null when no completed matches exist', async () => {
    getOne.mockResolvedValue(null);

    const result = await matchService.getMostRecentRoundWithResults();

    expect(result).toBeNull();
  });

  test('getMostRecentRoundWithResults maps the latest row into year and round fields', async () => {
    getOne.mockResolvedValue({ year: 2026, round_number: '4', latest_date: '2026-04-01' });

    const result = await matchService.getMostRecentRoundWithResults();

    expect(result).toEqual({ year: 2026, round: '4' });
  });

  test('getMostRecentRoundWithResults rethrows database failures', async () => {
    const error = new Error('db failed');
    getOne.mockRejectedValue(error);

    await expect(matchService.getMostRecentRoundWithResults()).rejects.toBe(error);
  });
});
