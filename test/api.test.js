const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { createApp } = require('../src/app');
const { todayStr: appTodayStr } = require('../src/data/dates');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-api-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

// Boots a real HTTP server on an ephemeral port against a seeded temp DB, and
// returns { db, base, close } for supertest-style fetch() calls. node:test +
// native fetch is sufficient — no supertest dependency needed on Node 22.
async function startServer() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  migrate(db);
  seed(db);
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}`;
  return {
    db,
    base,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          cleanup(dbPath);
          resolve();
        });
      }),
  };
}

function pk(extra = {}) {
  return { 'X-Editor': 'PK', 'Content-Type': 'application/json', ...extra };
}
function rp(extra = {}) {
  return { 'X-Editor': 'RP', 'Content-Type': 'application/json', ...extra };
}

test('GET /health reports real DB connectivity, migration version, and taxonomy version+sha256', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.db, 'ready');
    assert.ok(body.migration, 'migration must report the actual applied schema_migrations version, not null');
    assert.equal(body.taxonomy_version, '1.7');
    assert.match(body.taxonomy_json_sha256, /^[0-9a-f]{64}$/);
  } finally {
    await ctx.close();
  }
});

test('GET /health reports db:error with a non-200 status when the DB is unreachable', async () => {
  const ctx = await startServer();
  try {
    ctx.db.close();
    const res = await fetch(`${ctx.base}/health`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.db, 'error');
  } finally {
    await ctx.close();
  }
});

test('missing X-Editor -> 400 on API routes', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/ingredients`);
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

test('ingredients CRUD happy path', async () => {
  const ctx = await startServer();
  try {
    const listRes = await fetch(`${ctx.base}/api/ingredients`, { headers: pk() });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.ok(list.length > 0);

    const createRes = await fetch(`${ctx.base}/api/ingredients`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ name_en: 'Test Veg', category: 'vegetable' }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.origin, 'user');
    assert.equal(created.updated_by, 'PK');
    assert.equal(created.version, 1);

    const getRes = await fetch(`${ctx.base}/api/ingredients/${created.id}`, { headers: pk() });
    assert.equal(getRes.status, 200);

    const putRes = await fetch(`${ctx.base}/api/ingredients/${created.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ version: created.version, seasonality_note: 'summer' }),
    });
    assert.equal(putRes.status, 200);
    const updated = await putRes.json();
    assert.equal(updated.seasonality_note, 'summer');
    assert.equal(updated.version, 2);

    const delRes = await fetch(`${ctx.base}/api/ingredients/${created.id}`, { method: 'DELETE', headers: pk() });
    assert.equal(delRes.status, 204);

    const getGoneRes = await fetch(`${ctx.base}/api/ingredients/${created.id}`, { headers: pk() });
    assert.equal(getGoneRes.status, 404);
  } finally {
    await ctx.close();
  }
});

test('CHECK-domain validation returns a friendly 400, not a raw SQLite error', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/ingredients`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ name_en: 'Bad Category Veg', category: 'not_a_real_category' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /category must be one of/);
  } finally {
    await ctx.close();
  }
});

test('PUT with stale version -> 409 with current row (the concurrency path RP/PS will actually hit: two people editing the same ingredient/rule from different phones)', async () => {
  const ctx = await startServer();
  try {
    const row = await (await fetch(`${ctx.base}/api/ingredients`, { headers: pk() })).json().then((r) => r[0]);

    const firstPut = await fetch(`${ctx.base}/api/ingredients/${row.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ version: row.version, seasonality_note: 'first write' }),
    });
    assert.equal(firstPut.status, 200);

    const staleRes = await fetch(`${ctx.base}/api/ingredients/${row.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ version: row.version, seasonality_note: 'stale write' }),
    });
    assert.equal(staleRes.status, 409);
    const body = await staleRes.json();
    assert.equal(body.error, 'version_conflict');
    assert.equal(body.current.seasonality_note, 'first write');
  } finally {
    await ctx.close();
  }
});

