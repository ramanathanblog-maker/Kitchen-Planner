// Data for the server-rendered /plan (7-day grid) and Today ('/') views: a lookup
// of dish_item_id -> name_en (for cheap SSR interpolation) plus the raw plans rows
// in [from, to] range, date/slot/ordering ordered.
function getPlanData(db, from, to) {
  const items = db.prepare('SELECT id, name_en FROM dish_items').all();
  const itemsById = {};
  for (const it of items) itemsById[it.id] = it.name_en;

  const plans = db
    .prepare('SELECT * FROM plans WHERE date >= ? AND date <= ? ORDER BY date, slot, ordering')
    .all(from, to);

  return { itemsById, plans };
}

module.exports = { getPlanData };
