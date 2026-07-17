// Data for GET /api/display/today (and the /display kiosk page): per-slot dishes
// with actual_meals taking precedence over plans, falling back to 'none' when
// neither exists — the same actual-over-planned-over-none precedence the kiosk
// and Today view already assume. Read-only, no editor identity required (see
// src/routes/display.js header comment).
const SLOTS = ['morning', 'noon', 'night'];

function dishesFor(db, table, date, slot) {
  return db
    .prepare(
      `SELECT di.id, di.name_en FROM ${table} m
       JOIN dish_items di ON di.id = m.dish_item_id
       WHERE m.date = ? AND m.slot = ?
       ORDER BY m.ordering, m.id`
    )
    .all(date, slot);
}

function slotData(db, date, slot) {
  const actual = dishesFor(db, 'actual_meals', date, slot);
  if (actual.length) return { source: 'actual', dishes: actual };
  const planned = dishesFor(db, 'plans', date, slot);
  if (planned.length) return { source: 'planned', dishes: planned };
  return { source: 'none', dishes: [] };
}

function specialDayFor(db, date) {
  return db
    .prepare(
      `SELECT sdt.id AS special_day_type_id, sdt.name, sdt.restricts_onion, sdt.restricts_garlic, sdt.default_notes
       FROM special_day_dates sdd JOIN special_day_types sdt ON sdt.id = sdd.special_day_type_id
       WHERE sdd.date = ?
       ORDER BY sdt.name`
    )
    .all(date);
}

function getTodayData(db, date) {
  const slots = {};
  for (const slot of SLOTS) slots[slot] = slotData(db, date, slot);
  return { date, slots, special_day: specialDayFor(db, date) };
}

module.exports = { getTodayData };
