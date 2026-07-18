// Regression tests for the meal_patterns validator (Audit 2026-07-18, code #5):
// getMealPatterns()/getSlotPattern() used to be a blind JSON.parse of admin-
// editable settings data, with no defense against malformed JSON, a missing
// `max` (silently unbounded stepper), or an unknown role/filter_class.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const { getMealPatterns, getSlotPattern, MealPatternsFormatError } = require('../src/data/mealPatterns');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-meal-patterns-validation-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}
function freshDb() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  migrate(db);
  return { db, dbPath };
}
function setPatterns(db, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('meal_patterns', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(typeof value === 'string' ? value : JSON.stringify(value));
}

test('malformed top-level JSON throws MealPatternsFormatError', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, '{not valid json');
    assert.throws(() => getMealPatterns(db), MealPatternsFormatError);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('valid JSON that is not an object (e.g. an array) throws MealPatternsFormatError', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, '[1,2,3]');
    assert.throws(() => getMealPatterns(db), MealPatternsFormatError);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('a missing max defaults to 1', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, { morning: { rows: [{ role: 'main_gravy', label: 'Gravy' }] }, noon: { rows: [] }, night: { rows: [] } });
    const pattern = getSlotPattern(db, 'morning');
    assert.equal(pattern.rows.length, 1);
    assert.equal(pattern.rows[0].max, 1);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('an invalid (non-integer / zero / negative) max defaults to 1 instead of crashing or going unbounded', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, {
      morning: { rows: [
        { role: 'main_gravy', label: 'Gravy', max: 0 },
        { role: 'secondary_gravy', label: 'Rasam', max: -3 },
        { role: 'semi_solid_side', label: 'Kootu', max: 'two' },
      ] },
      noon: { rows: [] },
      night: { rows: [] },
    });
    const pattern = getSlotPattern(db, 'morning');
    assert.equal(pattern.rows.length, 3);
    for (const row of pattern.rows) assert.equal(row.max, 1);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('a row with an unknown role is dropped, not rendered and not crashed on', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, {
      morning: { rows: [
        { role: 'main_gravy', label: 'Gravy', max: 1 },
        { role: 'not_a_real_role', label: 'Mystery', max: 1 },
      ] },
      noon: { rows: [] },
      night: { rows: [] },
    });
    const pattern = getSlotPattern(db, 'morning');
    assert.equal(pattern.rows.length, 1);
    assert.equal(pattern.rows[0].role, 'main_gravy');
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('a row with a non-string filter_class is dropped, not crashed on', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, {
      morning: { rows: [
        { role: 'condiment', label: 'Thogayal', max: 1, filter_class: 42 },
      ] },
      noon: { rows: [] },
      night: { rows: [] },
    });
    const pattern = getSlotPattern(db, 'morning');
    assert.equal(pattern.rows.length, 0);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('a slot value that is not an object renders as an empty pattern instead of crashing', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, { morning: 'not an object', noon: { rows: [] }, night: { rows: [] } });
    const pattern = getSlotPattern(db, 'morning');
    assert.deepEqual(pattern.rows, []);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('rows that is not an array renders as an empty pattern instead of crashing', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, { morning: { rows: 'nope' }, noon: { rows: [] }, night: { rows: [] } });
    const pattern = getSlotPattern(db, 'morning');
    assert.deepEqual(pattern.rows, []);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('a missing slot key defaults to an empty pattern', () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, { morning: { rows: [] } });
    const pattern = getSlotPattern(db, 'night');
    assert.deepEqual(pattern.rows, []);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('HTTP: a malformed meal_patterns value renders a visible HTML error page on /plan/:date/:slot, not a raw stack trace', async () => {
  const { db, dbPath } = freshDb();
  try {
    setPatterns(db, '{not valid json');
    const app = createApp(db);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const base = `http://localhost:${server.address().port}`;
      const res = await fetch(`${base}/plan/2026-07-20/morning`);
      assert.equal(res.status, 500);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, /Something went wrong/);
      assert.doesNotMatch(html, /at Object\.<anonymous>/, 'must not leak a raw Node stack trace to the page');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    db.close();
    cleanup(dbPath);
  }
});
