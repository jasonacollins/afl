const sqlite3 = require('sqlite3').verbose();
const { runMigrations } = require('../migration-runner');

function openDatabase() {
  return new sqlite3.Database(':memory:');
}

function buildDatabaseApi(database) {
  return {
    runQuery(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function onRun(error) {
          if (error) {
            reject(error);
            return;
          }
          resolve(this);
        });
      });
    },
    getQuery(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(rows);
        });
      });
    },
    getOne(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(row);
        });
      });
    }
  };
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('migration-runner', () => {
  test('applies pending migrations once and records them', async () => {
    const database = openDatabase();
    const databaseApi = buildDatabaseApi(database);
    let appliedCount = 0;

    try {
      const migrations = [
        {
          id: '001-create-example',
          up: async (db) => {
            appliedCount += 1;
            await db.runQuery('CREATE TABLE example_items (id INTEGER PRIMARY KEY, name TEXT)');
          }
        }
      ];

      await runMigrations(databaseApi, migrations);
      await runMigrations(databaseApi, migrations);

      const migrationRows = await databaseApi.getQuery('SELECT id FROM schema_migrations ORDER BY id');
      const exampleTable = await databaseApi.getOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        ['example_items']
      );

      expect(appliedCount).toBe(1);
      expect(migrationRows).toEqual([{ id: '001-create-example' }]);
      expect(exampleTable).toEqual({ name: 'example_items' });
    } finally {
      await closeDatabase(database);
    }
  });
});
