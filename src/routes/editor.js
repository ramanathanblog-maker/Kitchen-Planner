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

function editorMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const editor = req.get('X-Editor') || cookies.editor;
  if (!editor || !EDITORS.has(editor)) {
    return res.status(400).json({ error: `X-Editor header (or editor cookie) required, must be one of: ${[...EDITORS].join(', ')}` });
  }
  req.editor = editor;
  next();
}

module.exports = { editorMiddleware, EDITORS };
