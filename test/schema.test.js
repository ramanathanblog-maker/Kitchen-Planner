const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');

function tmpDb() {
  const p = path.join(__dirname, `tmp-schema-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(p);
  return { db, p };
}

function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

test('migration applies cleanly and re-run is a no-op', () => {
  const { db, p } = tmpDb();
  try {
    const first = migrate(db);
    assert.deepEqual(first, [
      '001_init.sql',
      '002_special_day_flags.sql',
      '003_taxonomy_v14.sql',
      '004_api_support.sql',
      '005_undo_source.sql',
      '006_meal_patterns.sql',
    ]);
    const second = migrate(db);
    assert.deepEqual(second, []);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes('dish_families'));
    assert.ok(tables.includes('knowledge_events'));
  } finally {
    db.close();
    cleanup(p);
  }
});

test('CHECK constraints reject bad values', () => {
  const { db, p } = tmpDb();
  try {
    migrate(db);
    assert.throws(() => {
      db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES ('2026-01-01', 'brunch', 1)").run();
    }, /CHECK constraint failed/);
    assert.throws(() => {
      db.prepare(
        "INSERT INTO ingredient_family_rules (ingredient_id, family_id, verdict) VALUES (1, 1, 'maybe')"
      ).run();
    }, /CHECK constraint failed/);
    assert.throws(() => {
      db.prepare("INSERT INTO ingredients (name_en, category) VALUES ('x', 'meat')").run();
    }, /CHECK constraint failed/);
  } finally {
    db.close();
    cleanup(p);
  }
});