test('POST /api/teach writes rule + knowledge_event atomically', async () => {
  const ctx = await startServer();
  try {
    const kariFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    const someIngredient = ctx.db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_005'").get();

    const res = await fetch(`${ctx.base}/api/teach`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({
        table: 'ingredient_family_rules',
        ingredient_id: someIngredient.id,
        family_id: kariFamily.id,
        verdict: 'avoid',
        note: 'taught via one-tap',
      }),
    });
    assert.equal(res.status, 200);
    const row = await res.json();

    const ruleRow = ctx.db.prepare('SELECT * FROM ingredient_family_rules WHERE id = ?').get(row.id);
    assert.ok(ruleRow);
    const eventRow = ctx.db
      .prepare("SELECT * FROM knowledge_events WHERE table_name = 'ingredient_family_rules' AND row_id = ? AND source = 'one_tap_teach'")
      .get(row.id);
    assert.ok(eventRow);
  } finally {
    await ctx.close();
  }
});

test("scope negative test: scope='person:RP' is rejected at the app layer on all three rule-write paths (CRUD PUT/POST and /api/teach) — scope isn't a CHECK constraint, so this is the only thing enforcing the A1 v1 hook restriction", async () => {
  const ctx = await startServer();
  try {
    const kariFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    const someIngredient = ctx.db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_006'").get();
    // Baseline, not 0 — seeding already wrote one ingredient_family_rules row
    // (drumstick never in Kari).
    const baselineCount = ctx.db.prepare('SELECT COUNT(*) c FROM ingredient_family_rules').get().c;

    const createRes = await fetch(`${ctx.base}/api/rules/ingredient_family`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({
        ingredient_id: someIngredient.id,
        family_id: kariFamily.id,
        verdict: 'avoid',
        scope: 'person:RP',
      }),
    });
    assert.equal(createRes.status, 400);
    assert.match((await createRes.json()).error, /scope must be one of/);
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) c FROM ingredient_family_rules').get().c,
      baselineCount,
      'the rejected row must not have been written'
    );

    const teachRes = await fetch(`${ctx.base}/api/teach`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({
        table: 'ingredient_family_rules',
        ingredient_id: someIngredient.id,
        family_id: kariFamily.id,
        verdict: 'avoid',
        scope: 'person:RP',
      }),
    });
    assert.equal(teachRes.status, 400);
    assert.match((await teachRes.json()).error, /scope must be one of/);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) c FROM ingredient_family_rules').get().c, baselineCount);

    // A legitimate row exists so the PUT path can be exercised too.
    const goodCreate = await (
      await fetch(`${ctx.base}/api/rules/ingredient_family`, {
        method: 'POST',
        headers: pk(),
        body: JSON.stringify({ ingredient_id: someIngredient.id, family_id: kariFamily.id, verdict: 'avoid' }),
      })
    ).json();
    assert.equal(goodCreate.scope, 'household');

    const putRes = await fetch(`${ctx.base}/api/rules/ingredient_family/${goodCreate.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ version: goodCreate.version, scope: 'person:RP' }),
    });
    assert.equal(putRes.status, 400);
    assert.match((await putRes.json()).error, /scope must be one of/);
    const unchanged = ctx.db.prepare('SELECT scope FROM ingredient_family_rules WHERE id = ?').get(goodCreate.id);
    assert.equal(unchanged.scope, 'household', 'scope must remain household after the rejected write');
  } finally {
    await ctx.close();
  }
});

test('POST /api/teach kill test: forced failure on the knowledge_events INSERT (injected mid-transaction, after the rule write) rolls back both the rule row and the event row', async () => {
  const ctx = await startServer();
  try {
    const kariFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    const someIngredient = ctx.db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_006'").get();

    const beforeRuleCount = ctx.db.prepare('SELECT COUNT(*) c FROM ingredient_family_rules').get().c;
    const beforeEventCount = ctx.db.prepare('SELECT COUNT(*) c FROM knowledge_events').get().c;

    // Force the knowledge_events INSERT specifically to throw, simulating a failure
    // mid-transaction, without touching production code (no test-only backdoor).
    const originalPrepare = ctx.db.prepare.bind(ctx.db);
    ctx.db.prepare = (sql) => {
      if (/INSERT INTO knowledge_events/.test(sql)) {
        throw new Error('forced failure for kill test');
      }
      return originalPrepare(sql);
    };

    let threw = false;
    try {
      const app2 = createApp(ctx.db);
      const server2 = await new Promise((resolve) => {
        const s = app2.listen(0, () => resolve(s));
      });
      const base2 = `http://localhost:${server2.address().port}`;
      const res = await fetch(`${base2}/api/teach`, {
        method: 'POST',
        headers: pk(),
        body: JSON.stringify({
          table: 'ingredient_family_rules',
          ingredient_id: someIngredient.id,
          family_id: kariFamily.id,
          verdict: 'avoid',
        }),
      });
      threw = res.status === 500;
      await new Promise((resolve) => server2.close(resolve));
    } finally {
      ctx.db.prepare = originalPrepare;
    }

    assert.ok(threw, 'expected the forced failure to surface as a 500');
    const afterRuleCount = ctx.db.prepare('SELECT COUNT(*) c FROM ingredient_family_rules').get().c;
    const afterEventCount = ctx.db.prepare('SELECT COUNT(*) c FROM knowledge_events').get().c;
    assert.equal(afterRuleCount, beforeRuleCount, 'rule row must not exist after rollback');
    assert.equal(afterEventCount, beforeEventCount, 'event row must not exist after rollback');
  } finally {
    await ctx.close();
  }
});

