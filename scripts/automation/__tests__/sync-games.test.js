jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('../../../models/db', () => ({
  getQuery: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  initializeDatabase: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../../utils/squiggle-request', () => ({
  buildSquiggleQueryUrl: jest.fn((endpoint) => `https://api.test/${endpoint}`),
  getSquiggleRequestOptions: jest.fn(() => ({
    headers: {
      'User-Agent': 'AFL Predictions Test'
    }
  }))
}));

const syncGamesModule = require('../sync-games');
const fs = require('fs');
const {
  getOne,
  runQuery,
  initializeDatabase
} = require('../../../models/db');

const {
  resolveSquiggleTeamIds,
  resolveRoundNumber,
  resolveMatchDate,
  normalizeCompletion,
  normalizeScorePayload
} = syncGamesModule.__testables;

describe('sync-games normalization helpers', () => {
  test('maps TBA finals teams to placeholder ids', () => {
    expect(resolveSquiggleTeamIds({
      hteam: 'To be announced',
      ateam: 'TO BE ANNOUNCED'
    })).toEqual({
      homeTeamId: 99,
      awayTeamId: 99
    });
  });

  test('preserves explicit team ids when present', () => {
    expect(resolveSquiggleTeamIds({
      hteamid: 5,
      ateamid: 9,
      hteam: 'To be announced',
      ateam: 'To be announced'
    })).toEqual({
      homeTeamId: 5,
      awayTeamId: 9
    });
  });

  test('maps opening round and explicit finals labels correctly', () => {
    expect(resolveRoundNumber({ round: 0, roundname: 'Opening Round', is_final: 0 })).toBe('OR');
    expect(resolveRoundNumber({ round: 25, roundname: 'Wildcard Finals', is_final: 1 })).toBe('Wildcard Finals');
    expect(resolveRoundNumber({ round: 26, roundname: 'Qualifying Final', is_final: 3 })).toBe('Qualifying Final');
  });

  test('falls back to Squiggle finals numeric codes when round names are generic', () => {
    expect(resolveRoundNumber({ round: 25, roundname: 'Finals', is_final: 4 })).toBe('Semi Final');
    expect(resolveRoundNumber({ round: 28, roundname: 'Finals', is_final: 6 })).toBe('Grand Final');
  });

  test('keeps regular season rounds numeric when not finals', () => {
    expect(resolveRoundNumber({ round: 7, roundname: 'Round 7', is_final: 0 })).toBe('7');
  });

  test('resolves match date from unix time before date strings', () => {
    expect(resolveMatchDate({
      unixtime: 1772236800,
      date: '2020-01-01T00:00:00Z'
    })).toBe('2026-02-28T00:00:00.000Z');
    expect(resolveMatchDate({ date: '2026-03-20T09:30:00Z' })).toBe('2026-03-20T09:30:00.000Z');
    expect(resolveMatchDate({})).toBeNull();
  });

  test('normalizes invalid completion values to zero', () => {
    expect(normalizeCompletion(undefined)).toBe(0);
    expect(normalizeCompletion('abc')).toBe(0);
    expect(normalizeCompletion(101)).toBe(0);
    expect(normalizeCompletion('100')).toBe(100);
  });

  test('nulls future incomplete zero-zero placeholders', () => {
    const result = normalizeScorePayload(
      {
        hscore: 0,
        ascore: 0,
        hgoals: 0,
        hbehinds: 0,
        agoals: 0,
        abehinds: 0
      },
      '2099-03-20T09:30:00.000Z',
      0,
      new Date('2026-04-03T00:00:00.000Z')
    );

    expect(result).toEqual({
      homeScore: null,
      awayScore: null,
      homeGoals: null,
      homeBehinds: null,
      awayGoals: null,
      awayBehinds: null
    });
  });

  test('preserves completed scores even when they are zero', () => {
    const result = normalizeScorePayload(
      {
        hscore: 0,
        ascore: 0,
        hgoals: 0,
        hbehinds: 0,
        agoals: 0,
        abehinds: 0
      },
      '2026-03-20T09:30:00.000Z',
      100,
      new Date('2026-04-03T00:00:00.000Z')
    );

    expect(result).toEqual({
      homeScore: 0,
      awayScore: 0,
      homeGoals: null,
      homeBehinds: null,
      awayGoals: null,
      awayBehinds: null
    });
  });
});

