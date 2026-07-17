// POST /api/teach — the one-tap "teach a rule" endpoint. Creates or updates a rule
// row and its knowledge_events entry in a single db.transaction(): if anything
// throws between the two writes, better-sqlite3 rolls the whole thing back, so
// there is never a rule write with no matching event or vice versa.
//
// Deliberately simpler than the full CRUD PUT in resource.js: no version check —
// "one tap" is meant to be a quick correction from the Today/Plan view, not a
// contested collaborative edit. If id is given the row is blindly updated.
const express = require('express');
const { ApiError } = require('./errors');
const { assertInDomain, assertRequired } = require('./validate');
const { logEvent } = require('./resource');

const TABLES = {
  ingredient_family_rules: {
    fields: ['ingredient_id', 'family_id', 'verdict', 'example_dish', 'rationale_tag', 'note', 'scope'],
    required: ['ingredient_id', 'family_id', 'verdict'],
    validate: (body) => {
      assertInDomain(body.verdict, 'verdict', 'verdict');
      assertInDomain(body.scope, 'scope', 'scope');
    },
  },
  dish_repeat_rules: {
    fields: ['dish_item_id', 'min_gap_days', 'severity', 'rationale_tag', 'note', 'scope'],
    required: ['dish_item_id', 'min_gap_days', 'severity'],
    validate: (body) => {
      assertInDomain(body.severity, 'severity', 'severity');
      assertInDomain(body.scope, 'scope', 'scope');
    },
  },
  dish_compatibility_rules: {
    fields: [
      'source_dish_item_id', 'source_family_id', 'target_dish_item_id', 'target_family_id',
      'direction', 'preference', 'rationale_tag', 'note', 'scope',
    ],
    required: ['preference'],
    validate: (body) => {
      assertInDomain(body.preference, 'preference', 'preference');
      assertInDomain(body.direction, 'direction', 'direction');
      assertInDomain(body.scope, 'scope', 'scope');
    },
  },
};

function teachRouter(db) {
  const router = express.Router();

  router.post('/', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['table']);
    const spec = TABLES[body.table];
    if (!spec) throw new ApiError(400, `table must be one of: ${Object.keys(TABLES).join(', ')}`);

    const cols = spec.fields.filter((f) => body[f] !== undefined);
    if (spec.validate) spec.validate(body);

    const result = db.transaction(() => {
      let current = null;
      if (body.id !== undefined) {
        current = db.prepare(`SELECT * FROM ${body.table} WHERE id = ?`).get(body.id);
        if (!current) throw new ApiError(404, 'not_found');
      } else {
        assertRequired(body, spec.required);
      }

      let row;
      if (current) {
        db.prepare(
          `UPDATE ${body.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?`
        ).run(...cols.map((c) => body[c]), req.editor, body.id);
        row = db.prepare(`SELECT * FROM ${body.table} WHERE id = ?`).get(body.id);
      } else {
        const info = db
          .prepare(`INSERT INTO ${body.table} (${cols.join(', ')}, updated_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`)
          .run(...cols.map((c) => body[c]), req.editor);
        row = db.prepare(`SELECT * FROM ${body.table} WHERE id = ?`).get(info.lastInsertRowid);
      }

      logEvent(db, { who: req.editor, tableName: body.table, rowId: row.id, oldValue: current, newValue: row, source: 'one_tap_teach' });
      return row;
    })();

    res.status(200).json(result);
  });

  return router;
}

module.exports = { teachRouter };
