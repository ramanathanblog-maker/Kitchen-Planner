// Phase 4b Amendment §2/§8 — the meal-pattern wizard's page routes (hub + drill
// levels, real navigable URLs, server-rendered) and its API mutation routes
// (choose / clear-collapsed). Reuses /api/plans' insert+knowledge_events pattern
// (src/routes/plans.js) rather than proxying through it, since the wizard needs
// server-side max-cap enforcement that the plain plans CRUD deliberately doesn't
// have (amendment §9 "stepper caps at max").
const express = require('express');
const { ApiError } = require('./errors');
const { assertRequired, assertInDomain } = require('./validate');
const { logEvent } = require('./resource');
const { assertPlanEditable } = require('./planLock');
const { readEditorFromCookie } = require('./editor');
const { getSlotPattern } = require('../data/mealPatterns');
const { todayStr } = require('../data/dates');
const {
  rowSlug,
  findRowBySlug,
  candidateItemsForRole,
  groupByClassAndFamily,
  evaluateItemsForLeaf,
  deadEndItem,
  morningGravyCarryover,
  chosenForRole,
  getHubData,
  dishesClearedByCollapse,
} = require('../data/wizard');
const { renderWizardHub, renderWizardRole, renderWizardItems } = require('../views/wizard');

function pageRouter(db) {
  const router = express.Router();

  router.get('/:date/:slot', (req, res) => {
    const { date, slot } = req.params;
    assertInDomain(slot, 'slot', 'slot');
    const hub = getHubData(db, { date, slot });
    const editor = readEditorFromCookie(req);
    const locked = date < todayStr() && editor !== 'PK';
    res.type('html').send(renderWizardHub(hub, { locked, editor }));
  });

  router.get('/:date/:slot/:rowSlug', (req, res) => {
    const { date, slot, rowSlug: slug } = req.params;
    const editor = readEditorFromCookie(req);
    assertInDomain(slot, 'slot', 'slot');
    const pattern = getSlotPattern(db, slot);
    const row = findRowBySlug(pattern, slug);
    if (!row) throw new ApiError(404, 'unknown row for this slot');

    const items = candidateItemsForRole(db, { slot, role: row.role, filterClass: row.filter_class });
    const groups = groupByClassAndFamily(db, items);
    // Dead-end families (<=1 item, amendment §10.3): mark so the view offers a
    // direct one-tap choose instead of a link to the item-choice level.
    for (const group of groups) {
      for (const fam of group.families) {
        fam.deadEndItemId = fam.items.length === 1 ? fam.items[0].id : null;
      }
    }
    // P2a — single-child drill collapse (generalizes the dead-end rule above): a
    // class with exactly one family (e.g. Rasam, Pachadi, Thogayal — verified
    // against seed data, not assumed) has no real "which family?" choice to make,
    // so skip that screen and render the family's item list inline on this same
    // role-level page instead of a link to the family drill level — regardless of
    // whether that one family also happens to be a dead end (1 item): a lone item
    // still gets the full leaf-item treatment (status chip, block reason, direct
    // Choose) rather than a bare annotated button. Classes with >1 family (e.g.
    // Sambar: Regular / Arachuvitta Pitlai) are unaffected — still shown as links.
    for (const group of groups) {
      if (group.families.length === 1) {
        group.inlineItems = evaluateItemsForLeaf(db, { date, slot, items: group.families[0].items });
        group.inlineFamilyName = group.families[0].name;
      }
    }
    let carryover = null;
    if (row.offer_morning_carryover) {
      carryover = morningGravyCarryover(db, date);
    }
    const chosen = chosenForRole(db, { date, slot, role: row.role, filterClass: row.filter_class });
    res.type('html').send(renderWizardRole({ date, slot, row, rowSlug: slug, groups, carryover, chosen, editor }));
  });

  router.get('/:date/:slot/:rowSlug/:familyId', (req, res) => {
    const { date, slot, rowSlug: slug } = req.params;
    const familyId = Number(req.params.familyId);
    const editor = readEditorFromCookie(req);
    assertInDomain(slot, 'slot', 'slot');
    const pattern = getSlotPattern(db, slot);
    const row = findRowBySlug(pattern, slug);
    if (!row) throw new ApiError(404, 'unknown row for this slot');
    if (!Number.isInteger(familyId)) throw new ApiError(400, 'familyId must be an integer');

    const allItems = candidateItemsForRole(db, { slot, role: row.role, filterClass: row.filter_class });
    const items = allItems.filter((i) => i.family_id === familyId);
    if (items.length === 0) throw new ApiError(404, 'no items for this family/role/slot combination');
    const evaluated = evaluateItemsForLeaf(db, { date, slot, items });
    res.type('html').send(renderWizardItems({ date, slot, row, rowSlug: slug, familyId, familyName: items[0].family_name, items: evaluated, editor }));
  });

  return router;
}

