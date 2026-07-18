// Phase 4b Amendment §3/§9: meal_patterns settings block seeds correctly, and
// reordering/relabelling/changing max in the settings row changes what the reader
// (and, downstream, the wizard hub view) produces with zero code changes — the
// same data-driven proof pattern as meal_composition_lead_roles / can_lead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { getMealPatterns, getSlotPattern } = require('../src/data/mealPatterns');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-meal-patterns-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

test('meal_patterns settings row seeds via migration with the amendment §3 shape', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    migrate(db);
    const patterns = getMealPatterns(db);

    assert.ok(Array.isArray(patterns.morning.rows));
    assert.equal(patterns.morning.rows.length, 9);
    assert.deepEqual(
      patterns.morning.rows.map((r) => r.role),
      ['main_gravy', 'secondary_gravy', 'semi_solid_side', 'dry_side', 'salad', 'condiment', 'condiment', 'crisp_side', 'standalone']
    );
    assert.equal(patterns.morning.rows[3].max, 2, 'kari max is 2');
    assert.equal(patterns.morning.rows[0].max, 1, 'gravy max is 1');
    const thogayalRow = patterns.morning.rows.find((r) => r.label === 'Thogayal');
    assert.equal(thogayalRow.filter_class, 'thogayal');
    const pachadiRow = patterns.morning.rows.find((r) => r.label === 'Pachadi');
    assert.equal(pachadiRow.filter_class, 'pachadi');
    const varietyRice = patterns.morning.rows.find((r) => r.role === 'standalone');
    assert.equal(varietyRice.collapses_pattern, true);
    assert.deepEqual(varietyRice.collapsed_allows, ['secondary_gravy', 'semi_solid_side', 'crisp_side']);

    assert.equal(patterns.noon.rows.length, 4);
    const sideGravy = patterns.noon.rows.find((r) => r.role === 'tiffin_side');
    assert.equal(sideGravy.offer_morning_carryover, true);
    const noonChutneyRow = patterns.noon.rows.find((r) => r.label === 'Chutney');
    assert.ok(noonChutneyRow, 'noon has a Chutney row');
    assert.equal(noonChutneyRow.filter_class, 'chutney', 'noon condiment row must filter on chutney (taxonomy v1.6), not thogayal — thogayal is morning/night only');

    // Migration 008 (Audit 2026-07-18, UX #1): night is no longer an empty
    // dead end — a minimal interim free-pick pattern, explicitly provisional.
    assert.ok(patterns.night.rows.length > 0);
    assert.match(patterns.night.note, /interim|provisional/i);

    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('migration 009 fixes an already-deployed noon condiment row (filter_class "thogayal" -> "chutney"), and is idempotent', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    migrate(db);

    // Simulate a DB that shipped before 009 existed: hand-roll the row back
    // to its old broken shape, as if only up through 006 had ever applied.
    const broken = getMealPatterns(db);
    const brokenRow = broken.noon.rows.find((r) => r.role === 'condiment');
    brokenRow.filter_class = 'thogayal';
    brokenRow.label = 'Chutney / Thogayal';
    db.prepare("UPDATE settings SET value = ? WHERE key = 'meal_patterns'").run(JSON.stringify(broken));
    db.prepare("DELETE FROM schema_migrations WHERE version = '009_noon_chutney_fix.sql'").run();

    const before = getSlotPattern(db, 'noon');
    const beforeRow = before.rows.find((r) => r.role === 'condiment');
    assert.equal(beforeRow.filter_class, 'thogayal', 'sanity: row is broken before 009 runs');

    const applied = migrate(db);
    assert.ok(applied.includes('009_noon_chutney_fix.sql'));

    const after = getSlotPattern(db, 'noon');
    const afterRow = after.rows.find((r) => r.role === 'condiment');
    assert.equal(afterRow.filter_class, 'chutney', '009 corrects filter_class');
    assert.equal(afterRow.label, 'Chutney', '009 corrects the label');
    // other noon rows must be untouched
    assert.equal(after.rows.length, 4);
    assert.equal(after.rows.find((r) => r.role === 'tiffin_side').offer_morning_carryover, true);

    // idempotent: re-running migrate() (a no-op, since 009 is now recorded
    // applied) leaves the corrected value exactly as-is.
    migrate(db);
    const afterAgain = getSlotPattern(db, 'noon');
    assert.deepEqual(afterAgain, after);

    // idempotent at the SQL level too: re-executing 009's statement directly
    // against an already-correct row (bypassing schema_migrations) must be a
    // no-op, not an error and not a further mutation.
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '009_noon_chutney_fix.sql'), 'utf8');
    db.exec(sql);
    const afterRawRerun = getSlotPattern(db, 'noon');
    assert.deepEqual(afterRawRerun, after);

    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('re-running migrate() does not duplicate the meal_patterns settings row', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    migrate(db);
    migrate(db); // idempotent: schema_migrations already records 006, no-op
    const count = db.prepare("SELECT COUNT(*) c FROM settings WHERE key = 'meal_patterns'").get().c;
    assert.equal(count, 1);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('data-driven proof: reordering, relabelling, and changing max in the settings row changes reader output with zero code changes', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    migrate(db);

    const before = getSlotPattern(db, 'morning');
    assert.equal(before.rows[0].role, 'main_gravy');
    assert.equal(before.rows[0].label, 'Gravy');
    assert.equal(before.rows[3].max, 2);

    // Simulate an admin edit: reverse row order, relabel Gravy, cap Kari at 1.
    const edited = JSON.parse(JSON.stringify(before));
    edited.rows.reverse();
    const gravyRow = edited.rows.find((r) => r.role === 'main_gravy');
    gravyRow.label = 'Main Gravy';
    const kariRow = edited.rows.find((r) => r.role === 'dry_side');
    kariRow.max = 1;

    const full = getMealPatterns(db);
    full.morning = edited;
    db.prepare("UPDATE settings SET value = ? WHERE key = 'meal_patterns'").run(JSON.stringify(full));

    const after = getSlotPattern(db, 'morning');
    assert.equal(after.rows[0].role, 'standalone', 'row order reversed — reader reflects it with no code change');
    assert.equal(after.rows.find((r) => r.role === 'main_gravy').label, 'Main Gravy');
    assert.equal(after.rows.find((r) => r.role === 'dry_side').max, 1, 'kari cap lowered to 1');

    db.close();
  } finally {
    cleanup(dbPath);
  }
});
