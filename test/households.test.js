// Phase 6a — Multi-DB foundation: system.db schema/seed, the household
// manifest's path helpers, and independent migrate+seed of two household DBs
// side by side. No routing/auth here — that's Phase 6b.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate, SYSTEM_MIGRATIONS_DIR } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { verify } = require('../seed/verify');
const { HOUSEHOLDS, householdDbPath, systemDbPath } = require('../src/db/households');

function tmpDbPath(name) {
  return path.join(os.tmpdir(), `kp-households-test-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

test('households manifest: householdDbPath/systemDbPath resolve to distinct, correctly-named paths under KITCHEN_DATA_DIR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-households-manifest-'));
  const prevDataDir = process.env.KITCHEN_DATA_DIR;
  process.env.KITCHEN_DATA_DIR = dir;
  try {
    delete require.cache[require.resolve('../src/db/households')];
    const { householdDbPath: freshHouseholdDbPath, systemDbPath: freshSystemDbPath, HOUSEHOLDS: freshHouseholds } = require('../src/db/households');
    assert.deepEqual(freshHouseholds, ['rp', 'ps']);
    assert.equal(freshHouseholdDbPath('rp'), path.join(dir, 'rp.db'));
    assert.equal(freshHouseholdDbPath('ps'), path.join(dir, 'ps.db'));
    assert.equal(freshSystemDbPath(), path.join(dir, 'system.db'));
    assert.throws(() => freshHouseholdDbPath('unknown'), /Unknown household/);
  } finally {
    if (prevDataDir === undefined) delete process.env.KITCHEN_DATA_DIR;
    else process.env.KITCHEN_DATA_DIR = prevDataDir;
    delete require.cache[require.resolve('../src/db/households')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('system.db: migrations-system/001_init.sql applies cleanly and seeds exactly PK/RP/PS with the right household mapping', () => {
  const p = tmpDbPath('system');
  try {
    const db = openDb(p);
    const applied = migrate(db, SYSTEM_MIGRATIONS_DIR);
    assert.deepEqual(applied, ['001_init.sql']);

    const users = db.prepare('SELECT email, display_name, household, is_admin FROM users ORDER BY id').all();
    assert.equal(users.length, 3);

    const pk = users.find((u) => u.display_name === 'PK');
    assert.equal(pk.household, null);
    assert.equal(pk.is_admin, 1);

    const rp = users.find((u) => u.display_name === 'RP');
    assert.equal(rp.household, 'rp');
    assert.equal(rp.is_admin, 0);

    const ps = users.find((u) => u.display_name === 'PS');
    assert.equal(ps.household, 'ps');
    assert.equal(ps.is_admin, 0);

    db.close();
  } finally {
    cleanup(p);
  }
});

test('system.db: re-running migrate() against SYSTEM_MIGRATIONS_DIR is idempotent (no duplicate users)', () => {
  const p = tmpDbPath('system-idempotent');
  try {
    const db = openDb(p);
    migrate(db, SYSTEM_MIGRATIONS_DIR);
    const second = migrate(db, SYSTEM_MIGRATIONS_DIR);
    assert.deepEqual(second, []);
    const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    assert.equal(count, 3);
    db.close();
  } finally {
    cleanup(p);
  }
});

test('system.db: household CHECK constraint rejects anything other than rp/ps/NULL', () => {
  const p = tmpDbPath('system-check');
  try {
    const db = openDb(p);
    migrate(db, SYSTEM_MIGRATIONS_DIR);
    assert.throws(() => {
      db.prepare("INSERT INTO users (email, display_name, household) VALUES ('x@example.com', 'X', 'other')").run();
    }, /CHECK constraint failed/);
    db.close();
  } finally {
    cleanup(p);
  }
});

test('two household DBs migrate and seed independently, each verifying clean at the expected 18/78/199 counts', () => {
  const rpPath = tmpDbPath('rp');
  const psPath = tmpDbPath('ps');
  try {
    const rpDb = openDb(rpPath);
    seed(rpDb);
    const psDb = openDb(psPath);
    seed(psDb);

    assert.deepEqual(verify(rpDb), [], 'rp.db must verify clean against the taxonomy JSON');
    assert.deepEqual(verify(psDb), [], 'ps.db must verify clean against the taxonomy JSON');

    for (const db of [rpDb, psDb]) {
      const classCount = db.prepare("SELECT COUNT(*) c FROM dish_families WHERE parent_id IS NULL AND origin='seed'").get().c;
      const itemCount = db.prepare("SELECT COUNT(*) c FROM dish_items WHERE origin='seed'").get().c;
      const ingredientCount = db.prepare("SELECT COUNT(*) c FROM ingredients WHERE origin='seed'").get().c;
      assert.equal(classCount, 18);
      assert.equal(itemCount, 199);
      assert.equal(ingredientCount, 78);
    }

    // ps.db starts clean of household-specific data (no plans/knowledge_events),
    // proving the two DBs are genuinely independent, not aliases of one file.
    rpDb.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES ('2026-07-20', 'morning', (SELECT id FROM dish_items LIMIT 1), 0)").run();
    const rpPlanCount = rpDb.prepare('SELECT COUNT(*) c FROM plans').get().c;
    const psPlanCount = psDb.prepare('SELECT COUNT(*) c FROM plans').get().c;
    assert.equal(rpPlanCount, 1);
    assert.equal(psPlanCount, 0, 'writing a plan into rp.db must not appear in ps.db');

    rpDb.close();
    psDb.close();
  } finally {
    cleanup(rpPath);
    cleanup(psPath);
  }
});
