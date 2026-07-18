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
const { todayStr, addDays } = require('../src/data/dates');

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
    const today = todayStr();
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

test('GET /knowledge: the verdict <select> for the seeded never-in-Kari rule has <option value="never" selected>, not the first option', async () => {
  const ctx = await startServer();
  try {
    const rule = ctx.db
      .prepare(
        `SELECT ifr.id, ifr.verdict FROM ingredient_family_rules ifr
         JOIN ingredients i ON i.id = ifr.ingredient_id WHERE i.name_en = 'Murungakkai'`
      )
      .get();
    assert.equal(rule.verdict, 'never', 'test assumption: the seeded rule is a non-first-option value');

    const html = await (await fetch(`${ctx.base}/knowledge`)).text();
    // Isolate this rule's <select> block so the assertion can't accidentally
    // match a different rule's or the add-rule form's <option>.
    const cardStart = html.indexOf('Murungakkai');
    const selectStart = html.indexOf('<select name="verdict">', cardStart);
    const selectEnd = html.indexOf('</select>', selectStart);
    assert.ok(selectStart > -1 && selectEnd > selectStart, 'expected a verdict <select> on the Murungakkai rule card');
    const selectHtml = html.slice(selectStart, selectEnd);

    assert.match(selectHtml, /<option value="never" selected>never<\/option>/);
    assert.doesNotMatch(selectHtml, /<option value="preferred" selected>/, 'the first option must not be selected when the stored value is not "preferred"');
  } finally {
    await ctx.close();
  }
});

test('GET /display (kiosk) is truly server-rendered: today\'s planned dish appears in the raw HTML immediately', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_002'").get();
    const today = todayStr();
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
    const today = todayStr();

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

// P2d — logging what was actually eaten is a one-tap "as-is" action: the Today
// page's primary button (visible when a slot is still just "planned") copies the
// planned dishes into actual_meals directly, no modal required first. Route-level
// coverage here since the "banner appears"/button-click level needs a browser tool
// this session doesn't have (see report).
test('Today page: logging a slot as eaten (one-tap "as-is" path) copies planned dishes into actual_meals without opening the override sheet', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE external_id = 'dish_002'").get();
    const today = todayStr();
    const cookie = 'editor=PK';

    const planRes = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ date: today, slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(planRes.status, 201);

    // The Today page itself renders a primary "Log as eaten" button for a
    // still-just-planned slot, and a secondary "Make changes" button.
    const todayHtml = await (await fetch(`${ctx.base}/`, { headers: { Cookie: cookie } })).text();
    assert.match(todayHtml, /Log as eaten/);
    assert.match(todayHtml, /Make changes/);

    // The Today page's "Log as eaten" button calls this single server-side
    // route (src/routes/serve.js) — one transaction covering every planned dish
    // in the slot, not a client-side loop of one POST per dish (Audit
    // 2026-07-18, code #8: the old loop could leave a slot half-logged on a
    // mid-loop failure).
    const logRes = await fetch(`${ctx.base}/api/plans/${today}/morning/log`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(logRes.status, 200);

    const displayAfter = await (await fetch(`${ctx.base}/api/display/today`)).json();
    assert.equal(displayAfter.slots.morning.source, 'actual');
    assert.ok(displayAfter.slots.morning.dishes.some((d) => d.name_en === dish.name_en));
  } finally {
    await ctx.close();
  }
});

