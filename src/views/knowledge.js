const { pageShell, jsonForAttr } = require('./layout');

// Server-rendered lists; Alpine's x-data is seeded with the server-fetched rows
// directly (embedded as JSON, not re-fetched on load) so the initial paint already
// shows real rule/event data. Edits still round-trip through the API + a reload,
// same pattern as every other mutation in this app.
function renderKnowledge(data) {
  // Only the fields the Alpine component actually reads get embedded — data.
  // ingredients/families/items (72+57+191 rows) exist in `data` for other callers
  // of getKnowledgeData but must not be shipped to the client unused; embedding
  // them bloated this page to ~190KB for zero benefit.
  const clientData = {
    ingredientRules: data.ingredientRules,
    repeatRules: data.repeatRules,
    events: data.events,
    placeholders: data.placeholders,
  };
  const body = `
  <div x-data="knowledgeView(${jsonForAttr(clientData)})">
    <h1>Knowledge</h1>

    <div style="display:flex; gap: var(--space-2); flex-wrap:wrap; margin-bottom: var(--space-4);">
      <button class="btn" :class="{ 'btn-primary': tab === 'ingredient' }" @click="tab = 'ingredient'">Ingredient rules</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'repeat' }" @click="tab = 'repeat'">Repeat rules</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'events' }" @click="tab = 'events'">History</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'needs_input' }" @click="tab = 'needs_input'">Needs input</button>
    </div>

    <section x-show="tab === 'ingredient'">
      <template x-for="rule in ingredientRules" :key="rule.id">
        <div class="dish-card" style="flex-direction:column; align-items:stretch;">
          <strong x-text="rule.ingredient_name + ' × ' + rule.family_name"></strong>
          <select x-model="rule.verdict">
            <option value="preferred">preferred</option>
            <option value="allowed">allowed</option>
            <option value="avoid">avoid</option>
            <option value="never">never</option>
            <option value="unsure">unsure</option>
          </select>
          <textarea x-model="rule.note" placeholder="note"></textarea>
          <button class="btn btn-primary" @click="saveRule('ingredient_family', rule)">Save</button>
          <p x-show="rule._conflict" style="color: var(--warn);">Changed since you loaded it — reload and reapply.</p>
        </div>
      </template>
    </section>

    <section x-show="tab === 'repeat'">
      <template x-for="rule in repeatRules" :key="rule.id">
        <div class="dish-card" style="flex-direction:column; align-items:stretch;">
          <strong x-text="rule.dish_name"></strong>
          <label>Min gap days <input type="number" x-model.number="rule.min_gap_days"></label>
          <select x-model="rule.severity">
            <option value="soft">soft</option>
            <option value="hard">hard</option>
          </select>
          <button class="btn btn-primary" @click="saveRule('dish_repeat', rule)">Save</button>
          <p x-show="rule._conflict" style="color: var(--warn);">Changed since you loaded it — reload and reapply.</p>
        </div>
      </template>
    </section>

    <section x-show="tab === 'events'">
      <template x-for="ev in events" :key="ev.id">
        <div class="dish-card" style="flex-direction:column; align-items:stretch;">
          <div class="dish-card__family" x-text="ev.at + ' · ' + ev.who + ' · ' + ev.table_name + ' · ' + ev.source"></div>
          <button class="btn" @click="undo(ev.id)">Undo</button>
        </div>
      </template>
    </section>

    <section x-show="tab === 'needs_input'">
      <p>Placeholder rows awaiting PK — not filled in automatically per CLAUDE.md A3.3.</p>
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
        ingredientRules: initial.ingredientRules.map((r) => ({ ...r, _conflict: false })),
        repeatRules: initial.repeatRules.map((r) => ({ ...r, _conflict: false })),
        events: initial.events,
        placeholders: initial.placeholders,
        async saveRule(pathSegment, rule) {
          const res = await fetch('/api/rules/' + pathSegment + '/' + rule.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rule),
          });
          if (res.status === 409) {
            rule._conflict = true;
            return;
          }
          window.location.reload();
        },
        async undo(eventId) {
          await fetch('/api/knowledge_events/' + eventId + '/undo', { method: 'POST' });
          window.location.reload();
        },
      };
    }
  </script>
  `;
  return pageShell({ title: 'Knowledge', activeTab: 'knowledge', bodyHtml: body });
}

module.exports = { renderKnowledge };
