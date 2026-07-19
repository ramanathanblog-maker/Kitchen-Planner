const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const SYSTEM_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations-system');

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function listMigrationFiles(migrationsDir = MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// migrationsDir defaults to the household-schema migrations/ dir; Phase 6a's
// system.db passes SYSTEM_MIGRATIONS_DIR (migrations-system/) instead, reusing
// this same runner/schema_migrations bookkeeping rather than a second engine.
function migrate(db, migrationsDir = MIGRATIONS_DIR) {
  ensureMigrationsTable(db);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const files = listMigrationFiles(migrationsDir);
  const results = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
    });
    run();
    results.push(file);
  }
  return results;
}

function currentVersion(db) {
  ensureMigrationsTable(db);
  const row = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
    .get();
  return row ? row.version : null;
}

if (require.main === module) {
  const db = openDb();
  const applied = migrate(db);
  console.log(`Applied ${applied.length} migration(s):`, applied);
  db.close();
}

module.exports = { migrate, currentVersion, ensureMigrationsTable, listMigrationFiles, MIGRATIONS_DIR, SYSTEM_MIGRATIONS_DIR };