test("undo restores the prior value and appends a new event with source='undo' (never deletes the original, and is distinguishable from a manual_edit in the timeline)", async () => {
  const ctx = await startServer();
  try {
    const row = await (await fetch(`${ctx.base}/api/ingredients`, { headers: pk() })).json().then((r) => r[0]);

    const putRes = await fetch(`${ctx.base}/api/ingredients/${row.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ version: row.version, seasonality_note: 'changed' }),
    });
    const updated = await putRes.json();

    const eventsBefore = ctx.db.prepare('SELECT COUNT(*) c FROM knowledge_events').get().c;
    const editEvent = ctx.db
      .prepare("SELECT * FROM knowledge_events WHERE table_name='ingredients' AND row_id=? ORDER BY id DESC LIMIT 1")
      .get(row.id);

    const undoRes = await fetch(`${ctx.base}/api/knowledge_events/${editEvent.id}/undo`, { method: 'POST', headers: pk() });
    assert.equal(undoRes.status, 200);
    const undoBody = await undoRes.json();
    assert.equal(undoBody.result.seasonality_note, row.seasonality_note);

    const eventsAfter = ctx.db.prepare('SELECT COUNT(*) c FROM knowledge_events').get().c;
    assert.equal(eventsAfter, eventsBefore + 1, 'undo appends a new event, never deletes');

    const originalEventStillThere = ctx.db.prepare('SELECT * FROM knowledge_events WHERE id = ?').get(editEvent.id);
    assert.ok(originalEventStillThere, 'the original event row must survive undo');
    assert.equal(originalEventStillThere.source, 'manual_edit', 'the original edit event keeps its original source');

    const undoEvent = ctx.db.prepare('SELECT * FROM knowledge_events ORDER BY id DESC LIMIT 1').get();
    assert.equal(undoEvent.source, 'undo', "the reversal is logged with source='undo', not manual_edit");

    const finalRow = ctx.db.prepare('SELECT * FROM ingredients WHERE id = ?').get(row.id);
    assert.equal(finalRow.seasonality_note, row.seasonality_note);
  } finally {
    await ctx.close();
  }
});

test('GET /api/suggest and /api/explain', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/suggest?date=2026-07-16&slot=morning`, { headers: pk() });
    assert.equal(res.status, 200);
    const suggestBody = await res.json();
    const { suggestions } = suggestBody;
    assert.ok('compositionWarning' in suggestBody, 'response carries the slot-level composition warning separately from per-dish suggestions');
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.every((s) => s.status !== 'blocked'));
    assert.ok(
      suggestions.every((s) => !s.findings.some((f) => f.step === 'meal_composition' && /No sambar/.test(f.message))),
      'zero-leads is a slot-level condition and must never appear in a per-dish findings array'
    );

    const onionSambar = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_011'").get();
    const explainRes = await fetch(`${ctx.base}/api/explain?dish=${onionSambar.id}&date=2026-07-16&slot=morning`, { headers: pk() });
    assert.equal(explainRes.status, 200);
    const body = await explainRes.json();
    assert.equal(body.dish.name_en, 'Vengaya Sambar');
    assert.ok('status' in body);
    assert.ok(Array.isArray(body.findings));
  } finally {
    await ctx.close();
  }
});

