const { pageShell, escapeHtml, jsonForAttr } = require('./layout');

function renderSpecialDays({ types, dates }, { editor = null } = {}) {
  const typesHtml = types
    .map(
      (t) => `<div class="dish-card">
      <div class="dish-card__name">${escapeHtml(t.name)}</div>
      ${t.restricts_onion ? '<span class="chip chip--avoid">no onion</span>' : ''}
      ${t.restricts_garlic ? '<span class="chip chip--avoid">no garlic</span>' : ''}
    </div>`
    )
    .join('\n');

  const datesHtml = dates
    .map(
      (d) => `<div class="dish-card">
      <div class="dish-card__name">${escapeHtml(d.date)} — ${escapeHtml(d.type_name)}</div>
      <button class="btn" :disabled="busy" @click="removeDate(${jsonForAttr(d.date)}, ${d.special_day_type_id})">Remove</button>
    </div>`
    )
    .join('\n');

  const typeOptionsHtml = types.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('\n');

  const body = `
  <div x-data="specialDaysView()">
    <p><a href="/knowledge">← Knowledge</a></p>
    <h1>Special days</h1>

    <section class="styleguide-section">
      <h2>Types</h2>
      ${typesHtml}
      <div style="display:flex; flex-direction:column; gap: var(--space-2); max-width:320px;">
        <input x-model="newType.name" placeholder="Type name, e.g. Amavasai">
        <label><input type="checkbox" x-model="newType.restricts_onion"> restricts onion</label>
        <label><input type="checkbox" x-model="newType.restricts_garlic"> restricts garlic</label>
        <button class="btn btn-primary" :disabled="busy" @click="addType()">Add type</button>
      </div>
    </section>

    <section class="styleguide-section">
      <h2>Calendar</h2>
      ${datesHtml || '<p>No special days assigned yet.</p>'}
      <div style="display:flex; flex-direction:column; gap: var(--space-2); max-width:320px;">
        <input type="date" x-model="newDate.date">
        <select x-model.number="newDate.special_day_type_id">
          <option value="">Choose a type</option>
          ${typeOptionsHtml}
        </select>
        <button class="btn btn-primary" :disabled="busy" @click="addDate()">Assign date</button>
      </div>
    </section>
  </div>
  <script src="/alpine.min.js" defer></script>
  <script>
    function specialDaysView() {
      return {
        newType: { name: '', restricts_onion: false, restricts_garlic: false },
        newDate: { date: '', special_day_type_id: '' },
        // Guards every mutating button on this page (audit code #2 / UX #10) —
        // addType/addDate/removeDate used to be raw fetch() calls with
        // no error handling at all, so a failed add would silently disappear;
        // kpFetch now surfaces failures via the shared error banner.
        busy: false,
        async addType() {
          if (this.busy) return;
          this.busy = true;
          try {
            const res = await kpFetch('/api/special_day_types', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: this.newType.name,
                restricts_onion: this.newType.restricts_onion ? 1 : 0,
                restricts_garlic: this.newType.restricts_garlic ? 1 : 0,
              }),
            });
            if (!res.ok) return;
            window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async addDate() {
          if (this.busy) return;
          this.busy = true;
          try {
            const res = await kpFetch('/api/special_day_dates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.newDate),
            });
            if (!res.ok) return;
            window.location.reload();
          } finally {
            this.busy = false;
          }
        },
        async removeDate(date, typeId) {
          if (this.busy) return;
          this.busy = true;
          try {
            const res = await kpFetch('/api/special_day_dates/' + date + '/' + typeId, { method: 'DELETE' });
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
  return pageShell({ title: 'Special days', activeTab: 'knowledge', bodyHtml: body, editor });
}

module.exports = { renderSpecialDays };
