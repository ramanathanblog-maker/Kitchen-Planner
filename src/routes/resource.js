// Generic CRUD router factory for the six versioned tables (ingredients,
// dish_families, dish_items, and the three rule tables). Every write is a single
// db.transaction() covering both the row write and its knowledge_events entry, so
// a failure between the two leaves neither behind (guardrail: multi-row writes in
// transactions). Optimistic concurrency: PUT requires the client's last-read
// `version`; a mismatch returns 409 with the current row so the UI can diff.
const express = require('express');
const { ApiError } = require('./errors');

function logEvent(db, { who, tableName, rowId, oldValue, newValue, source }) {
  db.prepare(
    `INSERT INTO knowledge_events (who, table_name, row_id, old_value, new_value, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(who, tableName, rowId, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), source);
}

function createResourceRouter(db, opts) {
  const {
    table,
    fields, // editable column names, excluding id/version/updated_at/updated_by/origin
    validate = () => {}, // (body, current|null) => void, throws ApiError on bad input
    transforms = {}, // { field: (value) => storedValue }
    extraOnCreate = {}, // fixed columns always set on insert, e.g. { origin: 'user' }
    listQuery, // optional (req) => { where: string, params: [] } for GET / filtering
    defaultOrder = 'id',
  } = opts;

  const router = express.Router();

  const applyTransforms = (body) => {
    const out = { ...body };
    for (const [field, fn] of Object.entries(transforms)) {
      if (out[field] !== undefined) out[field] = fn(out[field]);
    }
    return out;
  };

  router.get('/', (req, res) => {
    let sql = `SELECT * FROM ${table}`;
    const params = [];
    if (listQuery) {
      const q = listQuery(req);
      if (q && q.where) {
        sql += ` WHERE ${q.where}`;
        params.push(...q.params);
      }
    }
    sql += ` ORDER BY ${defaultOrder}`;
    res.json(db.prepare(sql).all(...params));
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found');
    res.json(row);
  });

  router.post('/', (req, res) => {
    const body = applyTransforms(req.body || {});
    validate(body, null);
    const cols = fields.filter((f) => body[f] !== undefined);
    const extraCols = Object.keys(extraOnCreate);
    const allCols = [...cols, ...extraCols, 'updated_by'];
    const allValues = [...cols.map((c) => body[c]), ...extraCols.map((c) => extraOnCreate[c]), req.editor];

    const row = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`)
        .run(...allValues);
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
      logEvent(db, { who: req.editor, tableName: table, rowId: created.id, oldValue: null, newValue: created, source: 'manual_edit' });
      return created;
    })();

    res.status(201).json(row);
  });

  router.put('/:id', (req, res) => {
    const body = applyTransforms(req.body || {});
    if (body.version === undefined) throw new ApiError(400, 'version is required for updates (optimistic concurrency)');

    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    if (current.version !== body.version) {
      throw new ApiError(409, 'version_conflict', { current });
    }
    validate(body, current);

    const cols = fields.filter((f) => body[f] !== undefined);
    const setClause = cols.map((c) => `${c} = ?`).join(', ');
    const values = cols.map((c) => body[c]);

    const updated = db.transaction(() => {
      db.prepare(
        `UPDATE ${table} SET ${setClause}${cols.length ? ', ' : ''} version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?`
      ).run(...values, req.editor, req.params.id);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      logEvent(db, { who: req.editor, tableName: table, rowId: row.id, oldValue: current, newValue: row, source: 'manual_edit' });
      return row;
    })();

    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!current) throw new ApiError(404, 'not_found');
    try {
      db.transaction(() => {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
        logEvent(db, { who: req.editor, tableName: table, rowId: current.id, oldValue: current, newValue: null, source: 'manual_edit' });
      })();
    } catch (e) {
      if (/FOREIGN KEY constraint failed/.test(e.message)) {
        throw new ApiError(400, 'cannot delete: referenced by other rows');
      }
      throw e;
    }
    res.status(204).end();
  });

  return router;
}

module.exports = { createResourceRouter, logEvent };
