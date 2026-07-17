const { zeroLeadsWarning } = require('../engine/slotComposition');
const { addDays } = require('./dates');

function getPlanData(db, fromDate, toDate) {
  const items = db.prepare('SELECT id, name_en FROM dish_items').all();
  const itemsById = Object.fromEntries(items.map((i) => [i.id, i.name_en]));
  const plans = db.prepare('SELECT * FROM plans WHERE date >= ? AND date <= ? ORDER BY date, slot, ordering').all(fromDate, toDate);

  const compositionWarnings = {};
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    for (const slot of ['morning', 'noon', 'night']) {
      const warning = zeroLeadsWarning(db, { date, slot });
      if (warning) compositionWarnings[`${date}|${slot}`] = warning;
    }
  }

  return { itemsById, plans, compositionWarnings };
}

module.exports = { getPlanData };
