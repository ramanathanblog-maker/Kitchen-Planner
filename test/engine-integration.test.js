const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { seed } = require('../seed/load');
const { buildContext } = require('../src/engine/context');
const { evaluate } = require('../src/engine/evaluate');
const { rank } = require('../src/engine/rank');
const { zeroLeadsWarning } = require('../src/engine/slotComposition');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-engine-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

function byExternalId(db, externalId) {
  return db.prepare('SELECT * FROM dish_items WHERE external_id = ?').get(externalId);
}

function addDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('integration: onion sambar dish-specific 20-day rule fires on day 15 even though ingredient+form default (14) would allow it (seeded soft -> warn)', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    const onionSambar = byExternalId(db, 'dish_011'); // vengaya_sambar
    assert.ok(onionSambar);

    const lastServed = '2026-07-01';
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(lastServed, onionSambar.id);

    const evalDate = addDate(lastServed, 15); // 2026-07-16
    const ctx = buildContext(db, { dishItemId: onionSambar.id, date: evalDate, slot: 'morning' });
    const result = evaluate(ctx);

    assert.equal(result.status, 'warn');
    assert.ok(result.findings.some((f) => f.step === 'repeat_gap' && f.severity === 'warn' && /20/.test(f.message)));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('integration: onion sambar is allowed again once 20 full days have passed', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const onionSambar = byExternalId(db, 'dish_011');
    const lastServed = '2026-07-01';
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(lastServed, onionSambar.id);

    const evalDate = addDate(lastServed, 20);
    const ctx = buildContext(db, { dishItemId: onionSambar.id, date: evalDate, slot: 'morning' });
    const result = evaluate(ctx);

    assert.notEqual(result.status, 'blocked');
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('integration: drumstick (Murungakkai) is never allowed in Kari', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const murungakkai = db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_001'").get();
    const carrotKari = byExternalId(db, 'dish_025'); // carrot_kari
    db.prepare(
      "INSERT INTO dish_item_ingredients (dish_item_id, ingredient_id, role) VALUES (?, ?, 'support')"
    ).run(carrotKari.id, murungakkai.id);

    const ctx = buildContext(db, { dishItemId: carrotKari.id, date: '2026-07-16', slot: 'morning' });
    const result = evaluate(ctx);

    assert.equal(result.status, 'blocked');
    assert.ok(result.findings.some((f) => f.step === 'ingredient_suitability' && f.severity === 'block'));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('integration: mor kuzhambu this morning prefers adai at noon', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const morKuzhambu = byExternalId(db, 'dish_002'); // morkuzhambu_vendaikkai
    const adai = db.prepare("SELECT * FROM dish_items WHERE name_en = 'Plain Adai'").get();
    const date = '2026-07-16';
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(date, morKuzhambu.id);

    const ctx = buildContext(db, { dishItemId: adai.id, date, slot: 'noon' });
    const result = evaluate(ctx);

    assert.notEqual(result.status, 'blocked');
    assert.ok(result.findings.some((f) => f.step === 'directional_compatibility' && f.severity === 'info'));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('integration: 10-day actual-meal history, suggestion snapshot for day 11', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    const carrotKari = byExternalId(db, 'dish_025');
    const cabbageKari = byExternalId(db, 'dish_028');
    const beansKari = byExternalId(db, 'dish_026');

    const startDate = '2026-07-01';
    db.prepare("INSERT INTO actual_meals (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(startDate, carrotKari.id);

    const day11 = addDate(startDate, 10);

    // A lead dish (kari items are dry_side, never leads) is already planned for the
    // slot, so the meal_composition step doesn't fire and this snapshot isolates the
    // repeat-gap distinction it's meant to test.
    const leadDish = byExternalId(db, 'dish_002'); // morkuzhambu_vendaikkai
    db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(day11, leadDish.id);

    const candidates = [carrotKari, cabbageKari, beansKari];
    const ranked = rank(db, { date: day11, slot: 'morning', dishItemIds: candidates.map((c) => c.id) });

    const carrotResult = ranked.find((r) => r.dishItemId === carrotKari.id);
    const cabbageResult = ranked.find((r) => r.dishItemId === cabbageKari.id);

    assert.equal(carrotResult.status, 'warn');
    assert.equal(cabbageResult.status, 'allowed');
    assert.ok(ranked.indexOf(cabbageResult) <= ranked.indexOf(carrotResult));

    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('integration (amavasai): no onion/garlic-flagged item is suggested for an amavasai date', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    const typeInfo = db
      .prepare('INSERT INTO special_day_types (name, restricts_onion, restricts_garlic) VALUES (?, 1, 1)')
      .run('Amavasai');
    const date = '2026-07-16';
    db.prepare('INSERT INTO special_day_dates (date, special_day_type_id) VALUES (?, ?)').run(date, typeInfo.lastInsertRowid);

    const onionDish = byExternalId(db, 'dish_011'); // vengaya_sambar, onion_flag=1
    const garlicDish = byExternalId(db, 'dish_166'); // poondu_kozhambu, garlic_flag=1
    const cleanDish = byExternalId(db, 'dish_002'); // morkuzhambu_vendaikkai, no flags

    for (const dish of [onionDish, garlicDish]) {
      const ctx = buildContext(db, { dishItemId: dish.id, date, slot: 'morning' });
      const result = evaluate(ctx);
      assert.equal(result.status, 'blocked', `${dish.name_en} must be blocked on an amavasai date`);
    }

    const cleanCtx = buildContext(db, { dishItemId: cleanDish.id, date, slot: 'morning' });
    const cleanResult = evaluate(cleanCtx);
    assert.notEqual(cleanResult.status, 'blocked');

    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('meal composition: milagu rasam alone (can_lead=1) satisfies the lead requirement', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const milaguRasam = byExternalId(db, 'dish_176');
    const ctx = buildContext(db, { dishItemId: milaguRasam.id, date: '2026-07-16', slot: 'morning' });
    const result = evaluate(ctx);
    assert.ok(!result.findings.some((f) => f.step === 'meal_composition'));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('meal composition: paruppu rasam alone (secondary_gravy, can_lead=0) does not satisfy the lead requirement — but this is a slot-level fact, not a per-dish finding', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const paruppuRasam = byExternalId(db, 'dish_174');
    const date = '2026-07-16';
    db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(date, paruppuRasam.id);

    const ctx = buildContext(db, { dishItemId: paruppuRasam.id, date, slot: 'morning' });
    const result = evaluate(ctx);
    assert.ok(
      !result.findings.some((f) => f.step === 'meal_composition'),
      'zero-leads must never appear in a per-dish findings array (it fired identically for every non-lead candidate before this fix)'
    );

    const warning = zeroLeadsWarning(db, { date, slot: 'morning' });
    assert.ok(warning, 'the slot itself has zero leads planned');
    assert.match(warning.message, /No sambar\/kozhambu/);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('meal composition: variety rice (standalone) alone satisfies the lead requirement', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const lemonRice = byExternalId(db, 'dish_070');
    const ctx = buildContext(db, { dishItemId: lemonRice.id, date: '2026-07-16', slot: 'morning' });
    const result = evaluate(ctx);
    assert.ok(!result.findings.some((f) => f.step === 'meal_composition'));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('meal composition: thogayal (condiment, can_lead=1) alone satisfies the lead requirement', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const paruppuThogayal = byExternalId(db, 'dish_060');
    const ctx = buildContext(db, { dishItemId: paruppuThogayal.id, date: '2026-07-16', slot: 'morning' });
    const result = evaluate(ctx);
    assert.ok(!result.findings.some((f) => f.step === 'meal_composition'));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('meal composition: sambar + kozhambu planned for the same morning warns and names both', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const vengayaSambar = byExternalId(db, 'dish_011');
    const morKuzhambu = byExternalId(db, 'dish_002');
    const date = '2026-07-16';
    db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(date, vengayaSambar.id);

    const ctx = buildContext(db, { dishItemId: morKuzhambu.id, date, slot: 'morning' });
    const result = evaluate(ctx);

    const finding = result.findings.find((f) => f.step === 'meal_composition');
    assert.ok(finding, 'expected a multiple-leads finding');
    assert.equal(finding.severity, 'warn');
    assert.match(finding.message, /Vengaya Sambar/);
    assert.match(finding.message, /Morkuzhambu Vendaikkai/);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('meal composition: toggling can_lead off for milagu rasam changes the slot-level verdict (reads data, not code)', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const milaguRasam = byExternalId(db, 'dish_176');
    const date = '2026-07-16';

    db.prepare('UPDATE dish_items SET can_lead = 0 WHERE id = ?').run(milaguRasam.id);
    db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(date, milaguRasam.id);

    const ctx = buildContext(db, { dishItemId: milaguRasam.id, date, slot: 'morning' });
    const result = evaluate(ctx);
    assert.ok(!result.findings.some((f) => f.step === 'meal_composition'));

    const warning = zeroLeadsWarning(db, { date, slot: 'morning' });
    assert.ok(warning);
    assert.match(warning.message, /No sambar\/kozhambu/);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('zeroLeadsWarning: nothing planned for an enforced slot -> a warning, independent of any specific candidate', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const warning = zeroLeadsWarning(db, { date: '2099-01-01', slot: 'morning' });
    assert.ok(warning);
    assert.match(warning.message, /No sambar\/kozhambu/);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('zeroLeadsWarning: a lead dish already planned -> null', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const vengayaSambar = byExternalId(db, 'dish_011');
    const date = '2026-07-16';
    db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(date, vengayaSambar.id);
    assert.equal(zeroLeadsWarning(db, { date, slot: 'morning' }), null);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('zeroLeadsWarning: a non-enforced slot never warns, regardless of what is planned', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    assert.equal(zeroLeadsWarning(db, { date: '2099-01-01', slot: 'noon' }), null);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});
