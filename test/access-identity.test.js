// Phase 6c — Cloudflare Access identity path. Mirrors test/household-routing.test.js's
// startServer()/pk()/rp()/ps() convention, extended with a system.db (seeded
// with test-only real-looking emails matching the PK/RP/PS users rows) and a
// locally-generated RSA keypair so JWT verification never makes a network call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const jose = require('jose');
const { openDb } = require('../src/db/connection');
const { migrate, SYSTEM_MIGRATIONS_DIR } = require('../src/db/migrate');
const { seed } = require('../seed/load');
const { createApp } = require('../src/app');

const TEAM_DOMAIN = 'test-team';
const AUD = 'test-aud';
const ISSUER = `https://${TEAM_DOMAIN}.cloudflareaccess.com`;

function tmpDbPath(name) {
  return path.join(os.tmpdir(), `kp-access-test-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}
function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix);
  }
}

let keys; // shared across tests -- generating an RSA keypair per test is unnecessarily slow
let otherKeys; // a second, unrelated keypair to prove a spoofed signature is rejected
let jwks;

test.before(async () => {
  keys = await jose.generateKeyPair('RS256');
  otherKeys = await jose.generateKeyPair('RS256');
  const publicJwk = await jose.exportJWK(keys.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  jwks = jose.createLocalJWKSet({ keys: [publicJwk] });
});

async function signJwt({ email, signingKey = keys.privateKey, issuer = ISSUER, audience = AUD, expiresIn = '1h' }) {
  return new jose.SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn)
    .sign(signingKey);
}

function accessHeaders(email, token, extra = {}) {
  return { 'Cf-Access-Authenticated-User-Email': email, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json', ...extra };
}

async function startServer({ configured = true } = {}) {
  const rpPath = tmpDbPath('rp');
  const psPath = tmpDbPath('ps');
  const systemPath = tmpDbPath('system');
  const rpDb = openDb(rpPath);
  seed(rpDb);
  const psDb = openDb(psPath);
  seed(psDb);
  const systemDb = openDb(systemPath);
  migrate(systemDb, SYSTEM_MIGRATIONS_DIR);
  // Overwrite the 6a placeholder emails with test-only real-looking ones so
  // this file's JWTs can address them.
  systemDb.prepare("UPDATE users SET email = 'pk@example.test' WHERE display_name = 'PK'").run();
  systemDb.prepare("UPDATE users SET email = 'rp@example.test' WHERE display_name = 'RP'").run();
  systemDb.prepare("UPDATE users SET email = 'ps@example.test' WHERE display_name = 'PS'").run();

  const app = createApp(
    { rp: rpDb, ps: psDb },
    systemDb,
    configured ? { cfAccessTeamDomain: TEAM_DOMAIN, cfAccessAud: AUD, cfAccessJwks: jwks } : {}
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}`;
  return {
    rpDb,
    psDb,
    systemDb,
    base,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rpDb.close();
          psDb.close();
          systemDb.close();
          cleanup(rpPath);
          cleanup(psPath);
          cleanup(systemPath);
          resolve();
        });
      }),
  };
}