// API mutation routes, mounted under /api/wizard (behind editorMiddleware like
// the rest of /api) — choose enforces the row's `max` cap server-side; clear-
// collapsed implements the "variety rice hides & clears other rows" behavior
// (amendment §4), both driven entirely by the meal_patterns settings data, no
// hard-coded role names.
function apiRouter(db) {
  const router = express.Router();

  // P2c — read-only preview for the confirm sheet: which named dishes a
  // collapses_pattern choice (variety rice) would clear, so the UI can list them
  // before the destructive clear-collapsed call.
  router.get('/collapse-preview', (req, res) => {
    const { date, slot } = req.query;
    assertRequired(req.query, ['date', 'slot']);
    assertInDomain(slot, 'slot', 'slot');
    res.status(200).json({ dishes: dishesClearedByCollapse(db, { date, slot }) });
  });

  router.post('/choose', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['date', 'slot', 'rowSlug', 'dishItemId']);
    assertInDomain(body.slot, 'slot', 'slot');
    const pattern = getSlotPattern(db, body.slot);
    const row = findRowBySlug(pattern, body.rowSlug);
    if (!row) throw new ApiError(400, 'unknown rowSlug for this slot');

    const dishItemId = Number(body.dishItemId);
    if (!Number.isInteger(dishItemId)) throw new ApiError(400, 'dishItemId must be an integer');
    assertPlanEditable(req.editor, body.date);

    const created = db.transaction(() => {
      const chosen = chosenForRole(db, { date: body.date, slot: body.slot, role: row.role, filterClass: row.filter_class });
      if (chosen.length >= row.max) {
        throw new ApiError(409, `row "${row.label}" is already at its max of ${row.max}`);
      }
      const nextOrdering = chosen.length === 0 ? 0 : Math.max(...chosen.map((c) => c.ordering)) + 1;
      const info = db
        .prepare('INSERT INTO plans (date, slot, dish_item_id, ordering) VALUES (?, ?, ?, ?)')
        .run(body.date, body.slot, dishItemId, nextOrdering);
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(info.lastInsertRowid);
      logEvent(db, { who: req.editor, tableName: 'plans', rowId: plan.id, oldValue: null, newValue: plan, source: 'manual_edit' });
      return plan;
    })();

    res.status(201).json(created);
  });

  // Variety rice (or any collapses_pattern row) chosen: clear plans in rows the
  // collapsed pattern hides, so the hub doesn't keep a now-invisible dish planned.
  router.post('/clear-collapsed', (req, res) => {
    const body = req.body || {};
    assertRequired(body, ['date', 'slot']);
    assertInDomain(body.slot, 'slot', 'slot');
    assertPlanEditable(req.editor, body.date);
    const pattern = getSlotPattern(db, body.slot);
    const collapseRow = pattern.rows.find((r) => r.collapses_pattern);
    if (!collapseRow) return res.status(200).json({ cleared: [] });
    const allowed = new Set(collapseRow.collapsed_allows || []);
    const hiddenRows = pattern.rows.filter((r) => r !== collapseRow && !allowed.has(r.role));

    const cleared = db.transaction(() => {
      const removed = [];
      for (const r of hiddenRows) {
        const chosen = chosenForRole(db, { date: body.date, slot: body.slot, role: r.role, filterClass: r.filter_class });
        for (const c of chosen) {
          const current = db.prepare('SELECT * FROM plans WHERE id = ?').get(c.plan_id);
          db.prepare('DELETE FROM plans WHERE id = ?').run(c.plan_id);
          logEvent(db, { who: req.editor, tableName: 'plans', rowId: c.plan_id, oldValue: current, newValue: null, source: 'manual_edit' });
          removed.push(c.plan_id);
        }
      }
      return removed;
    })();

    res.status(200).json({ cleared });
  });

  return router;
}

module.exports = { pageRouter, apiRouter };
