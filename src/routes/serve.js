// POST /api/plans/:date/serve — copies every planned dish for :date into
// actual_meals, one tap. Idempotent: skips a (date, slot, dish_item_id) that's
// already recorded as an actual, so double-tapping "serve" doesn't duplicate rows.
const express = require('express');
const { logEvent } = require('./resource');

function serveRouter(db) {
  const router = express.Router();

  router.post('/:date/serve', (req, res) => {
    const { date } = req.params;
    const created = db.transaction(() => {
      const planned = db.prepare('SELECT * FROM plans WHERE date = ?').all(date);
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
        logEvent(db, { who: req.editor, tableName: 'actual_meals', rowId: row.id, oldValue: null, newValue: row, source: 'manual_edit' });
        out.push(row);
      }
      return out;
    })();
    res.status(200).json({ date, created });
  });

  return router;
}

module.exports = { serveRouter };
