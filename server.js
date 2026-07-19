const { openDb } = require('./src/db/connection');
const { migrate, SYSTEM_MIGRATIONS_DIR } = require('./src/db/migrate');
const { seed } = require('./seed/load');
const { HOUSEHOLDS, householdDbPath, systemDbPath } = require('./src/db/households');
const { createApp } = require('./src/app');

const PORT = process.env.KITCHEN_PORT || 3010;

// Phase 6a: one DB per household, migrated and seeded from the manifest
// (seed() calls migrate() internally and only upserts seed-origin rows, so
// this is safe to run against rp.db's existing data on every boot — see
// seed/load.js's header comment). Plus system.db for cross-household user/
// login data — schema only in 6a, nothing reads it yet (starts in 6b).
const dbByHousehold = {};
for (const key of HOUSEHOLDS) {
  const db = openDb(householdDbPath(key));
  seed(db);
  dbByHousehold[key] = db;
}
const systemDb = openDb(systemDbPath());
migrate(systemDb, SYSTEM_MIGRATIONS_DIR);

const app = createApp(dbByHousehold);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kitchen Knowledge Planner listening on :${PORT}`);
  });
}

module.exports = { app, dbByHousehold, systemDb };
