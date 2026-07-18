// POST /api/plans/:date/serve — copies every planned dish for :date into
// actual_meals, one tap. POST /api/plans/:date/:slot/log — same, scoped to a
// single slot ("Log as eaten" on Today, src/views/today.js). Both are
// idempotent: skip a (date, slot, dish_item_id) that's already recorded as an
// actual, so a double-tap doesn't duplicate rows (actual_meals also has a
// UNIQUE(date, slot, dish_item_id) index as of migration 007, so this is
// belt-and-suspenders, not the only guard). Both run as one db.transaction()
// covering every row + its knowledge_events entry, so a mid-loop failure never
// leaves a slot half-logged (Audit 2026-07-18, code #8: the client used to loop
// one POST per dish with no transaction wrapping the loop).
const express = require('express');
const { assertInDomain } = require('./validate');
const { logEvent } = require('./resource');

function logPlannedRows(db, editor, planned) {
  const out = [];
  for (const plan of planned) {
    const already = db
      .prepare('SELECT 1 FROM actual_meals WHERE date = ? AND slot = ? AND dish_item_id = ?')
      .get(plan.date, plan.slot, plan.dish_item_id);
    if (already) continue;
    const info = db
      .prepare(
        `INSERT INTO actual_meals (date, slot, dish_item_id, note, ordering, headcount)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(plan.date, plan.slot, plan.dish_item_id, plan.note, plan.ordering, plan.headcount);
    const row = db.prepare('SELECT * FROM actual_meals WHERE id = ?').get(info.lastInsertRowid);
    logEvent(db, { who: editor, tableName: 'actual_meals', rowId: row.id, oldValue: null, newValue: row, source: 'manual_edit' });
    out.push(row);
  }
  return out;
}

function serveRouter(db) {
  const router = express.Router();

  router.post('/:date/serve', (req, res) => {
    const { date } = req.params;
    const created = db.transaction(() =>
      logPlannedRows(db, req.editor, db.prepare('SELECT * FROM plans WHERE date = ?').all(date))
    )();
    res.status(200).json({ date, created });
  });

  router.post('/:date/:slot/log', (req, res) => {
    const { date, slot } = req.params;
    assertInDomain(slot, 'slot', 'slot');
    const created = db.transaction(() =>
      logPlannedRows(db, req.editor, db.prepare('SELECT * FROM plans WHERE date = ? AND slot = ?').all(date, slot))
    )();
    res.status(200).json({ date, slot, created });
  });

  return router;
}

module.exports = { serveRouter };
