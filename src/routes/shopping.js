// GET /api/shopping?from&to — missing-ingredients roll-up from planned meals
// (plans, not actual_meals — this is forward-looking). Two lenses over the same
// range: "tomorrow" (date = from) and "week" (the full [from, to] range, which
// necessarily includes tomorrow — it's a wider view, not a disjoint partition).
// Ingredients flagged leftover_flag=1 are split into have_leftover so the shopper
// knows not to buy them, honoring the leftovers-first flag (DECISIONS.md Phase 2
// entry: this flag had no storage table until migration 004).
const express = require('express');
const { assertRequired } = require('./validate');

function ingredientsForRange(db, from, to) {
  const rows = db
    .prepare(
      `SELECT DISTINCT i.id, i.name_en, i.leftover_flag
       FROM plans p
       JOIN dish_item_ingredients dii ON dii.dish_item_id = p.dish_item_id
       JOIN ingredients i ON i.id = dii.ingredient_id
       WHERE p.date >= ? AND p.date <= ?
       ORDER BY i.name_en`
    )
    .all(from, to);
  return {
    to_buy: rows.filter((r) => !r.leftover_flag).map(({ id, name_en }) => ({ id, name_en })),
    have_leftover: rows.filter((r) => r.leftover_flag).map(({ id, name_en }) => ({ id, name_en })),
  };
}

function shoppingRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { from, to } = req.query;
    assertRequired(req.query, ['from', 'to']);
    res.json({
      tomorrow: { date: from, ...ingredientsForRange(db, from, from) },
      week: { from, to, ...ingredientsForRange(db, from, to) },
    });
  });

  return router;
}

module.exports = { shoppingRouter, ingredientsForRange };
