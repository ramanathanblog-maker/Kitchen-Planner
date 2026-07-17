const { zeroLeadsWarning } = require('../engine/slotComposition');

// Pure DB-read functions for "today's menu" — shared by GET /api/display/today
// (src/routes/display.js) and the server-rendered Today/kiosk pages, so both call
// the same query logic in-process instead of one HTTP-fetching the other.
function slotMenu(db, date, slot) {
  const compositionWarning = zeroLeadsWarning(db, { date, slot });

  const actual = db
    .prepare(
      `SELECT di.id, di.name_en FROM actual_meals am JOIN dish_items di ON di.id = am.dish_item_id
       WHERE am.date = ? AND am.slot = ? ORDER BY am.ordering`
    )
    .all(date, slot);
  if (actual.length > 0) return { source: 'actual', dishes: actual, compositionWarning };

  const planned = db
    .prepare(
      `SELECT di.id, di.name_en FROM plans p JOIN dish_items di ON di.id = p.dish_item_id
       WHERE p.date = ? AND p.slot = ? ORDER BY p.ordering`
    )
    .all(date, slot);
  if (planned.length > 0) return { source: 'planned', dishes: planned, compositionWarning };

  return { source: 'none', dishes: [], compositionWarning };
}

function specialDayFor(db, date) {
  const rows = db
    .prepare(
      `SELECT sdt.name, sdt.restricts_onion, sdt.restricts_garlic
       FROM special_day_dates sdd JOIN special_day_types sdt ON sdt.id = sdd.special_day_type_id
       WHERE sdd.date = ?`
    )
    .all(date);
  return rows.length === 0 ? null : rows;
}

function getTodayData(db, date) {
  return {
    date,
    special_day: specialDayFor(db, date),
    slots: {
      morning: slotMenu(db, date, 'morning'),
      noon: slotMenu(db, date, 'noon'),
      night: slotMenu(db, date, 'night'),
    },
  };
}

module.exports = { getTodayData, slotMenu, specialDayFor };
