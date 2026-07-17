// Read-only display contract (build prompt Phase 3 §3): GET /api/display/today and
// GET /api/display/shopping. No editor identity required — these feed the homelab
// dashboard (a Homepage custom-API widget) and the /display kiosk page's ongoing
// auto-refresh, neither of which has a household member sitting at a keyboard to
// pick an identity. Deliberately NOT mounted behind editorMiddleware in src/app.js.
//
// "Today" is resolved from wall-clock time here at the HTTP boundary, not inside
// the engine (src/engine/* stays deterministic/no-Date.now() per its own
// guardrail) — an API route translating "now" into a date for its caller is exactly
// the kind of boundary A2's determinism rule is scoped to, not a violation of it.
const express = require('express');
const { ingredientsForRange } = require('./shopping');
const { todayStr, addDays } = require('../data/dates');
const { getTodayData } = require('../data/today');

function getDisplayShoppingData(db) {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  return {
    tomorrow: { date: tomorrow, ...ingredientsForRange(db, tomorrow, tomorrow) },
    week: { from: tomorrow, to: weekEnd, ...ingredientsForRange(db, tomorrow, weekEnd) },
  };
}

function displayRouter(db) {
  const router = express.Router();

  router.get('/today', (req, res) => {
    res.json(getTodayData(db, todayStr()));
  });

  router.get('/shopping', (req, res) => {
    res.json(getDisplayShoppingData(db));
  });

  return router;
}

module.exports = { displayRouter, getDisplayShoppingData };