test('POST /api/plans/:date/serve copies planned dishes to actual_meals, idempotently', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'morning', dish_item_id: dish.id }),
    });

    const serveRes = await fetch(`${ctx.base}/api/plans/2026-07-16/serve`, { method: 'POST', headers: pk() });
    assert.equal(serveRes.status, 200);
    const body = await serveRes.json();
    assert.equal(body.created.length, 1);

    const serveAgainRes = await fetch(`${ctx.base}/api/plans/2026-07-16/serve`, { method: 'POST', headers: pk() });
    const bodyAgain = await serveAgainRes.json();
    assert.equal(bodyAgain.created.length, 0, 'second serve is a no-op for the same plan');

    const actualCount = ctx.db.prepare("SELECT COUNT(*) c FROM actual_meals WHERE date='2026-07-16'").get().c;
    assert.equal(actualCount, 1);
  } finally {
    await ctx.close();
  }
});

// Regression (Audit 2026-07-18, code #8): the Today page's "Log as eaten" used
// to loop one POST /api/actual_meals call per planned dish client-side, with no
// transaction — a mid-loop failure could leave a slot half-logged. This single
// route does the whole slot in one db.transaction() server-side.
test('POST /api/plans/:date/:slot/log copies only that slot\'s planned dishes to actual_meals, idempotently, in one transaction', async () => {
  const ctx = await startServer();
  try {
    const morningDish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    const noonDish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_078'").get();
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'morning', dish_item_id: morningDish.id }),
    });
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'noon', dish_item_id: noonDish.id }),
    });

    const logRes = await fetch(`${ctx.base}/api/plans/2026-07-16/morning/log`, { method: 'POST', headers: pk() });
    assert.equal(logRes.status, 200);
    const body = await logRes.json();
    assert.equal(body.created.length, 1);
    assert.equal(body.created[0].slot, 'morning');

    // noon was never logged — the route is slot-scoped, not day-scoped.
    const noonActual = ctx.db.prepare("SELECT COUNT(*) c FROM actual_meals WHERE date='2026-07-16' AND slot='noon'").get().c;
    assert.equal(noonActual, 0);

    const logAgainRes = await fetch(`${ctx.base}/api/plans/2026-07-16/morning/log`, { method: 'POST', headers: pk() });
    const bodyAgain = await logAgainRes.json();
    assert.equal(bodyAgain.created.length, 0, 'second log is a no-op for the same slot');

    const morningActualCount = ctx.db.prepare("SELECT COUNT(*) c FROM actual_meals WHERE date='2026-07-16' AND slot='morning'").get().c;
    assert.equal(morningActualCount, 1);
  } finally {
    await ctx.close();
  }
});

