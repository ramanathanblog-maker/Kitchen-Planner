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
      '007_actual_meals_unique.sql',
      '008_night_pattern.sql',
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

// Regression (Audit 2026-07-18, code #8 / migration 007): actual_meals used to
// have no uniqueness guard on (date, slot, dish_item_id) at all, so a
// double-tap / retry could insert the same dish twice for the same slot, which
// then skewed the engine's repeat-gap history.
test('actual_meals rejects a duplicate (date, slot, dish_item_id) via its unique index', () => {
  const { db, p } = tmpDb();
  try {
    migrate(db);
    const famId = db.prepare("INSERT INTO dish_families (name_en, slot_fit) VALUES ('Test Family', '[\"morning\"]')").run().lastInsertRowid;
    const dishId = db.prepare('INSERT INTO dish_items (family_id, name_en) VALUES (?, ?)').run(famId, 'Test Dish').lastInsertRowid;

    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-01', 'morning', ?)").run(dishId);
    assert.throws(() => {
      db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-01', 'morning', ?)").run(dishId);
    }, /UNIQUE constraint failed/);

    // A different slot or date for the same dish is unaffected.
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-01', 'noon', ?)").run(dishId);
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-02', 'morning', ?)").run(dishId);
    const count = db.prepare('SELECT COUNT(*) c FROM actual_meals').get().c;
    assert.equal(count, 3);
  } finally {
    db.close();
    cleanup(p);
  }
});

// Migration 007 dedupes any pre-existing duplicate rows before creating the
// unique index — this proves that path against a DB seeded (via raw INSERT,
// migrations table hand-marked as already-applied through 006) with a
// duplicate that predates the migration, then migrated forward.
test('migration 007 dedupes pre-existing duplicate actual_meals rows (keeping the lowest id) before enforcing uniqueness', () => {
  const { db, p } = tmpDb();
  try {
    const { listMigrationFiles, ensureMigrationsTable } = require('../src/db/migrate');
    const fsMod = require('node:fs');
    const pathMod = require('node:path');
    ensureMigrationsTable(db);
    const files = listMigrationFiles().filter((f) => f !== '007_actual_meals_unique.sql');
    for (const file of files) {
      const sql = fsMod.readFileSync(pathMod.join(__dirname, '..', 'migrations', file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
      })();
    }

    const famId = db.prepare("INSERT INTO dish_families (name_en, slot_fit) VALUES ('Test Family', '[\"morning\"]')").run().lastInsertRowid;
    const dishId = db.prepare('INSERT INTO dish_items (family_id, name_en) VALUES (?, ?)').run(famId, 'Test Dish').lastInsertRowid;
    // Two duplicate rows for the same (date, slot, dish_item_id), predating 007.
    const firstId = db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-01', 'morning', ?)").run(dishId).lastInsertRowid;
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-01', 'morning', ?)").run(dishId);

    const applied = migrate(db);
    assert.deepEqual(applied, ['007_actual_meals_unique.sql']);

    const rows = db.prepare('SELECT id FROM actual_meals').all();
    assert.equal(rows.length, 1, 'the duplicate must be removed by the migration');
    assert.equal(rows[0].id, firstId, 'the lowest-id (earliest-logged) row must survive');

    // Uniqueness is now enforced going forward.
    assert.throws(() => {
      db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES ('2026-01-01', 'morning', ?)").run(dishId);
    }, /UNIQUE constraint failed/);
  } finally {
    db.close();
    cleanup(p);
  }
});