test('Access: valid JWT for RP\'s email resolves to RP/rp.db with correct permissions', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.rpDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const token = await signJwt({ email: 'rp@example.test' });
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: accessHeaders('rp@example.test', token),
      body: JSON.stringify({ date: '2026-08-05', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 201);
    assert.equal(ctx.rpDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-08-05'").get().c, 1);

    // RP still can't write into ps -- Access identity flows through the same
    // household-ownership check as the cookie/header path (6b), unchanged.
    const crossRes = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: accessHeaders('rp@example.test', token, { 'X-Household': 'ps' }),
      body: JSON.stringify({ date: '2026-08-05', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(crossRes.status, 403);
  } finally {
    await ctx.close();
  }
});

test('Access: valid JWT for PS\'s email resolves to PS/ps.db, symmetric', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.psDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const token = await signJwt({ email: 'ps@example.test' });
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: accessHeaders('ps@example.test', token),
      body: JSON.stringify({ date: '2026-08-06', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 201);
    assert.equal(ctx.psDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-08-06'").get().c, 1);
    assert.equal(ctx.rpDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-08-06'").get().c, 0);
  } finally {
    await ctx.close();
  }
});

test('Access: unknown email is rejected with 403, no household/user silently created', async () => {
  const ctx = await startServer();
  try {
    const token = await signJwt({ email: 'stranger@example.test' });
    const before = ctx.systemDb.prepare('SELECT COUNT(*) c FROM users').get().c;
    const res = await fetch(`${ctx.base}/api/plans`, { headers: accessHeaders('stranger@example.test', token) });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /isn't set up.*ask PK/);
    assert.equal(ctx.systemDb.prepare('SELECT COUNT(*) c FROM users').get().c, before, 'no new user row was created');
  } finally {
    await ctx.close();
  }
});

test('Access: header present with no JWT at all -> 401, never trusted alone', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/plans`, {
      headers: { 'Cf-Access-Authenticated-User-Email': 'rp@example.test', 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Access: JWT signed with a different (spoofed) keypair -> 401', async () => {
  const ctx = await startServer();
  try {
    const token = await signJwt({ email: 'rp@example.test', signingKey: otherKeys.privateKey });
    const res = await fetch(`${ctx.base}/api/plans`, { headers: accessHeaders('rp@example.test', token) });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Access: header email disagrees with the verified JWT\'s own email claim -> 401', async () => {
  const ctx = await startServer();
  try {
    const token = await signJwt({ email: 'rp@example.test' }); // JWT says rp, header will claim ps
    const res = await fetch(`${ctx.base}/api/plans`, { headers: accessHeaders('ps@example.test', token) });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Access: expired JWT -> 401', async () => {
  const ctx = await startServer();
  try {
    const token = await new jose.SignJWT({ email: 'rp@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(keys.privateKey);
    const res = await fetch(`${ctx.base}/api/plans`, { headers: accessHeaders('rp@example.test', token) });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Access: wrong audience claim -> 401', async () => {
  const ctx = await startServer();
  try {
    const token = await signJwt({ email: 'rp@example.test', audience: 'not-the-right-aud' });
    const res = await fetch(`${ctx.base}/api/plans`, { headers: accessHeaders('rp@example.test', token) });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Access: unconfigured (no env/opts, matching every pre-6c createApp call) -- a stray Access header never gates the request, falls through to normal cookie identity', async () => {
  const ctx = await startServer({ configured: false });
  try {
    const token = await signJwt({ email: 'rp@example.test' });
    // No X-Editor at all, plus a well-formed (but unverifiable-here) Access
    // header pair -- must 400 exactly like a plain missing-editor request
    // always has, not treat the Access header as identity.
    const res = await fetch(`${ctx.base}/api/plans`, { headers: accessHeaders('rp@example.test', token) });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /X-Editor header/);
  } finally {
    await ctx.close();
  }
});

test('Access: valid Access JWT identity wins over a stale/mismatched X-Editor cookie on the same request', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.rpDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const token = await signJwt({ email: 'ps@example.test' });

    // Stale X-Editor: RP header alongside a valid Access JWT for PS, no
    // household override -- if the stale header won, this would default to
    // RP's own household (rp) and succeed there. It must instead default to
    // PS's own household (ps) and land in ps.db, proving the JWT identity (not
    // the stale header) drove both who's writing and which household is theirs.
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: accessHeaders('ps@example.test', token, { 'X-Editor': 'RP' }),
      body: JSON.stringify({ date: '2026-08-07', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 201);
    assert.equal(ctx.psDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-08-07'").get().c, 1, "must land in ps.db (the JWT-verified PS identity's own household)");
    assert.equal(ctx.rpDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-08-07'").get().c, 0, "must not land in rp.db (the stale header's household)");

    // And an explicit attempt against rp (RP's own household) with the same
    // stale RP header still 403s, since the JWT-verified identity is PS.
    const crossRes = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: accessHeaders('ps@example.test', token, { 'X-Editor': 'RP', 'X-Household': 'rp' }),
      body: JSON.stringify({ date: '2026-08-07', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(crossRes.status, 403);
  } finally {
    await ctx.close();
  }
});

test('Access: regression -- plain LAN cookie/header flow (no Access headers at all) is completely unaffected', async () => {
  const ctx = await startServer();
  try {
    const dish = ctx.rpDb.prepare("SELECT id FROM dish_items WHERE external_id = 'dish_001'").get();
    const res = await fetch(`${ctx.base}/api/plans`, {
      method: 'POST',
      headers: { 'X-Editor': 'RP', 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-08-08', slot: 'morning', dish_item_id: dish.id }),
    });
    assert.equal(res.status, 201);
    assert.equal(ctx.rpDb.prepare("SELECT COUNT(*) c FROM plans WHERE date = '2026-08-08'").get().c, 1);
  } finally {
    await ctx.close();
  }
});
