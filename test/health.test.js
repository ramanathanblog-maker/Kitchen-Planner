const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('placeholder: repo boots and migration runner is idempotent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-test-'));
  const dbPath = path.join(tmpDir, 'kitchen.db');
  const { openDb } = require('../src/db/connection');
  const { migrate, currentVersion } = require('../src/db/migrate');

  const db = openDb(dbPath);
  const firstRun = migrate(db);
  const secondRun = migrate(db);

  assert.deepEqual(secondRun, [], 'second run should apply no new migrations');
  assert.equal(typeof currentVersion, 'function');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
