// The suggestion sheet (Plan page picker) must never render a flat dump of
// every candidate dish. It groups by meal_role (composition order) and
// collapses each group to the top few, with a "show all" expander. This
// file has no browser/DOM, so it verifies the same pure grouping module the
// Alpine sheet calls (public/suggestion-grouping.js), plus that it keeps the
// rendered count bounded against a real /api/suggest payload for an empty
// morning slot with the full ~191-item seed taxonomy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { groupSuggestions, TOP_N } = require('../public/suggestion-grouping');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { createApp } = require('../src/app');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-grouping-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

test('groupSuggestions collapses each meal_role group to TOP_N and reports hasMore', () => {
  const suggestions = [];
  for (let i = 0; i < 10; i++) {
    suggestions.push({ dishItemId: i, dishName: `Dish ${i}`, mealRole: 'dry_side', status: 'allowed', score: 100 });
  }
  const groups = groupSuggestions(suggestions);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].role, 'dry_side');
  assert.equal(groups[0].top.length, TOP_N);
  assert.equal(groups[0].items.length, 10);
  assert.equal(groups[0].hasMore, true);
});

test('groupSuggestions orders groups by composition order, unknown roles appended after', () => {
  const suggestions = [
    { dishItemId: 1, dishName: 'A', mealRole: 'condiment', status: 'allowed', score: 100 },
    { dishItemId: 2, dishName: 'B', mealRole: 'main_gravy', status: 'allowed', score: 100 },
    { dishItemId: 3, dishName: 'C', mealRole: 'tiffin_main', status: 'allowed', score: 100 },
  ];
  const groups = groupSuggestions(suggestions);
  assert.deepEqual(
    groups.map((g) => g.role),
    ['main_gravy', 'condiment', 'tiffin_main']
  );
});

test('the Plan picker sheet response, once grouped, renders a bounded item count for an empty morning slot (not all 191 dishes)', async () => {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  migrate(db);
  seed(db);
  const app = createApp({ rp: db });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}`;
  try {
    const date = '2099-01-01'; // far future, guaranteed no plans/history for this date
    const res = await fetch(`${base}/api/suggest?date=${date}&slot=morning`, { headers: { 'X-Editor': 'PK' } });
    assert.equal(res.status, 200);
    const { suggestions } = await res.json();
    // The full slot-filtered candidate pool is a meaningful chunk of the seed
    // (well below 191, but sizable) — the bug was rendering ALL of it flat.
    assert.ok(suggestions.length > TOP_N, 'test is only meaningful if the raw candidate pool exceeds the per-group cap');

    const groups = groupSuggestions(suggestions);
    const collapsedCount = groups.reduce((sum, g) => sum + g.top.length, 0);

    assert.ok(collapsedCount < suggestions.length, 'collapsed sheet must render fewer items than the raw candidate pool');
    assert.ok(collapsedCount <= groups.length * TOP_N);
    assert.ok(collapsedCount < 191, 'must never render the full 191-item taxonomy flat');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    cleanup(dbPath);
  }
});
