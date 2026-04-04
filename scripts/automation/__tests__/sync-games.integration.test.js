const fs = require('fs').promises;
const os = require('os');
const path = require('path');

function loadModules(dbPath) {
  let loaded;
  const mockFetch = jest.fn();

  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;

    jest.doMock('../../../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    }));

    jest.doMock('bcrypt', () => ({
      hashSync: jest.fn(() => 'hashed'),
      compareSync: jest.fn(() => true)
    }));

    jest.doMock('node-fetch', () => ({
      __esModule: true,
      default: mockFetch
    }));

    jest.doMock('fs', () => {
      const actualFs = jest.requireActual('fs');

      return {
        ...actualFs,
        existsSync: jest.fn(() => false),
        mkdirSync: jest.fn(),
        statSync: jest.fn(),
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
        readdirSync: jest.fn(() => []),
        unlinkSync: jest.fn()
      };
    });

    loaded = {
      dbModule: require('../../../models/db'),
      syncGames: require('../sync-games'),
      mockFetch
    };
  });

  return loaded;
}

async function unloadDbModule(dbModule) {
  if (dbModule && dbModule.db) {
    await new Promise((resolve, reject) => {
      dbModule.db.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  jest.resetModules();
  delete process.env.DB_PATH;
}

async function seedBaseData(dbModule) {
  await dbModule.initializeDatabase();
  await dbModule.runQuery(
    `INSERT INTO teams (team_id, name, state)
     VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
    [
      1, 'Cats', 'VIC',
      2, 'Swans', 'NSW',
      3, 'Lions', 'QLD',
      4, 'Dockers', 'WA'
    ]
  );
  await dbModule.runQuery(
    `INSERT INTO venues (venue_id, name, city, state)
     VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    [
      5, 'SCG', 'Sydney', 'NSW',
      9, 'MCG', 'Melbourne', 'VIC'
    ]
  );
  await dbModule.runQuery(
    `INSERT INTO venue_aliases (alias_id, venue_id, alias_name)
     VALUES (?, ?, ?)`,
    [1, 5, 'Sydney Cricket Ground']
  );
}

function buildResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}

describe('sync-games SQLite integration', () => {
  let tempDir;
  let loaded;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-sync-games-'));
    loaded = loadModules(path.join(tempDir, 'integration.db'));
    await seedBaseData(loaded.dbModule);
  });

  afterEach(async () => {
    if (loaded && loaded.syncGames && loaded.syncGames.__testables) {
      loaded.syncGames.__testables.resetFetchImplementationForTests();
    }
    await unloadDbModule(loaded && loaded.dbModule);
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('syncGamesFromAPI inserts future fixtures with placeholder scores nulled and invalid completion normalized', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('teams')) {
        return buildResponse({
          teams: [
            { id: 1, name: 'Cats' },
            { id: 2, name: 'Swans' },
            { id: 3, name: 'Lions' },
            { id: 4, name: 'Dockers' }
          ]
        });
      }

      return buildResponse({
        games: [
          {
            id: 38520,
            round: 3,
            roundname: 'Round 3',
            date: '2099-04-20T09:30:00Z',
            venue: 'Sydney Cricket Ground',
            hteamid: 2,
            ateamid: 3,
            hscore: 0,
            ascore: 0,
            hgoals: 0,
            hbehinds: 0,
            agoals: 0,
            abehinds: 0,
            year: 2026,
            complete: 'unknown'
          }
        ]
      });
    });
    loaded.syncGames.__testables.setFetchImplementationForTests(fetchMock);

    const result = await loaded.syncGames.syncGamesFromAPI({ year: 2026 });
    const inserted = await loaded.dbModule.getOne(
      `SELECT round_number, venue, venue_id, home_team_id, away_team_id,
              hscore, ascore, hgoals, hbehinds, agoals, abehinds, year, complete
       FROM matches
       WHERE match_number = ?`,
      [38520]
    );

    expect(result).toEqual({
      insertCount: 1,
      updateCount: 0,
      skipCount: 0,
      completedInsertCount: 0,
      completedUpdateCount: 0
    });
    expect(inserted).toEqual({
      round_number: '3',
      venue: 'Sydney Cricket Ground',
      venue_id: 5,
      home_team_id: 2,
      away_team_id: 3,
      hscore: null,
      ascore: null,
      hgoals: null,
      hbehinds: null,
      agoals: null,
      abehinds: null,
      year: 2026,
      complete: 0
    });
  });

  test('syncGamesFromAPI updates existing matches and tracks newly completed results in SQLite', async () => {
    await loaded.dbModule.runQuery(
      `INSERT INTO matches (
        match_id, match_number, round_number, match_date, venue, venue_id,
        home_team_id, away_team_id, hscore, ascore, hgoals, hbehinds, agoals, abehinds, year, complete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [10, 38510, '1', '2026-03-20T09:30:00Z', 'SCG', 5, 2, 4, null, null, null, null, null, null, 2026, 0]
    );

    const fetchMock = jest.fn(async (url) => {
      if (url.includes('teams')) {
        return buildResponse({
          teams: [
            { id: 1, name: 'Cats' },
            { id: 2, name: 'Swans' },
            { id: 3, name: 'Lions' },
            { id: 4, name: 'Dockers' }
          ]
        });
      }

      return buildResponse({
        games: [
          {
            id: 38510,
            round: 2,
            roundname: 'Qualifying Final',
            is_final: 3,
            date: '2026-03-27T09:30:00Z',
            venue: 'MCG',
            hteamid: 1,
            ateamid: 2,
            hscore: 91,
            ascore: 84,
            hgoals: 13,
            hbehinds: 13,
            agoals: 12,
            abehinds: 12,
            year: 2026,
            complete: 100
          }
        ]
      });
    });
    loaded.syncGames.__testables.setFetchImplementationForTests(fetchMock);

    const result = await loaded.syncGames.syncGamesFromAPI({ year: 2026 });
    const updated = await loaded.dbModule.getOne(
      `SELECT round_number, match_date, venue, venue_id, home_team_id, away_team_id,
              hscore, ascore, hgoals, hbehinds, agoals, abehinds, complete
       FROM matches
       WHERE match_number = ?`,
      [38510]
    );

    expect(result).toEqual({
      insertCount: 0,
      updateCount: 1,
      skipCount: 0,
      completedInsertCount: 0,
      completedUpdateCount: 1
    });
    expect(updated).toEqual({
      round_number: 'Qualifying Final',
      match_date: '2026-03-27T09:30:00.000Z',
      venue: 'MCG',
      venue_id: 9,
      home_team_id: 1,
      away_team_id: 2,
      hscore: 91,
      ascore: 84,
      hgoals: 13,
      hbehinds: 13,
      agoals: 12,
      abehinds: 12,
      complete: 100
    });
  });
});
