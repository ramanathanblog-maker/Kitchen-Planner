// Unit tests for the History-tab human-readable formatter (Audit 2026-07-18,
// UX #3). Display-layer only — no DB, no knowledge_events schema/undo-route
// involvement; just the old_value/new_value -> sentence mapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLookups, describeEvent, describeUndoPreview } = require('../src/data/eventDescriptions');

const lookups = buildLookups({
  ingredients: [{ id: 1, name_en: 'Murungakkai' }],
  families: [{ id: 2, name_en: 'Kari' }],
  items: [{ id: 3, name_en: 'Vengaya Sambar' }],
});

function ev(overrides) {
  return { id: 1, who: 'RP', at: '2026-07-18 10:00:00', table_name: 'ingredient_family_rules', source: 'manual_edit', old_value: null, new_value: null, ...overrides };
}

test('ingredient_family_rules update: "RP set Murungakkai × Kari to never"', () => {
  const e = ev({
    old_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'allowed' }),
    new_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'never' }),
  });
  assert.equal(describeEvent(e, lookups), 'RP set Murungakkai × Kari to never');
});

test('plans create: "PS added Vengaya Sambar for Sun 19 Jul morning"', () => {
  const e = ev({
    who: 'PS',
    table_name: 'plans',
    old_value: null,
    new_value: JSON.stringify({ dish_item_id: 3, date: '2026-07-19', slot: 'morning' }),
  });
  assert.equal(describeEvent(e, lookups), 'PS added Vengaya Sambar for Sun 19 Jul morning');
});

test('plans delete: describes what was removed, using the old_value', () => {
  const e = ev({
    who: 'PK',
    table_name: 'plans',
    old_value: JSON.stringify({ dish_item_id: 3, date: '2026-07-19', slot: 'morning' }),
    new_value: null,
  });
  assert.equal(describeEvent(e, lookups), 'PK removed Vengaya Sambar for Sun 19 Jul morning');
});

test('actual_meals create uses "as eaten for" phrasing', () => {
  const e = ev({
    who: 'RP',
    table_name: 'actual_meals',
    old_value: null,
    new_value: JSON.stringify({ dish_item_id: 3, date: '2026-07-19', slot: 'night' }),
  });
  assert.equal(describeEvent(e, lookups), 'RP added Vengaya Sambar as eaten for Sun 19 Jul night');
});

test('dish_repeat_rules create: names the dish and the gap', () => {
  const e = ev({
    who: 'PK',
    table_name: 'dish_repeat_rules',
    old_value: null,
    new_value: JSON.stringify({ dish_item_id: 3, min_gap_days: 90, severity: 'soft' }),
  });
  assert.equal(describeEvent(e, lookups), 'PK added Vengaya Sambar to a 90-day repeat gap (soft)');
});

test('unknown ingredient/family id falls back to "#<id>" rather than crashing', () => {
  const e = ev({
    old_value: null,
    new_value: JSON.stringify({ ingredient_id: 999, family_id: 998, verdict: 'never' }),
  });
  assert.equal(describeEvent(e, lookups), 'RP added #999 × #998 to never');
});

test('an undo-source event is prefixed "Undo: "', () => {
  const e = ev({
    who: 'PK',
    source: 'undo',
    old_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'never' }),
    new_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'allowed' }),
  });
  assert.match(describeEvent(e, lookups), /^Undo: PK set/);
});

test('a row with no `who` falls back to "Someone" rather than "undefined"', () => {
  const e = ev({ who: null, old_value: null, new_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'never' }) });
  assert.match(describeEvent(e, lookups), /^Someone added/);
});

test('describeUndoPreview: a create-event preview says what will be removed', () => {
  const e = ev({
    old_value: null,
    new_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'never' }),
  });
  assert.equal(describeUndoPreview(e, lookups), 'This will remove Murungakkai × Kari to never.');
});

test('describeUndoPreview: a delete-event preview says what will be restored', () => {
  const e = ev({
    old_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'avoid' }),
    new_value: null,
  });
  assert.equal(describeUndoPreview(e, lookups), 'This will restore Murungakkai × Kari to avoid.');
});

test('describeUndoPreview: an update-event preview says what will be reverted, back to the old value', () => {
  const e = ev({
    old_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'allowed' }),
    new_value: JSON.stringify({ ingredient_id: 1, family_id: 2, verdict: 'never' }),
  });
  assert.equal(describeUndoPreview(e, lookups), 'This will revert Murungakkai × Kari to allowed.');
});

test('an unrecognized table falls back to a generic but non-crashing description', () => {
  const e = ev({ table_name: 'special_day_types', old_value: null, new_value: JSON.stringify({ name: 'Amavasai' }) });
  assert.equal(describeEvent(e, lookups), 'RP added the day type "Amavasai"');
});

test('dish_compatibility_rules describes source -> target and preference', () => {
  const e = ev({
    table_name: 'dish_compatibility_rules',
    old_value: null,
    new_value: JSON.stringify({ source_family_id: 2, target_dish_item_id: 3, preference: 'prefers' }),
  });
  assert.equal(describeEvent(e, lookups), 'RP added Kari → Vengaya Sambar to prefers');
});
