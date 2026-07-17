const express = require('express');
const { ApiError } = require('./errors');
const { assertInDomain, assertRequired } = require('./validate');
const { buildContext } = require('../engine/context');
const { evaluate } = require('../engine/evaluate');
const { rank } = require('../engine/rank');
const { zeroLeadsWarning } = require('../engine/slotComposition');

// Candidate set for a slot: every dish_item whose family's slot_fit (JSON array)
// includes the requested slot. Family slot_fit is the single source of slot
// eligibility per CLAUDE.md A1 — dish_items carry no slot_fit of their own.
function candidateIdsForSlot(db, slot) {
  const rows = db
    .prepare(`SELECT di.id, df.slot_fit FROM dish_items di JOIN dish_families df ON di.family_id = df.id`)
    .all();
  return rows.filter((r) => JSON.parse(r.slot_fit).includes(slot)).map((r) => r.id);
}

function suggestRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { date, slot } = req.query;
    assertRequired(req.query, ['date', 'slot']);
    assertInDomain(slot, 'slot', 'slot');
    const dishItemIds = candidateIdsForSlot(db, slot);
    const suggestions = rank(db, { date, slot, dishItemIds });
    const compositionWarning = zeroLeadsWarning(db, { date, slot });
    res.json({ suggestions, compositionWarning });
  });

  return router;
}

function explainRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { dish, date, slot } = req.query;
    assertRequired(req.query, ['dish', 'date', 'slot']);
    assertInDomain(slot, 'slot', 'slot');
    const dishItemId = Number(dish);
    if (!Number.isInteger(dishItemId)) throw new ApiError(400, 'dish must be a dish_item id');
    const context = buildContext(db, { dishItemId, date, slot });
    const result = evaluate(context);
    res.json({ dish: { id: context.dish.id, name_en: context.dish.name_en, family_name: context.dish.family_name }, date, slot, ...result });
  });

  return router;
}

module.exports = { suggestRouter, explainRouter, candidateIdsForSlot };
