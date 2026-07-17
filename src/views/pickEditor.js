const { pageShell } = require('./layout');

function renderPickEditor() {
  const body = `
  <h1>Who's this?</h1>
  <p>Pick your name once per device — no password, this is a home LAN app.</p>
  <div x-data="{ pick(name) {
      document.cookie = 'editor=' + encodeURIComponent(name) + '; path=/; max-age=' + (60*60*24*365);
      var params = new URLSearchParams(window.location.search);
      window.location.href = params.get('next') || '/';
    } }" style="display:flex; flex-direction:column; gap: var(--space-3); max-width: 320px;">
    <button class="btn btn-primary" @click="pick('PK')">PK</button>
    <button class="btn btn-primary" @click="pick('RP')">RP</button>
    <button class="btn btn-primary" @click="pick('PS')">PS</button>
  </div>
  <script src="/alpine.min.js" defer></script>
  `;
  return pageShell({ title: 'Who is this', bodyHtml: body, requireEditor: false });
}

module.exports = { renderPickEditor };
