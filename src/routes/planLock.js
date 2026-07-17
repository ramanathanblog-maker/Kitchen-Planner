// P1 — past-day plan edits are locked. Only PK may write a `plans` row whose
// date is strictly before the server's current date; RP and PS get a 403. This
// is intent (what's planned), not the log of what actually happened, so
// actual_meals is deliberately never checked here (data/dates.js `todayStr` is
// the sole source of "current date", per the engine's own no-Date.now() rule —
// this file is a route-layer boundary, same as src/routes/display.js).
const { ApiError } = require('./errors');
const { todayStr } = require('../data/dates');

function assertPlanEditable(editor, date) {
  if (date < todayStr() && editor !== 'PK') {
    throw new ApiError(403, 'past days are locked — ask PK to change this');
  }
}

module.exports = { assertPlanEditable };