test('POST /api/plans/:date/:slot/log rejects an unknown slot', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/plans/2026-07-16/brunch/log`, { method: 'POST', headers: pk() });
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});

// Regression (Audit 2026-07-18, code #8): actual_meals now has a
// UNIQUE(date, slot, dish_item_id) index (migration 007). POST is idempotent
// against it — a double-tap on "Log as eaten" (via the override sheet's direct
// markEaten call, not the slot-log route above) returns the existing row
// instead of erroring or duplicating.
test('POST /api/actual_meals with a duplicate (date, slot, dish_item_id) returns the existing row, does not duplicate', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    const first = await fetch(`${ctx.base}/api/actual_meals`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json();

    const second = await fetch(`${ctx.base}/api/actual_meals`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(second.status, 200, 'a repeat POST is idempotent, not an error');
    const secondBody = await second.json();
    assert.equal(secondBody.id, firstBody.id);

    const count = ctx.db.prepare("SELECT COUNT(*) c FROM actual_meals WHERE date='2026-07-16' AND slot='morning' AND dish_item_id=?").get(dish.id).c;
    assert.equal(count, 1);
  } finally {
    await ctx.close();
  }
});

test('GET /api/shopping de-duplicates ingredients and splits tomorrow vs week', async () => {
  const ctx = await startServer();
  try {
    // Two dishes on day 1 sharing an ingredient (drumstick, veg_001, via morkuzhambu_vendaikkai
    // and murungakkai_vathakozhambu) should collapse to one shopping-list entry.
    const dish1 = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get(); // uses veg_017 (vendaikkai)
    const dish2 = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get(); // uses veg_001 (murungakkai)
    const dish3 = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_025'").get(); // carrot_kari, day 3, distinct ingredient

    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'morning', dish_item_id: dish1.id }),
    });
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'night', dish_item_id: dish2.id }),
    });
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-18', slot: 'morning', dish_item_id: dish3.id }),
    });

    const res = await fetch(`${ctx.base}/api/shopping?from=2026-07-16&to=2026-07-22`, { headers: pk() });
    assert.equal(res.status, 200);
    const body = await res.json();

    // "tomorrow" (day 1 only) sees both dish1+dish2's ingredients, deduplicated,
    // but not dish3's (that's two days later).
    const tomorrowNames = body.tomorrow.to_buy.map((i) => i.name_en);
    assert.equal(new Set(tomorrowNames).size, tomorrowNames.length, 'tomorrow list must be deduplicated');
    assert.ok(!tomorrowNames.some((n) => /Carrot/i.test(n)), 'day-3-only ingredient must not appear in tomorrow');

    // "week" spans the full range and additionally includes dish3's ingredient.
    const weekNames = body.week.to_buy.map((i) => i.name_en);
    assert.ok(weekNames.some((n) => /Carrot/i.test(n)), 'week view must include the day-3 dish');
    assert.equal(new Set(weekNames).size, weekNames.length, 'week list must be deduplicated');
  } finally {
    await ctx.close();
  }
});

test('leftover_flag excludes an ingredient from to_buy and puts it in have_leftover', async () => {
  const ctx = await startServer();
  try {
    const dish1 = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    const veg = ctx.db.prepare("SELECT id, version FROM ingredients WHERE external_id = 'veg_017'").get();

    await fetch(`${ctx.base}/api/ingredients/${veg.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ version: veg.version, leftover_flag: 1 }),
    });
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: '2026-07-16', slot: 'morning', dish_item_id: dish1.id }),
    });

    const res = await fetch(`${ctx.base}/api/shopping?from=2026-07-16&to=2026-07-16`, { headers: pk() });
    const body = await res.json();
    assert.ok(body.tomorrow.have_leftover.some((i) => i.id === veg.id));
    assert.ok(!body.tomorrow.to_buy.some((i) => i.id === veg.id));
  } finally {
    await ctx.close();
  }
});

