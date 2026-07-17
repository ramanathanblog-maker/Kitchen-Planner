// HTTP-level smoke tests for the server-rendered pages (Phase 4). These verify the
// pages render, wire the expected DOM hooks, and reference only real API routes —
// they do NOT execute Alpine or a browser, so they cannot verify actual rendered
// layout, 375px no-horizontal-scroll, dark-mode appearance, or Lighthouse PWA
// checks. Those GATE items need a real browser and are reported as unverified in
// the phase report, not silently skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { createApp } = require('../src/app');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-pages-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

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

const PAGES = [
  { path: '/', name: 'Today', marker: /todayView\(/ },
  { path: '/plan', name: 'Plan', marker: /Guided plan/ },
  { path: '/shopping', name: 'Shopping', marker: /shoppingView\(\)/ },
  { path: '/knowledge', name: 'Knowledge', marker: /knowledgeView\(/ },
  { path: '/special-days', name: 'Special days', marker: /specialDaysView\(\)/ },
];

for (const page of PAGES) {
  test(`GET ${page.path} renders 200 HTML with theme.css, manifest, tab bar, and its Alpine component`, async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.base}${page.path}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, /theme\.css/);
      assert.match(html, /manifest\.webmanifest/);
      assert.match(html, /class="tab-bar"/, 'daily-use pages must show the bottom tab bar');
      assert.match(html, page.marker);
      assert.match(html, /viewport-fit=cover/);
    } finally {
      await ctx.close();
    }
  });
}

test('GET / (Today) is truly server-rendered: a planned dish name is present in the raw HTML with no client fetch needed', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_002'").get();
    const today = new Date().toISOString().slice(0, 10);
    ctx.db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(today, dish.id);

    const html = await (await fetch(`${ctx.base}/`)).text();
    assert.match(html, new RegExp(dish.name_en), 'the planned dish name must appear in the initial HTML payload, not only via a later fetch');
    assert.doesNotMatch(html, /x-init="load\(\)"/, 'must not fetch its own data on load');
  } finally {
    await ctx.close();
  }
});

test('GET /plan (7-day grid) is truly server-rendered: a planned dish name for a future day is present in the raw HTML', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_025'").get();
    const day3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    ctx.db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(day3, dish.id);

    const html = await (await fetch(`${ctx.base}/plan`)).text();
    assert.match(html, new RegExp(dish.name_en));
  } finally {
    await ctx.close();
  }
});

test('GET /knowledge is truly server-rendered: a seeded rule and its ingredient/family names are present in the raw HTML', async () => {
  const ctx = await startServer();
  try {
    const html = await (await fetch(`${ctx.base}/knowledge`)).text();
    assert.match(html, /Murungakkai/, 'the seeded drumstick-never-in-kari rule ingredient name must appear server-rendered');
    assert.match(html, /Kari/);
  } finally {
    await ctx.close();
  }
});

test('GET /display (kiosk) is truly server-rendered: today\'s planned dish appears in the raw HTML immediately', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_002'").get();
    const today = new Date().toISOString().slice(0, 10);
    ctx.db.prepare("INSERT INTO plans (date, slot, dish_item_id) VALUES (?, 'morning', ?)").run(today, dish.id);

    const html = await (await fetch(`${ctx.base}/display`)).text();
    assert.match(html, new RegExp(dish.name_en), 'a wall-mounted kiosk must show real data on first paint, not a blank shell');
  } finally {
    await ctx.close();
  }
});

test('GET /pick-editor renders the three-editor picker with no tab bar and no editor-guard redirect', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/pick-editor`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /pick\('PK'\)/);
    assert.match(html, /pick\('RP'\)/);
    assert.match(html, /pick\('PS'\)/);
    assert.doesNotMatch(html, /class="tab-bar"/, 'the picker itself has nowhere to navigate yet');
    assert.doesNotMatch(html, /window\.location\.replace/, 'must not redirect-loop on itself');
  } finally {
    await ctx.close();
  }
});

test('GET /display (kiosk) renders 200, uses only /api/display/* endpoints (server-side for the initial paint, client-side only as a reachability probe before refreshing), has no editor-guard redirect, and has no tab bar', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/display`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /kioskView\(/);
    assert.match(html, /\/api\/display\/today/, 'the refresh reachability probe hits /api/display/today');
    assert.doesNotMatch(html, /\/api\/(ingredients|plans|suggest|explain|teach)\b/, 'kiosk page must consume only /api/display/*');
    assert.doesNotMatch(html, /window\.location\.replace/, 'kiosk page requires no editor identity');
    assert.doesNotMatch(html, /class="tab-bar"/, 'kiosk page is not part of daily navigation');
    assert.match(html, /class="kiosk"/, 'kiosk page must use the large-type kiosk variant');
    assert.match(html, /5 \* 60 \* 1000/, 'must auto-refresh roughly every 5 minutes');
  } finally {
    await ctx.close();
  }
});

test('daily-use pages (not pick-editor, not kiosk) all carry the editor-guard redirect script', async () => {
  const ctx = await startServer();
  try {
    for (const page of PAGES) {
      const html = await (await fetch(`${ctx.base}${page.path}`)).text();
      assert.match(html, /window\.location\.replace\('\/pick-editor/, `${page.path} must guard on missing editor identity`);
    }
  } finally {
    await ctx.close();
  }
});

test('Today page end-to-end: pick an editor, plan a dish, load Today, mark day as served', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    const today = new Date().toISOString().slice(0, 10);

    // Simulate what the editor-picker's client JS does: set the cookie, then all
    // subsequent same-origin fetches (including these test ones) carry it.
    const cookie = 'editor=PK';

    const planRes = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ date: today, slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(planRes.status, 201);

    const displayRes = await fetch(`${ctx.base}/api/display/today`);
    const displayBody = await displayRes.json();
    assert.equal(displayBody.slots.morning.source, 'planned');

    const serveRes = await fetch(`${ctx.base}/api/plans/${today}/serve`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(serveRes.status, 200);

    const displayAfter = await (await fetch(`${ctx.base}/api/display/today`)).json();
    assert.equal(displayAfter.slots.morning.source, 'actual');
  } finally {
    await ctx.close();
  }
});

test('GET /display (kiosk) has a theme toggle that defaults to light and persists via localStorage, scoped to the kiosk page only', async () => {
  const ctx = await startServer();
  try {
    const kioskHtml = await (await fetch(`${ctx.base}/display`)).text();
    assert.match(kioskHtml, /class="theme-toggle"/, 'kiosk page must expose a visible theme toggle');
    assert.match(kioskHtml, /data-theme',\s*saved === 'dark' \? 'dark' : 'light'/, 'must default to light regardless of system preference when nothing saved yet');
    assert.match(kioskHtml, /localStorage/, 'toggle choice must persist via localStorage');

    const todayHtml = await (await fetch(`${ctx.base}/`)).text();
    assert.doesNotMatch(todayHtml, /class="theme-toggle"/, 'non-kiosk pages keep following prefers-color-scheme automatically, unchanged');
  } finally {
    await ctx.close();
  }
});