// P2e — a single already-chosen dish can be removed directly (Today view and the
// wizard hub), without re-entering the guided drill from the top. Uses the
// existing generic DELETE /api/plans/:id (src/routes/plans.js simpleCrudRouter)
// and DELETE /api/rules/... pattern — no new route needed.
test('a single planned dish can be removed directly via DELETE /api/plans/:id, without touching the rest of the slot', async () => {
  const ctx = await startServer();
  try {
    const dishes = ctx.db.prepare("SELECT id FROM dish_items WHERE meal_role = 'dry_side' LIMIT 2").all();
    const today = todayStr();
    const cookie = 'editor=PK';

    const plan1 = await (
      await fetch(`${ctx.base}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ date: today, slot: 'morning', dish_item_id: dishes[0].id }),
      })
    ).json();
    const plan2 = await (
      await fetch(`${ctx.base}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ date: today, slot: 'morning', dish_item_id: dishes[1].id }),
      })
    ).json();

    const delRes = await fetch(`${ctx.base}/api/plans/${plan1.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(delRes.status, 204);

    const remaining = ctx.db.prepare('SELECT * FROM plans WHERE date = ? AND slot = ?').all(today, 'morning');
    assert.ok(remaining.some((r) => r.id === plan2.id), 'the other dish stays planned');
    assert.ok(!remaining.some((r) => r.id === plan1.id), 'the removed dish is gone');

    // Wizard hub renders a Remove control per chosen dish (P2e).
    const hubHtml = await (await fetch(`${ctx.base}/plan/${today}/morning`, { headers: { Cookie: cookie } })).text();
    assert.match(hubHtml, /removePlan\(/);
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

// --- Phase R2 (Trust: History, teach feedback, mutation visibility) ---

test('editor identity header shows "You are <editor>" with a switch link on daily-use pages, once an editor cookie is set', async () => {
  const ctx = await startServer();
  try {
    const cookie = 'editor=RP';
    const html = await (await fetch(`${ctx.base}/`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /You are <strong>RP<\/strong>/);
    assert.match(html, /href="\/pick-editor"/);
  } finally {
    await ctx.close();
  }
});

test('editor identity header is absent when no editor cookie is set, and absent on the kiosk page even with one set', async () => {
  const ctx = await startServer();
  try {
    const noCookieHtml = await (await fetch(`${ctx.base}/plan`)).text();
    assert.doesNotMatch(noCookieHtml, /You are <strong>/);

    const kioskHtml = await (await fetch(`${ctx.base}/display`, { headers: { Cookie: 'editor=PS' } })).text();
    assert.doesNotMatch(kioskHtml, /You are <strong>/, 'kiosk is read-only/no-identity, per pageShell\'s !kiosk guard');
  } finally {
    await ctx.close();
  }
});

test('Knowledge page links to Special Days', async () => {
  const ctx = await startServer();
  try {
    const html = await (await fetch(`${ctx.base}/knowledge`, { headers: { Cookie: 'editor=PK' } })).text();
    assert.match(html, /href="\/special-days"/);
  } finally {
    await ctx.close();
  }
});

test('History tab renders human-readable event summaries, not raw table/source codes, plus an Undo confirm sheet with plain-language preview text', async () => {
  const ctx = await startServer();
  try {
    // The seed script writes its interview rules directly (no knowledge_events
    // row — those are 'seed'-origin data, not audited edits), so an event has
    // to be produced via a real mutation first.
    const someIngredient = ctx.db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_005'").get();
    const kariFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    await fetch(`${ctx.base}/api/teach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Editor': 'PK' },
      body: JSON.stringify({ table: 'ingredient_family_rules', ingredient_id: someIngredient.id, family_id: kariFamily.id, verdict: 'avoid' }),
    });

    const html = await (await fetch(`${ctx.base}/knowledge`, { headers: { Cookie: 'editor=PK' } })).text();
    assert.match(html, /PK added .+ × Kari.* to avoid/, 'History must show a human-readable summary, not just raw table_name/source');
    assert.match(html, /confirmUndo = \{ id: \d+, preview:/, 'Undo must open a confirm sheet carrying preview text, not fire immediately');
    assert.match(html, /Undo this\?/);
  } finally {
    await ctx.close();
  }
});

