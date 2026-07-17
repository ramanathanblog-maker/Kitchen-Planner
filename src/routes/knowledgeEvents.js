// GET /api/knowledge_events — append-only audit list.
// POST /api/knowledge_events/:id/undo — reverses the recorded change by writing a
// NEW event with source='undo' (never deletes the original, per CLAUDE.md A3.5
// append-only audit; 'undo' is a distinct source value — see migration 005 — so a
// reversal is never indistinguishable from a fresh manual_edit in the timeline):
//   - old_value null (row was created)  -> undo deletes the row
//   - new_value null (row was deleted)  -> undo re-inserts the row as it was
//   - otherwise (update)                -> undo writes old_value's fields back
const express = require('express');
const { ApiError } = require('./errors');
const { logEvent } = require('./resource');

function knowledgeEventsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    let sql = 'SELECT * FROM knowledge_events';
    const params = [];
    const clauses = [];
    if (req.query.table) {
      clauses.push('table_name = ?');
      params.push(req.query.table);
    }
    if (req.query.row_id) {
      clauses.push('row_id = ?');
      params.push(req.query.row_id);
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Number(req.query.limit) || 100, Number(req.query.offset) || 0);
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/:id/undo', (req, res) => {
    const event = db.prepare('SELECT * FROM knowledge_events WHERE id = ?').get(req.params.id);
    if (!event) throw new ApiError(404, 'not_found');

    const oldValue = event.old_value ? JSON.parse(event.old_value) : null;
    const newValue = event.new_value ? JSON.parse(event.new_value) : null;
    const table = event.table_name;
    const rowId = event.row_id;

    const result = db.transaction(() => {
      const before = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId) || null;
      let after;

      if (oldValue === null && newValue !== null) {
        // was a create -> undo deletes
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId);
        after = null;
      } else if (newValue === null && oldValue !== null) {
        // was a delete -> undo re-inserts exactly as it was
        const cols = Object.keys(oldValue);
        db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
          ...cols.map((c) => oldValue[c])
        );
        after = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
      } else {
        // was an update -> undo writes old_value's fields back
        const cols = Object.keys(oldValue).filter((c) => c !== 'id');
        db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
          ...cols.map((c) => oldValue[c]),
          rowId
        );
        after = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
      }

      logEvent(db, { who: req.editor, tableName: table, rowId, oldValue: before, newValue: after, source: 'undo' });
      return after;
    })();

    res.json({ undone_event_id: event.id, result });
  });

  return router;
}

module.exports = { knowledgeEventsRouter };