// Delegates to the app's real (IST-aware) todayStr so test-constructed "today"
// fixtures stay aligned with what the app under test actually considers today.
function todayStr() {
  return appTodayStr();
}
function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('GET /api/display/today requires no X-Editor header and reflects planned/actual/none per slot', async () => {
  const ctx = await startServer();
  try {
    const today = todayStr();
    const morningDish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_002'").get();
    const noonDish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_078'").get(); // plain_dosai

    // night: nothing planned or served -> 'none'.
    // morning: only planned -> 'planned'.
    // noon: both planned and served -> 'actual' wins.
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: today, slot: 'morning', dish_item_id: morningDish.id }),
    });
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: today, slot: 'noon', dish_item_id: noonDish.id }),
    });
    await fetch(`${ctx.base}/api/actual_meals`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: today, slot: 'noon', dish_item_id: noonDish.id }),
    });

    // No X-Editor header at all — this must not 400 like the gated /api/* routes do.
    const res = await fetch(`${ctx.base}/api/display/today`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.date, today);
    assert.equal(body.slots.morning.source, 'planned');
    assert.equal(body.slots.morning.dishes[0].name_en, morningDish.name_en);
    assert.equal(body.slots.noon.source, 'actual');
    assert.equal(body.slots.noon.dishes[0].name_en, noonDish.name_en);
    assert.equal(body.slots.night.source, 'none');
    assert.deepEqual(body.slots.night.dishes, []);
  } finally {
    await ctx.close();
  }
});

test('GET /api/display/today surfaces the special-day note when today is a special day', async () => {
  const ctx = await startServer();
  try {
    const today = todayStr();
    const typeInfo = ctx.db
      .prepare('INSERT INTO special_day_types (name, restricts_onion, restricts_garlic) VALUES (?, 1, 0)')
      .run('Amavasai');
    ctx.db.prepare('INSERT INTO special_day_dates (date, special_day_type_id) VALUES (?, ?)').run(today, typeInfo.lastInsertRowid);

    const res = await fetch(`${ctx.base}/api/display/today`);
    const body = await res.json();
    assert.ok(Array.isArray(body.special_day));
    assert.equal(body.special_day[0].name, 'Amavasai');
    assert.equal(body.special_day[0].restricts_onion, 1);
  } finally {
    await ctx.close();
  }
});

test('GET /api/display/shopping requires no X-Editor header and covers tomorrow + the next 7 days', async () => {
  const ctx = await startServer();
  try {
    const tomorrow = addDaysStr(todayStr(), 1);
    const day5 = addDaysStr(todayStr(), 5);
    const dish1 = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    const dish2 = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_025'").get(); // carrot_kari

    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: tomorrow, slot: 'morning', dish_item_id: dish1.id }),
    });
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: day5, slot: 'morning', dish_item_id: dish2.id }),
    });

    const res = await fetch(`${ctx.base}/api/display/shopping`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.tomorrow.date, tomorrow);
    assert.ok(!body.tomorrow.to_buy.some((i) => /Carrot/i.test(i.name_en)), 'day-5 dish must not appear in tomorrow');
    assert.ok(body.week.to_buy.some((i) => /Carrot/i.test(i.name_en)), 'week view must include the day-5 dish');
    assert.equal(body.week.from, tomorrow);
  } finally {
    await ctx.close();
  }
});

test('special_day_types/dates/assignments CRUD happy path, and the special day is honored by the engine via /api/display/today', async () => {
  const ctx = await startServer();
  try {
    const typeRes = await fetch(`${ctx.base}/api/special_day_types`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ name: 'Amavasai', restricts_onion: 1, restricts_garlic: 1 }),
    });
    assert.equal(typeRes.status, 201);
    const type = await typeRes.json();

    const today = appTodayStr();
    const dateRes = await fetch(`${ctx.base}/api/special_day_dates`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: today, special_day_type_id: type.id }),
    });
    assert.equal(dateRes.status, 201);
    const dateRow = await dateRes.json();
    assert.equal(dateRow.type_name, 'Amavasai');

    const listRes = await fetch(`${ctx.base}/api/special_day_dates?from=${today}&to=${today}`, { headers: pk() });
    assert.equal((await listRes.json()).length, 1);

    const kariFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    const assignRes = await fetch(`${ctx.base}/api/special_day_assignments`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: today, special_day_type_id: type.id, family_id: kariFamily.id, rule: 'avoid', note: 'test' }),
    });
    assert.equal(assignRes.status, 201);

    // The onion-flagged rule attaches generically via restricts_onion — visible on the
    // read-only display endpoint with no editor identity.
    const displayRes = await fetch(`${ctx.base}/api/display/today`);
    const displayBody = await displayRes.json();
    assert.ok(displayBody.special_day.some((s) => s.name === 'Amavasai'));

    const delRes = await fetch(`${ctx.base}/api/special_day_dates/${today}/${type.id}`, { method: 'DELETE', headers: pk() });
    assert.equal(delRes.status, 204);
    const listAfter = await (await fetch(`${ctx.base}/api/special_day_dates?from=${today}&to=${today}`, { headers: pk() })).json();
    assert.equal(listAfter.length, 0);
  } finally {
    await ctx.close();
  }
});