describe('sync-games orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    initializeDatabase.mockResolvedValue();
  });

  test('syncTeams inserts new teams and updates renamed teams from cached API data', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('teams')) {
        return JSON.stringify({
          teams: [
            { id: 1, name: 'Cats' },
            { id: 2, name: 'Dogs' }
          ]
        });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    getOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ team_id: 2, name: 'Hounds' });
    runQuery.mockResolvedValue({ changes: 1 });

    await expect(syncGamesModule.syncTeams()).resolves.toBe(true);

    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO teams (team_id, name) VALUES (?, ?)',
      [1, 'Cats']
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE teams SET name = ? WHERE team_id = ?',
      ['Dogs', 2]
    );
  });

  test('syncGamesFromAPI inserts new completed matches and counts completed inserts', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.includes('teams')) {
        return JSON.stringify({ teams: [] });
      }
      if (normalizedPath.includes('games')) {
        return JSON.stringify({
          games: [
            {
              id: 101,
              round: 26,
              roundname: 'Qualifying Final',
              is_final: 3,
              unixtime: 1772236800,
              venue: 'MCG',
              hteamid: 1,
              ateamid: 2,
              hscore: 80,
              ascore: 70,
              hgoals: 12,
              hbehinds: 8,
              agoals: 10,
              abehinds: 10,
              year: 2026,
              complete: 100
            }
          ]
        });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    getOne
      .mockResolvedValueOnce({ venue_id: 7 })
      .mockResolvedValueOnce(null);
    runQuery.mockResolvedValue({ changes: 1 });

    const result = await syncGamesModule.syncGamesFromAPI({ year: 2026 });

    expect(initializeDatabase).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO matches'),
      expect.arrayContaining([
        101,
        'Qualifying Final',
        '2026-02-28T00:00:00.000Z',
        'MCG',
        7,
        1,
        2,
        80,
        70,
        12,
        8,
        10,
        10,
        2026,
        100
      ])
    );
    expect(result).toEqual({
      insertCount: 1,
      updateCount: 0,
      skipCount: 0,
      completedInsertCount: 1,
      completedUpdateCount: 0
    });
  });

  test('syncGamesFromAPI updates existing matches and counts newly completed results', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.includes('teams')) {
        return JSON.stringify({ teams: [] });
      }
      if (normalizedPath.includes('games')) {
        return JSON.stringify({
          games: [
            {
              id: 202,
              round: 1,
              roundname: 'Round 1',
              is_final: 0,
              date: '2026-03-20T09:30:00Z',
              venue: 'Marvel Stadium',
              hteamid: 3,
              ateamid: 4,
              hscore: 95,
              ascore: 81,
              hgoals: 14,
              hbehinds: 11,
              agoals: 12,
              abehinds: 9,
              year: 2026,
              complete: 100
            }
          ]
        });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    getOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        match_id: 55,
        complete: 0,
        hscore: null,
        ascore: null
      });
    runQuery.mockResolvedValue({ changes: 1 });

    const result = await syncGamesModule.syncGamesFromAPI({ year: 2026 });

    expect(runQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE matches'),
      expect.arrayContaining([
        '1',
        '2026-03-20T09:30:00.000Z',
        'Marvel Stadium',
        null,
        3,
        4,
        95,
        81,
        14,
        11,
        12,
        9,
        2026,
        100,
        55
      ])
    );
    expect(result).toEqual({
      insertCount: 0,
      updateCount: 1,
      skipCount: 0,
      completedInsertCount: 0,
      completedUpdateCount: 1
    });
  });
});
