// Re-reads /seed/taxonomy-comprehensive.json and the DB, reports any divergence
// (missing/extra/mismatched seed-origin rows). Prose docs are never consulted here —
// the JSON is the only input, per CLAUDE.md A1.
//
// Phase 1b Amendment (v1.4): comparison is keyed on external_id, not name — the JSON
// now carries its own stable ids. Zero divergence, zero exemptions (the old
// KNOWN_NON_JSON_ITEMS allowlist is gone: onion sambar and mor kuzhambu are now
// canonical JSON items, not hand-seeded rows).
const { openDb } = require('../src/db/connection');
const { loadJson, titleCase } = require('./load');

function expectedRows(dishClasses, vegetables) {
  const families = new Map(); // external_id -> name_en
  const items = new Map();
  const ingredients = new Map();

  for (const veg of vegetables) ingredients.set(veg.id, titleCase(veg.name_en));

  for (const cls of dishClasses) {
    families.set(cls.id, titleCase(cls.name_en));
    for (const fam of cls.families || []) families.set(fam.id, titleCase(fam.name_en));
    for (const subfam of cls.subfamilies || []) families.set(subfam.id, titleCase(subfam.name_en));
    for (const item of cls.items || []) items.set(item.id, titleCase(item.name_en));
  }

  return { families, items, ingredients };
}

function verify(db) {
  const { data } = loadJson();
  const findings = [];
  const expected = expectedRows(data.dish_classes, data.vegetables);

  const dbFamilies = new Map(
    db.prepare("SELECT external_id, name_en FROM dish_families WHERE origin = 'seed'").all().map((r) => [r.external_id, r.name_en])
  );
  const dbItems = new Map(
    db.prepare("SELECT external_id, name_en FROM dish_items WHERE origin = 'seed'").all().map((r) => [r.external_id, r.name_en])
  );
  const dbIngredients = new Map(
    db.prepare("SELECT external_id, name_en FROM ingredients WHERE origin = 'seed'").all().map((r) => [r.external_id, r.name_en])
  );

  const compare = (expectedMap, dbMap, label) => {
    for (const [externalId, name] of expectedMap) {
      if (!dbMap.has(externalId)) findings.push({ type: `missing_${label}`, external_id: externalId, name });
      else if (dbMap.get(externalId) !== name) {
        findings.push({ type: `name_mismatch_${label}`, external_id: externalId, expected: name, actual: dbMap.get(externalId) });
      }
    }
    for (const [externalId, name] of dbMap) {
      if (!expectedMap.has(externalId)) findings.push({ type: `extra_seed_${label}`, external_id: externalId, name });
    }
  };

  compare(expected.families, dbFamilies, 'family');
  compare(expected.items, dbItems, 'item');
  compare(expected.ingredients, dbIngredients, 'ingredient');

  return findings;
}

function summary(db) {
  const families = db
    .prepare(
      `SELECT df.name_en, df.parent_id, (SELECT COUNT(*) FROM dish_items di WHERE di.family_id = df.id) item_count
       FROM dish_families df ORDER BY df.parent_id IS NOT NULL, df.id`
    )
    .all();
  return families;
}

if (require.main === module) {
  const db = openDb();
  const findings = verify(db);
  if (process.argv.includes('--summary')) {
    console.log('Taxonomy summary (family — item count):');
    for (const f of summary(db)) {
      console.log(`  ${f.parent_id ? '  ' : ''}${f.name_en} — ${f.item_count} item(s)`);
    }
  }
  if (findings.length === 0) {
    console.log('No divergence found.');
  } else {
    console.log(`${findings.length} divergence(s) found:`);
    for (const f of findings) console.log(`  [${f.type}] ${f.external_id || ''} ${f.name || ''}`);
    process.exitCode = 1;
  }
  db.close();
}

module.exports = { verify, summary };
