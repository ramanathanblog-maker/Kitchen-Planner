// Builds the plain-object context that the 7 pure engine steps consume, from the
// database, a dish_item id, a date, and a slot. This module does the SQL/date-math
// work so the steps in /src/engine/steps stay pure and unit-testable without a DB.
// Deterministic: date is always a caller-supplied parameter, never Date.now().

function daysBetween(earlierDate, laterDate) {
  const a = new Date(`${earlierDate}T00:00:00Z`);
  const b = new Date(`${laterDate}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function loadDish(db, dishItemId) {
  const row = db
    .prepare(
      `SELECT di.id, di.name_en, di.family_id, di.onion_flag, di.garlic_flag,
              COALESCE(di.heaviness, df.heaviness) AS heaviness,
              di.meal_role, di.can_lead,
              df.name_en AS family_name, df.slot_fit
       FROM dish_items di JOIN dish_families df ON di.family_id = df.id
       WHERE di.id = ?`
    )
    .get(dishItemId);
  if (!row) throw new Error(`dish_item ${dishItemId} not found`);
  const ingredients = db
    .prepare(
      `SELECT dii.ingredient_id, i.name_en AS ingredient_name, dii.role
       FROM dish_item_ingredients dii JOIN ingredients i ON dii.ingredient_id = i.id
       WHERE dii.dish_item_id = ?`
    )
    .all(dishItemId);
  return { ...row, slot_fit: JSON.parse(row.slot_fit), ingredients };
}

function loadSpecialDay(db, date) {
  const activeTypes = db
    .prepare(
      `SELECT sdt.id, sdt.name, sdt.restricts_onion, sdt.restricts_garlic
       FROM special_day_dates sdd JOIN special_day_types sdt ON sdd.special_day_type_id = sdt.id
       WHERE sdd.date = ?`
    )
    .all(date);
  const assignments = db
    .prepare(
      `SELECT sda.id, sda.family_id, sda.dish_item_id, sda.rule, sda.note, sdt.name AS type_name
       FROM special_day_assignments sda JOIN special_day_types sdt ON sda.special_day_type_id = sdt.id
       WHERE sda.date = ?`
    )
    .all(date);
  if (activeTypes.length === 0 && assignments.length === 0) return null;
  return { activeTypes, assignments };
}

function loadIngredientFamilyRules(db, dish) {
  if (dish.ingredients.length === 0) return [];
  const ingredientIds = dish.ingredients.map((i) => i.ingredient_id);
  const placeholders = ingredientIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT ifr.id, ifr.verdict, ifr.note, ifr.rationale_tag, i.name_en AS ingredient_name
       FROM ingredient_family_rules ifr JOIN ingredients i ON ifr.ingredient_id = i.id
       WHERE ifr.family_id = ? AND ifr.ingredient_id IN (${placeholders})`
    )
    .all(dish.family_id, ...ingredientIds);
}

function loadDishRepeatRule(db, dishItemId) {
  return db.prepare('SELECT id, min_gap_days, severity, note FROM dish_repeat_rules WHERE dish_item_id = ?').get(dishItemId) || null;
}

function loadRepetitionDefaults(db) {
  const any = db.prepare("SELECT value FROM settings WHERE key = 'vegetable_repetition_any_form_gap_days'").get();
  const same = db.prepare("SELECT value FROM settings WHERE key = 'vegetable_repetition_same_form_gap_days'").get();
  return {
    any_form_gap_days: any ? Number(any.value) : 3,
    same_form_gap_days: same ? Number(same.value) : 14,
  };
}

// Most recent actual_meals date strictly before `date` for this exact dish item.
function lastActualDishDate(db, dishItemId, date) {
  const row = db
    .prepare('SELECT date FROM actual_meals WHERE dish_item_id = ? AND date < ? ORDER BY date DESC LIMIT 1')
    .get(dishItemId, date);
  return row ? row.date : null;
}

function plannedDishConflictWithinGap(db, dishItemId, date, gapDays) {
  if (!gapDays) return false;
  const windowStart = new Date(`${date}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - gapDays);
  const windowStartStr = windowStart.toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT 1 FROM plans WHERE dish_item_id = ? AND date >= ? AND date < ?
       AND date NOT IN (SELECT date FROM actual_meals WHERE dish_item_id = ?)
       LIMIT 1`
    )
    .get(dishItemId, windowStartStr, date, dishItemId);
  return !!row;
}

// Most recent actual_meals date strictly before `date` where this ingredient appeared
// in ANY dish family (any-form), and separately in THIS dish's family (same-form).
function lastIngredientFormDates(db, ingredientId, familyId, date) {
  const anyForm = db
    .prepare(
      `SELECT am.date FROM actual_meals am
       JOIN dish_item_ingredients dii ON dii.dish_item_id = am.dish_item_id
       WHERE dii.ingredient_id = ? AND am.date < ?
       ORDER BY am.date DESC LIMIT 1`
    )
    .get(ingredientId, date);
  const sameForm = db
    .prepare(
      `SELECT am.date FROM actual_meals am
       JOIN dish_item_ingredients dii ON dii.dish_item_id = am.dish_item_id
       JOIN dish_items di ON di.id = am.dish_item_id
       WHERE dii.ingredient_id = ? AND di.family_id = ? AND am.date < ?
       ORDER BY am.date DESC LIMIT 1`
    )
    .get(ingredientId, familyId, date);
  return { anyForm: anyForm ? anyForm.date : null, sameForm: sameForm ? sameForm.date : null };
}

