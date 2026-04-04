jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn()
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
const nodeFetch = require('node-fetch').default;
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
  normalizeScorePayload,
  fetchAPI,
  resolveVenueId,
  resetDatabase,
  monitorLiveGames,
  main,
  setFetchImplementationForTests,
  resetFetchImplementationForTests
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

describe('sync-games fetchAPI cache behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nodeFetch.mockReset();
    resetFetchImplementationForTests();
  });

  test('returns fresh cached API data without making a network request', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    fs.readFileSync.mockReturnValue(JSON.stringify({ games: [{ id: 1 }] }));

    const data = await fetchAPI('games', { year: 2026 });

    expect(data).toEqual({ games: [{ id: 1 }] });
    expect(nodeFetch).not.toHaveBeenCalled();
  });

  test('falls back to expired cache when the network request fails', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: 0 });
    fs.readFileSync.mockReturnValue(JSON.stringify({ games: [{ id: 9 }] }));
    nodeFetch.mockRejectedValue(new Error('network down'));

    const data = await fetchAPI('games', { year: 2026 });

    expect(data).toEqual({ games: [{ id: 9 }] });
  });

  test('uses the injected fetch implementation for uncached successful requests', async () => {
    fs.existsSync.mockReturnValue(false);
    setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ games: [{ id: 5 }] })
    }));

    const data = await fetchAPI('games', { year: 2026 });

    expect(data).toEqual({ games: [{ id: 5 }] });
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ games: [{ id: 5 }] }));
  });

  test('rethrows fetch failures when no cache is available', async () => {
    fs.existsSync.mockReturnValue(false);
    setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Unavailable'
    }));

    await expect(fetchAPI('games', { year: 2026 })).rejects.toThrow('API request failed: 503 Unavailable');
  });
});

describe('sync-games venue resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolveVenueId returns null for blank values', async () => {
    await expect(resolveVenueId('')).resolves.toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  test('resolveVenueId returns the matched venue id', async () => {
    getOne.mockResolvedValue({ venue_id: 11 });

    await expect(resolveVenueId('MCG')).resolves.toBe(11);
    expect(getOne).toHaveBeenCalledWith(expect.stringContaining('SELECT venue_id'), ['MCG', 'MCG']);
  });
});

describe('sync-games orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nodeFetch.mockReset();
    resetFetchImplementationForTests();
    fs.existsSync.mockReturnValue(true);
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

  test('syncTeams returns false when the API payload does not contain a teams array', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ invalid: true }));

    await expect(syncGamesModule.syncTeams()).resolves.toBe(false);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test('syncGamesFromAPI returns zero counts for invalid game payloads', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('teams')) {
        return JSON.stringify({ teams: [] });
      }

      return JSON.stringify({ games: null });
    });

    await expect(syncGamesModule.syncGamesFromAPI({ year: 2026 })).resolves.toEqual({
      insertCount: 0,
      updateCount: 0,
      skipCount: 0,
      completedInsertCount: 0,
      completedUpdateCount: 0
    });
  });

  test('syncGamesFromAPI skips malformed games and continues processing later games', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.includes('teams')) {
        return JSON.stringify({ teams: [] });
      }
      if (normalizedPath.includes('games')) {
        return JSON.stringify({
          games: [
            {
              id: 301,
              round: 1,
              roundname: 'Round 1',
              is_final: 0,
              date: '2026-03-20T09:30:00Z',
              venue: 'Broken Venue',
              hteamid: 1,
              ateamid: 2,
              complete: 0
            },
            {
              id: 302,
              round: 2,
              roundname: 'Round 2',
              is_final: 0,
              date: '2026-03-27T09:30:00Z',
              venue: 'MCG',
              hteamid: 3,
              ateamid: 4,
              hscore: 70,
              ascore: 60,
              complete: 100
            }
          ]
        });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });

    getOne
      .mockRejectedValueOnce(new Error('venue lookup failed'))
      .mockResolvedValueOnce({ venue_id: 8 })
      .mockResolvedValueOnce(null);
    runQuery.mockResolvedValue({ changes: 1 });

    const result = await syncGamesModule.syncGamesFromAPI({ year: 2026 });

    expect(result).toEqual({
      insertCount: 1,
      updateCount: 0,
      skipCount: 1,
      completedInsertCount: 1,
      completedUpdateCount: 0
    });
    expect(runQuery).toHaveBeenCalledTimes(1);
  });
});

