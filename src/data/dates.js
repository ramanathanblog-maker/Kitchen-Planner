// Small date helpers for the HTTP boundary only (display routes resolve "now"
// here, not inside src/engine/*, which stays deterministic — see the comment at
// the top of src/routes/display.js). UTC-based YYYY-MM-DD strings throughout, to
// match how `date` columns are stored and compared everywhere else in the app.

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { todayStr, addDays };
