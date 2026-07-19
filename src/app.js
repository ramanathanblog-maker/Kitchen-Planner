// Testable app factory: given already-migrated per-household DBs, returns a
// wired Express app. server.js is the thin process entrypoint (opens the real
// dbs, migrates/seeds, listens); tests call createApp({ rp: db, ps: db2 })
// directly against temp DBs with no HTTP listen needed beyond what
// supertest-style fetch tests set up themselves.
const path = require('node:path');
const express = require('express');
const { createRemoteJWKSet } = require('jose');
const { renderStyleguide } = require('./views/styleguide');
const { currentVersion } = require('./db/migrate');
const { HOUSEHOLDS } = require('./db/households');
const { editorMiddleware, readEditorFromCookie } = require('./routes/editor');
const { resolveHouseholdRequest } = require('./routes/household');
const { createAccessIdentityMiddleware } = require('./routes/access');
const { errorHandler, pageErrorHandler } = require('./routes/errors');
const { ingredientsRouter } = require('./routes/ingredients');
const { familiesRouter } = require('./routes/families');
const { itemsRouter } = require('./routes/items');
const { ingredientFamilyRulesRouter, dishRepeatRulesRouter, dishCompatibilityRulesRouter } = require('./routes/rules');
const { simpleCrudRouter } = require('./routes/plans');
const { suggestRouter, explainRouter } = require('./routes/suggest');
const { teachRouter } = require('./routes/teach');
const { serveRouter } = require('./routes/serve');
const { shoppingRouter } = require('./routes/shopping');
const { knowledgeEventsRouter } = require('./routes/knowledgeEvents');
const { displayRouter } = require('./routes/display');
const { specialDayTypesRouter, specialDayDatesRouter, specialDayAssignmentsRouter } = require('./routes/specialDays');
const { renderPickEditor } = require('./views/pickEditor');
const { renderToday } = require('./views/today');
const { renderPlan } = require('./views/plan');
const { renderShopping } = require('./views/shopping');
const { renderKnowledge } = require('./views/knowledge');
const { renderSpecialDays } = require('./views/specialDays');
const { renderKiosk } = require('./views/kiosk');
const { todayStr, addDays } = require('./data/dates');
const { getTodayData } = require('./data/today');
const { getPlanData } = require('./data/plan');
const { getKnowledgeData } = require('./data/knowledge');
const { getSpecialDaysData } = require('./data/specialDays');
const { getDisplayShoppingData } = require('./routes/display');
const { ingredientsForRange } = require('./routes/shopping');
const { pageRouter: wizardPageRouter, apiRouter: wizardApiRouter } = require('./routes/wizard');

