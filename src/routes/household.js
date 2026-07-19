// Phase 6b — household routing/authorization, separate from editor.js (identity
// only) the same way planLock.js is kept separate from plans.js: one file per
// concern. This module decides *which household's DB* a request is served from
// and whether a write against that household is allowed for the resolved editor.
const { HOUSEHOLDS } = require('../db/households');
const { resolveEditor, parseCookies } = require('./editor');

const OWN_HOUSEHOLD = { RP: 'rp', PS: 'ps' }; // PK: none listed -- always allowed
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Throws-nothing; callers decide what to do with an invalid override themselves
// (the household dispatcher 400s it) so this stays a pure resolver, mirroring
// resolveEditor's non-throwing shape.
function requestedHousehold(req) {
  const raw = req.get('X-Household') || req.query.household;
  if (raw === undefined) return { value: undefined, valid: true };
  return { value: raw, valid: HOUSEHOLDS.includes(raw) };
}

// household dispatcher's core logic: resolve editor + target household, and
// reject (400 invalid override, 403 unauthorized write) before any route runs.
// Returns { status: 400|403 } to reject, or { household, editor } to proceed --
// deliberately data-only (no res.* calls) so the Express middleware wrapper in
// app.js stays the only place that touches the response.
function resolveHouseholdRequest(req) {
  const override = requestedHousehold(req);
  if (!override.valid) {
    return { status: 400, error: `X-Household must be one of: ${HOUSEHOLDS.join(', ')}` };
  }

  const editor = resolveEditor(req);
  let household;
  if (override.value !== undefined) {
    household = override.value;
  } else if (editor === 'PK') {
    const cookies = parseCookies(req.headers.cookie);
    household = HOUSEHOLDS.includes(cookies.pk_household) ? cookies.pk_household : 'rp';
  } else if (editor && OWN_HOUSEHOLD[editor]) {
    household = OWN_HOUSEHOLD[editor];
  } else {
    household = 'rp'; // no editor identified yet (pre-/pick-editor page load)
  }

  if (!SAFE_METHODS.has(req.method) && editor && OWN_HOUSEHOLD[editor] && OWN_HOUSEHOLD[editor] !== household) {
    return { status: 403, error: `read-only on ${household} — ask PK to change this` };
  }

  return { household, editor };
}

module.exports = { resolveHouseholdRequest, OWN_HOUSEHOLD, SAFE_METHODS };
