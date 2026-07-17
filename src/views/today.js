const { pageShell, escapeHtml, jsonForAttr } = require('./layout');

const SLOT_LABELS = { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' };

function compositionBannerHtml(warning) {
  if (!warning) return '';
  return `<div class="composition-banner" role="status" aria-live="polite">${escapeHtml(warning.message)}</div>`;
}

function slotHtml(date, slotKey, slotData) {
  const dishesHtml = slotData.dishes.length
    ? slotData.dishes
        .map((d) => `<div class="dish-card"><div class="dish-card__name">${escapeHtml(d.name_en)}</div></div>`)
        .join('\n')
    : '<p>Nothing planned yet.</p>';
  return `
  <section class="styleguide-section" style="margin-bottom: var(--space-6);">
    <div class="slot-header">
      <div>
        <div class="slot-header__label">${SLOT_LABELS[slotKey]}</div>
        <div class="slot-header__date">${escapeHtml(date)}</div>
      </div>
      <span class="chip chip--allowed">${escapeHtml(slotData.source)}</span>
    </div>
    ${compositionBannerHtml(slotData.compositionWarning)}
    ${dishesHtml}
    <button class="btn" @click="openOverride(${jsonForAttr(slotKey)})">Log what was actually eaten</button>
  </section>`;
}

// Data is rendered directly into the initial HTML — no client-side fetch-on-load,
// so there is no empty-then-populated flash on navigation and CSS view transitions
// have real before/after content to animate between (see DECISIONS.md Phase 4
// rewrite entry). Alpine is still used, but only for post-load interactivity
// (opening the override sheet, submitting a mutation) — never for the initial paint.
function renderToday(todayData) {
  const { date, special_day, slots } = todayData;
  const specialDayHtml = special_day
    ? `<div class="slot-header" style="border-bottom:none;"><span class="slot-header__badge">${escapeHtml(
        special_day.map((s) => s.name).join(', ')
      )}</span></div>`
    : '';

  const body = `
  <div x-data="todayView(${jsonForAttr(date)})">
    <h1>Today</h1>
    ${specialDayHtml}
    ${['morning', 'noon', 'night'].map((k) => slotHtml(date, k, slots[k])).join('\n')}

    <button class="btn btn-primary" @click="markServed()" style="width:100%;">Mark day as served</button>
    <p x-show="servedMessage" x-text="servedMessage" style="color: var(--accent);"></p>

    <template x-if="overrideSlot">
      <div class="sheet-backdrop" @click.self="overrideSlot = null">
        <div class="sheet">
          <h2>What was eaten — <span x-text="slotLabel(overrideSlot)"></span></h2>
          <template x-for="s in overrideSuggestions" :key="s.dishItemId">
            <div class="dish-card" @click="markEaten(s.dishItemId)" style="cursor:pointer;">
              <div class="dish-card__name" x-text="s.dishName"></div>
              <span :class="'chip chip--' + (s.status === 'allowed' ? 'allowed' : 'avoid')" x-text="s.status"></span>
            </div>
          </template>
          <p x-show="overrideCompositionWarning" class="composition-banner" x-text="overrideCompositionWarning && overrideCompositionWarning.message" role="status" aria-live="polite"></p>
          <button class="btn" @click="overrideSlot = null">Cancel</button>
        </div>
      </div>
    </template>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function todayView(date) {
      return {
        date: date,
        overrideSlot: null,
        overrideSuggestions: [],
        overrideCompositionWarning: null,
        servedMessage: '',
        slotLabel(key) {
          return { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' }[key];
        },
        async openOverride(slotKey) {
          this.overrideSlot = slotKey;
          const res = await fetch('/api/suggest?date=' + this.date + '&slot=' + slotKey);
          const data = await res.json();
          this.overrideSuggestions = data.suggestions;
          this.overrideCompositionWarning = data.compositionWarning;
        },
        async markEaten(dishItemId) {
          await fetch('/api/actual_meals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: this.date, slot: this.overrideSlot, dish_item_id: dishItemId }),
          });
          window.location.reload();
        },
        async markServed() {
          await fetch('/api/plans/' + this.date + '/serve', { method: 'POST' });
          window.location.reload();
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Today', activeTab: 'today', bodyHtml: body });
}

module.exports = { renderToday };
