const { pageShell, escapeHtml, jsonForAttr } = require('./layout');

const SLOT_LABELS = { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' };

function dayHtml(day, plansByDaySlot, itemsById) {
  const slotsHtml = ['morning', 'noon', 'night']
    .map((slotKey) => {
      const dishes = (plansByDaySlot[day] && plansByDaySlot[day][slotKey]) || [];
      const dishesHtml = dishes
        .map((d) => `<div class="dish-card"><div class="dish-card__name">${escapeHtml(itemsById[d.dish_item_id] || '#' + d.dish_item_id)}</div></div>`)
        .join('\n');
      return `
      <div style="margin-bottom: var(--space-3);">
        <div class="dish-card__family">${SLOT_LABELS[slotKey]}</div>
        ${dishesHtml}
        <button class="btn" @click="openPicker(${jsonForAttr(day)}, ${jsonForAttr(slotKey)})">+ Add</button>
      </div>`;
    })
    .join('\n');
  return `
  <section class="styleguide-section">
    <div class="slot-header"><div class="slot-header__label">${escapeHtml(day)}</div></div>
    ${slotsHtml}
  </section>`;
}

// Server-rendered grid (real initial paint, no fetch-on-load flash); Alpine only
// drives the suggestion-picker sheet, which is genuine post-load interactivity —
// it has no meaningful "before" state to pre-render since it only exists once a
// slot is tapped.
function renderPlan({ days, plans, itemsById }) {
  const plansByDaySlot = {};
  for (const p of plans) {
    (plansByDaySlot[p.date] ||= {});
    (plansByDaySlot[p.date][p.slot] ||= []).push(p);
  }

  const body = `
  <div x-data="planView()">
    <h1>7-day plan</h1>
    ${days.map((day) => dayHtml(day, plansByDaySlot, itemsById)).join('\n')}

    <template x-if="picker">
      <div class="sheet-backdrop" @click.self="picker = null">
        <div class="sheet">
          <h2>Suggestions — <span x-text="picker.date"></span> · <span x-text="slotLabel(picker.slot)"></span></h2>
          <p x-show="pickerLoading">Loading…</p>
          <template x-for="s in pickerSuggestions" :key="s.dishItemId">
            <div class="dish-card">
              <div style="flex:1;">
                <div class="dish-card__name" x-text="s.dishName"></div>
              </div>
              <span :class="'chip chip--' + (s.status === 'allowed' ? 'allowed' : 'avoid')" x-text="s.status" @click="choose(s)" style="cursor:pointer;"></span>
              <button class="btn" @click="reject(s)" title="Not this dish — remember?">✕</button>
            </div>
          </template>
          <button class="btn" @click="picker = null">Close</button>
        </div>
      </div>
    </template>

    <template x-if="confirmDish">
      <div class="sheet-backdrop" @click.self="confirmDish = null">
        <div class="sheet">
          <h2>This has warnings</h2>
          <p x-text="confirmDish.dishName"></p>
          <template x-for="f in confirmDish.findings" :key="f.message">
            <p style="color: var(--warn);" x-text="f.message"></p>
          </template>
          <button class="btn btn-primary" @click="confirmPlan()">Plan anyway</button>
          <button class="btn" @click="confirmDish = null">Cancel</button>
        </div>
      </div>
    </template>

    <template x-if="rejectDish">
      <div class="sheet-backdrop" @click.self="rejectDish = null">
        <div class="sheet">
          <h2>Remember this?</h2>
          <p><strong x-text="rejectDish.dishName"></strong></p>
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
    function planView() {
      return {
        picker: null,
        pickerSuggestions: [],
        pickerLoading: false,
        confirmDish: null,
        rejectDish: null,
        rejectPrimaryIngredients: [],
        rejectIngredientsLoading: false,
        slotLabel(key) {
          return { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' }[key];
        },
        async openPicker(date, slot) {
          this.picker = { date, slot };
          this.pickerLoading = true;
          const res = await fetch('/api/suggest?date=' + date + '&slot=' + slot);
          this.pickerSuggestions = await res.json();
          this.pickerLoading = false;
        },
        choose(s) {
          if (s.status === 'warn') {
            this.confirmDish = s;
          } else {
            this.doPlan(s.dishItemId);
          }
        },
        async doPlan(dishItemId) {
          await fetch('/api/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: this.picker.date, slot: this.picker.slot, dish_item_id: dishItemId }),
          });
          window.location.reload();
        },
        async confirmPlan() {
          await this.doPlan(this.confirmDish.dishItemId);
        },
        async reject(s) {
          this.rejectDish = s;
          this.rejectIngredientsLoading = true;
          const res = await fetch('/api/items/' + s.dishItemId + '/ingredients');
          const rows = await res.json();
          this.rejectPrimaryIngredients = rows.filter((r) => r.role === 'primary');
          this.rejectIngredientsLoading = false;
        },
        // "Avoid carrot in kootu?" — a specific ingredient×family suitability
        // rule, per the build prompt's own example. Only offered when the
        // rejected dish actually has a primary ingredient to blame.
        async teachIngredientAvoid(ing) {
          const dishRes = await fetch('/api/items/' + this.rejectDish.dishItemId);
          const dish = await dishRes.json();
          await fetch('/api/teach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              table: 'ingredient_family_rules',
              ingredient_id: ing.id,
              family_id: dish.family_id,
              verdict: 'avoid',
              rationale_tag: 'dislike',
              note: 'Rejected from Plan view suggestions.',
            }),
          });
          this.rejectDish = null;
          this.picker = null;
        },
        // "Just not for a while?" — a different piece of knowledge (cooldown on
        // this specific dish, not a claim about an ingredient) when there's no
        // ingredient to blame, or the household's real objection isn't
        // ingredient-specific.
        async teachDishCooldown() {
          await fetch('/api/teach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              table: 'dish_repeat_rules',
              dish_item_id: this.rejectDish.dishItemId,
              min_gap_days: 90,
              severity: 'soft',
              rationale_tag: 'dislike',
              note: 'Rejected from Plan view suggestions.',
            }),
          });
          this.rejectDish = null;
          this.picker = null;
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Plan', activeTab: 'plan', bodyHtml: body });
}

module.exports = { renderPlan };
