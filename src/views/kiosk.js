const { pageShell, escapeHtml, jsonForAttr } = require('./layout');

const SLOT_LABELS = { morning: 'Morning (Rice Meal)', noon: 'Noon (Tiffin)', night: 'Night' };

// Kiosk page for the homelab dashboard monitor / Homepage iframe. Read-only, no
// editor identity, large type, no interaction. Server-rendered on first load (a
// monitor that's just been power-cycled must show real data immediately, not a
// blank shell waiting on JS) then polls GET /api/display/* every ~5 min — a
// failed poll leaves the last successfully rendered data on screen (stale but
// readable) rather than clearing to blank, which is the actual failure mode a
// kiosk display needs to avoid. Consumes only /api/display/* per build-prompt
// Phase 4 §6.
function renderKiosk({ today, shopping }) {
  const specialDayHtml = today.special_day
    ? `<p class="slot-header__badge" style="font-size:1.25rem;">${escapeHtml(today.special_day.map((s) => s.name).join(', '))}</p>`
    : '';

  const slotsHtml = ['morning', 'noon', 'night']
    .map((slotKey) => {
      const slotData = today.slots[slotKey];
      const dishesHtml = slotData.dishes.length
        ? slotData.dishes.map((d) => `<div class="dish-card"><div class="dish-card__name">${escapeHtml(d.name_en)}</div></div>`).join('\n')
        : '<p>Nothing planned.</p>';
      return `<section class="styleguide-section"><h2>${SLOT_LABELS[slotKey]}</h2>${dishesHtml}</section>`;
    })
    .join('\n');

  const shoppingHtml = shopping.tomorrow.to_buy
    .map((ing) => `<div class="dish-card"><div class="dish-card__name">${escapeHtml(ing.name_en)}</div></div>`)
    .join('\n');

  const body = `
  <div x-data="kioskView(${jsonForAttr(today.date)})" x-init="setInterval(refresh, 5 * 60 * 1000)">
    <h1>Today's menu</h1>
    ${specialDayHtml}
    ${slotsHtml}
    <section class="styleguide-section">
      <h2>Tomorrow's shopping gaps</h2>
      ${shoppingHtml || '<p>Nothing needed.</p>'}
    </section>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function kioskView(renderedForDate) {
      return {
        async refresh() {
          // A stale-but-correct display is far better than a blank one for a
          // wall-mounted kiosk — on any failure, or once the date rolls over
          // past what was server-rendered, just do a full reload (cheap, and
          // guarantees a fresh server-render) instead of patching the DOM by hand.
          const nowDate = new Date().toISOString().slice(0, 10);
          if (nowDate !== renderedForDate) { window.location.reload(); return; }
          try {
            // Pre-flight reachability check before reloading: a bare
            // location.reload() during a network blip would replace the kiosk
            // with the browser's own connection-error page, which is worse than
            // doing nothing. Only reload (a full server re-render) once fetch
            // has confirmed the server actually answers.
            const res = await fetch('/api/display/today');
            if (!res.ok) return;
            window.location.reload();
          } catch (e) {
            // network blip — leave the current (stale but readable) render alone
          }
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Kiosk', bodyHtml: body, kiosk: true, requireEditor: false });
}

module.exports = { renderKiosk };
