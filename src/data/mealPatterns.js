// Reads the `meal_patterns` settings row (migration 006) — the pattern-hub wizard's
// shape (amendment §3). Views must call this on every render and must never
// hard-code role/label/max strings themselves (amendment §8 guardrail, checked by
// `grep -rn "main_gravy\|'Gravy'\|'Kari'" src/views`).
function getMealPatterns(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'meal_patterns'").get();
  if (!row) return { morning: { rows: [] }, noon: { rows: [] }, night: { rows: [] } };
  return JSON.parse(row.value);
}

function getSlotPattern(db, slot) {
  const patterns = getMealPatterns(db);
  return patterns[slot] || { rows: [] };
}

module.exports = { getMealPatterns, getSlotPattern };
