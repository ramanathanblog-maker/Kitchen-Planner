const { pageShell, escapeHtml, jsonForAttr } = require('./layout');

const SLOT_LABELS = { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' };

function compositionBannerHtml(warning) {
  if (!warning) return '';
  return `<div class="composition-banner" role="status" aria-live="polite">${escapeHtml(warning.message)}</div>`;
}

function slotHtml(date, slotKey, slotData) {
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
    ${slotData.dishes
      .map(
        (d) => `<div class="dish-card">
      <div class="dish-card__name">${escapeHtml(d.name_en)}</div>
      <button class="btn" @click="removeDish(${jsonForAttr(slotKey)}, ${jsonForAttr(slotData.source)}, ${d.row_id})" title="Remove">✕</button>
    </div>`
      )
      .join('\n') || '<p>Nothing planned yet.</p>'}
    ${slotData.source === 'planned' && slotData.dishes.length
      ? `<button class="btn btn-primary" style="width:100%;" @click="logSlotAsPlanned(${jsonForAttr(slotKey)})">Log as eaten</button>`
      : ''}
    <button class="btn" style="width:100%; margin-top: var(--space-2);" @click="openOverride(${jsonForAttr(slotKey)})">Make changes</button>
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
  <div x-data="todayView(${jsonForAttr(date)}, ${jsonForAttr(slots)})">
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
    function todayView(date, slots) {
      return {
        date: date,
        slots: slots,
        overrideSlot: null,
        overrideSuggestions: [],
        overrideCompositionWarning: null,
        servedMessage: '',
        slotLabel(key) {
          return { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' }[key];
        },
        async openOverride(slotKey) {
          this.overrideSlot = slotKey;
          const res = await kpFetch('/api/suggest?date=' + this.date + '&slot=' + slotKey);
          if (!res.ok) { this.overrideSlot = null; return; }
          const data = await res.json();
          this.overrideSuggestions = data.suggestions;
          this.overrideCompositionWarning = data.compositionWarning;
        },
        async markEaten(dishItemId) {
          const res = await kpFetch('/api/actual_meals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: this.date, slot: this.overrideSlot, dish_item_id: dishItemId }),
          });
          if (!res.ok) return;
          window.location.reload();
        },
        // P2d — the primary one-tap action: log every already-planned dish in this
        // slot as eaten, as-is, without opening the override sheet at all.
        // "Make changes" (openOverride) remains the secondary path for alterations.
        async logSlotAsPlanned(slotKey) {
          const dishes = this.slots[slotKey].dishes;
          for (const d of dishes) {
            const res = await kpFetch('/api/actual_meals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date: this.date, slot: slotKey, dish_item_id: d.id }),
            });
            if (!res.ok) return;
          }
          window.location.reload();
        },
        // P2e — remove a single already-chosen dish directly (plans row if still
        // just planned, actual_meals row if already logged as eaten) without going
        // through the guided wizard drill.
        async removeDish(slotKey, source, rowId) {
          const table = source === 'actual' ? 'actual_meals' : 'plans';
          const res = await kpFetch('/api/' + table + '/' + rowId, { method: 'DELETE' });
          if (!res.ok) return;
          window.location.reload();
        },
        async markServed() {
          const res = await kpFetch('/api/plans/' + this.date + '/serve', { method: 'POST' });
          if (!res.ok) return;
          window.location.reload();
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Today', activeTab: 'today', bodyHtml: body });
}

module.exports = { renderToday };
