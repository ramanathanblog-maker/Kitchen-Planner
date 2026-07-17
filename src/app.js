// Testable app factory: given an already-migrated db, returns a wired Express app.
// server.js is the thin process entrypoint (opens the real db, migrates, listens);
// tests call createApp(db) directly against a temp DB with no HTTP listen needed
// beyond what supertest-style fetch tests set up themselves.
const path = require('node:path');
const express = require('express');
const { renderStyleguide } = require('./views/styleguide');
const { currentVersion } = require('./db/migrate');
const { editorMiddleware } = require('./routes/editor');
const { errorHandler } = require('./routes/errors');
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

function createApp(db) {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ ok: true, db: 'ready', migration: currentVersion(db) });
  });

  app.get('/styleguide', (req, res) => {
    res.type('html').send(renderStyleguide());
  });

  app.get('/pick-editor', (req, res) => {
    res.type('html').send(renderPickEditor());
  });
  app.get('/', (req, res) => {
    res.type('html').send(renderToday(getTodayData(db, todayStr())));
  });
  app.get('/plan', (req, res) => {
    const today = todayStr();
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    const { itemsById, plans } = getPlanData(db, days[0], days[6]);
    res.type('html').send(renderPlan({ days, plans, itemsById }));
  });
  app.get('/shopping', (req, res) => {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const weekEnd = addDays(today, 7);
    const data = {
      tomorrow: { date: tomorrow, ...ingredientsForRange(db, tomorrow, tomorrow) },
      week: { from: tomorrow, to: weekEnd, ...ingredientsForRange(db, tomorrow, weekEnd) },
    };
    res.type('html').send(renderShopping(data));
  });
  app.get('/knowledge', (req, res) => {
    res.type('html').send(renderKnowledge(getKnowledgeData(db)));
  });
  app.get('/special-days', (req, res) => {
    res.type('html').send(renderSpecialDays(getSpecialDaysData(db)));
  });
  app.get('/display', (req, res) => {
    const today = getTodayData(db, todayStr());
    const shopping = getDisplayShoppingData(db);
    res.type('html').send(renderKiosk({ today, shopping }));
  });

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

  app.use('/api', api);
  app.use('/api', errorHandler);

  return app;
}

module.exports = { createApp };