// Builds the full route tree for one household's db -- everything that used to
// live directly in createApp before Phase 6b, unchanged, just parameterized on
// db instead of closing over a single outer one. Called once per household so
// each household's routes stay fully independent Router instances; no route
// handler in here (or in any of the router factories it calls) needs to know
// households exist at all.
function buildHouseholdRoutes(db) {
  const router = express.Router();

  router.get('/pick-editor', (req, res) => {
    res.type('html').send(renderPickEditor());
  });
  router.get('/', (req, res) => {
    res.type('html').send(renderToday(getTodayData(db, todayStr()), { editor: readEditorFromCookie(req) }));
  });
  router.get('/plan', (req, res) => {
    const today = todayStr();
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    const { itemsById, plans, compositionWarnings } = getPlanData(db, days[0], days[6]);
    res.type('html').send(renderPlan({ days, plans, itemsById, compositionWarnings, editor: readEditorFromCookie(req) }));
  });
  router.get('/shopping', (req, res) => {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const weekEnd = addDays(today, 7);
    const data = {
      tomorrow: { date: tomorrow, ...ingredientsForRange(db, tomorrow, tomorrow) },
      week: { from: tomorrow, to: weekEnd, ...ingredientsForRange(db, tomorrow, weekEnd) },
    };
    res.type('html').send(renderShopping(data, { editor: readEditorFromCookie(req) }));
  });
  router.get('/knowledge', (req, res) => {
    res.type('html').send(renderKnowledge(getKnowledgeData(db), { editor: readEditorFromCookie(req) }));
  });
  router.get('/special-days', (req, res) => {
    res.type('html').send(renderSpecialDays(getSpecialDaysData(db), { editor: readEditorFromCookie(req) }));
  });
  // Guided plan wizard (Phase 4b Amendment §2/§8) — real server-rendered pages
  // under /plan/:date/:slot[...] — the sole entry point for planning a slot.
  router.use('/plan', wizardPageRouter(db));

  // HTML error page for every page route above (Today/Plan/Shopping/Knowledge/
  // Special Days/the wizard) — must be mounted after them and before any /api
  // route below, so a thrown error there never leaks a raw Express stack trace
  // to a household member's phone (Audit 2026-07-18, code #5). /api's own JSON
  // errorHandler (mounted at the bottom of this function) is separate.
  router.use(pageErrorHandler);

  const api = express.Router();
  api.use(editorMiddleware);

  api.use('/ingredients', ingredientsRouter(db));
  api.use('/families', familiesRouter(db));
  api.use('/items', itemsRouter(db));
  api.use('/rules/ingredient_family', ingredientFamilyRulesRouter(db));
  api.use('/rules/dish_repeat', dishRepeatRulesRouter(db));
  api.use('/rules/dish_compatibility', dishCompatibilityRulesRouter(db));
  api.use('/plans', simpleCrudRouter(db, 'plans'));
  api.use('/actual_meals', simpleCrudRouter(db, 'actual_meals'));
  api.use('/suggest', suggestRouter(db));
  api.use('/explain', explainRouter(db));
  api.use('/teach', teachRouter(db));
  api.use('/plans', serveRouter(db)); // adds POST /plans/:date/serve alongside the CRUD above
  api.use('/shopping', shoppingRouter(db));
  api.use('/knowledge_events', knowledgeEventsRouter(db));
  api.use('/special_day_types', specialDayTypesRouter(db));
  api.use('/special_day_dates', specialDayDatesRouter(db));
  api.use('/special_day_assignments', specialDayAssignmentsRouter(db));
  api.use('/wizard', wizardApiRouter(db));

  router.use('/api', api);
  router.use('/api', errorHandler);

  return router;
}

