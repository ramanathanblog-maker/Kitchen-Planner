const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { seed } = require('../seed/load');
const { verify } = require('../seed/verify');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-verify-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

test('verify reports zero divergence after a fresh seed (zero exemptions, per amendment)', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const findings = verify(db);
    assert.deepEqual(findings, []);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('verify catches a deliberately corrupted DB', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    // Delete a seed-origin item outright (simulating drift/corruption).
    const item = db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002' AND origin = 'seed'").get();
    db.prepare('DELETE FROM dish_item_ingredients WHERE dish_item_id = ?').run(item.id);
    db.prepare('DELETE FROM dish_items WHERE id = ?').run(item.id);

    // Insert a bogus seed-origin item with no JSON basis (no external_id).
    const kariFamily = db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    db.prepare("INSERT INTO dish_items (family_id, name_en, origin) VALUES (?, 'Bogus Corrupted Item', 'seed')").run(kariFamily.id);

    const findings = verify(db);
    const types = findings.map((f) => f.type);
    assert.ok(types.includes('missing_item'), 'should catch the deleted seed item');
    assert.ok(types.includes('extra_seed_item'), 'should catch the bogus extra seed item');
    db.close();
  } finally {
    cleanup(dbPath);
  }
});
