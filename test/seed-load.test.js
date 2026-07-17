const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { seed } = require('../seed/load.js');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-seed-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

const TAXONOMY_PATH = path.join(__dirname, '..', 'seed', 'taxonomy-comprehensive.json');

function tmpJsonPath() {
  return path.join(os.tmpdir(), `kp-taxonomy-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

test('seed loader is idempotent: counts stable across two runs', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const before = {
      families: db.prepare("SELECT COUNT(*) c FROM dish_families WHERE origin='seed'").get().c,
      items: db.prepare("SELECT COUNT(*) c FROM dish_items WHERE origin='seed'").get().c,
      ingredients: db.prepare("SELECT COUNT(*) c FROM ingredients WHERE origin='seed'").get().c,
    };
    seed(db);
    const after = {
      families: db.prepare("SELECT COUNT(*) c FROM dish_families WHERE origin='seed'").get().c,
      items: db.prepare("SELECT COUNT(*) c FROM dish_items WHERE origin='seed'").get().c,
      ingredients: db.prepare("SELECT COUNT(*) c FROM ingredients WHERE origin='seed'").get().c,
    };
    assert.deepEqual(after, before);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('taxonomy v1.5 counts: 17 classes, 73 ingredients, 191 items', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const classCount = db.prepare("SELECT COUNT(*) c FROM dish_families WHERE parent_id IS NULL AND origin='seed'").get().c;
    const itemCount = db.prepare("SELECT COUNT(*) c FROM dish_items WHERE origin='seed'").get().c;
    const ingredientCount = db.prepare("SELECT COUNT(*) c FROM ingredients WHERE origin='seed'").get().c;
    assert.equal(classCount, 17);
    assert.equal(itemCount, 191);
    assert.equal(ingredientCount, 73);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('Groundnut normalization: aliases + allergy flag + widened category', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const row = db.prepare("SELECT * FROM ingredients WHERE name_en = 'Groundnut'").get();
    assert.ok(row);
    assert.equal(row.allergy_flag, 1);
    assert.equal(row.category, 'pulse_nut');
    const aliases = JSON.parse(row.aliases);
    assert.ok(aliases.includes('peanut'));
    assert.ok(aliases.includes('kadalai'));
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('vathakozhambu is a family under kozhambu; dish_001 external_id retained after restructure', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const row = db
      .prepare(
        `SELECT di.external_id, df.name_en family, parent.name_en class
         FROM dish_items di JOIN dish_families df ON di.family_id = df.id
         JOIN dish_families parent ON df.parent_id = parent.id
         WHERE di.external_id = 'dish_001'`
      )
      .get();
    assert.ok(row);
    assert.equal(row.family, 'Vathakozhambu');
    assert.equal(row.class, 'Kozhambu');
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('onion/garlic flags come from the JSON, not a false default', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const poondu = db.prepare("SELECT garlic_flag FROM dish_items WHERE external_id = 'dish_166'").get();
    assert.equal(poondu.garlic_flag, 1);
    const idichaVengayaRasam = db.prepare("SELECT onion_flag FROM dish_items WHERE external_id = 'dish_182'").get();
    assert.equal(idichaVengayaRasam.onion_flag, 1);
    const vengayaVadaam = db.prepare("SELECT onion_flag FROM dish_items WHERE external_id = 'dish_191'").get();
    assert.equal(vengayaVadaam.onion_flag, 1);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sbm and child_bento_box are seeded as placeholders', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const sbm = db.prepare("SELECT * FROM dish_items WHERE external_id = 'dish_142'").get();
    assert.equal(sbm.is_placeholder, 1);
    const bento = db.prepare("SELECT * FROM dish_items WHERE external_id = 'dish_162'").get();
    assert.equal(bento.is_placeholder, 1);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('interview rules seed rules only (items are canonical JSON entries now)', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    const onionRule = db
      .prepare(
        `SELECT drr.* FROM dish_repeat_rules drr JOIN dish_items di ON drr.dish_item_id = di.id
         WHERE di.external_id = 'dish_011'`
      )
      .get();
    assert.equal(onionRule.min_gap_days, 20);
    assert.equal(onionRule.severity, 'soft');

    const drumstickRule = db
      .prepare(
        `SELECT ifr.* FROM ingredient_family_rules ifr
         JOIN ingredients i ON ifr.ingredient_id = i.id
         JOIN dish_families df ON ifr.family_id = df.id
         WHERE i.external_id = 'veg_001' AND df.external_id = 'fam_006_001'`
      )
      .get();
    assert.equal(drumstickRule.verdict, 'never');

    const compatRule = db
      .prepare(
        `SELECT dcr.* FROM dish_compatibility_rules dcr
         JOIN dish_families src ON dcr.source_family_id = src.id
         JOIN dish_families tgt ON dcr.target_family_id = tgt.id
         WHERE src.external_id = 'fam_002_001' AND tgt.external_id = 'subfam_014_007'`
      )
      .get();
    assert.equal(compatRule.preference, 'prefers');
    assert.equal(compatRule.direction, 'morning_to_noon');
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('scope defaults to household on all three rule tables', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    for (const table of ['ingredient_family_rules', 'dish_repeat_rules', 'dish_compatibility_rules']) {
      const rows = db.prepare(`SELECT DISTINCT scope FROM ${table}`).all();
      for (const r of rows) assert.equal(r.scope, 'household');
    }
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('re-seed upserts seed-origin rows and never touches user-origin rows', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    const kariFamily = db.prepare("SELECT * FROM dish_families WHERE external_id = 'fam_006_001'").get();
    db.prepare("UPDATE dish_families SET origin = 'user', notes = 'user edited this' WHERE id = ?").run(kariFamily.id);

    const userItemInfo = db
      .prepare("INSERT INTO dish_items (family_id, name_en, origin) VALUES (?, 'My Custom Kari', 'user')")
      .run(kariFamily.id);

    seed(db);

    const kariAfter = db.prepare('SELECT * FROM dish_families WHERE id = ?').get(kariFamily.id);
    assert.equal(kariAfter.notes, 'user edited this', 'user-origin family row must not be overwritten by re-seed');

    const userItemAfter = db.prepare('SELECT * FROM dish_items WHERE id = ?').get(userItemInfo.lastInsertRowid);
    assert.ok(userItemAfter, 'user-origin item must survive re-seed');
    assert.equal(userItemAfter.name_en, 'My Custom Kari');

    const seedSibling = db
      .prepare("SELECT * FROM dish_items WHERE family_id = ? AND origin = 'seed' LIMIT 1")
      .get(kariFamily.id);
    assert.ok(seedSibling);

    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('upsert: renaming an item in the JSON (external_id stable) and re-seeding updates the row in place', () => {
  const dbPath = tmpDbPath();
  const jsonPath = tmpJsonPath();
  try {
    const db = openDb(dbPath);
    fs.copyFileSync(TAXONOMY_PATH, jsonPath);
    seed(db, jsonPath);

    const before = db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const item = json.dish_classes.flatMap((c) => c.items).find((it) => it.id === 'dish_001');
    item.name_en = 'murungakkai_vathakozhambu_renamed';
    fs.writeFileSync(jsonPath, JSON.stringify(json));

    seed(db, jsonPath);

    const after = db.prepare("SELECT id, name_en, origin FROM dish_items WHERE external_id = 'dish_001'").get();
    assert.equal(after.id, before.id, 'row id stable across rename (matched by external_id, not name)');
    assert.equal(after.name_en, 'Murungakkai Vathakozhambu Renamed');
    assert.equal(after.origin, 'seed');

    const totalItems = db.prepare("SELECT COUNT(*) c FROM dish_items WHERE origin='seed'").get().c;
    assert.equal(totalItems, 191, 'rename must not create a duplicate row');

    db.close();
  } finally {
    cleanup(dbPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  }
});

test('clearStaleSeedRows filters on origin=seed, not just external_id IS NULL: user rows with no external_id survive a full reseed', () => {
  // user-created rows never get an external_id (that's only assigned to JSON-sourced
  // seed rows), so external_id IS NULL is a permanent, legitimate state for them —
  // clearStaleSeedRows must never delete on that condition alone.
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);

    const kariFamily = db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();

    const userIngredient = db
      .prepare("INSERT INTO ingredients (name_en, origin) VALUES ('My Custom Ingredient', 'user')")
      .run();
    const userFamily = db
      .prepare("INSERT INTO dish_families (name_en, slot_fit, origin) VALUES ('My Custom Family', '[]', 'user')")
      .run();
    const userItem = db
      .prepare("INSERT INTO dish_items (family_id, name_en, origin) VALUES (?, 'My Custom Kari Item', 'user')")
      .run(kariFamily.id);

    seed(db);

    assert.ok(
      db.prepare('SELECT id FROM ingredients WHERE id = ?').get(userIngredient.lastInsertRowid),
      'user-origin ingredient with external_id NULL must survive reseed'
    );
    assert.ok(
      db.prepare('SELECT id FROM dish_families WHERE id = ?').get(userFamily.lastInsertRowid),
      'user-origin family with external_id NULL must survive reseed'
    );
    assert.ok(
      db.prepare('SELECT id FROM dish_items WHERE id = ?').get(userItem.lastInsertRowid),
      'user-origin item with external_id NULL must survive reseed'
    );

    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('49 items with no ingredient roles are mostly expected (plain dosai etc), but flags PK-review gaps', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db);
    const noRoleItems = db
      .prepare(
        `SELECT di.name_en FROM dish_items di
         WHERE di.origin='seed' AND NOT EXISTS (SELECT 1 FROM dish_item_ingredients dii WHERE dii.dish_item_id = di.id)`
      )
      .all()
      .map((r) => r.name_en);
    // Per amendment §6.7: aviyal, kosumalli, arachuvitta_sambar, paruppu_usili, lemon_rice,
    // veg_stew are likely gaps in the JSON itself (not a loader bug) — flagged for PK there.
    assert.ok(noRoleItems.length > 0);
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('taxonomy v1.5: retired family fam_004_003 (pitlai merge) is cleared when unreferenced', () => {
  const dbPath = tmpDbPath();
  try {
    const db = openDb(dbPath);
    seed(db); // current JSON already has fam_004_003 retired
    const row = db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_004_003'").get();
    assert.equal(row, undefined, 'retired family must be cleared from the seed rows');
    // dish_015/016 must have been reparented to fam_004_002, not orphaned or deleted
    const reparented = db
      .prepare(
        `SELECT di.external_id, df.external_id AS family_external_id
         FROM dish_items di JOIN dish_families df ON df.id = di.family_id
         WHERE di.external_id IN ('dish_015','dish_016')`
      )
      .all();
    assert.equal(reparented.length, 2);
    for (const r of reparented) assert.equal(r.family_external_id, 'fam_004_002');
    db.close();
  } finally {
    cleanup(dbPath);
  }
});

test('clearStaleSeedRows: a stale seed row with external_id removed-from-JSON but still referenced STOPs the loader', () => {
  const dbPath = tmpDbPath();
  const jsonPath = tmpJsonPath();
  try {
    const db = openDb(dbPath);
    // Seed once with the real (v1.5) taxonomy so schema + baseline data exist.
    seed(db, TAXONOMY_PATH);

    // Now simulate retiring a family that is still referenced: build a modified JSON
    // that drops one currently-present family (fam_006_001, kari) entirely (and its
    // items), then plant a dish_compatibility_rule referencing that family before
    // re-seeding with the modified JSON.
    const json = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
    const kariFamilyRow = db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    assert.ok(kariFamilyRow, 'fixture assumption: fam_006_001 exists in the current taxonomy');

    // Plant a reference that would be orphaned by removing the family.
    db.prepare(
      `INSERT INTO dish_compatibility_rules (source_family_id, target_family_id, direction, preference, rationale_tag, updated_by)
       VALUES (?, ?, 'morning_to_noon', 'prefers', 'other', 'test')`
    ).run(kariFamilyRow.id, kariFamilyRow.id);

    // Remove fam_006_001 (and any items under it) from the JSON to simulate retirement.
    for (const cls of json.dish_classes) {
      if (cls.families) cls.families = cls.families.filter((f) => f.id !== 'fam_006_001');
      if (cls.items) cls.items = cls.items.filter((it) => it.family_id !== 'fam_006_001');
    }
    fs.writeFileSync(jsonPath, JSON.stringify(json));

    assert.throws(
      () => seed(db, jsonPath),
      /fam_006_001/,
      'loader must STOP (throw) rather than silently delete a referenced stale family'
    );

    // The family and the rule must still be present — nothing was silently deleted.
    assert.ok(db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get());

    db.close();
  } finally {
    cleanup(dbPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  }
});
