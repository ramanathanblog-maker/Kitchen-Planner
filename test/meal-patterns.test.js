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

    // Migration 008 (Audit 2026-07-18, UX #1): night is no longer an empty
    // dead end — a minimal interim free-pick pattern, explicitly provisional.
    assert.ok(patterns.night.rows.length > 0);
    assert.match(patterns.night.note, /interim|provisional/i);

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