test('POST /api/teach response carries knowledge_events_id, so the client can offer an inline Undo without a second lookup', async () => {
  const ctx = await startServer();
  try {
    const kariFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    const someIngredient = ctx.db.prepare("SELECT id FROM ingredients WHERE external_id = 'veg_005'").get();
    const res = await fetch(`${ctx.base}/api/teach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Editor': 'PK' },
      body: JSON.stringify({
        table: 'ingredient_family_rules',
        ingredient_id: someIngredient.id,
        family_id: kariFamily.id,
        verdict: 'avoid',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Number.isInteger(body.knowledge_events_id));
    const eventRow = ctx.db.prepare('SELECT * FROM knowledge_events WHERE id = ?').get(body.knowledge_events_id);
    assert.ok(eventRow, 'the returned id must be a real knowledge_events row');
    assert.equal(eventRow.row_id, body.id);
  } finally {
    await ctx.close();
  }
});

test('the wizard drill leaf page renders a post-teach toast with inline Undo and a data-dish-item-id hook for in-place chip refresh', async () => {
  const ctx = await startServer();
  try {
    const sambarFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_004_001'").get();
    const html = await (
      await fetch(`${ctx.base}/plan/2026-07-20/morning/main_gravy/${sambarFamily.id}`, { headers: { Cookie: 'editor=PK' } })
    ).text();
    assert.match(html, /data-dish-item-id="\d+"/, 'each leaf card must be addressable for an in-place chip refresh');
    assert.match(html, /showToast\(/);
    assert.match(html, /refreshChipFor\(/);
    assert.match(html, /Undo<\/button>/);
  } finally {
    await ctx.close();
  }
});

test('mutating buttons carry :disabled="busy" so a double-tap cannot fire two overlapping requests', async () => {
  const ctx = await startServer();
  try {
    const cookie = 'editor=PK';
    // Shopping only renders a checkbox (the button with :disabled="busy") per
    // ingredient it actually needs — plan something for tomorrow first so the
    // page has at least one row to assert against.
    const dish = ctx.db.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_002'").get();
    const tomorrow = addDays(todayStr(), 1);
    await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ date: tomorrow, slot: 'morning', dish_item_id: dish.id }),
    });
    const shoppingHtml = await (await fetch(`${ctx.base}/shopping`, { headers: { Cookie: cookie } })).text();
    assert.match(shoppingHtml, /:disabled="busy"/);

    const knowledgeHtml = await (await fetch(`${ctx.base}/knowledge`, { headers: { Cookie: cookie } })).text();
    assert.match(knowledgeHtml, /:disabled="busy"/);

    const specialDaysHtml = await (await fetch(`${ctx.base}/special-days`, { headers: { Cookie: cookie } })).text();
    assert.match(specialDaysHtml, /:disabled="busy"/);

    const todayHtml = await (await fetch(`${ctx.base}/`, { headers: { Cookie: cookie } })).text();
    assert.match(todayHtml, /:disabled="busy"/);
  } finally {
    await ctx.close();
  }
});

test('specialDays.js mutations (addType/addDate/removeDate) go through kpFetch, not a bare unchecked fetch()', async () => {
  const ctx = await startServer();
  try {
    const html = await (await fetch(`${ctx.base}/special-days`, { headers: { Cookie: 'editor=PK' } })).text();
    const scriptMatch = html.match(/function specialDaysView\(\)[\s\S]*?<\/script>/);
    assert.ok(scriptMatch, 'expected to find the specialDaysView script block');
    assert.doesNotMatch(scriptMatch[0], /await fetch\(/, 'no raw unchecked fetch() should remain in the mutating methods');
    assert.match(scriptMatch[0], /kpFetch\(/);
  } finally {
    await ctx.close();
  }
});

test('shopping.js\'s toggleLeftover goes through kpFetch, not a bare unchecked fetch()', async () => {
  const ctx = await startServer();
  try {
    const html = await (await fetch(`${ctx.base}/shopping`, { headers: { Cookie: 'editor=PK' } })).text();
    const scriptMatch = html.match(/function shoppingView\(\)[\s\S]*?<\/script>/);
    assert.ok(scriptMatch);
    assert.doesNotMatch(scriptMatch[0], /await fetch\(/);
    assert.match(scriptMatch[0], /kpFetch\(/);
  } finally {
    await ctx.close();
  }
});
