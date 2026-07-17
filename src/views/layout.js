// Shared page shell for all server-rendered pages. Each page is a real URL (no
// client-side router); Alpine handles in-page interactivity and mutations (via
// fetch, same-origin, so the editor cookie set by /pick-editor rides along
// automatically), but the initial paint on every page is fully server-rendered —
// no fetch-on-load. Cross-document CSS view transitions (opted into via
// `@view-transition { navigation: auto; }` in theme.css) animate between each
// navigation's real before/after rendered state.
function pageShell({ title, activeTab = null, bodyHtml, kiosk = false, requireEditor = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} — Kitchen Knowledge Planner</title>
<link rel="stylesheet" href="/theme.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#3F6212">
</head>
<body${kiosk ? ' class="kiosk"' : ''}>
${requireEditor ? editorGuardScript() : ''}
<main>
${bodyHtml}
</main>
${activeTab ? tabBar(activeTab) : ''}
<script>
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }
</script>
</body>
</html>`;
}

function editorGuardScript() {
  return `<script>
  (function () {
    var m = document.cookie.match(/(?:^|; )editor=([^;]*)/);
    if (!m || !['PK', 'RP', 'PS'].includes(decodeURIComponent(m[1]))) {
      window.location.replace('/pick-editor?next=' + encodeURIComponent(window.location.pathname));
    }
  })();
</script>`;
}

function tabBar(activeTab) {
  const tabs = [
    { key: 'today', label: 'Today', href: '/' },
    { key: 'plan', label: 'Plan', href: '/plan' },
    { key: 'shopping', label: 'Shopping', href: '/shopping' },
    { key: 'knowledge', label: 'Knowledge', href: '/knowledge' },
  ];
  return `<nav class="tab-bar">
${tabs
  .map(
    (t) =>
      `  <a class="tab-bar__item${t.key === activeTab ? ' is-active' : ''}" href="${t.href}">${t.label}</a>`
  )
  .join('\n')}
</nav>`;
}

function verdictChip(status) {
  const map = {
    preferred: ['chip--preferred', '✓ preferred'],
    allowed: ['chip--allowed', '• allowed'],
    warn: ['chip--avoid', '⚠ avoid'],
    avoid: ['chip--avoid', '⚠ avoid'],
    blocked: ['chip--blocked', '✕ blocked'],
  };
  const [cls, label] = map[status] || map.allowed;
  return `<span class="chip ${cls}">${label}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// For embedding a JSON blob inside an HTML attribute (e.g. x-data="view(...)").
// JSON.stringify output contains raw double-quotes, which would otherwise
// terminate the attribute early the moment any field (an ingredient name, a
// free-text note) contains one — this isn't just cosmetic breakage, it's the
// same class of bug as unescaped HTML injection. The browser HTML-decodes
// attribute values before Alpine parses the JS expression, so this round-trips
// correctly; do not use JSON.stringify(...) directly inside an HTML attribute.
function jsonForAttr(value) {
  return escapeHtml(JSON.stringify(value));
}

module.exports = { pageShell, verdictChip, escapeHtml, jsonForAttr };
