// Phase 4b Amendment Step 2 — meal-pattern wizard: data helpers, routes, views.
// Follows test/pages.test.js / test/meal-patterns.test.js conventions (node:test
// only, tmp sqlite db per test, real seed data).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { createApp } = require('../src/app');
const wizard = require('../src/data/wizard');

function tmpDbPath() {
  return path.join(os.tmpdir(), `kp-wizard-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
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

function tmpDb() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  migrate(db);
  seed(db);
  return { db, dbPath };
}

test('candidateItemsForRole: main_gravy/morning returns only main_gravy items eligible for morning', () => {
  const { db, dbPath } = tmpDb();
  try {
    const items = wizard.candidateItemsForRole(db, { slot: 'morning', role: 'main_gravy' });
    assert.ok(items.length > 0);
    for (const it of items) {
      assert.ok(JSON.parse(it.slot_fit).includes('morning'));
    }
    const roles = db.prepare('SELECT DISTINCT meal_role FROM dish_items WHERE id IN (' + items.map((i) => i.id).join(',') + ')').all();
    assert.deepEqual(roles.map((r) => r.meal_role), ['main_gravy']);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('candidateItemsForRole with filter_class narrows to only that taxonomy class (thogayal vs pachadi)', () => {
  const { db, dbPath } = tmpDb();
  try {
    const thogayal = wizard.candidateItemsForRole(db, { slot: 'morning', role: 'condiment', filterClass: 'thogayal' });
    const pachadi = wizard.candidateItemsForRole(db, { slot: 'morning', role: 'condiment', filterClass: 'pachadi' });
    assert.ok(thogayal.length > 0);
    assert.ok(pachadi.length > 0);
    const thogayalIds = new Set(thogayal.map((i) => i.id));
    const pachadiIds = new Set(pachadi.map((i) => i.id));
    for (const id of pachadiIds) assert.ok(!thogayalIds.has(id));
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('groupByClassAndFamily: gravy groups items under Sambar/Kozhambu classes, each with bounded families', () => {
  const { db, dbPath } = tmpDb();
  try {
    const items = wizard.candidateItemsForRole(db, { slot: 'morning', role: 'main_gravy' });
    const groups = wizard.groupByClassAndFamily(db, items);
    const classNames = groups.map((g) => g.name.toLowerCase());
    assert.ok(classNames.includes('sambar'));
    assert.ok(classNames.includes('kozhambu'));
    for (const g of groups) {
      for (const fam of g.families) {
        assert.ok(fam.items.length <= 10, `family ${fam.name} has ${fam.items.length} items`);
      }
    }
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('evaluateItemsForLeaf includes blocked items with a visible reason, not omitted (amendment §6)', () => {
  const { db, dbPath } = tmpDb();
  try {
    const items = wizard.candidateItemsForRole(db, { slot: 'morning', role: 'dry_side' });
    assert.ok(items.length > 0);
    // Seed a fresh 'never' rule against one candidate's primary ingredient+family
    // so we have a guaranteed blocked candidate (the seeded murungakkai/Kari rule
    // has no dish_item currently sharing both that ingredient and that exact
    // family, so it never fires in this candidate set — this proves the same
    // mechanism generically instead).
    const target = items[0];
    const primaryIngredient = db
      .prepare("SELECT ingredient_id FROM dish_item_ingredients WHERE dish_item_id = ? AND role = 'primary' LIMIT 1")
      .get(target.id);
    assert.ok(primaryIngredient, 'candidate needs a primary ingredient to test blocking on');
    db.prepare(
      `INSERT INTO ingredient_family_rules (ingredient_id, family_id, verdict, rationale_tag, note, updated_by)
       VALUES (?, ?, 'never', 'other', 'test-only block', 'test')`
    ).run(primaryIngredient.ingredient_id, target.family_id);

    const results = wizard.evaluateItemsForLeaf(db, { date: '2026-07-20', slot: 'morning', items });
    const blocked = results.find((r) => r.dishItemId === target.id);
    assert.equal(blocked.status, 'blocked');
    assert.ok(blocked.reason, 'blocked item must carry a visible reason');
    // and it must still be present in the list (not omitted the way rank() would)
    assert.equal(results.length, items.length);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('deadEndItem: a family with exactly one item is detected for auto-select', () => {
  const { db, dbPath } = tmpDb();
  try {
    const row = db
      .prepare(
        `SELECT family_id, COUNT(*) c FROM dish_items GROUP BY family_id HAVING c = 1 LIMIT 1`
      )
      .get();
    assert.ok(row, 'seed data should contain at least one single-item family');
    const item = wizard.deadEndItem(db, row.family_id);
    assert.ok(item);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('morningGravyCarryover: empty when nothing planned, populated after planning a morning gravy', () => {
  const { db, dbPath } = tmpDb();
  try {
    assert.deepEqual(wizard.morningGravyCarryover(db, '2026-07-20'), []);
    const gravy = db.prepare("SELECT id FROM dish_items WHERE meal_role = 'main_gravy' LIMIT 1").get();
    db.prepare(`INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES (?, 'morning', ?, 0)`).run('2026-07-20', gravy.id);
    const carry = wizard.morningGravyCarryover(db, '2026-07-20');
    assert.equal(carry.length, 1);
    assert.equal(carry[0].id, gravy.id);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

test('getHubData: morning hub rows match meal_patterns order exactly, chosen empty initially', () => {
  const { db, dbPath } = tmpDb();
  try {
    const hub = wizard.getHubData(db, { date: '2026-07-20', slot: 'morning' });
    assert.deepEqual(
      hub.rows.map((r) => r.role),
      ['main_gravy', 'secondary_gravy', 'semi_solid_side', 'dry_side', 'salad', 'condiment', 'condiment', 'crisp_side', 'standalone']
    );
    for (const r of hub.rows) assert.deepEqual(r.chosen, []);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});

// ---- HTTP-level route tests (hub, drill levels, mutations) ----

function jsonHeaders() {
  return { 'Content-Type': 'application/json', 'X-Editor': 'PK' };
}

test('GET /plan/:date/:slot renders exactly the configured hub rows, in order', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/plan/2026-07-20/morning`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // configured labels appear in order
    const labels = ['Gravy', 'Rasam', 'Kootu', 'Kari', 'Salad', 'Thogayal', 'Pachadi', 'Crisp', 'Variety Rice'];
    let lastIdx = -1;
    for (const label of labels) {
      const idx = html.indexOf(`>${label}<`);
      assert.ok(idx > lastIdx, `${label} should appear after previous row`);
      lastIdx = idx;
    }
  } finally {
    await ctx.close();
  }
});

