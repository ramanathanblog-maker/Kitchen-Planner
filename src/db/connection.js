const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

function openDb(dbPath) {
  const resolved = dbPath || path.join(__dirname, '..', '..', 'data', 'kitchen.db');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { openDb };
