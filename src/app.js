// Testable app factory: given an already-migrated db, returns a wired Express app.
// server.js is the thin process entrypoint (opens the real db, migrates, listens);
// tests call createApp(db) directly against a temp DB with no HTTP listen needed
// beyond what supertest-style fetch tests set up themselves.
const path = require('node:path');
const express = require('express');
const { renderStyleguide } = require('./views/styleguide');
const { currentVersion } = require('./db/migrate');
const { editorMiddleware, readEditorFromCookie } = require('./routes/editor');
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

function createApp(db) {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json());

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
  app.get('/health', (req, res) => {
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

  app.get('/pick-editor', (req, res) => {
    res.type('html').send(renderPickEditor());
  });
  app.get('/', (req, res) => {
    res.type('html').send(renderToday(getTodayData(db, todayStr()), { editor: readEditorFromCookie(req) }));
  });
  app.get('/plan', (req, res) => {
    const today = todayStr();
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    const { itemsById, plans, compositionWarnings } = getPlanData(db, days[0], days[6]);
    res.type('html').send(renderPlan({ days, plans, itemsById, compositionWarnings, editor: readEditorFromCookie(req) }));
  });
  app.get('/shopping', (req, res) => {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const weekEnd = addDays(today, 7);
    const data = {
      tomorrow: { date: tomorrow, ...ingredientsForRange(db, tomorrow, tomorrow) },
      week: { from: tomorrow, to: weekEnd, ...ingredientsForRange(db, tomorrow, weekEnd) },
    };
    res.type('html').send(renderShopping(data, { editor: readEditorFromCookie(req) }));
  });
  app.get('/knowledge', (req, res) => {
    res.type('html').send(renderKnowledge(getKnowledgeData(db), { editor: readEditorFromCookie(req) }));
  });
  app.get('/special-days', (req, res) => {
    res.type('html').send(renderSpecialDays(getSpecialDaysData(db), { editor: readEditorFromCookie(req) }));
  });
  // Guided plan wizard (Phase 4b Amendment §2/§8) — real server-rendered pages
  // under /plan/:date/:slot[...] — the sole entry point for planning a slot.
  app.use('/plan', wizardPageRouter(db));

  app.get('/display', (req, res) => {
    const today = getTodayData(db, todayStr());
    const shopping = getDisplayShoppingData(db);
    res.type('html').send(renderKiosk({ today, shopping }));
  });

  // HTML error page for every page route above (Today/Plan/Shopping/Knowledge/
  // Special Days/the wizard/the kiosk) — must be mounted after them and before
  // any /api route below, so a thrown error there never leaks a raw Express
  // stack trace to a household member's phone (Audit 2026-07-18, code #5).
  // /api's own JSON errorHandler (mounted at the bottom of this file) is separate.
  app.use(pageErrorHandler);

  // Mounted before the editor gate below: read-only, no identity required (spec
  // Phase 3 §3). Must not go through editorMiddleware.
  app.use('/api/display', displayRouter(db));

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

  app.use('/api', api);
  app.use('/api', errorHandler);

  return app;
}

module.exports = { createApp };
