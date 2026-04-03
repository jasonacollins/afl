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

  test('getMostRecentRoundWithResults returns null when no completed matches exist', async () => {
    getOne.mockResolvedValue(null);

    const result = await matchService.getMostRecentRoundWithResults();

    expect(result).toBeNull();
  });
});