describe('sync-games maintenance and monitoring helpers', () => {
  let originalArgv;
  let originalExit;
  let originalSetTimeout;
  let originalProcessOn;

  beforeEach(() => {
    jest.clearAllMocks();
    nodeFetch.mockReset();
    resetFetchImplementationForTests();
    fs.existsSync.mockReturnValue(true);
    originalArgv = process.argv;
    originalExit = process.exit;
    originalSetTimeout = global.setTimeout;
    originalProcessOn = process.on;
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    initializeDatabase.mockResolvedValue();
    process.exit = jest.fn();
    process.on = jest.fn();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    global.setTimeout = originalSetTimeout;
    process.on = originalProcessOn;
  });

  test('resetDatabase clears dependent tables and re-syncs team data', async () => {
    global.setTimeout = jest.fn((callback) => {
      callback();
      return 0;
    });
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('teams')) {
        return JSON.stringify({
          teams: [{ id: 1, name: 'Cats' }]
        });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    getOne.mockResolvedValue(null);
    runQuery.mockResolvedValue({ changes: 1 });

    await expect(resetDatabase()).resolves.toBe(true);

    expect(runQuery).toHaveBeenNthCalledWith(1, 'DELETE FROM predictions');
    expect(runQuery).toHaveBeenNthCalledWith(2, 'DELETE FROM matches');
    expect(runQuery).toHaveBeenNthCalledWith(3, 'DELETE FROM teams');
    expect(runQuery).toHaveBeenNthCalledWith(
      4,
      'INSERT INTO teams (team_id, name) VALUES (?, ?)',
      [1, 'Cats']
    );
  });

  test('main clears cached Squiggle responses from disk', async () => {
    process.argv = ['node', 'sync-games.js', 'clear-cache'];
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['games.json', 'teams.json']);

    await main();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });

  test('main syncs the current year by default and exits successfully', async () => {
    process.argv = ['node', 'sync-games.js'];
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('teams')) {
        return JSON.stringify({ teams: [] });
      }
      return JSON.stringify({ games: [] });
    });

    await main();

    expect(initializeDatabase).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test('monitorLiveGames schedules the standard polling interval after a successful update', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.includes('teams')) {
        return JSON.stringify({ teams: [] });
      }
      if (normalizedPath.includes('games')) {
        return JSON.stringify({ games: [] });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    global.setTimeout = jest.fn();

    await monitorLiveGames('5');
    await new Promise((resolve) => setImmediate(resolve));

    expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 60000);
    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  test('monitorLiveGames backs off after sync failures', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('teams')) {
        return JSON.stringify({ teams: [] });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    global.setTimeout = jest.fn();

    await monitorLiveGames();
    await new Promise((resolve) => setImmediate(resolve));

    expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 72000);
  });

  test('monitorLiveGames exits cleanly when the SIGINT handler fires', async () => {
    fs.readFileSync.mockImplementation((filePath) => {
      const normalizedPath = String(filePath);
      if (normalizedPath.includes('teams')) {
        return JSON.stringify({ teams: [] });
      }
      if (normalizedPath.includes('games')) {
        return JSON.stringify({ games: [] });
      }

      throw new Error(`Unexpected cache read: ${filePath}`);
    });
    global.setTimeout = jest.fn();

    await monitorLiveGames();
    await new Promise((resolve) => setImmediate(resolve));

    const sigintHandler = process.on.mock.calls.find(([eventName]) => eventName === 'SIGINT')[1];
    sigintHandler();

    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
