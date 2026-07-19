// Phase 6c — Cloudflare Access identity path. Runs alongside, not instead of,
// the existing cookie/header PK/RP/PS picker (src/routes/editor.js) -- LAN
// requests without any Cloudflare-set header are completely unaffected.
const { jwtVerify } = require('jose');
const { EDITORS } = require('./editor');

// systemDb: the system.db handle (users table). teamDomain/aud: Cloudflare
// Access application config. jwks: a jose JWTVerifyGetKey -- createRemoteJWKSet
// in production, createLocalJWKSet in tests (no network calls in tests).
// enabled is false whenever teamDomain/aud/jwks aren't all supplied (the
// default, unconfigured state for dev/test and any deploy before PK sets up
// Access) -- in that state this middleware always no-ops, regardless of what
// headers a request carries, since there is no way to verify them.
function createAccessIdentityMiddleware({ systemDb, teamDomain, aud, jwks }) {
  const enabled = Boolean(teamDomain && aud && jwks);

  return async function accessIdentityMiddleware(req, res, next) {
    const headerEmail = req.get('Cf-Access-Authenticated-User-Email');
    if (!headerEmail || !enabled) return next();

    // The header alone is never sufficient -- it must be accompanied by a
    // valid signed Access JWT, or the request is rejected outright. A request
    // can't be spoofed by just setting the header.
    const token = req.get('Cf-Access-Jwt-Assertion');
    if (!token) {
      return res.status(401).json({ error: 'Cf-Access-Authenticated-User-Email present without a valid Cloudflare Access JWT' });
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: `https://${teamDomain}.cloudflareaccess.com`,
        audience: aud,
      }));
    } catch {
      return res.status(401).json({ error: 'invalid or expired Cloudflare Access session — please log in again' });
    }

    // Defense in depth: Cloudflare's edge sets both headers together from the
    // same verified login, so they must agree -- a mismatch means something
    // altered the header downstream of Cloudflare (or a bug), never legitimate.
    if (payload.email !== headerEmail) {
      return res.status(401).json({ error: 'Cf-Access-Authenticated-User-Email does not match the verified Access JWT' });
    }

    const user = systemDb.prepare('SELECT * FROM users WHERE email = ?').get(headerEmail);
    if (!user || !EDITORS.has(user.display_name)) {
      return res.status(403).json({ error: "this Google account isn't set up — ask PK" });
    }

    // Authoritative: wins over any stale editor cookie on the same request --
    // see resolveEditor() in editor.js, which checks req.editor first.
    req.editor = user.display_name;
    next();
  };
}

module.exports = { createAccessIdentityMiddleware };
