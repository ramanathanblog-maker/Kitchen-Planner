const { pageShell, escapeHtml } = require('./layout');

function ingredientRow(ing, checked) {
  return `<div class="dish-card">
    <label style="flex:1; display:flex; align-items:center; gap: var(--space-2);">
      <input type="checkbox" ${checked ? 'checked' : ''} @change="toggleLeftover(${ing.id})">
      <span>${escapeHtml(ing.name_en)}</span>
    </label>
  </div>`;
}

// Server-rendered: the checkbox states reflect the DB at request time; toggling
// one triggers a mutation + full reload rather than optimistic client-only state,
// consistent with every other mutation in this app (real URL, real reload, no SPA
// state drift).
function renderShopping(data) {
  const body = `
  <div x-data="shoppingView()">
    <h1>Shopping</h1>

    <section class="styleguide-section">
      <h2>Tomorrow — ${escapeHtml(data.tomorrow.date)}</h2>
      ${data.tomorrow.to_buy.map((ing) => ingredientRow(ing, false)).join('\n')}
      ${
        data.tomorrow.have_leftover.length
          ? `<p class="dish-card__family">Using up as leftovers:</p>` +
            data.tomorrow.have_leftover.map((ing) => ingredientRow(ing, true)).join('\n')
          : ''
      }
    </section>

    <section class="styleguide-section">
      <h2>This week — ${escapeHtml(data.week.from)} to ${escapeHtml(data.week.to)}</h2>
      ${data.week.to_buy.map((ing) => `<div class="dish-card"><div class="dish-card__name">${escapeHtml(ing.name_en)}</div></div>`).join('\n')}
    </section>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function shoppingView() {
      return {
        async toggleLeftover(ingredientId) {
          const current = await (await fetch('/api/ingredients/' + ingredientId)).json();
          await fetch('/api/ingredients/' + ingredientId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: current.version, leftover_flag: current.leftover_flag ? 0 : 1 }),
          });
          window.location.reload();
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Shopping', activeTab: 'shopping', bodyHtml: body });
}

module.exports = { renderShopping };
