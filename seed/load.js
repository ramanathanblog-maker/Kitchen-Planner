// Parses /seed/taxonomy-comprehensive.json (the only input this loader reads — never
// prose docs, per CLAUDE.md A1) and populates dish_families / dish_items / ingredients /
// dish_item_ingredients / settings. Re-running upserts seed-origin rows and never
// touches user-origin rows.
//
// Phase 1b Amendment (v1.4): the JSON now carries its own stable ids (veg_NNN,
// dc_NNN, fam_NNN_NNN, subfam_NNN_NNN, dish_NNN) — external_id supersedes the old
// positional seed_index as the upsert identity key.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');

const JSON_PATH = path.join(__dirname, 'taxonomy-comprehensive.json');

function loadJson(jsonPath = JSON_PATH) {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  return { data: JSON.parse(raw), sha256, raw };
}

function upsertSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

// Seed-origin upsert keyed by the JSON's stable external_id, so renaming a JSON entry
// updates the existing row in place rather than orphaning it. Never touches a row a
// user has since edited (origin='user').
function upsertFamily(db, { external_id, name_en, parent_id = null, slot_fit, meal_role = null, can_lead = null, notes = null }) {
  const existing = db.prepare('SELECT id, origin FROM dish_families WHERE external_id = ?').get(external_id);
  if (existing) {
    if (existing.origin === 'seed') {
      db.prepare(
        `UPDATE dish_families SET name_en = ?, parent_id = ?, slot_fit = ?, meal_role = ?, can_lead = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(name_en, parent_id, JSON.stringify(slot_fit), meal_role, can_lead, notes, existing.id);
    }
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO dish_families (external_id, name_en, parent_id, slot_fit, meal_role, can_lead, notes, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')`
    )
    .run(external_id, name_en, parent_id, JSON.stringify(slot_fit), meal_role, can_lead, notes);
  return info.lastInsertRowid;
}

function upsertItem(db, { external_id, family_id, name_en, name_ta = null, is_placeholder = 0, onion_flag = 0, garlic_flag = 0, meal_role = null, can_lead = null, notes = null }) {
  const existing = db.prepare('SELECT id, origin FROM dish_items WHERE external_id = ?').get(external_id);
  if (existing) {
    if (existing.origin === 'seed') {
      db.prepare(
        `UPDATE dish_items SET family_id = ?, name_en = ?, name_ta = ?, is_placeholder = ?, onion_flag = ?, garlic_flag = ?,
           meal_role = ?, can_lead = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(family_id, name_en, name_ta, is_placeholder, onion_flag, garlic_flag, meal_role, can_lead, notes, existing.id);
    }
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO dish_items (external_id, family_id, name_en, name_ta, is_placeholder, onion_flag, garlic_flag, meal_role, can_lead, notes, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')`
    )
    .run(external_id, family_id, name_en, name_ta, is_placeholder, onion_flag, garlic_flag, meal_role, can_lead, notes);
  return info.lastInsertRowid;
}

function upsertIngredient(db, { external_id, name_en, name_ta = null, aliases = [], category = 'other', allergy_flag = 0 }) {
  const existing = db.prepare('SELECT id, origin FROM ingredients WHERE external_id = ?').get(external_id);
  if (existing) {
    if (existing.origin === 'seed') {
      db.prepare(
        `UPDATE ingredients SET name_en = ?, name_ta = ?, aliases = ?, category = ?, allergy_flag = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(name_en, name_ta, JSON.stringify(aliases), category, allergy_flag, existing.id);
    }
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO ingredients (external_id, name_en, name_ta, aliases, category, allergy_flag, origin)
       VALUES (?, ?, ?, ?, ?, ?, 'seed')`
    )
    .run(external_id, name_en, name_ta, JSON.stringify(aliases), category, allergy_flag);
  return info.lastInsertRowid;
}

function linkIngredient(db, dishItemId, ingredientId, role = 'primary') {
  db.prepare(
    `INSERT INTO dish_item_ingredients (dish_item_id, ingredient_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(dish_item_id, ingredient_id) DO UPDATE SET role = excluded.role`
  ).run(dishItemId, ingredientId, role);
}

function titleCase(key) {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Removes seed-origin rows from a prior taxonomy shape (no external_id) so a v1.4
// reseed starts clean. Never touches origin='user' rows. See DECISIONS.md Phase 1b
// entry: this is a structural rewrite, not a data refresh, so old seed-origin rows
// can't be matched/merged by external_id — they're simply stale.
function clearStaleSeedRows(db) {
  const staleItems = db.prepare("SELECT id FROM dish_items WHERE origin = 'seed' AND external_id IS NULL").all();
  for (const { id } of staleItems) {
    db.prepare('DELETE FROM dish_item_ingredients WHERE dish_item_id = ?').run(id);
    db.prepare('DELETE FROM dish_repeat_rules WHERE dish_item_id = ?').run(id);
    db.prepare('DELETE FROM dish_compatibility_rules WHERE source_dish_item_id = ? OR target_dish_item_id = ?').run(id, id);
    db.prepare('DELETE FROM special_day_assignments WHERE dish_item_id = ?').run(id);
    db.prepare('DELETE FROM dish_items WHERE id = ?').run(id);
  }
  const staleFamilies = db
    .prepare("SELECT id FROM dish_families WHERE origin = 'seed' AND external_id IS NULL ORDER BY parent_id IS NULL")
    .all();
  for (const { id } of staleFamilies) {
    db.prepare('DELETE FROM dish_compatibility_rules WHERE source_family_id = ? OR target_family_id = ?').run(id, id);
    db.prepare('DELETE FROM ingredient_family_rules WHERE family_id = ?').run(id);
    db.prepare('DELETE FROM special_day_assignments WHERE family_id = ?').run(id);
    db.prepare('DELETE FROM dish_families WHERE id = ?').run(id);
  }
  const staleIngredients = db.prepare("SELECT id FROM ingredients WHERE origin = 'seed' AND external_id IS NULL").all();
  for (const { id } of staleIngredients) {
    db.prepare('DELETE FROM dish_item_ingredients WHERE ingredient_id = ?').run(id);
    db.prepare('DELETE FROM ingredient_family_rules WHERE ingredient_id = ?').run(id);
    db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
  }
}

function seedIngredientRegistry(db, vegetables) {
  const idByExternalId = {};
  for (const veg of vegetables) {
    const id = upsertIngredient(db, {
      external_id: veg.id,
      name_en: titleCase(veg.name_en),
      name_ta: veg.name_ta || null,
      aliases: veg.aliases || [],
      category: veg.category || 'other',
      allergy_flag: veg.allergy_sensitive ? 1 : 0,
    });
    idByExternalId[veg.id] = id;
  }
  return idByExternalId;
}

function seedDishClasses(db, dishClasses, ingredientIdByExternalId) {
  const counts = { families: 0, items: 0, links: 0 };

  for (const cls of dishClasses) {
    const classRowId = upsertFamily(db, {
      external_id: cls.id,
      name_en: titleCase(cls.name_en),
      parent_id: null,
      slot_fit: cls.slot_fit,
    });
    counts.families++;

    const familyRowIdByExternalId = {};
    for (const fam of cls.families || []) {
      familyRowIdByExternalId[fam.id] = upsertFamily(db, {
        external_id: fam.id,
        name_en: titleCase(fam.name_en),
        parent_id: classRowId,
        slot_fit: fam.slot_fit,
        meal_role: fam.meal_role || null,
        can_lead: fam.can_lead_default ? 1 : 0,
      });
      counts.families++;
    }

    const subfamilyRowIdByExternalId = {};
    for (const subfam of cls.subfamilies || []) {
      const parentFamilyRowId = familyRowIdByExternalId[subfam.family_id];
      subfamilyRowIdByExternalId[subfam.id] = upsertFamily(db, {
        external_id: subfam.id,
        name_en: titleCase(subfam.name_en),
        parent_id: parentFamilyRowId,
        slot_fit: subfam.slot_fit,
        meal_role: subfam.meal_role || null,
        can_lead: subfam.can_lead_default ? 1 : 0,
      });
      counts.families++;
    }

    for (const item of cls.items || []) {
      const targetFamilyRowId = item.subfamily_id
        ? subfamilyRowIdByExternalId[item.subfamily_id]
        : familyRowIdByExternalId[item.family_id];
      const itemId = upsertItem(db, {
        external_id: item.id,
        family_id: targetFamilyRowId,
        name_en: titleCase(item.name_en),
        name_ta: item.name_ta || null,
        is_placeholder: item.is_placeholder ? 1 : 0,
        onion_flag: item.onion_flag ? 1 : 0,
        garlic_flag: item.garlic_flag ? 1 : 0,
        meal_role: item.meal_role || null,
        can_lead: item.can_lead ? 1 : 0,
        notes: item.notes || null,
      });
      counts.items++;

      const roles = item.ingredient_roles || { primary: [], support: [] };
      for (const role of ['primary', 'support']) {
        for (const vegExternalId of roles[role] || []) {
          const ingredientId = ingredientIdByExternalId[vegExternalId];
          if (!ingredientId) continue; // dangling ref — should not happen per JSON's own zero-dangling-refs guarantee
          linkIngredient(db, itemId, ingredientId, role);
          counts.links++;
        }
      }
    }
  }

  return counts;
}

function seedInterviewRules(db) {
  // Onion sambar (vengaya_sambar, dish_011) >= 20 days, severity soft — PK confirmed
  // (appendix placeholder #4 resolved by the amendment). The item itself is now in
  // the canonical JSON; this function seeds RULES only, never items.
  const onionSambar = db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_011'").get();
  if (onionSambar) {
    const existingRule = db.prepare('SELECT id FROM dish_repeat_rules WHERE dish_item_id = ?').get(onionSambar.id);
    if (!existingRule) {
      db.prepare(
        `INSERT INTO dish_repeat_rules (dish_item_id, min_gap_days, severity, rationale_tag, note, updated_by)
         VALUES (?, 20, 'soft', 'traditional_restriction', 'Interview rule from PK, severity confirmed soft.', 'seed')`
      ).run(onionSambar.id);
    }
  }

  // Drumstick (murungakkai, veg_001) never in Kari (fam_006_001, the kari_family row).
  const murungakkai = db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_001'").get();
  const kariFamily = db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
  if (murungakkai && kariFamily) {
    const existingRule = db
      .prepare('SELECT id FROM ingredient_family_rules WHERE ingredient_id = ? AND family_id = ?')
      .get(murungakkai.id, kariFamily.id);
    if (!existingRule) {
      db.prepare(
        `INSERT INTO ingredient_family_rules (ingredient_id, family_id, verdict, rationale_tag, note, updated_by)
         VALUES (?, ?, 'never', 'traditional_restriction', 'Interview rule from PK: drumstick never in Kari.', 'seed')`
      ).run(murungakkai.id, kariFamily.id);
    }
  }

  // Mor kuzhambu (morning, family fam_002_001) prefers adai (noon, subfamily subfam_014_007).
  // Source/target are families, not single items — mor kuzhambu is a family of 7 items —
  // supported directly by dish_compatibility_rules.source_family_id/target_family_id,
  // already in the Phase 2 schema, so no schema gap here.
  const morKuzhambuFamily = db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_002_001'").get();
  const adaiSubfamily = db.prepare("SELECT id FROM dish_families WHERE external_id = 'subfam_014_007'").get();
  if (morKuzhambuFamily && adaiSubfamily) {
    const existingRule = db
      .prepare('SELECT id FROM dish_compatibility_rules WHERE source_family_id = ? AND target_family_id = ?')
      .get(morKuzhambuFamily.id, adaiSubfamily.id);
    if (!existingRule) {
      db.prepare(
        `INSERT INTO dish_compatibility_rules
           (source_family_id, target_family_id, direction, preference, rationale_tag, note, updated_by)
         VALUES (?, ?, 'morning_to_noon', 'prefers', 'traditional_restriction', 'Interview rule from PK: mor kuzhambu (morning) prefers adai (noon).', 'seed')`
      ).run(morKuzhambuFamily.id, adaiSubfamily.id);
    }
  }
}

function seed(db, jsonPath = JSON_PATH) {
  migrate(db);
  const { data, sha256 } = loadJson(jsonPath);

  const run = db.transaction(() => {
    upsertSetting(db, 'taxonomy_json_sha256', sha256);
    upsertSetting(db, 'vegetable_repetition_any_form_gap_days', String(data.rules.vegetable_repetition.any_form_gap_days));
    upsertSetting(db, 'vegetable_repetition_same_form_gap_days', String(data.rules.vegetable_repetition.same_form_gap_days));
    upsertSetting(db, 'meal_composition_enforced_slots', JSON.stringify(data.rules.meal_composition.enforced_slots));
    upsertSetting(db, 'meal_composition_lead_required', String(data.rules.meal_composition.lead_required));
    upsertSetting(db, 'meal_composition_zero_leads_severity', data.rules.meal_composition.zero_leads_severity);
    upsertSetting(db, 'meal_composition_multiple_leads_severity', data.rules.meal_composition.multiple_leads_severity);
    upsertSetting(db, 'meal_composition_lead_roles', JSON.stringify(data.rules.meal_composition.lead_roles));

    clearStaleSeedRows(db);
    const ingredientIds = seedIngredientRegistry(db, data.vegetables);
    const counts = seedDishClasses(db, data.dish_classes, ingredientIds);
    seedInterviewRules(db);

    return counts;
  });

  return run();
}

if (require.main === module) {
  const db = openDb();
  const counts = seed(db);
  console.log('Seed complete:', counts);
  db.close();
}

module.exports = { seed, loadJson, titleCase };
