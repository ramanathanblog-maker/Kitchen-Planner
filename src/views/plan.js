const { pageShell, escapeHtml } = require('./layout');

const SLOT_LABELS = { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' };

function compositionBannerHtml(warning) {
  if (!warning) return '';
  return `<div class="composition-banner" role="status" aria-live="polite">${escapeHtml(warning.message)}</div>`;
}

function dayHtml(day, plansByDaySlot, itemsById, compositionWarnings) {
  const slotsHtml = ['morning', 'noon', 'night']
    .map((slotKey) => {
      const dishes = (plansByDaySlot[day] && plansByDaySlot[day][slotKey]) || [];
      const dishesHtml = dishes
        .map((d) => `<div class="dish-card"><div class="dish-card__name">${escapeHtml(itemsById[d.dish_item_id] || '#' + d.dish_item_id)}</div></div>`)
        .join('\n');
      return `
      <div style="margin-bottom: var(--space-3);">
        <div class="dish-card__family">${SLOT_LABELS[slotKey]}</div>
        ${compositionBannerHtml(compositionWarnings[`${day}|${slotKey}`])}
        ${dishesHtml}
        <a class="btn" href="/plan/${day}/${slotKey}">Guided plan</a>
      </div>`;
    })
    .join('\n');
  return `
  <section class="styleguide-section">
    <div class="slot-header"><div class="slot-header__label">${escapeHtml(day)}</div></div>
    ${slotsHtml}
  </section>`;
}

// Server-rendered grid (real initial paint, no fetch-on-load flash). The
// flat suggestion picker was removed per PK: the pattern-hub wizard
// (src/views/wizard.js, /plan/:date/:slot) is now the sole entry point for
// planning a slot — no separate "+ Add" flat-dump sheet.
function renderPlan({ days, plans, itemsById, compositionWarnings = {} }) {
  const plansByDaySlot = {};
  for (const p of plans) {
    (plansByDaySlot[p.date] ||= {});
    (plansByDaySlot[p.date][p.slot] ||= []).push(p);
  }

  const body = `
  <div>
    <h1>7-day plan</h1>
    ${days.map((day) => dayHtml(day, plansByDaySlot, itemsById, compositionWarnings)).join('\n')}
  </div>
  `;
  return pageShell({ title: 'Plan', activeTab: 'plan', bodyHtml: body });
}

module.exports = { renderPlan };