// P1a — documents that scope-omission is NOT a failure mode (closes the "silent
// failure" red herring investigated before this batch of fixes): assertInDomain
// skips validation on undefined, so /api/teach without an explicit `scope` must
// succeed and persist with the column's DEFAULT 'household'.
test('teach without explicit scope succeeds and persists scope=household by default', async () => {
  const ctx = await startServer();
  try {
    const dishItem = ctx.db.prepare('SELECT id FROM dish_items LIMIT 1').get();
    const res = await fetch(`${ctx.base}/api/teach`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({
        table: 'dish_repeat_rules',
        dish_item_id: dishItem.id,
        min_gap_days: 14,
        severity: 'soft',
        rationale_tag: 'dislike',
        note: 'no scope field on purpose',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const persisted = ctx.db.prepare('SELECT * FROM dish_repeat_rules WHERE id = ?').get(body.id);
    assert.equal(persisted.scope, 'household');
  } finally {
    await ctx.close();
  }
});

// P1a — a deliberately invalid /api/teach payload (missing a required field) must
// return non-200 so the UI's error banner has something real to surface instead of
// silently proceeding as if the write succeeded.
test('teach with a missing required field returns a non-200 error, not a silent success', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/teach`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({
        table: 'dish_repeat_rules',
        // dish_item_id / min_gap_days / severity all omitted — required fields missing.
        rationale_tag: 'dislike',
      }),
    });
    assert.notEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.error);
  } finally {
    await ctx.close();
  }
});

// P1b — a seeded dish_repeat_rules row (dish_repeat_rules/ingredient_family_rules
// have no `origin` column at all, unlike dish_items/dish_families/ingredients) must
// be freely editable, and the edit must survive a full reseed since seed() never
// touches rule tables (only dish_items/dish_families/ingredients).
test('edited seeded dish_repeat_rules row survives a full reseed untouched', async () => {
  const ctx = await startServer();
  try {
    const seededRule = ctx.db.prepare("SELECT * FROM dish_repeat_rules WHERE updated_by = 'seed' LIMIT 1").get();
    assert.ok(seededRule, 'expected at least one seed-origin dish_repeat_rules row');

    const putRes = await fetch(`${ctx.base}/api/rules/dish_repeat/${seededRule.id}`, {
      method: 'PUT',
      headers: pk(),
      body: JSON.stringify({ ...seededRule, min_gap_days: 999 }),
    });
    assert.equal(putRes.status, 200);

    const { migrate } = require('../src/db/migrate');
    const { seed } = require('../seed/load');
    migrate(ctx.db);
    seed(ctx.db);

    const afterReseed = ctx.db.prepare('SELECT * FROM dish_repeat_rules WHERE id = ?').get(seededRule.id);
    assert.equal(afterReseed.min_gap_days, 999);
  } finally {
    await ctx.close();
  }
});

// P1b — the Knowledge UI now offers a Delete action per rule row (route-level
// coverage: the DELETE route itself, already generic via createResourceRouter,
// works against a seed-origin rule with no origin-based block).
test('DELETE /api/rules/dish_repeat/:id works against a seed-origin rule (no origin block exists)', async () => {
  const ctx = await startServer();
  try {
    const seededRule = ctx.db.prepare("SELECT * FROM dish_repeat_rules WHERE updated_by = 'seed' LIMIT 1").get();
    assert.ok(seededRule);
    const delRes = await fetch(`${ctx.base}/api/rules/dish_repeat/${seededRule.id}`, { method: 'DELETE', headers: pk() });
    assert.equal(delRes.status, 204);
    const gone = ctx.db.prepare('SELECT * FROM dish_repeat_rules WHERE id = ?').get(seededRule.id);
    assert.equal(gone, undefined);
  } finally {
    await ctx.close();
  }
});

// P1 — past-day plans rows are locked for RP/PS, enforced server-side (not just
// hidden in the UI): a direct API call from RP must 403, PK must still succeed,
// and actual_meals (a log of what happened, not a rewrite of intent) must stay
// editable by RP on any date.
test('P1: past-day plans lock', async (t) => {
  const ctx = await startServer();
  try {
    const yesterday = addDaysStr(todayStr(), -1);
    const dish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();

    await t.test('RP write to a past-day plans row -> 403', async () => {
      const res = await fetch(`${ctx.base}/api/plans`, {
        method: 'POST',
        headers: rp(),
        body: JSON.stringify({ date: yesterday, slot: 'morning', dish_item_id: dish.id }),
      });
      assert.equal(res.status, 403);
    });

    await t.test('PK write to a past-day plans row -> succeeds', async () => {
      const res = await fetch(`${ctx.base}/api/plans`, {
        method: 'POST',
        headers: pk(),
        body: JSON.stringify({ date: yesterday, slot: 'morning', dish_item_id: dish.id }),
      });
      assert.equal(res.status, 201);
    });

    await t.test('RP write to today/future plans -> succeeds as before', async () => {
      const res = await fetch(`${ctx.base}/api/plans`, {
        method: 'POST',
        headers: rp(),
        body: JSON.stringify({ date: todayStr(), slot: 'morning', dish_item_id: dish.id }),
      });
      assert.equal(res.status, 201);
    });

    await t.test('RP write to a past-day actual_meals row -> succeeds (actuals unaffected)', async () => {
      const res = await fetch(`${ctx.base}/api/actual_meals`, {
        method: 'POST',
        headers: rp(),
        body: JSON.stringify({ date: yesterday, slot: 'morning', dish_item_id: dish.id }),
      });
      assert.equal(res.status, 201);
    });

    await t.test('RP PUT/DELETE on an existing past-day plans row -> 403', async () => {
      const row = ctx.db.prepare("SELECT * FROM plans WHERE date = ?").get(yesterday);
      assert.ok(row, 'expected the PK-created past-day plan row from above');
      const putRes = await fetch(`${ctx.base}/api/plans/${row.id}`, {
        method: 'PUT',
        headers: rp(),
        body: JSON.stringify({ note: 'x' }),
      });
      assert.equal(putRes.status, 403);
      const delRes = await fetch(`${ctx.base}/api/plans/${row.id}`, { method: 'DELETE', headers: rp() });
      assert.equal(delRes.status, 403);
    });
  } finally {
    await ctx.close();
  }
});

// P2 — shopping list excludes today: neither /api/display/shopping nor the
// /shopping HTML page (the two real callers that resolve "today" themselves)
// should ever surface today's date.
test('P2: /api/display/shopping never includes today', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/display/shopping`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const today = todayStr();
    assert.notEqual(body.tomorrow.date, today);
    assert.notEqual(body.week.from, today);
  } finally {
    await ctx.close();
  }
});

test('P2: /shopping HTML page starts from tomorrow, not today', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const today = todayStr();
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk(),
      body: JSON.stringify({ date: today, slot: 'morning', dish_item_id: dish.id }),
    });
    const res = await fetch(`${ctx.base}/shopping`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes(today), "today's date must not appear anywhere in the shopping page");
  } finally {
    await ctx.close();
  }
});
