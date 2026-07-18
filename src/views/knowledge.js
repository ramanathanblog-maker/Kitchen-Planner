const { pageShell, jsonForAttr, escapeHtml } = require('./layout');

// Server-rendered lists; the rule cards below are built with a plain .map().join()
// (not Alpine's `x-for` over a shared `<template>`) precisely so each row's
// <select> gets its own baked-in `selected` attribute for the value actually
// stored in the DB. The old version put verdict/severity <select>s inside one
// `<template x-for>` shared by every row — since a template's markup (including
// its <option> children) is a single piece of HTML cloned per row, there was
// nowhere to bake a per-row `selected` into it, and it silently painted the
// first option ("preferred") regardless of the stored verdict (P0: Murungakkai ×
// Kari showed "preferred" while the DB held "never"). Rows now carry no x-model
// at all — Save reads the live form values straight off the DOM via
// closest('.dish-card'), so there's no reactive state to get out of sync with
// the initial paint in the first place.
//
// The Add-rule pickers further down this file used to have the same
// `<template x-for>`-inside-a-`<select>` shape (options cloned client-side from
// JSON, x-model on the select) — lower stakes than the rule cards since these
// are "add new" pickers with a JS-state default rather than a per-row DB value
// to invert, but it was the exact banned pattern on the same page as this
// comment (Audit 2026-07-18, code #1). Converted to server-rendered <option>s
// (optionsHtmlFor below) with no x-for involved; see scripts/lint-alpine-select.js
// for the guardrail against this pattern reappearing anywhere in src/views.
const VERDICT_OPTIONS = ['preferred', 'allowed', 'avoid', 'never', 'unsure'];
const SEVERITY_OPTIONS = ['soft', 'hard'];

function optionsHtml(options, selected) {
  return options
    .map((o) => `<option value="${o}"${o === selected ? ' selected' : ''}>${o}</option>`)
    .join('');
}

// Server-rendered <option> list for the Add-rule pickers below — same reasoning
// as optionsHtml above (and the file-header comment): a `<template x-for>` of
// `<option>`s inside an `x-model` `<select>` is the pattern that caused the P0
// verdict-inversion bug on the rule cards. These pickers don't carry a per-row
// `selected` (they're "add new", not "edit existing"), but the fix is the same
// either way — no cloned-template options inside a select on this page, full
// stop (Audit 2026-07-18, code #1).
function optionsHtmlFor(rows, valueKey, labelKey) {
  return rows.map((r) => `<option value="${escapeHtml(String(r[valueKey]))}">${escapeHtml(String(r[labelKey]))}</option>`).join('');
}

function ingredientRuleCard(rule) {
  return `
  <div class="dish-card" style="flex-direction:column; align-items:stretch;">
    <strong>${escapeHtml(rule.ingredient_name)} × ${escapeHtml(rule.family_name)}</strong>
    <select name="verdict">
      ${optionsHtml(VERDICT_OPTIONS, rule.verdict)}
    </select>
    <textarea name="note" placeholder="note">${escapeHtml(rule.note || '')}</textarea>
    <button class="btn btn-primary" :disabled="busy" @click="saveIngredientRule(${rule.id}, $event.target)">Save</button>
    <button class="btn" :disabled="busy" @click="confirmDeleteRule = { pathSegment: 'ingredient_family', id: ${rule.id}, label: ${jsonForAttr(rule.ingredient_name + ' × ' + rule.family_name)} }">Delete</button>
  </div>`;
}

function repeatRuleCard(rule) {
  return `
  <div class="dish-card" style="flex-direction:column; align-items:stretch;">
    <strong>${escapeHtml(rule.dish_name)}</strong>
    <label>Min gap days <input type="number" name="min_gap_days" value="${Number(rule.min_gap_days)}"></label>
    <select name="severity">
      ${optionsHtml(SEVERITY_OPTIONS, rule.severity)}
    </select>
    <button class="btn btn-primary" :disabled="busy" @click="saveRepeatRule(${rule.id}, $event.target)">Save</button>
    <button class="btn" :disabled="busy" @click="confirmDeleteRule = { pathSegment: 'dish_repeat', id: ${rule.id}, label: ${jsonForAttr(rule.dish_name)} }">Delete</button>
  </div>`;
}

