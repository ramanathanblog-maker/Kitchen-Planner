// Two named editors, no auth (LAN trust model per CLAUDE.md A1 Users / A2 stack).
// A device sets X-Editor once (header, or an editor= cookie the client JS mirrors
// into the header on every fetch) and it's recorded verbatim into updated_by /
// knowledge_events.who. No cookie-parsing dependency needed — the raw Cookie
// header is trivial to split by hand for a single key.
const EDITORS = new Set(['PK', 'RP', 'PS']);

function parseCookies(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Header-or-cookie resolution, no validation — shared by editorMiddleware (which
// validates and 400s) and the Phase 6b household dispatcher (which only needs to
// know who's asking, before any household-specific gate runs).
//
// Phase 6c: if req.editor is already set, an upstream identity middleware
// (Cloudflare Access, src/routes/access.js) has already authoritatively
// resolved who this is from a verified JWT -- that always wins over a stale
// X-Editor header/cookie on the same request, per the amendment's precedence
// rule. Only when nothing upstream has set it does this fall back to the
// plain LAN header/cookie picker, unchanged from before 6c.
function resolveEditor(req) {
  if (req.editor && EDITORS.has(req.editor)) return req.editor;
  const cookies = parseCookies(req.headers.cookie);
  const editor = req.get('X-Editor') || cookies.editor;
  return EDITORS.has(editor) ? editor : null;
}

function editorMiddleware(req, res, next) {
  const editor = resolveEditor(req);
  if (!editor) {
    return res.status(400).json({ error: `X-Editor header (or editor cookie) required, must be one of: ${[...EDITORS].join(', ')}` });
  }
  req.editor = editor;
  next();
}

// For server-rendered HTML pages (not behind editorMiddleware, no hard 400 if
// missing — /pick-editor's client-side redirect handles that case): best-effort
// read of who's asking, so a page can decide what to show without requiring a
// round trip through the API.
function readEditorFromCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return EDITORS.has(cookies.editor) ? cookies.editor : null;
}

module.exports = { editorMiddleware, readEditorFromCookie, resolveEditor, parseCookies, EDITORS };
