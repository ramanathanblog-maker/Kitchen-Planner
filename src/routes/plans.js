// plans / actual_meals CRUD — no optimistic-concurrency version column on these
// tables (spec lists version checking for the taxonomy + rule tables only; a
// plan/actual row is a single tap's worth of state, not collaboratively edited
// knowledge, so last-write-wins is the simplest option consistent with A1/A3).
const express = require('express');
const { ApiError } = require('./errors');
const { assertInDomain, assertRequired } = require('./validate');
const { logEvent } = require('./resource');
const { assertPlanEditable } = require('./planLock');

function simpleCrudRouter(db, table) {
  const router = express.Router();
  const fields = ['date', 'slot', 'dish_item_id', 'note', 'ordering', 'headcount'];

  router.get('/', (req, res) => {
    let sql = `SELECT * FROM ${table}`;
    const params = [];
    const clauses = [];
    if (req.query.date) {
      clauses.push('date = ?');
      params.push(req.query.date);
    }
    if (req.query.from) {
      clauses.push('date >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push('date <= ?');
      params.push(req.query.to);
    }
    if (req.query.slot) {
      clauses.push('slot = ?');
      params.push(req.query.slot);
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += ' ORDER BY date, slot, ordering';
    res.json(db.prepare(sql).all(...params));
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found');
    res.json(row);
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['date', 'slot', 'dish_item_id']);
    assertInDomain(body.slot, 'slot', 'slot');
    if (table === 'plans') assertPlanEditable(req.editor, body.date);

    // actual_meals has a UNIQUE(date, slot, dish_item_id) index (migration 007).
    // A repeat POST — a double-tap, or a client retry after a network blip — is
    // idempotent: it returns the already-recorded row (200, not 201) rather than
    // erroring or creating a duplicate that would skew the engine's repeat-gap
    // history. Same "skip if already recorded" precedent as the day-level
    // POST /api/plans/:date/serve (src/routes/serve.js). Audit 2026-07-18, code #8.
    if (table === 'actual_meals') {
      const existing = db
        .prepare('SELECT * FROM actual_meals WHERE date = ? AND slot = ? AND dish_item_id = ?')
        .get(body.date, body.slot, body.dish_item_id);
      if (existing) return res.status(200).json(existing);
    }

    const cols = fields.filter((f) => body[f] !== undefined);
    const row = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => body[c]));
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
      logEvent(db, { who: req.editor, tableName: table, rowId: created.id, oldValue: null, newValue: created, source: 'manual_edit' });
      return created;
    })();
    res.status(201).json(row);
  });

  router.put('/:id', (req, res) => {
    const body = req.body || {};
    assertInDomain(body.slot, 'slot', 'slot');
    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    if (table === 'plans') assertPlanEditable(req.editor, current.date);
    const cols = fields.filter((f) => body[f] !== undefined);
    const updated = db.transaction(() => {
      if (cols.length) {
        db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
          ...cols.map((c) => body[c]),
          req.params.id
        );
      }
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      logEvent(db, { who: req.editor, tableName: table, rowId: row.id, oldValue: current, newValue: row, source: 'manual_edit' });
      return row;
    })();
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    if (table === 'plans') assertPlanEditable(req.editor, current.date);
    db.transaction(() => {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
      logEvent(db, { who: req.editor, tableName: table, rowId: current.id, oldValue: current, newValue: null, source: 'manual_edit' });
    })();
    res.status(204).end();
  });

  return router;
}

module.exports = { simpleCrudRouter };
