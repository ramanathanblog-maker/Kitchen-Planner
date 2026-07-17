// Data helpers for the meal-pattern wizard (Phase 4b Amendment §2/§6/§7). View-layer
// aggregation only — composes existing engine functions (buildContext + evaluate)
// from a new call site rather than editing engine code (amendment §6/§8 guardrail).
const { buildContext } = require('../engine/context');
const { evaluate } = require('../engine/evaluate');
const { zeroLeadsWarning } = require('../engine/slotComposition');
const { getSlotPattern } = require('./mealPatterns');

// Class row = a dish_families row with parent_id IS NULL (the taxonomy "class"
// level, e.g. "Sambar", "Kozhambu" — see seed/load.js:seedDishClasses, which
// seeds class -> family -> [subfamily] -> dish_items exactly this way).
function classRowByName(db, name) {
  return db
    .prepare('SELECT * FROM dish_families WHERE parent_id IS NULL AND lower(name_en) = lower(?)')
    .get(name);
}

// Walks a leaf family (the row a dish_item.family_id actually points at — a
// "family" or "subfamily" row) up to its root class row.
function classRowForFamily(db, familyId) {
  let row = db.prepare('SELECT * FROM dish_families WHERE id = ?').get(familyId);
  if (!row) return null;
  while (row.parent_id != null) {
    const parent = db.prepare('SELECT * FROM dish_families WHERE id = ?').get(row.parent_id);
    if (!parent) break;
    row = parent;
  }
  return row;
}

// All leaf family ids (family or subfamily rows dish_items.family_id can point
// at) descending from a class row.
function descendantLeafFamilyIds(db, classRowId) {
  const families = db.prepare('SELECT id FROM dish_families WHERE parent_id = ?').all(classRowId);
  const ids = new Set();
  for (const fam of families) {
    const subfams = db.prepare('SELECT id FROM dish_families WHERE parent_id = ?').all(fam.id);
    if (subfams.length === 0) {
      ids.add(fam.id);
    } else {
      for (const sf of subfams) ids.add(sf.id);
    }
  }
  return ids;
}

// Candidate dish_items for a hub row: meal_role + slot_fit (via leaf family),
// optionally narrowed to a single taxonomy class by filter_class (amendment §10.2).
function candidateItemsForRole(db, { slot, role, filterClass }) {
  const rows = db
    .prepare(
      `SELECT di.id, di.name_en, di.family_id, df.name_en AS family_name, df.slot_fit, df.parent_id
       FROM dish_items di JOIN dish_families df ON di.family_id = df.id
       WHERE di.meal_role = ?`
    )
    .all(role);
  let items = rows.filter((r) => JSON.parse(r.slot_fit).includes(slot));
  if (filterClass) {
    const classRow = classRowByName(db, filterClass);
    if (!classRow) return [];
    const allowedFamilyIds = descendantLeafFamilyIds(db, classRow.id);
    items = items.filter((r) => allowedFamilyIds.has(r.family_id));
  }
  return items;
}

// Groups candidate items by their root taxonomy class, then by leaf family —
// the "class -> family" drill content the role-level route (§8's first URL
// level) renders as one page (class headings, family links).
function groupByClassAndFamily(db, items) {
  const classes = new Map(); // classId -> { id, name, families: Map(familyId -> {id,name,items:[]}) }
  for (const item of items) {
    const classRow = classRowForFamily(db, item.family_id) || { id: item.family_id, name_en: item.family_name };
    if (!classes.has(classRow.id)) classes.set(classRow.id, { id: classRow.id, name: classRow.name_en, families: new Map() });
    const cls = classes.get(classRow.id);
    if (!cls.families.has(item.family_id)) cls.families.set(item.family_id, { id: item.family_id, name: item.family_name, items: [] });
    cls.families.get(item.family_id).items.push(item);
  }
  return Array.from(classes.values()).map((c) => ({ ...c, families: Array.from(c.families.values()) }));
}

// Per-item evaluate() results INCLUDING blocked (rank() in src/engine/rank.js
// filters blocked out for /api/suggest; the drill leaf list must keep them
// visible-but-disabled per amendment §6, so we call buildContext+evaluate
// directly here instead of going through rank()).
function evaluateItemsForLeaf(db, { date, slot, items }) {
  return items.map((item) => {
    const context = buildContext(db, { dishItemId: item.id, date, slot });
    const result = evaluate(context);
    const blockedFinding = result.findings.find((f) => f.severity === 'block');
    return {
      dishItemId: item.id,
      dishName: item.name_en,
      familyName: item.family_name,
      status: result.status,
      reason: blockedFinding ? blockedFinding.message : null,
      findings: result.findings,
    };
  });
}