function loadRepeatGapFacts(db, dish, date, dishRule) {
  const plannedConflict = plannedDishConflictWithinGap(db, dish.id, date, dishRule ? dishRule.min_gap_days : null);

  if (dishRule) {
    const lastDate = lastActualDishDate(db, dish.id, date);
    return {
      dishRule,
      lastActualDishGapDays: lastDate ? daysBetween(lastDate, date) : null,
      plannedDishConflictWithinGap: plannedConflict,
      ingredientGaps: [],
    };
  }

  const ingredientGaps = dish.ingredients.map((ing) => {
    const { anyForm, sameForm } = lastIngredientFormDates(db, ing.ingredient_id, dish.family_id, date);
    return {
      ingredient_id: ing.ingredient_id,
      ingredient_name: ing.ingredient_name,
      role: ing.role,
      lastActualAnyFormGapDays: anyForm ? daysBetween(anyForm, date) : null,
      lastActualSameFormGapDays: sameForm ? daysBetween(sameForm, date) : null,
    };
  });

  return {
    dishRule: null,
    lastActualDishGapDays: null,
    plannedDishConflictWithinGap: plannedConflict,
    ingredientGaps,
  };
}

// Today's morning dish (actual takes precedence over planned, per A1/spec: "actual is
// authoritative"). Only the first dish in ordering is used as the compatibility source
// when a multi-dish morning slot exists — matches the mor-kuzhambu-anchors-the-meal intent.
function loadMorningReference(db, date) {
  const actual = db
    .prepare(
      `SELECT am.dish_item_id, di.name_en AS dish_name, di.family_id
       FROM actual_meals am JOIN dish_items di ON di.id = am.dish_item_id
       WHERE am.date = ? AND am.slot = 'morning' ORDER BY am.ordering LIMIT 1`
    )
    .get(date);
  if (actual) return { dishItemId: actual.dish_item_id, dishName: actual.dish_name, familyId: actual.family_id };
  const planned = db
    .prepare(
      `SELECT p.dish_item_id, di.name_en AS dish_name, di.family_id
       FROM plans p JOIN dish_items di ON di.id = p.dish_item_id
       WHERE p.date = ? AND p.slot = 'morning' ORDER BY p.ordering LIMIT 1`
    )
    .get(date);
  if (planned) return { dishItemId: planned.dish_item_id, dishName: planned.dish_name, familyId: planned.family_id };
  return null;
}

function loadCompatibilityRules(db, morningReference, dish) {
  return db
    .prepare(
      `SELECT id, preference, rationale_tag, note FROM dish_compatibility_rules
       WHERE (source_dish_item_id = ? OR source_family_id = ?)
         AND (target_dish_item_id = ? OR target_family_id = ?)`
    )
    .all(morningReference.dishItemId, morningReference.familyId, dish.id, dish.family_id);
}

function loadSameSlotDishesHeaviness(db, date, slot, excludeDishItemId) {
  const rows = db
    .prepare(
      `SELECT COALESCE(di.heaviness, df.heaviness) AS heaviness
       FROM plans p JOIN dish_items di ON di.id = p.dish_item_id JOIN dish_families df ON df.id = di.family_id
       WHERE p.date = ? AND p.slot = ? AND p.dish_item_id != ?`
    )
    .all(date, slot, excludeDishItemId);
  return rows.map((r) => r.heaviness).filter(Boolean);
}

// Step 5b (meal composition) inputs: the household's "exactly one lead per enforced
// slot" rule, entirely data-driven from settings (see seed/load.js meal_composition_*
// keys) — never hard-code which classes/items can lead here or in the step itself.
function loadMealCompositionSettings(db) {
  const get = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const enforcedSlots = JSON.parse(get('meal_composition_enforced_slots')?.value || '[]');
  const leadRoles = JSON.parse(get('meal_composition_lead_roles')?.value || '[]');
  const zeroLeadsSeverity = get('meal_composition_zero_leads_severity')?.value || 'warn';
  const multipleLeadsSeverity = get('meal_composition_multiple_leads_severity')?.value || 'warn';
  return { enforcedSlots, leadRoles, zeroLeadsSeverity, multipleLeadsSeverity };
}

function loadSameSlotDishesMealRole(db, date, slot, excludeDishItemId) {
  return db
    .prepare(
      `SELECT di.name_en, di.meal_role, di.can_lead
       FROM plans p JOIN dish_items di ON di.id = p.dish_item_id
       WHERE p.date = ? AND p.slot = ? AND p.dish_item_id != ?`
    )
    .all(date, slot, excludeDishItemId);
}

function buildContext(db, { dishItemId, date, slot, leftoverIngredientIds = new Set() }) {
  const dish = loadDish(db, dishItemId);
  const dishRule = loadDishRepeatRule(db, dishItemId);
  const morningReference = slot === 'noon' ? loadMorningReference(db, date) : null;
  return {
    date,
    slot,
    dish,
    specialDay: loadSpecialDay(db, date),
    ingredientFamilyRules: loadIngredientFamilyRules(db, dish),
    repeatGap: loadRepeatGapFacts(db, dish, date, dishRule),
    repetitionDefaults: loadRepetitionDefaults(db),
    morningReference,
    compatibilityRules: morningReference ? loadCompatibilityRules(db, morningReference, dish) : [],
    sameSlotDishesHeaviness: loadSameSlotDishesHeaviness(db, date, slot, dishItemId),
    mealComposition: {
      ...loadMealCompositionSettings(db),
      siblings: loadSameSlotDishesMealRole(db, date, slot, dishItemId),
    },
    leftoverIngredientIds,
  };
}

module.exports = { buildContext, daysBetween };
