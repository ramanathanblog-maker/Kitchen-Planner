// Phase 6b — household routing: X-Household resolves which household's DB a
// request is served from, RP/PS are read-only cross-household (403 on write),
// PK can read/write either, invalid overrides 400 rather than silently
// defaulting, and the kiosk is unaffected by any of this. Mirrors test/api.test.js's
// startServer()/pk()/rp() convention and its 'P1: past-day plans lock' test shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { createApp } = require('../src/app');

function tmpDbPath(name) {
  return path.join(os.tmpdir(), `kp-household-routing-test-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

async function startServer(env = {}) {
  const rpPath = tmpDbPath('rp');
  const psPath = tmpDbPath('ps');
  const rpDb = openDb(rpPath);
  seed(rpDb);
  const psDb = openDb(psPath);
  seed(psDb);

  const prevEnv = {};
  for (const [k, v] of Object.entries(env)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const app = createApp({ rp: rpDb, ps: psDb });
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}`;
  return {
    rpDb,
    psDb,
    base,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rpDb.close();
          psDb.close();
          cleanup(rpPath);
          cleanup(psPath);
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
function ps(extra = {}) {
  return { 'X-Editor': 'PS', 'Content-Type': 'application/json', ...extra };
}

test('household routing: RP write with no override lands in rp.db, no visible change from pre-6b behavior', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.rpDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: rp(),
      body: JSON.stringify({ date: '2026-07-25', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 201);
    const row = ctx.rpDb.prepare("SELECT * FROM plans WHERE date = '2026-07-25'").get();
    assert.ok(row, 'plan must land in rp.db');
    assert.equal(ctx.psDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-07-25'").get().c, 0);
  } finally {
    await ctx.close();
  }
});

test('household routing: RP write with X-Household: ps -> 403, and nothing is written to either db', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.rpDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: rp({ 'X-Household': 'ps' }),
      body: JSON.stringify({ date: '2026-07-25', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 403);
    assert.equal(ctx.rpDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-07-25'").get().c, 0);
    assert.equal(ctx.psDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-07-25'").get().c, 0);
  } finally {
    await ctx.close();
  }
});

test('household routing: RP read with X-Household: ps -> 200 and reflects ps.db data, not rp.db', async () => {
  const ctx = await startServer();
  try {
    const psDish = ctx.psDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    ctx.psDb.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES ('2026-07-26', 'morning', ?, 0)").run(psDish.id);

    const res = await fetch(`${ctx.base}/api/plans?date=2026-07-26`, { headers: rp({ 'X-Household': 'ps' }) });
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dish_item_id, psDish.id);

    const rpSideRes = await fetch(`${ctx.base}/api/plans?date=2026-07-26`, { headers: rp() });
    const rpSideRows = await rpSideRes.json();
    assert.equal(rpSideRows.length, 0, 'rp.db must not have this plan -- proves real cross-db routing, not a shared db');
  } finally {
    await ctx.close();
  }
});

test('household routing: PS write with X-Household: rp -> 403; PS read with X-Household: rp -> 200 (symmetric)', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.rpDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();

    const writeRes = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: ps({ 'X-Household': 'rp' }),
      body: JSON.stringify({ date: '2026-07-27', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(writeRes.status, 403);

    ctx.rpDb.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES ('2026-07-27', 'morning', ?, 0)").run(dish.id);
    const readRes = await fetch(`${ctx.base}/api/plans?date=2026-07-27`, { headers: ps({ 'X-Household': 'rp' }) });
    assert.equal(readRes.status, 200);
    const rows = await readRes.json();
    assert.equal(rows.length, 1);
  } finally {
    await ctx.close();
  }
});

test('household routing: PK write with X-Household: ps -> succeeds and lands in ps.db', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.psDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: pk({ 'X-Household': 'ps' }),
      body: JSON.stringify({ date: '2026-07-28', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 201);
    assert.equal(ctx.psDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-07-28'").get().c, 1);
    assert.equal(ctx.rpDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-07-28'").get().c, 0);
  } finally {
    await ctx.close();
  }
});

test('household routing: PK read with X-Household: ps -> 200 and reflects ps.db data (explicit, not just implied by the write check short-circuiting)', async () => {
  const ctx = await startServer();
  try {
    const psDish = ctx.psDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    ctx.psDb.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES ('2026-07-29', 'morning', ?, 0)").run(psDish.id);

    const res = await fetch(`${ctx.base}/api/plans?date=2026-07-29`, { headers: pk({ 'X-Household': 'ps' }) });
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dish_item_id, psDish.id);
  } finally {
    await ctx.close();
  }
});

test('household routing: invalid X-Household value -> 400, never a silent fallback, for RP/PS/PK alike', async () => {
  const ctx = await startServer();
  try {
    for (const headers of [rp({ 'X-Household': 'household1' }), ps({ 'X-Household': 'household1' }), pk({ 'X-Household': 'household1' })]) {
      const res = await fetch(`${ctx.base}/api/plans`, { headers });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /X-Household must be one of/);
    }
    // Same for the page-route ?household= query override.
    const pageRes = await fetch(`${ctx.base}/plan?household=household1`);
    assert.equal(pageRes.status, 400);
  } finally {
    await ctx.close();
  }
});

test('household routing: kiosk always reflects rp.db regardless of any X-Household header or editor cookie', async () => {
  const ctx = await startServer();
  try {
    const psDish = ctx.psDb.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_001'").get();
    ctx.psDb.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES (date('now'), 'morning', ?, 0)").run(psDish.id);

    const res = await fetch(`${ctx.base}/display`, { headers: rp({ 'X-Household': 'ps' }) });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes(psDish.name_en), 'kiosk must never surface ps.db data via a household override');
  } finally {
    await ctx.close();
  }
});

test('household routing: KITCHEN_KIOSK_HOUSEHOLD=ps env makes the kiosk reflect ps.db instead', async () => {
  const ctx = await startServer({ KITCHEN_KIOSK_HOUSEHOLD: 'ps' });
  try {
    const psDish = ctx.psDb.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_001'").get();
    ctx.psDb.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES (date('now'), 'morning', ?, 0)").run(psDish.id);

    const res = await fetch(`${ctx.base}/display`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(psDish.name_en), 'KITCHEN_KIOSK_HOUSEHOLD=ps must switch the kiosk to ps.db');
  } finally {
    await ctx.close();
  }
});

test('household routing: meal_patterns/settings are per-household -- editing rp.db does not affect ps.db', async () => {
  const ctx = await startServer();
  try {
    const rpPatterns = JSON.parse(ctx.rpDb.prepare("SELECT value FROM settings WHERE key = 'meal_patterns'").get().value);
    rpPatterns.morning.rows[0].label = 'Changed On RP Only';
    ctx.rpDb.prepare("UPDATE settings SET value = ? WHERE key = 'meal_patterns'").run(JSON.stringify(rpPatterns));

    const psRes = await fetch(`${ctx.base}/plan/2026-07-20/morning?household=ps`);
    assert.equal(psRes.status, 200);
    const psHtml = await psRes.text();
    assert.ok(!psHtml.includes('Changed On RP Only'), 'ps.db settings must be unaffected by an rp.db-only edit');

    const rpRes = await fetch(`${ctx.base}/plan/2026-07-20/morning`);
    const rpHtml = await rpRes.text();
    assert.ok(rpHtml.includes('Changed On RP Only'), 'rp.db must reflect its own edit');
  } finally {
    await ctx.close();
  }
});
