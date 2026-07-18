// Human-readable descriptions of knowledge_events rows, built from old_value/
// new_value plus id->name lookups. Display-layer only (Audit 2026-07-18, UX #3:
// History used to render raw "date · who · table · source" lines with no way
// to tell what a mistake actually was without reading the stored JSON by
// hand) — does not touch knowledge_events' schema or the undo route's
// execution semantics (src/routes/knowledgeEvents.js); it only describes what
// an event did, or what an undo of it would do.
const { formatDateHuman } = require('./dates');

function buildLookups({ ingredients = [], families = [], items = [] } = {}) {
  return {
    ingredientName: new Map(ingredients.map((i) => [i.id, i.name_en])),
    familyName: new Map(families.map((f) => [f.id, f.name_en])),
    dishName: new Map(items.map((i) => [i.id, i.name_en])),
  };
}

function nameOr(map, id, fallback) {
  if (id === null || id === undefined) return fallback;
  return map.get(id) || `#${id}`;
}

function describeIngredientFamilyRule(value, lookups) {
  const ingredient = nameOr(lookups.ingredientName, value.ingredient_id, 'an ingredient');
  const family = nameOr(lookups.familyName, value.family_id, 'a dish family');
  return { subject: `${ingredient} × ${family}`, detail: `to ${value.verdict}` };
}

function describeDishRepeatRule(value, lookups) {
  const dish = nameOr(lookups.dishName, value.dish_item_id, 'a dish');
  return { subject: dish, detail: `to a ${value.min_gap_days}-day repeat gap (${value.severity})` };
}

function describeDishCompatibilityRule(value, lookups) {
  const source = value.source_dish_item_id
    ? nameOr(lookups.dishName, value.source_dish_item_id, 'a dish')
    : nameOr(lookups.familyName, value.source_family_id, 'a dish family');
  const target = value.target_dish_item_id
    ? nameOr(lookups.dishName, value.target_dish_item_id, 'a dish')
    : nameOr(lookups.familyName, value.target_family_id, 'a dish family');
  return { subject: `${source} → ${target}`, detail: `to ${value.preference}` };
}

function describePlanRow(value, lookups, verb) {
  const dish = nameOr(lookups.dishName, value.dish_item_id, 'a dish');
  const when = value.date ? `${formatDateHuman(value.date)}${value.slot ? ' ' + value.slot : ''}` : 'an unspecified date';
  return { subject: dish, detail: `${verb} ${when}` };
}

function describeGeneric(value) {
  return { subject: (value && value.name_en) || 'a row', detail: '' };
}

// { subject, detail } describing the row a create/update/delete acted on —
// shared by describeEvent (what happened) and describeUndoPreview (what an
// undo would do), so the two phrasings stay in sync by construction.
function describeRow(tableName, value, lookups) {
  if (!value) return { subject: 'the change', detail: '' };
  switch (tableName) {
    case 'ingredient_family_rules':
      return describeIngredientFamilyRule(value, lookups);
    case 'dish_repeat_rules':
      return describeDishRepeatRule(value, lookups);
    case 'dish_compatibility_rules':
      return describeDishCompatibilityRule(value, lookups);
    case 'plans':
      return describePlanRow(value, lookups, 'for');
    case 'actual_meals':
      return describePlanRow(value, lookups, 'as eaten for');
    case 'special_day_types':
      return { subject: value.name ? `the day type "${value.name}"` : 'a day type', detail: '' };
    case 'special_day_dates':
      return { subject: value.date ? formatDateHuman(value.date) : 'a date', detail: 'as a special day' };
    case 'special_day_assignments': {
      const subject = value.dish_item_id
        ? nameOr(lookups.dishName, value.dish_item_id, 'a dish')
        : nameOr(lookups.familyName, value.family_id, 'a dish family');
      return { subject, detail: `to "${value.rule}"${value.date ? ' on ' + formatDateHuman(value.date) : ''}` };
    }
    default:
      return describeGeneric(value);
  }
}

function joinSentence(subject, detail) {
  return detail ? `${subject} ${detail}` : subject;
}

function parseValue(json) {
  return json ? JSON.parse(json) : null;
}

// "What happened" — for the History list itself.
function describeEvent(event, lookups) {
  const oldValue = parseValue(event.old_value);
  const newValue = parseValue(event.new_value);
  const who = event.who || 'Someone';
  const prefix = event.source === 'undo' ? 'Undo: ' : '';

  if (oldValue === null && newValue !== null) {
    const { subject, detail } = describeRow(event.table_name, newValue, lookups);
    return `${prefix}${who} added ${joinSentence(subject, detail)}`;
  }
  if (newValue === null && oldValue !== null) {
    const { subject, detail } = describeRow(event.table_name, oldValue, lookups);
    return `${prefix}${who} removed ${joinSentence(subject, detail)}`;
  }
  if (oldValue !== null && newValue !== null) {
    const { subject, detail } = describeRow(event.table_name, newValue, lookups);
    return `${prefix}${who} set ${joinSentence(subject, detail)}`;
  }
  return `${prefix}${who} changed a ${event.table_name} row`;
}

// "What this will do" — for the Undo confirm sheet, shown before it executes.
// Mirrors src/routes/knowledgeEvents.js's own undo logic (create -> delete,
// delete -> re-insert, update -> revert fields) but only to describe it, never
// to perform it — the actual undo still happens via
// POST /api/knowledge_events/:id/undo, unchanged.
function describeUndoPreview(event, lookups) {
  const oldValue = parseValue(event.old_value);
  const newValue = parseValue(event.new_value);

  if (oldValue === null && newValue !== null) {
    const { subject, detail } = describeRow(event.table_name, newValue, lookups);
    return `This will remove ${joinSentence(subject, detail)}.`;
  }
  if (newValue === null && oldValue !== null) {
    const { subject, detail } = describeRow(event.table_name, oldValue, lookups);
    return `This will restore ${joinSentence(subject, detail)}.`;
  }
  if (oldValue !== null && newValue !== null) {
    const { subject, detail } = describeRow(event.table_name, oldValue, lookups);
    return `This will revert ${joinSentence(subject, detail)}.`;
  }
  return 'This will undo the change.';
}

module.exports = { buildLookups, describeEvent, describeUndoPreview };