// dbByHousehold: { rp: db, ps: db }. systemDb: the system.db handle (users
// table) -- may be omitted/undefined when Cloudflare Access isn't configured
// (see opts below), since it's only ever touched by the Access middleware.
// opts lets tests inject a local (non-network) JWKS instead of the real
// Cloudflare one; production always uses env vars and the real remote JWKS.
function createApp(dbByHousehold, systemDb, opts = {}) {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json());

  // Phase 6c: Cloudflare Access identity path, alongside (not instead of) the
  // LAN cookie/header picker below. Unconfigured by default (no env vars set)
  // -- in that state this is a no-op for every request, including every
  // pre-6c test's createApp({ rp: db }) single-argument call, since systemDb
  // is never dereferenced when disabled.
  const cfAccessTeamDomain = opts.cfAccessTeamDomain ?? process.env.CF_ACCESS_TEAM_DOMAIN;
  const cfAccessAud = opts.cfAccessAud ?? process.env.CF_ACCESS_AUD;
  const cfAccessJwks =
    opts.cfAccessJwks ??
    (cfAccessTeamDomain ? createRemoteJWKSet(new URL(`https://${cfAccessTeamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`)) : null);
  app.use(
    createAccessIdentityMiddleware({
      systemDb,
      teamDomain: cfAccessTeamDomain,
      aud: cfAccessAud,
      jwks: cfAccessJwks,
    })
  );

  // Real connectivity + version check (Phase 5) — this replaced the Phase 0
  // stub ({ok:true, db:'pending', migration:null} always, regardless of actual
  // state) that once caused a stale-build misdiagnosis: a dead/old process kept
  // answering health checks as if everything were fine. This is also the Docker
  // HEALTHCHECK target, so a genuinely broken DB must fail it, not report ok.
  //
  // git_commit/built_at close the *other* half of that same failure class
  // (Audit 2026-07-18, threat: stale-process masking): migration/taxonomy_sha
  // prove the DB state, but a deploy that changes only JS with no new
  // migration and no reseed was previously indistinguishable from the old
  // process at /health. Sourced from GIT_COMMIT/BUILD_TIME env vars baked in
  // at image build time (Dockerfile ARGs, see OPERATIONS.md "Deploy /
  // build stamp") — never computed by running git inside the running
  // container, which may not have git installed or a .git directory at all.
  //
  // Household-agnostic: checks rp.db only, same as before Phase 6b split the
  // db in two -- a single process-level liveness signal, not a per-household one.
  app.get('/health', (req, res) => {
    const db = dbByHousehold.rp;
    try {
      db.prepare('SELECT 1').get();
      const migration = currentVersion(db);
      const taxonomyVersion = db.prepare("SELECT value FROM settings WHERE key = 'taxonomy_version'").get();
      const taxonomySha256 = db.prepare("SELECT value FROM settings WHERE key = 'taxonomy_json_sha256'").get();
      res.json({
        ok: true,
        db: 'ready',
        migration,
        taxonomy_version: taxonomyVersion ? taxonomyVersion.value : null,
        taxonomy_json_sha256: taxonomySha256 ? taxonomySha256.value : null,
        git_commit: process.env.GIT_COMMIT || 'unknown',
        built_at: process.env.BUILD_TIME || 'unknown',
      });
    } catch (err) {
      res.status(503).json({ ok: false, db: 'error', error: err.message });
    }
  });

  app.get('/styleguide', (req, res) => {
    res.type('html').send(renderStyleguide());
  });

  // Kiosk (Phase 6b DO §3): hardcoded to a single household, resolved once at
  // boot from KITCHEN_KIOSK_HOUSEHOLD (falls back to 'rp' if unset/invalid) --
  // deliberately no per-request household resolution, unaffected by any
  // X-Household header, ?household= query param, or editor cookie/identity.
  const kioskHousehold = HOUSEHOLDS.includes(process.env.KITCHEN_KIOSK_HOUSEHOLD)
    ? process.env.KITCHEN_KIOSK_HOUSEHOLD
    : 'rp';
  const kioskDb = dbByHousehold[kioskHousehold];
  app.get('/display', (req, res) => {
    const today = getTodayData(kioskDb, todayStr());
    const shopping = getDisplayShoppingData(kioskDb);
    res.type('html').send(renderKiosk({ today, shopping }));
  });
  // Mounted before the household dispatcher below: read-only, no identity
  // required (spec Phase 3 §3). Must not go through editorMiddleware or
  // household routing.
  app.use('/api/display', displayRouter(kioskDb));

  const routesByHousehold = {};
  for (const key of HOUSEHOLDS) {
    routesByHousehold[key] = buildHouseholdRoutes(dbByHousehold[key]);
  }

  // Single blanket authorization gate ahead of every household-scoped route
  // (mirrors editorMiddleware's own blanket-mount pattern, not planLock's
  // per-write-site pattern -- see docs/KitchenPlanner_Phase6_Amendment
  // Phase 6b for why: household-write-ownership is an authorization concern,
  // not a plans-table-specific domain rule).
  app.use((req, res, next) => {
    const resolved = resolveHouseholdRequest(req);
    if (resolved.status) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    req.household = resolved.household;
    routesByHousehold[resolved.household](req, res, next);
  });

  return app;
}

module.exports = { createApp, buildHouseholdRoutes };
