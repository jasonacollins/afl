function nowIso() {
  return new Date().toISOString();
}

async function ensureSchemaMigrationsTable(database) {
  await database.runQuery(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

function validateMigration(migration) {
  if (!migration || typeof migration.id !== 'string' || migration.id.trim() === '') {
    throw new Error('Migration id is required');
  }

  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${migration.id} must define an up function`);
  }
}

async function getAppliedMigrationIds(database) {
  const rows = await database.getQuery('SELECT id FROM schema_migrations ORDER BY id');
  return new Set(rows.map((row) => row.id));
}

async function runMigration(database, migration) {
  await database.runQuery('BEGIN TRANSACTION');

  try {
    await migration.up(database);
    await database.runQuery(
      'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
      [migration.id, nowIso()]
    );
    await database.runQuery('COMMIT');
  } catch (error) {
    await database.runQuery('ROLLBACK');
    throw error;
  }
}

async function runMigrations(database, migrations = []) {
  await ensureSchemaMigrationsTable(database);

  migrations.forEach(validateMigration);
  const appliedMigrationIds = await getAppliedMigrationIds(database);

  for (const migration of migrations) {
    if (appliedMigrationIds.has(migration.id)) {
      continue;
    }

    await runMigration(database, migration);
    appliedMigrationIds.add(migration.id);
  }
}

module.exports = {
  ensureSchemaMigrationsTable,
  runMigrations
};
