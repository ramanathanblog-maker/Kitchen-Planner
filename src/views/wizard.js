// Phase 4b Amendment §2 — pattern-hub wizard views. Never hard-code role/label
// strings: every row's role/label/max/filter_class comes from the meal_patterns
// settings row (src/data/mealPatterns.js), read fresh on every render (amendment
// §8 guardrail — enforced by a grep in the test suite).
const { pageShell, escapeHtml } = require('./layout');
const { rowSlug } = require('../data/wizard');

const SLOT_LABELS = { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' };

function chipClassFor(status) {
  if (status === 'blocked') return 'chip--blocked';
  if (status === 'warn') return 'chip--avoid';
  return 'chip--allowed';
}
function chipLabelFor(status) {
  if (status === 'blocked') return '✕ blocked';
  if (status === 'warn') return '⚠ avoid';
  return '• allowed';
}

function rowHtml(date, slot, row, locked) {
  const slug = rowSlug(row);
  const count = row.chosen.length;
  // P2e — each already-chosen dish gets its own "Remove" action, distinct from
  // re-drilling via Edit, so removing one dish doesn't require re-entering the
  // guided flow from the top. Deletes the single `plans` row via the existing
  // generic DELETE /api/plans/:id route (src/routes/plans.js).
  const chosenHtml = row.chosen
    .map(
      (c) => `<span class="chip chip--allowed" style="margin-right: var(--space-1);">
      ${escapeHtml(c.name_en)}
      ${locked ? '' : `<button class="btn" style="padding: 0 var(--space-1); margin-left: var(--space-1);" @click="removePlan(${c.plan_id})" title="Remove ${escapeHtml(c.name_en)}">✕</button>`}
    </span>`
    )
    .join('');
  const editAffordance = locked
    ? `<span class="btn" style="opacity: 0.5;" title="past days are locked — ask PK to change this">${count >= row.max ? 'Edit' : (row.max > 1 ? `+ (${count}/${row.max})` : '+')}</span>`
    : `<a class="btn" href="/plan/${date}/${slot}/${slug}" data-role="${escapeHtml(row.role)}">
      ${count >= row.max ? 'Edit' : (row.max > 1 ? `+ (${count}/${row.max})` : '+')}
    </a>`;
  return `
  <div class="dish-card" style="justify-content: space-between;">
    <div style="flex:1;">
      <div class="dish-card__name">${escapeHtml(row.label)}</div>
      ${count ? `<div class="dish-card__family">${chosenHtml}</div>` : ''}
    </div>
    ${editAffordance}
  </div>`;
}

function renderWizardHub(hub, { locked = false } = {}) {
  const { date, slot, rows, compositionWarning } = hub;

  if (rows.length === 0) {
    const body = `
    <h1>Guided plan — ${escapeHtml(date)}</h1>
    <p>${escapeHtml(SLOT_LABELS[slot] || slot)}</p>
    <p>No pattern set for this slot yet${hub.note ? ' — ' + escapeHtml(hub.note) : ''}.</p>
    <a class="btn" href="/plan">Back to Plan</a>`;
    return pageShell({ title: 'Guided plan', activeTab: 'plan', bodyHtml: body });
  }

  // Variety-rice-style collapse (amendment §4): a chosen collapses_pattern row
  // hides any row not in its collapsed_allows list.
  const collapseRow = rows.find((r) => r.collapses_pattern && r.chosen.length > 0);
  const visibleRows = collapseRow
    ? rows.filter((r) => r === collapseRow || (collapseRow.collapsed_allows || []).includes(r.role))
    : rows;

  const body = `
  <div x-data="wizardHub()">
    <h1>Guided plan</h1>
    <div class="slot-header">
      <div class="slot-header__label">${escapeHtml(SLOT_LABELS[slot] || slot)}</div>
      <div class="slot-header__date">${escapeHtml(date)}</div>
    </div>
    ${compositionWarning ? `<div class="composition-banner" role="status" aria-live="polite">${escapeHtml(compositionWarning.message)}</div>` : ''}
    ${locked ? `<div class="composition-banner" role="status" aria-live="polite">past days are locked — ask PK to change this</div>` : ''}
    ${visibleRows.map((r) => rowHtml(date, slot, r, locked)).join('\n')}
    <div class="sheet__footer" style="position:static; margin-top: var(--space-4);">
      <a class="btn btn-primary" style="width:100%; display:block; text-align:center;" href="/plan">Save day</a>
    </div>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function wizardHub() {
      return {
        async removePlan(planId) {
          const res = await kpFetch('/api/plans/' + planId, { method: 'DELETE' });
          if (!res.ok) return;
          window.location.reload();
        },
      };
    }
  </script>`;
  return pageShell({ title: 'Guided plan', activeTab: 'plan', bodyHtml: body });
}

function familyGroupHtml(date, slot, rowSlugValue, group) {
  // P2a — single-child collapse: the class has exactly one family, so render its
  // items directly here (leafItemHtml, same markup as the item-choice level) rather
  // than a link into a separate family/item screen.
  if (group.inlineItems) {
    return `
    <div style="margin-bottom: var(--space-3);">
      <div class="suggestion-group__header">${escapeHtml(group.name)}</div>
      ${group.inlineItems.map((i) => leafItemHtml(date, slot, rowSlugValue, i, false)).join('\n')}
    </div>`;
  }
  const famsHtml = group.families
    .map((fam) => {
      if (fam.deadEndItemId) {
        return `
        <button class="btn" style="display:block; width:100%; text-align:left; margin-bottom: var(--space-2);"
          @click="choose(${fam.deadEndItemId})">
          ${escapeHtml(fam.name)} <span class="dish-card__family">(${escapeHtml(fam.items[0].name_en)})</span>
        </button>`;
      }
      return `
      <a class="btn" style="display:block; width:100%; text-align:left; margin-bottom: var(--space-2);"
        href="/plan/${date}/${slot}/${rowSlugValue}/${fam.id}">
        ${escapeHtml(fam.name)}
      </a>`;
    })
    .join('\n');
  return `
  <div style="margin-bottom: var(--space-3);">
    <div class="suggestion-group__header">${escapeHtml(group.name)}</div>
    ${famsHtml}
  </div>`;
}

function renderWizardRole({ date, slot, row, rowSlug: slug, groups, carryover, chosen }) {
  const carryoverHtml =
    carryover && carryover.length
      ? `
    <div style="margin-bottom: var(--space-3);">
      <div class="suggestion-group__header">From this morning</div>
      ${carryover
        .map(
          (d) => `
        <button class="btn" style="display:block; width:100%; text-align:left; margin-bottom: var(--space-2);"
          @click="choose(${d.id})">
          ${escapeHtml(d.name_en)}
        </button>`
        )
        .join('\n')}
    </div>`
      : '';

  const body = `
  <div x-data="wizardRole()">
    <h1>${escapeHtml(row.label)}</h1>
    <p class="dish-card__family">${escapeHtml(SLOT_LABELS[slot] || slot)} · ${escapeHtml(date)} · ${chosen.length}/${row.max} chosen</p>
    ${carryoverHtml}
    ${groups.map((g) => familyGroupHtml(date, slot, slug, g)).join('\n')}
    <p ${groups.length ? '' : ''}>${groups.length === 0 && (!carryover || carryover.length === 0) ? 'No options for this row.' : ''}</p>
    <button class="btn" style="width:100%;" @click="skip()">Skip</button>
    <a class="btn" style="width:100%; display:block; text-align:center; margin-top: var(--space-2);" href="/plan/${date}/${slot}">Back</a>

    <template x-if="collapseConfirm">
      <div class="sheet-backdrop" @click.self="collapseConfirm = null">
        <div class="sheet sheet--static">
          <h2>Choosing this will clear:</h2>
          <template x-for="d in collapseConfirm.dishes" :key="d.planId">
            <p><strong x-text="d.rowLabel"></strong>: <span x-text="d.name"></span></p>
          </template>
          <button class="btn btn-primary" style="display:block; width:100%; margin-bottom: var(--space-2);" @click="confirmChoose()">Continue</button>
          <button class="btn" style="width:100%;" @click="collapseConfirm = null">Cancel</button>
        </div>
      </div>
    </template>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function wizardRole() {
      return {
        collapseConfirm: null,
        async choose(dishItemId) {
          ${row.collapses_pattern
            ? `const previewRes = await kpFetch('/api/wizard/collapse-preview?date=${date}&slot=${slot}');
          if (!previewRes.ok) return;
          const preview = await previewRes.json();
          if (preview.dishes.length > 0) {
            this.collapseConfirm = { dishItemId, dishes: preview.dishes };
            return;
          }
          await this.doChoose(dishItemId);`
            : `await this.doChoose(dishItemId);`}
        },
        async confirmChoose() {
          const dishItemId = this.collapseConfirm.dishItemId;
          this.collapseConfirm = null;
          await this.doChoose(dishItemId);
        },
        async doChoose(dishItemId) {
          const res = await kpFetch('/api/wizard/choose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: ${JSON.stringify(date)}, slot: ${JSON.stringify(slot)}, rowSlug: ${JSON.stringify(slug)}, dishItemId }),
          });
          if (!res.ok) return;
          ${row.collapses_pattern ? `const res2 = await kpFetch('/api/wizard/clear-collapsed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: ${JSON.stringify(date)}, slot: ${JSON.stringify(slot)} }) }); if (!res2.ok) return;` : ''}
          window.location.href = '/plan/${date}/${slot}';
        },
        skip() {
          window.location.href = '/plan/${date}/${slot}';
        },
      };
    }
  </script>`;
  return pageShell({ title: row.label, activeTab: 'plan', bodyHtml: body });
}

function leafItemHtml(date, slot, rowSlugValue, item, allowReject = true) {
  const disabled = item.status === 'blocked';
  return `
  <div class="dish-card">
    <div style="flex:1;">
      <div class="dish-card__name">${escapeHtml(item.dishName)}</div>
      ${disabled ? `<div class="dish-card__family" style="color: var(--blocked);">${escapeHtml(item.reason || 'blocked')}</div>` : ''}
    </div>
    <span class="chip ${chipClassFor(item.status)}">${chipLabelFor(item.status)}</span>
    ${disabled
      ? `<button class="btn" disabled>Choose</button>`
      : `<button class="btn btn-primary" @click="choose(${item.dishItemId})">Choose</button>
         ${allowReject ? `<button class="btn" @click="reject(${item.dishItemId}, ${JSON.stringify(item.dishName)})" title="Not this dish — remember?">✕</button>` : ''}`}
  </div>`;
}

function renderWizardItems({ date, slot, row, rowSlug: slug, familyId, familyName, items }) {
  const body = `
  <div x-data="wizardItems()">
    <h1>${escapeHtml(familyName)}</h1>
    <p class="dish-card__family">${escapeHtml(row.label)} · ${escapeHtml(SLOT_LABELS[slot] || slot)} · ${escapeHtml(date)}</p>
    ${items.map((i) => leafItemHtml(date, slot, slug, i)).join('\n')}
    <button class="btn" style="width:100%;" @click="skip()">Skip</button>
    <a class="btn" style="width:100%; display:block; text-align:center; margin-top: var(--space-2);" href="/plan/${date}/${slot}/${slug}">Back</a>

    <template x-if="collapseConfirm">
      <div class="sheet-backdrop" @click.self="collapseConfirm = null">
        <div class="sheet sheet--static">
          <h2>Choosing this will clear:</h2>
          <template x-for="d in collapseConfirm.dishes" :key="d.planId">
            <p><strong x-text="d.rowLabel"></strong>: <span x-text="d.name"></span></p>
          </template>
          <button class="btn btn-primary" style="display:block; width:100%; margin-bottom: var(--space-2);" @click="confirmChoose()">Continue</button>
          <button class="btn" style="width:100%;" @click="collapseConfirm = null">Cancel</button>
        </div>
      </div>
    </template>

    <template x-if="rejectDish">
      <div class="sheet-backdrop" @click.self="rejectDish = null">
        <div class="sheet sheet--static">
          <h2>Remember this?</h2>
          <p><strong x-text="rejectDish.name"></strong></p>
          <p x-show="rejectIngredientsLoading">Checking ingredients…</p>
          <template x-if="!rejectIngredientsLoading && rejectPrimaryIngredients.length">
            <div>
              <template x-for="ing in rejectPrimaryIngredients" :key="ing.id">
                <button class="btn btn-primary" style="display:block; width:100%; margin-bottom: var(--space-2);" @click="teachIngredientAvoid(ing)">
                  Avoid <span x-text="ing.name_en"></span> in this dish family?
                </button>
              </template>
            </div>
          </template>
          <button class="btn" style="display:block; width:100%; margin-bottom: var(--space-2);" @click="teachDishCooldown()">Just not for a while?</button>
          <button class="btn" @click="rejectDish = null">No thanks</button>
        </div>
      </div>
    </template>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function wizardItems() {
      return {
        rejectDish: null,
        rejectPrimaryIngredients: [],
        rejectIngredientsLoading: false,
        collapseConfirm: null,
        async choose(dishItemId) {
          ${row.collapses_pattern
            ? `const previewRes = await kpFetch('/api/wizard/collapse-preview?date=${date}&slot=${slot}');
          if (!previewRes.ok) return;
          const preview = await previewRes.json();
          if (preview.dishes.length > 0) {
            this.collapseConfirm = { dishItemId, dishes: preview.dishes };
            return;
          }
          await this.doChoose(dishItemId);`
            : `await this.doChoose(dishItemId);`}
        },
        async confirmChoose() {
          const dishItemId = this.collapseConfirm.dishItemId;
          this.collapseConfirm = null;
          await this.doChoose(dishItemId);
        },
        async doChoose(dishItemId) {
          const res = await kpFetch('/api/wizard/choose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: ${JSON.stringify(date)}, slot: ${JSON.stringify(slot)}, rowSlug: ${JSON.stringify(slug)}, dishItemId }),
          });
          if (!res.ok) return;
          window.location.href = '/plan/${date}/${slot}';
        },
        skip() {
          window.location.href = '/plan/${date}/${slot}/${slug}';
        },
        async reject(dishItemId, name) {
          this.rejectDish = { id: dishItemId, name };
          this.rejectIngredientsLoading = true;
          const res = await kpFetch('/api/items/' + dishItemId + '/ingredients');
          if (!res.ok) { this.rejectIngredientsLoading = false; this.rejectDish = null; return; }
          const rows = await res.json();
          this.rejectPrimaryIngredients = rows.filter((r) => r.role === 'primary');
          this.rejectIngredientsLoading = false;
        },
        async teachIngredientAvoid(ing) {
          const dishRes = await kpFetch('/api/items/' + this.rejectDish.id);
          if (!dishRes.ok) return;
          const dish = await dishRes.json();
          const res = await kpFetch('/api/teach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              table: 'ingredient_family_rules',
              ingredient_id: ing.id,
              family_id: dish.family_id,
              verdict: 'avoid',
              rationale_tag: 'dislike',
              note: 'Rejected from Guided plan drill.',
            }),
          });
          if (!res.ok) return;
          this.rejectDish = null;
        },
        async teachDishCooldown() {
          const res = await kpFetch('/api/teach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              table: 'dish_repeat_rules',
              dish_item_id: this.rejectDish.id,
              min_gap_days: 90,
              severity: 'soft',
              rationale_tag: 'dislike',
              note: 'Rejected from Guided plan drill.',
            }),
          });
          if (!res.ok) return;
          this.rejectDish = null;
        },
      };
    }
  </script>`;
  return pageShell({ title: familyName, activeTab: 'plan', bodyHtml: body });
}

module.exports = { renderWizardHub, renderWizardRole, renderWizardItems };
