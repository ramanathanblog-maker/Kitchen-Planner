// CRUD for special_day_types / special_day_dates / special_day_assignments — not
// listed explicitly in the Phase 3 build-prompt route list, but Phase 4's Special
// Days admin page ("calendar list, assign a type to a date, per-day allow/avoid/
// block editor") can't function without a backing API, so it's added here rather
// than left as dead UI. None of these three tables has a `version` column (unlike
// the six Phase 3 versioned tables), so this follows the same last-write-wins
// pattern as plans/actual_meals, not the optimistic-concurrency CRUD.
const express = require('express');
const { ApiError } = require('./errors');
const { assertInDomain, assertRequired } = require('./validate');
const { logEvent } = require('./resource');

function specialDayTypesRouter(db) {
  const router = express.Router();
  const fields = ['name', 'default_notes', 'restricts_onion', 'restricts_garlic'];

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM special_day_types ORDER BY name').all());
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM special_day_types WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found');
    res.json(row);
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['name']);
    assertInDomain(body.restricts_onion, 'bool', 'restricts_onion');
    assertInDomain(body.restricts_garlic, 'bool', 'restricts_garlic');
    const cols = fields.filter((f) => body[f] !== undefined);
    const row = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO special_day_types (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => body[c]));
      const created = db.prepare('SELECT * FROM special_day_types WHERE id = ?').get(info.lastInsertRowid);
      logEvent(db, { who: req.editor, tableName: 'special_day_types', rowId: created.id, oldValue: null, newValue: created, source: 'manual_edit' });
      return created;
    })();
    res.status(201).json(row);
  });

  router.put('/:id', (req, res) => {
    const body = req.body || {};
    assertInDomain(body.restricts_onion, 'bool', 'restricts_onion');
    assertInDomain(body.restricts_garlic, 'bool', 'restricts_garlic');
    const current = db.prepare('SELECT * FROM special_day_types WHERE id = ?').get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    const cols = fields.filter((f) => body[f] !== undefined);
    const updated = db.transaction(() => {
      if (cols.length) {
        db.prepare(`UPDATE special_day_types SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
          ...cols.map((c) => body[c]),
          req.params.id
        );
      }
      const row = db.prepare('SELECT * FROM special_day_types WHERE id = ?').get(req.params.id);
      logEvent(db, { who: req.editor, tableName: 'special_day_types', rowId: row.id, oldValue: current, newValue: row, source: 'manual_edit' });
      return row;
    })();
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const current = db.prepare('SELECT * FROM special_day_types WHERE id = ?').get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM special_day_types WHERE id = ?').run(req.params.id);
        logEvent(db, { who: req.editor, tableName: 'special_day_types', rowId: current.id, oldValue: current, newValue: null, source: 'manual_edit' });
      })();
    } catch (e) {
      if (/FOREIGN KEY constraint failed/.test(e.message)) throw new ApiError(400, 'cannot delete: referenced by other rows');
      throw e;
    }
    res.status(204).end();
  });

  return router;
}

// special_day_dates has a composite (date, special_day_type_id) key, no surrogate id.
function specialDayDatesRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    let sql = `SELECT sdd.date, sdd.special_day_type_id, sdt.name AS type_name
               FROM special_day_dates sdd JOIN special_day_types sdt ON sdt.id = sdd.special_day_type_id`;
    const params = [];
    if (req.query.from) {
      sql += ' WHERE sdd.date >= ?';
      params.push(req.query.from);
      if (req.query.to) {
        sql += ' AND sdd.date <= ?';
        params.push(req.query.to);
      }
    }
    sql += ' ORDER BY sdd.date';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['date', 'special_day_type_id']);
    const row = db.transaction(() => {
      db.prepare('INSERT INTO special_day_dates (date, special_day_type_id) VALUES (?, ?)').run(body.date, body.special_day_type_id);
      const created = db
        .prepare(
          `SELECT sdd.date, sdd.special_day_type_id, sdt.name AS type_name
           FROM special_day_dates sdd JOIN special_day_types sdt ON sdt.id = sdd.special_day_type_id
           WHERE sdd.date = ? AND sdd.special_day_type_id = ?`
        )
        .get(body.date, body.special_day_type_id);
      logEvent(db, {
        who: req.editor,
        tableName: 'special_day_dates',
        rowId: 0, // composite key, no surrogate id — row_id is not meaningful here
        oldValue: null,
        newValue: created,
        source: 'manual_edit',
      });
      return created;
    })();
    res.status(201).json(row);
  });

  router.delete('/:date/:typeId', (req, res) => {
    const { date, typeId } = req.params;
    const current = db.prepare('SELECT * FROM special_day_dates WHERE date = ? AND special_day_type_id = ?').get(date, typeId);
    if (!current) throw new ApiError(404, 'not_found');
    db.transaction(() => {
      db.prepare('DELETE FROM special_day_dates WHERE date = ? AND special_day_type_id = ?').run(date, typeId);
      logEvent(db, { who: req.editor, tableName: 'special_day_dates', rowId: 0, oldValue: current, newValue: null, source: 'manual_edit' });
    })();
    res.status(204).end();
  });

  return router;
}

function specialDayAssignmentsRouter(db) {
  const router = express.Router();
  const fields = ['date', 'special_day_type_id', 'family_id', 'dish_item_id', 'rule', 'note'];

  router.get('/', (req, res) => {
    let sql = 'SELECT * FROM special_day_assignments';
    const params = [];
    if (req.query.date) {
      sql += ' WHERE date = ?';
      params.push(req.query.date);
    }
    sql += ' ORDER BY date';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['date', 'special_day_type_id', 'rule']);
    assertInDomain(body.rule, 'special_day_rule', 'rule');
    if (!body.family_id && !body.dish_item_id) {
      throw new ApiError(400, 'one of family_id / dish_item_id is required');
    }
    const cols = fields.filter((f) => body[f] !== undefined);
    const row = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO special_day_assignments (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => body[c]));
      const created = db.prepare('SELECT * FROM special_day_assignments WHERE id = ?').get(info.lastInsertRowid);
      logEvent(db, { who: req.editor, tableName: 'special_day_assignments', rowId: created.id, oldValue: null, newValue: created, source: 'manual_edit' });
      return created;
    })();
    res.status(201).json(row);
  });

  router.delete('/:id', (req, res) => {
    const current = db.prepare('SELECT * FROM special_day_assignments WHERE id = ?').get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    db.transaction(() => {
      db.prepare('DELETE FROM special_day_assignments WHERE id = ?').run(req.params.id);
      logEvent(db, { who: req.editor, tableName: 'special_day_assignments', rowId: current.id, oldValue: current, newValue: null, source: 'manual_edit' });
    })();
    res.status(204).end();
  });

  return router;
}

module.exports = { specialDayTypesRouter, specialDayDatesRouter, specialDayAssignmentsRouter };
