const { DOMAINS } = require('../routes/validate');

const VALID_ROLES = new Set(DOMAINS.meal_role);
const SLOTS = ['morning', 'noon', 'night'];

// Thrown when the `meal_patterns` settings value isn't valid JSON at all — this
// is the one shape of bad data normalizeSlot()/normalizeRow() can't repair by
// dropping a row, so it's surfaced loudly (Audit 2026-07-18, code #5) rather
// than crashing every plan page with an unhandled JSON.parse exception, or
// silently rendering an empty planner with no explanation. Callers that serve
// HTML pages should catch this and render a visible error page (see
// src/routes/errors.js pageErrorHandler). The message is public-safe (no raw
// settings content) since it may reach household members, not just PK.
class MealPatternsFormatError extends Error {
  constructor(detail) {
    super('The meal-plan pattern settings are malformed. Ask PK to check the meal_patterns setting.');
    this.detail = detail;
  }
}

// A missing/invalid `max` defaults to 1 (a stepper cap of 1 is always safe;
// leaving it `undefined` let `chosen.length >= row.max` be permanently false —
// an unbounded stepper). A row with no valid `role` (the value the rest of the
// wizard keys off — candidate lookup, chosen-dish lookup, choose/clear mutation
// routes) can't be repaired, so it's dropped: logged server-side and simply
// absent from the rendered hub, rather than crashing the page.
function normalizeRow(row, slot) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    console.error(`meal_patterns: slot "${slot}" has a non-object row (${JSON.stringify(row)}) — dropping it`);
    return null;
  }
  if (typeof row.role !== 'string' || !VALID_ROLES.has(row.role)) {
    console.error(`meal_patterns: slot "${slot}" row has unknown/missing role ${JSON.stringify(row.role)} — dropping it`);
    return null;
  }
  if (row.filter_class !== undefined && typeof row.filter_class !== 'string') {
    console.error(`meal_patterns: slot "${slot}" role "${row.role}" has a non-string filter_class ${JSON.stringify(row.filter_class)} — dropping it`);
    return null;
  }
  let label = row.label;
  if (typeof label !== 'string' || !label) {
    console.error(`meal_patterns: slot "${slot}" role "${row.role}" is missing a label — falling back to the role name`);
    label = row.role;
  }
  let max = row.max;
  if (!Number.isInteger(max) || max < 1) {
    if (max !== undefined) {
      console.error(`meal_patterns: slot "${slot}" role "${row.role}" has invalid max ${JSON.stringify(row.max)} — defaulting to 1`);
    }
    max = 1;
  }
  return { ...row, label, max };
}

function normalizeSlot(value, slot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    console.error(`meal_patterns: slot "${slot}" is not an object — rendering it empty`);
    return { rows: [] };
  }
  const rawRows = Array.isArray(value.rows) ? value.rows : [];
  if (!Array.isArray(value.rows) && value.rows !== undefined) {
    console.error(`meal_patterns: slot "${slot}".rows is not an array — rendering it empty`);
  }
  const rows = rawRows.map((r) => normalizeRow(r, slot)).filter(Boolean);
  return { rows, ...(typeof value.note === 'string' ? { note: value.note } : {}) };
}

// Reads the `meal_patterns` settings row (migration 006) — the pattern-hub wizard's
// shape (amendment §3). Views must call this on every render and must never
// hard-code role/label/max strings themselves (amendment §8 guardrail, checked by
// `grep -rn "main_gravy\|'Gravy'\|'Kari'" src/views`).
//
// This is admin-editable data (and per-household data from Phase 6 onward), so it
// is validated on every read rather than trusted as always well-formed (Audit
// 2026-07-18, code/threat #5): malformed top-level JSON throws
// MealPatternsFormatError; anything else structurally wrong is repaired or
// dropped row-by-row with a server log line, never a crashed page.
function getMealPatterns(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'meal_patterns'").get();
  if (!row) return { morning: { rows: [] }, noon: { rows: [] }, night: { rows: [] } };
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch (e) {
    throw new MealPatternsFormatError(e.message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MealPatternsFormatError('top-level value is not a JSON object');
  }
  const result = {};
  for (const slot of SLOTS) result[slot] = normalizeSlot(parsed[slot], slot);
  return result;
}

function getSlotPattern(db, slot) {
  const patterns = getMealPatterns(db);
  return patterns[slot] || { rows: [] };
}

module.exports = { getMealPatterns, getSlotPattern, MealPatternsFormatError };
