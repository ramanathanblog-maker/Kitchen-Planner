const test = require('node:test');
const assert = require('node:assert/strict');
const { todayStr, addDays } = require('../src/data/dates');

// Regression for the IST-vs-UTC "yesterday" bug (Audit 2026-07-18, code #3):
// a plain `new Date().toISOString().slice(0,10)` reports the UTC calendar
// date, which is a day behind India (UTC+5:30, no DST) for the whole
// 18:30-23:59 UTC window (00:00-05:29 IST the *next* day). todayStr() must
// accept an injectable `now` and always resolve to the IST calendar date.
test('todayStr() resolves to the IST date for UTC instants in the 18:30-23:59 window (00:00-05:29 IST next day)', () => {
  // 2026-07-18T19:00:00Z = 2026-07-19T00:30:00+05:30 — IST has already
  // rolled into the 19th while UTC is still on the 18th.
  assert.equal(todayStr(new Date('2026-07-18T19:00:00Z')), '2026-07-19');
  // Right at the boundary: 18:30:00Z is exactly 00:00:00 IST.
  assert.equal(todayStr(new Date('2026-07-18T18:30:00Z')), '2026-07-19');
  // One second before the boundary: still the 18th in both zones.
  assert.equal(todayStr(new Date('2026-07-18T18:29:59Z')), '2026-07-18');
  // Late UTC evening, well into IST's next day.
  assert.equal(todayStr(new Date('2026-07-18T23:59:00Z')), '2026-07-19');
});

test('todayStr() matches UTC date outside the IST-rollover window', () => {
  assert.equal(todayStr(new Date('2026-07-18T06:00:00Z')), '2026-07-18');
  assert.equal(todayStr(new Date('2026-07-18T12:00:00Z')), '2026-07-18');
});

test('todayStr() with no argument returns a well-formed YYYY-MM-DD string', () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDays() is unaffected by the IST offset (pure date-string arithmetic)', () => {
  assert.equal(addDays('2026-07-18', 1), '2026-07-19');
  assert.equal(addDays('2026-07-18', -1), '2026-07-17');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