// If a family has <=1 item, the third drill level (item choice) is a dead end —
// skip straight to that one item (amendment §10.3).
function deadEndItem(db, familyId) {
  const items = db.prepare('SELECT id, name_en FROM dish_items WHERE family_id = ?').all(familyId);
  return items.length === 1 ? items[0] : null;
}

// Today's morning gravy dishes (main_gravy role), for the noon Side/Gravy row's
// "From this morning" carry-over group (amendment §5). Same actual-over-planned
// fallback precedence as src/data/today.js's slotMenu.
function morningGravyCarryover(db, date) {
  const actual = db
    .prepare(
      `SELECT di.id, di.name_en, di.family_id FROM actual_meals am JOIN dish_items di ON di.id = am.dish_item_id
       WHERE am.date = ? AND am.slot = 'morning' AND di.meal_role = 'main_gravy' ORDER BY am.ordering`
    )
    .all(date);
  if (actual.length > 0) return actual;
  return db
    .prepare(
      `SELECT di.id, di.name_en, di.family_id FROM plans p JOIN dish_items di ON di.id = p.dish_item_id
       WHERE p.date = ? AND p.slot = 'morning' AND di.meal_role = 'main_gravy' ORDER BY p.ordering`
    )
    .all(date);
}

// What's currently chosen for a hub row (role, + filter_class if set) on a given
// date+slot — reads plans (not actual_meals; the wizard plans ahead).
function chosenForRole(db, { date, slot, role, filterClass }) {
  const rows = db
    .prepare(
      `SELECT p.id AS plan_id, p.ordering, di.id AS dish_item_id, di.name_en, di.family_id
       FROM plans p JOIN dish_items di ON di.id = p.dish_item_id
       WHERE p.date = ? AND p.slot = ? AND di.meal_role = ? ORDER BY p.ordering`
    )
    .all(date, slot, role);
  if (!filterClass) return rows;
  const classRow = classRowByName(db, filterClass);
  if (!classRow) return [];
  const allowedFamilyIds = descendantLeafFamilyIds(db, classRow.id);
  return rows.filter((r) => allowedFamilyIds.has(r.family_id));
}

// Hub data: pattern rows + what's chosen for each + the zero-leads banner.
function getHubData(db, { date, slot }) {
  const pattern = getSlotPattern(db, slot);
  const rows = pattern.rows.map((row) => ({
    ...row,
    chosen: chosenForRole(db, { date, slot, role: row.role, filterClass: row.filter_class }),
  }));
  const compositionWarning = zeroLeadsWarning(db, { date, slot });
  return { date, slot, rows, compositionWarning, note: pattern.note || null };
}

// P2c — data-layer capability the collapse confirm sheet needs: which named
// dishes are currently planned in rows a collapses_pattern choice (variety rice)
// would hide, so the confirm sheet can list them by name before the destructive
// clear-collapsed call fires. Mirrors the hidden-rows logic in
// POST /api/wizard/clear-collapsed (src/routes/wizard.js) but read-only.
function dishesClearedByCollapse(db, { date, slot }) {
  const pattern = getSlotPattern(db, slot);
  const collapseRow = pattern.rows.find((r) => r.collapses_pattern);
  if (!collapseRow) return [];
  const allowed = new Set(collapseRow.collapsed_allows || []);
  const hiddenRows = pattern.rows.filter((r) => r !== collapseRow && !allowed.has(r.role));
  const dishes = [];
  for (const r of hiddenRows) {
    const chosen = chosenForRole(db, { date, slot, role: r.role, filterClass: r.filter_class });
    for (const c of chosen) dishes.push({ planId: c.plan_id, name: c.name_en, rowLabel: r.label });
  }
  return dishes;
}

// A stable, URL-safe identifier for a hub row — role alone collides when two rows
// share a meal_role but differ by filter_class (Thogayal vs Pachadi, both
// role:"condiment"), so the slug folds filter_class in. Computed from data, never
// a hard-coded string per row (amendment §8 guardrail).
function rowSlug(row) {
  return row.filter_class ? `${row.role}__${row.filter_class}` : row.role;
}

function findRowBySlug(pattern, slug) {
  return pattern.rows.find((r) => rowSlug(r) === slug) || null;
}

module.exports = {
  rowSlug,
  findRowBySlug,
  classRowByName,
  classRowForFamily,
  descendantLeafFamilyIds,
  candidateItemsForRole,
  groupByClassAndFamily,
  evaluateItemsForLeaf,
  deadEndItem,
  morningGravyCarryover,
  chosenForRole,
  getHubData,
  dishesClearedByCollapse,
};
