// Shared page shell for all server-rendered pages. Each page is a real URL (no
// client-side router); Alpine handles in-page interactivity and mutations (via
// fetch, same-origin, so the editor cookie set by /pick-editor rides along
// automatically), but the initial paint on every page is fully server-rendered —
// no fetch-on-load. Cross-document CSS view transitions (opted into via
// `@view-transition { navigation: auto; }` in theme.css) animate between each
// navigation's real before/after rendered state.
function pageShell({ title, activeTab = null, bodyHtml, kiosk = false, requireEditor = true, editor = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} — Kitchen Knowledge Planner</title>
<link rel="stylesheet" href="/theme.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#3F6212">
${kiosk ? kioskThemeInitScript() : ''}
</head>
<body${kiosk ? ' class="kiosk"' : ''}>
${requireEditor ? editorGuardScript() : ''}
<div id="kp-error-banner" class="error-banner" style="display:none;" role="alert" aria-live="assertive"></div>
<main>
${kiosk ? themeToggleButton() : ''}
${!kiosk && editor ? editorHeaderHtml(editor) : ''}
${bodyHtml}
</main>
${activeTab ? tabBar(activeTab) : ''}
<script>
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }
</script>
${errorBannerScript()}
</body>
</html>`;
}

// "You are RP · Switch" — no page previously showed who the device is currently
// acting as (the editor cookie set by /pick-editor is silent once set), so a
// shared/kiosk-adjacent device could attribute every edit to whoever set it up
// last, with no visible way to check or change it short of typing /pick-editor
// by hand (Audit 2026-07-18, UX #8). Kiosk pages opt out (kiosk is read-only,
// no identity involved) via the `!kiosk` check in pageShell above.
function editorHeaderHtml(editor) {
  return `<div class="editor-header" style="display:flex; justify-content:flex-end; align-items:center; gap: var(--space-2); margin-bottom: var(--space-3); font-size: var(--fs-chip); color: var(--info);">
  <span>You are <strong>${escapeHtml(editor)}</strong></span>
  <a class="btn" style="padding: var(--space-1) var(--space-2); min-height:auto; min-width:auto;" href="/pick-editor">Switch</a>
</div>`;
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

// Kiosk-only theming (Step 3 of the Phase 4b amendment): default light regardless
// of system prefers-color-scheme, with a visible toggle that persists to
// localStorage. Scoped to the kiosk page only — every other page keeps following
// prefers-color-scheme automatically, unchanged (see DECISIONS.md). This inline
// head script runs before first paint so there's no light-then-dark flash on load.
function kioskThemeInitScript() {
  return `<script>
  (function () {
    var saved = localStorage.getItem('kiosk-theme');
    document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
  })();
</script>`;
}

function themeToggleButton() {
  return `<button type="button" class="theme-toggle" aria-label="Toggle dark mode" onclick="
    (function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('kiosk-theme', next);
    })();
  ">
    <span aria-hidden="true" class="theme-toggle__icon">&#9788;</span>
    <span aria-hidden="true" class="theme-toggle__icon">&#9790;</span>
  </button>`;
}

// P1a — a small reusable error-surfacing mechanism shared by every page. Mutating
// fetch() calls across the app were proceeding as if a 4xx/5xx response was a
// success (see DECISIONS.md). window.kpShowError() renders the message in the
// sticky #kp-error-banner div above; window.kpFetch() wraps fetch() and shows the
// banner automatically on any non-ok response, returning {ok, status, body} so
// call sites can branch without duplicating res.ok checks.
function errorBannerScript() {
  return `<script>
  function kpShowError(message) {
    var el = document.getElementById('kp-error-banner');
    if (!el) return;
    el.textContent = message || 'Something went wrong.';
    el.style.display = 'block';
  }
  function kpClearError() {
    var el = document.getElementById('kp-error-banner');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }
  async function kpFetch(url, opts) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      kpShowError('Network error — please check your connection and try again.');
      throw e;
    }
    if (!res.ok) {
      let message = 'Request failed (' + res.status + ').';
      try {
        const body = await res.clone().json();
        if (body && body.error) message = body.error;
      } catch (e) { /* non-JSON error body */ }
      kpShowError(message);
    }
    return res;
  }
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
