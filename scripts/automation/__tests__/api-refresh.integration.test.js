const fs = require('fs').promises;
const os = require('os');
const path = require('path');

function loadModules(dbPath) {
  let loaded;

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

    loaded = {
      dbModule: require('../../../models/db'),
      apiRefresh: require('../api-refresh')
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
      1, 'Marvel Stadium', 'Melbourne', 'VIC',
      9, 'MCG', 'Melbourne', 'VIC'
    ]
  );
}

describe('api-refresh SQLite integration', () => {
  let tempDir;
  let loaded;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'afl-api-refresh-'));
    loaded = loadModules(path.join(tempDir, 'integration.db'));
    await seedBaseData(loaded.dbModule);
  });

  afterEach(async () => {
    loaded.apiRefresh.__testables.resetFetchImplementationForTests();
    await unloadDbModule(loaded.dbModule);
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('refreshAPIData updates existing fixtures and completed scores in SQLite', async () => {
    await loaded.dbModule.runQuery(
      `INSERT INTO matches (
        match_id, match_number, round_number, match_date, venue,
        home_team_id, away_team_id, year, complete, venue_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [10, 38510, '2', '2026-04-04T05:20:00Z', 'Marvel Stadium', 1, 3, 2026, 0, 1]
    );

    loaded.apiRefresh.__testables.setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        games: [
          {
            id: 38510,
            date: '2026-04-05T05:20:00Z',
            venue: 'MCG',
            hteamid: 1,
            ateamid: 2,
            complete: 100,
            hscore: 91,
            ascore: 84,
            hgoals: 13,
            hbehinds: 13,
            agoals: 12,
            abehinds: 12
          }
        ]
      })
    }));

    const result = await loaded.apiRefresh.refreshAPIData(2026, { source: 'integration-test' });
    const updated = await loaded.dbModule.getOne(
      `SELECT match_date, venue, venue_id, home_team_id, away_team_id,
              hscore, ascore, hgoals, hbehinds, agoals, abehinds, complete
       FROM matches
       WHERE match_number = ?`,
      [38510]
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      updateCount: 1,
      scoresUpdated: 1,
      updatedMatchNumbers: [38510],
      updatedCompletedMatchNumbers: [38510]
    }));
    expect(updated).toEqual({
      match_date: '2026-04-05T05:20:00Z',
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

  test('refreshAPIData remains update-only and does not insert missing fixtures', async () => {
    loaded.apiRefresh.__testables.setFetchImplementationForTests(jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        games: [
          {
            id: 99999,
            date: '2026-04-12T05:20:00Z',
            venue: 'MCG',
            hteamid: 1,
            ateamid: 2,
            complete: 100,
            hscore: 88,
            ascore: 72
          }
        ]
      })
    }));

    const result = await loaded.apiRefresh.refreshAPIData(2026);
    const rows = await loaded.dbModule.getQuery(
      'SELECT match_number, hscore, ascore FROM matches WHERE match_number = ?',
      [99999]
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      updateCount: 0,
      scoresUpdated: 0
    }));
    expect(rows).toHaveLength(0);
  });
});