// Renders the already-computed summary/undo_preview (src/data/eventDescriptions.js
// via src/data/knowledge.js) instead of the old raw "date · who · table · source"
// line — Audit 2026-07-18, UX #3: History used to give no way to tell what a
// mistake actually was, or what Undo would do, without reading stored JSON by hand.
function eventCard(ev) {
  return `
  <div class="dish-card" style="flex-direction:column; align-items:stretch;">
    <div>${escapeHtml(ev.summary)}</div>
    <div class="dish-card__family">${escapeHtml(ev.at)} · ${escapeHtml(ev.source)}</div>
    <button class="btn" :disabled="busy" @click="confirmUndo = { id: ${ev.id}, preview: ${jsonForAttr(ev.undo_preview)} }">Undo</button>
  </div>`;
}

function renderKnowledge(data, { editor = null } = {}) {
  // Only the fields the client actually reads get embedded — data.
  // ingredients/families/items (72+57+191 rows) exist in `data` for other callers
  // of getKnowledgeData but must not be shipped to the client unused; embedding
  // full rows bloated this page to ~190KB for zero benefit. The add-rule
  // pickers' options are server-rendered directly below (see optionsHtmlFor,
  // same reasoning as the rule cards' comment above) rather than re-sent as JSON
  // for a client-side x-for, so the raw arrays never need to reach the client at
  // all — smaller payload, and no `<template x-for>` + `<select>` combination on
  // this page to invert a selection on (Audit 2026-07-18, code #1).
  const clientData = {
    ingredientRuleVersions: Object.fromEntries(data.ingredientRules.map((r) => [r.id, r.version])),
    repeatRuleVersions: Object.fromEntries(data.repeatRules.map((r) => [r.id, r.version])),
    placeholders: data.placeholders,
  };
  const body = `
  <div x-data="knowledgeView(${jsonForAttr(clientData)})">
    <h1>Knowledge</h1>
    <p><a href="/special-days">Special days →</a></p>

    <div style="display:flex; gap: var(--space-2); flex-wrap:wrap; margin-bottom: var(--space-4);">
      <button class="btn" :class="{ 'btn-primary': tab === 'ingredient' }" @click="tab = 'ingredient'">Ingredient rules</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'repeat' }" @click="tab = 'repeat'">Repeat rules</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'events' }" @click="tab = 'events'">History</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'needs_input' }" @click="tab = 'needs_input'">Needs input</button>
    </div>

    <section x-show="tab === 'ingredient'">
      <div class="dish-card" style="flex-direction:column; align-items:stretch;">
        <strong>Add rule</strong>
        <select x-model.number="newIngredientRule.ingredient_id">
          <option value="" disabled selected>Ingredient…</option>
          ${optionsHtmlFor(data.ingredients, 'id', 'name_en')}
        </select>
        <select x-model.number="newIngredientRule.family_id">
          <option value="" disabled selected>Dish family…</option>
          ${optionsHtmlFor(data.families, 'id', 'name_en')}
        </select>
        <select x-model="newIngredientRule.verdict">
          ${optionsHtml(VERDICT_OPTIONS, 'unsure')}
        </select>
        <textarea x-model="newIngredientRule.note" placeholder="note"></textarea>
        <button class="btn btn-primary" :disabled="busy" @click="addIngredientRule()">Add rule</button>
      </div>
      ${data.ingredientRules.map(ingredientRuleCard).join('\n')}
    </section>

    <section x-show="tab === 'repeat'">
      <div class="dish-card" style="flex-direction:column; align-items:stretch;">
        <strong>Add rule</strong>
        <select x-model.number="newRepeatRule.dish_item_id">
          <option value="" disabled selected>Dish…</option>
          ${optionsHtmlFor(data.items, 'id', 'name_en')}
        </select>
        <label>Min gap days <input type="number" x-model.number="newRepeatRule.min_gap_days" value="3"></label>
        <select x-model="newRepeatRule.severity">
          ${optionsHtml(SEVERITY_OPTIONS, 'soft')}
        </select>
        <button class="btn btn-primary" :disabled="busy" @click="addRepeatRule()">Add rule</button>
      </div>
      ${data.repeatRules.map(repeatRuleCard).join('\n')}
    </section>

    <template x-if="confirmDeleteRule">
      <div class="sheet-backdrop" @click.self="confirmDeleteRule = null">
        <div class="sheet sheet--static">
          <h2>Delete this rule?</h2>
          <p><strong x-text="confirmDeleteRule.label"></strong></p>
          <button class="btn btn-primary" style="display:block; width:100%; margin-bottom: var(--space-2);" :disabled="busy" @click="deleteRule(confirmDeleteRule.pathSegment, confirmDeleteRule.id); confirmDeleteRule = null">Delete</button>
          <button class="btn" style="width:100%;" @click="confirmDeleteRule = null">Cancel</button>
        </div>
      </div>
    </template>

    <template x-if="confirmUndo">
      <div class="sheet-backdrop" @click.self="confirmUndo = null">
        <div class="sheet sheet--static">
          <h2>Undo this?</h2>
          <p x-text="confirmUndo.preview"></p>
          <button class="btn btn-primary" style="display:block; width:100%; margin-bottom: var(--space-2);" :disabled="busy" @click="undo(confirmUndo.id); confirmUndo = null">Undo</button>
          <button class="btn" style="width:100%;" @click="confirmUndo = null">Cancel</button>
        </div>
      </div>
    </template>

    <section x-show="tab === 'events'">
      ${data.events.map(eventCard).join('\n')}
    </section>

    <section x-show="tab === 'needs_input'">
      <p>Placeholder rows awaiting PK — not filled in automatically per CLAUDE.md A3.3. Edit the taxonomy JSON to resolve these.</p>
      <template x-for="item in placeholders" :key="item.id">
        <div class="dish-card">
          <div class="dish-card__name" x-text="item.name_en"></div>
          <span class="chip chip--avoid">needs input</span>
        </div>
      </template>
    </section>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function knowledgeView(initial) {
      return {
        tab: 'ingredient',
        ingredientRuleVersions: initial.ingredientRuleVersions,
        repeatRuleVersions: initial.repeatRuleVersions,
        placeholders: initial.placeholders,
        newIngredientRule: { ingredient_id: '', family_id: '', verdict: 'unsure', note: '' },
        newRepeatRule: { dish_item_id: '', min_gap_days: 3, severity: 'soft' },
        confirmDeleteRule: null,
        confirmUndo: null,
        // Guards every mutating button on this page against a double-tap firing
        // two overlapping requests (audit code #1 / UX #10).
        busy: false,
        async putRule(pathSegment, id, body) {
          const res = await kpFetch('/api/rules/' + pathSegment + '/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (res.status === 409) {
            kpShowError('Changed since you loaded it — reload and reapply.');
            return false;
          }
          return res.ok;
        },
        async saveIngredientRule(id, buttonEl) {
          if (this.busy) return;
          this.busy = true;
          try {
            const card = buttonEl.closest('.dish-card');
            const ok = await this.putRule('ingredient_family', id, {
              version: this.ingredientRuleVersions[id],
              verdict: card.querySelector('select[name="verdict"]').value,
              note: card.querySelector('textarea[name="note"]').value,
            });
            if (ok) window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async saveRepeatRule(id, buttonEl) {
          if (this.busy) return;
          this.busy = true;
          try {
            const card = buttonEl.closest('.dish-card');
            const ok = await this.putRule('dish_repeat', id, {
              version: this.repeatRuleVersions[id],
              severity: card.querySelector('select[name="severity"]').value,
              min_gap_days: Number(card.querySelector('input[name="min_gap_days"]').value),
            });
            if (ok) window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async addIngredientRule() {
          if (this.busy) return;
          if (!this.newIngredientRule.ingredient_id || !this.newIngredientRule.family_id) {
            kpShowError('Pick an ingredient and a dish family.');
            return;
          }
          this.busy = true;
          try {
            const res = await kpFetch('/api/rules/ingredient_family', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.newIngredientRule),
            });
            if (!res.ok) return;
            window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async addRepeatRule() {
          if (this.busy) return;
          if (!this.newRepeatRule.dish_item_id) {
            kpShowError('Pick a dish.');
            return;
          }
          this.busy = true;
          try {
            const res = await kpFetch('/api/rules/dish_repeat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.newRepeatRule),
            });
            if (!res.ok) return;
            window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async deleteRule(pathSegment, ruleId) {
          if (this.busy) return;
          this.busy = true;
          try {
            const res = await kpFetch('/api/rules/' + pathSegment + '/' + ruleId, { method: 'DELETE' });
            if (!res.ok) return;
            window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async undo(eventId) {
          if (this.busy) return;
          this.busy = true;
          try {
            const res = await kpFetch('/api/knowledge_events/' + eventId + '/undo', { method: 'POST' });
            if (!res.ok) return;
            window.location.reload();
          } finally {
            this.busy = false;
          }
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Knowledge', activeTab: 'knowledge', bodyHtml: body, editor });
}

module.exports = { renderKnowledge };
