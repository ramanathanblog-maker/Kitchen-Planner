// Phase 6a — explicit manifest of household DBs, not a filesystem glob. A stray
// *.db file dropped in data/ (e.g. a manual backup copy) must never be picked up
// as a household to migrate/seed; only the keys listed here are.
const path = require('node:path');

const HOUSEHOLDS = ['rp', 'ps'];

function dataDir() {
  return process.env.KITCHEN_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

function householdDbPath(key) {
  if (!HOUSEHOLDS.includes(key)) throw new Error(`Unknown household: ${key}`);
  return path.join(dataDir(), `${key}.db`);
}

function systemDbPath() {
  return path.join(dataDir(), 'system.db');
}

module.exports = { HOUSEHOLDS, dataDir, householdDbPath, systemDbPath };