test('Skip is offered on every configured row\'s drill page', async () => {
  const ctx = await startServer();
  try {
    const { getSlotPattern } = require('../src/data/mealPatterns');
    const { rowSlug } = require('../src/data/wizard');
    const pattern = getSlotPattern(ctx.db, 'morning');
    for (const row of pattern.rows) {
      const res = await fetch(`${ctx.base}/plan/2026-07-20/morning/${rowSlug(row)}`);
      assert.equal(res.status, 200, `row ${row.role} drill should render`);
      const html = await res.text();
      assert.ok(/Skip/.test(html), `row ${row.role} drill must offer Skip`);
    }
  } finally {
    await ctx.close();
  }
});

test('Drill gravy -> sambar family: item list is bounded (<=10) and contains only that family\'s items', async () => {
  const ctx = await startServer();
  try {
    const sambarFamily = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_004_001'").get();
    const res = await fetch(`${ctx.base}/plan/2026-07-20/morning/main_gravy/${sambarFamily.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    const itemRows = ctx.db.prepare('SELECT name_en FROM dish_items WHERE family_id = ?').all(sambarFamily.id);
    assert.ok(itemRows.length <= 10);
    for (const it of itemRows) assert.ok(html.includes(it.name_en));
  } finally {
    await ctx.close();
  }
});

test('Stepper caps at max: dry_side (Kari) allows 2 choices then rejects a 3rd', async () => {
  const ctx = await startServer();
  try {
    const kariItems = ctx.db.prepare("SELECT id FROM dish_items WHERE meal_role = 'dry_side' LIMIT 3").all();
    assert.equal(kariItems.length, 3);
    const post = (dishItemId) =>
      fetch(`${ctx.base}/api/wizard/choose`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ date: '2026-07-20', slot: 'morning', rowSlug: 'dry_side', dishItemId }),
      });
    const r1 = await post(kariItems[0].id);
    const r2 = await post(kariItems[1].id);
    const r3 = await post(kariItems[2].id);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r3.status, 409, 'third kari over the max:2 cap should be rejected');

    const plans = ctx.db.prepare("SELECT ordering FROM plans WHERE date = '2026-07-20' AND slot = 'morning'").all();
    assert.equal(plans.length, 2);
    assert.deepEqual(plans.map((p) => p.ordering).sort(), [0, 1], 'two karis save as two plans rows with distinct ordering');
  } finally {
    await ctx.close();
  }
});

test('Gravy (max 1) rejects a 2nd choice', async () => {
  const ctx = await startServer();
  try {
    const gravyItems = ctx.db.prepare("SELECT id FROM dish_items WHERE meal_role = 'main_gravy' LIMIT 2").all();
    const post = (dishItemId) =>
      fetch(`${ctx.base}/api/wizard/choose`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ date: '2026-07-20', slot: 'morning', rowSlug: 'main_gravy', dishItemId }),
      });
    const r1 = await post(gravyItems[0].id);
    const r2 = await post(gravyItems[1].id);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 409);
  } finally {
    await ctx.close();
  }
});

test('Variety rice chosen hides gravy/kari/salad/thogayal rows and clears their chosen dishes; banner clears', async () => {
  const ctx = await startServer();
  try {
    const kari = ctx.db.prepare("SELECT id FROM dish_items WHERE meal_role = 'dry_side' LIMIT 1").get();
    await fetch(`${ctx.base}/api/wizard/choose`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ date: '2026-07-20', slot: 'morning', rowSlug: 'dry_side', dishItemId: kari.id }),
    });

    const varietyRice = ctx.db
      .prepare("SELECT id FROM dish_items WHERE meal_role = 'standalone' AND can_lead = 1 LIMIT 1")
      .get();
    assert.ok(varietyRice);
    const chooseRes = await fetch(`${ctx.base}/api/wizard/choose`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ date: '2026-07-20', slot: 'morning', rowSlug: 'standalone', dishItemId: varietyRice.id }),
    });
    assert.equal(chooseRes.status, 201);
    const clearRes = await fetch(`${ctx.base}/api/wizard/clear-collapsed`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ date: '2026-07-20', slot: 'morning' }),
    });
    assert.equal(clearRes.status, 200);
    const cleared = (await clearRes.json()).cleared;
    assert.ok(cleared.length >= 1, 'the previously-chosen kari plan row should have been cleared');

    const hubRes = await fetch(`${ctx.base}/plan/2026-07-20/morning`);
    const html = await hubRes.text();
    assert.ok(!/>Kari</.test(html), 'Kari row hidden once variety rice chosen');
    assert.ok(!/>Salad</.test(html));
    assert.ok(!/>Gravy</.test(html));
    assert.ok(/>Rasam</.test(html), 'Rasam row remains (in collapsed_allows)');
    assert.ok(/>Crisp</.test(html), 'Crisp row remains (in collapsed_allows)');
    assert.ok(!html.includes('composition-banner'), 'zero-leads banner clears (variety rice is can_lead=1)');
  } finally {
    await ctx.close();
  }
});

test('Noon Side/Gravy row lists morning carry-over first when a morning gravy is planned, absent otherwise', async () => {
  const ctx = await startServer();
  try {
    const resNoCarry = await fetch(`${ctx.base}/plan/2026-07-20/noon/tiffin_side`);
    const htmlNoCarry = await resNoCarry.text();
    assert.ok(!htmlNoCarry.includes('From this morning'));

    const gravy = ctx.db.prepare("SELECT id, name_en FROM dish_items WHERE meal_role = 'main_gravy' LIMIT 1").get();
    ctx.db.prepare("INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES ('2026-07-20', 'morning', ?, 0)").run(gravy.id);

    const resCarry = await fetch(`${ctx.base}/plan/2026-07-20/noon/tiffin_side`);
    const htmlCarry = await resCarry.text();
    assert.ok(htmlCarry.includes('From this morning'));
    assert.ok(htmlCarry.includes(gravy.name_en));
    assert.ok(htmlCarry.indexOf('From this morning') < htmlCarry.indexOf(gravy.name_en));
  } finally {
    await ctx.close();
  }
});

test('Blocked item renders disabled with its reason string in the drill leaf list, not omitted', async () => {
  const ctx = await startServer();
  try {
    const kariFam = ctx.db.prepare("SELECT id FROM dish_families WHERE external_id = 'fam_006_001'").get();
    const anyKari = ctx.db.prepare('SELECT id, family_id FROM dish_items WHERE family_id = ?').get(kariFam.id);
    const primaryIngredient = ctx.db
      .prepare("SELECT ingredient_id FROM dish_item_ingredients WHERE dish_item_id = ? AND role = 'primary' LIMIT 1")
      .get(anyKari.id);
    assert.ok(primaryIngredient);
    ctx.db
      .prepare(
        `INSERT INTO ingredient_family_rules (ingredient_id, family_id, verdict, rationale_tag, note, updated_by)
         VALUES (?, ?, 'never', 'other', 'test block', 'test')`
      )
      .run(primaryIngredient.ingredient_id, kariFam.id);

    const res = await fetch(`${ctx.base}/plan/2026-07-20/morning/dry_side/${kariFam.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    const dish = ctx.db.prepare('SELECT name_en FROM dish_items WHERE id = ?').get(anyKari.id);
    assert.ok(html.includes(dish.name_en), 'blocked item stays listed, not omitted');
    assert.ok(html.includes('disabled'), 'blocked item choose control is disabled');
    assert.ok(html.includes('test block'), 'blocked item reason is visible');
  } finally {
    await ctx.close();
  }
});

test('regression: /api/suggest findings never contain a zero-leads entry, and compositionWarning stays a sibling field', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/suggest?date=2026-07-20&slot=morning`, { headers: jsonHeaders() });
    const data = await res.json();
    assert.ok('compositionWarning' in data);
    for (const s of data.suggestions) {
      assert.ok(!s.findings.some((f) => f.step === 'meal_composition' && /No sambar/.test(f.message || '')));
    }
  } finally {
    await ctx.close();
  }
});

test('night hub has empty rows (fallback to flat picker, amendment §10.1)', () => {
  const { db, dbPath } = tmpDb();
  try {
    const hub = wizard.getHubData(db, { date: '2026-07-20', slot: 'night' });
    assert.deepEqual(hub.rows, []);
  } finally {
    db.close();
    cleanup(dbPath);
  }
});
