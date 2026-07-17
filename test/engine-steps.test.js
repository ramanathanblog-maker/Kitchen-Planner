const test = require('node:test');
const assert = require('node:assert/strict');

const { slotFit } = require('../src/engine/steps/slotFit');
const { specialDay } = require('../src/engine/steps/specialDay');
const { ingredientSuitability } = require('../src/engine/steps/ingredientSuitability');
const { repeatGap } = require('../src/engine/steps/repeatGap');
const { directionalCompatibility } = require('../src/engine/steps/directionalCompatibility');
const { mealComposition } = require('../src/engine/steps/mealComposition');
const { heaviness } = require('../src/engine/steps/heaviness');
const { availability } = require('../src/engine/steps/availability');
const { evaluate } = require('../src/engine/evaluate');

function baseDish(overrides = {}) {
  return {
    id: 1,
    name_en: 'Test Dish',
    family_id: 10,
    family_name: 'Test Family',
    onion_flag: 0,
    garlic_flag: 0,
    heaviness: 'medium',
    slot_fit: ['morning', 'night'],
    ingredients: [],
    meal_role: null,
    can_lead: 0,
    ...overrides,
  };
}

function baseMealComposition(overrides = {}) {
  return {
    enforcedSlots: ['morning'],
    leadRoles: ['main_gravy', 'standalone'],
    zeroLeadsSeverity: 'warn',
    multipleLeadsSeverity: 'warn',
    siblings: [],
    ...overrides,
  };
}

function baseContext(overrides = {}) {
  return {
    date: '2026-07-20',
    slot: 'morning',
    dish: baseDish(),
    specialDay: null,
    ingredientFamilyRules: [],
    repeatGap: { dishRule: null, lastActualDishGapDays: null, plannedDishConflictWithinGap: false, ingredientGaps: [] },
    repetitionDefaults: { any_form_gap_days: 3, same_form_gap_days: 14 },
    morningReference: null,
    compatibilityRules: [],
    sameSlotDishesHeaviness: [],
    mealComposition: baseMealComposition(),
    leftoverIngredientIds: new Set(),
    ...overrides,
  };
}

// --- slot fit ---
test('slotFit: dish fits the requested slot -> no findings', () => {
  const ctx = baseContext({ dish: baseDish({ slot_fit: ['morning'] }), slot: 'morning' });
  assert.deepEqual(slotFit(ctx), []);
});

test('slotFit: dish does not fit the requested slot -> blocked', () => {
  const ctx = baseContext({ dish: baseDish({ slot_fit: ['noon'] }), slot: 'morning' });
  const findings = slotFit(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
});

test('slotFit: night is allowed when explicitly present in slot_fit', () => {
  const ctx = baseContext({ dish: baseDish({ slot_fit: ['morning', 'night'] }), slot: 'night' });
  assert.deepEqual(slotFit(ctx), []);
});

// --- special day ---
test('specialDay: no special day context -> no findings', () => {
  assert.deepEqual(specialDay(baseContext({ specialDay: null })), []);
});

test('specialDay: explicit block assignment on this dish -> blocked', () => {
  const ctx = baseContext({
    dish: baseDish({ id: 5 }),
    specialDay: { activeTypes: [], assignments: [{ id: 1, dish_item_id: 5, family_id: null, rule: 'block', note: 'no', type_name: 'Amavasai' }] },
  });
  const findings = specialDay(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
});

test('specialDay: explicit avoid assignment on the family -> warn', () => {
  const ctx = baseContext({
    dish: baseDish({ family_id: 7 }),
    specialDay: { activeTypes: [], assignments: [{ id: 2, dish_item_id: null, family_id: 7, rule: 'avoid', note: 'soft', type_name: 'Tharpanam' }] },
  });
  const findings = specialDay(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

test('specialDay: onion-flagged dish blocked on a restricts_onion day', () => {
  const ctx = baseContext({
    dish: baseDish({ onion_flag: 1 }),
    specialDay: { activeTypes: [{ id: 1, name: 'Amavasai', restricts_onion: 1, restricts_garlic: 0 }], assignments: [] },
  });
  const findings = specialDay(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
});

test('specialDay: explicit allow assignment overrides the onion/garlic restriction', () => {
  const ctx = baseContext({
    dish: baseDish({ id: 9, onion_flag: 1 }),
    specialDay: {
      activeTypes: [{ id: 1, name: 'Amavasai', restricts_onion: 1, restricts_garlic: 0 }],
      assignments: [{ id: 3, dish_item_id: 9, family_id: null, rule: 'allow', note: 'ok this once', type_name: 'Amavasai' }],
    },
  });
  assert.deepEqual(specialDay(ctx), []);
});

// --- ingredient suitability ---
test('ingredientSuitability: verdict never -> blocked', () => {
  const ctx = baseContext({ ingredientFamilyRules: [{ id: 1, ingredient_name: 'Onion', verdict: 'never', rationale_tag: 'traditional_restriction' }] });
  const findings = ingredientSuitability(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
});

test('ingredientSuitability: verdict avoid -> warn', () => {
  const ctx = baseContext({ ingredientFamilyRules: [{ id: 2, ingredient_name: 'Cabbage', verdict: 'avoid', rationale_tag: 'dislike' }] });
  const findings = ingredientSuitability(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

test('ingredientSuitability: verdict preferred -> info, does not block or warn', () => {
  const ctx = baseContext({ ingredientFamilyRules: [{ id: 3, ingredient_name: 'Carrot', verdict: 'preferred', rationale_tag: 'other' }] });
  const findings = ingredientSuitability(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'info');
});

test('ingredientSuitability: no matching rule -> no findings', () => {
  assert.deepEqual(ingredientSuitability(baseContext()), []);
});

// --- repeat gap ---
test('repeatGap: dish-specific hard rule violated -> blocked', () => {
  const ctx = baseContext({
    repeatGap: { dishRule: { id: 1, min_gap_days: 20, severity: 'hard', note: 'onion sambar' }, lastActualDishGapDays: 15, plannedDishConflictWithinGap: false, ingredientGaps: [] },
  });
  const findings = repeatGap(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
});

test('repeatGap: dish-specific soft rule violated -> warn', () => {
  const ctx = baseContext({
    repeatGap: { dishRule: { id: 1, min_gap_days: 20, severity: 'soft', note: 'onion sambar' }, lastActualDishGapDays: 15, plannedDishConflictWithinGap: false, ingredientGaps: [] },
  });
  const findings = repeatGap(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

test('repeatGap: dish-specific rule takes precedence over ingredient+form default even when default would allow', () => {
  // gap=15: ingredient+form default (same-form 14 days) would ALLOW this, but the
  // 20-day dish rule still blocks it. Ingredient gaps must be ignored entirely once a
  // dish rule exists.
  const ctx = baseContext({
    repeatGap: {
      dishRule: { id: 1, min_gap_days: 20, severity: 'hard', note: 'onion sambar' },
      lastActualDishGapDays: 15,
      plannedDishConflictWithinGap: false,
      ingredientGaps: [{ ingredient_id: 1, ingredient_name: 'Onion', role: 'primary', lastActualAnyFormGapDays: 15, lastActualSameFormGapDays: 15 }],
    },
  });
  const findings = repeatGap(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.match(findings[0].message, /onion sambar|20/i);
});

test('repeatGap: no dish rule, day 3 gap (boundary) on any-form default is compliant', () => {
  const ctx = baseContext({
    repeatGap: {
      dishRule: null,
      lastActualDishGapDays: null,
      plannedDishConflictWithinGap: false,
      ingredientGaps: [{ ingredient_id: 1, ingredient_name: 'Carrot', role: 'support', lastActualAnyFormGapDays: 3, lastActualSameFormGapDays: null }],
    },
  });
  assert.deepEqual(repeatGap(ctx), []);
});

test('repeatGap: no dish rule, day 2 gap on any-form default violates (warn)', () => {
  const ctx = baseContext({
    repeatGap: {
      dishRule: null,
      lastActualDishGapDays: null,
      plannedDishConflictWithinGap: false,
      ingredientGaps: [{ ingredient_id: 1, ingredient_name: 'Carrot', role: 'support', lastActualAnyFormGapDays: 2, lastActualSameFormGapDays: null }],
    },
  });
  const findings = repeatGap(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

test('repeatGap: no dish rule, day 14 gap (boundary) on same-form default is compliant for primary role', () => {
  const ctx = baseContext({
    repeatGap: {
      dishRule: null,
      lastActualDishGapDays: null,
      plannedDishConflictWithinGap: false,
      ingredientGaps: [{ ingredient_id: 1, ingredient_name: 'Carrot', role: 'primary', lastActualAnyFormGapDays: 14, lastActualSameFormGapDays: 14 }],
    },
  });
  assert.deepEqual(repeatGap(ctx), []);
});

test('repeatGap: no dish rule, day 13 gap on same-form default violates for primary role (warn)', () => {
  const ctx = baseContext({
    repeatGap: {
      dishRule: null,
      lastActualDishGapDays: null,
      plannedDishConflictWithinGap: false,
      ingredientGaps: [{ ingredient_id: 1, ingredient_name: 'Carrot', role: 'primary', lastActualAnyFormGapDays: 13, lastActualSameFormGapDays: 13 }],
    },
  });
  const findings = repeatGap(ctx);
  // any-form gap (13) is well past the 3-day default, so only the same-form (14-day) check fires.
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
  assert.match(findings[0].message, /Test Family/);
});

test('repeatGap: support-role ingredient never triggers the same-form check even when it would violate', () => {
  // any-form gap of 1 day violates the 3-day default; same-form gap of 13 days would
  // also violate the 14-day default, but must be suppressed because role is support.
  const ctx = baseContext({
    repeatGap: {
      dishRule: null,
      lastActualDishGapDays: null,
      plannedDishConflictWithinGap: false,
      ingredientGaps: [{ ingredient_id: 1, ingredient_name: 'Carrot', role: 'support', lastActualAnyFormGapDays: 1, lastActualSameFormGapDays: 13 }],
    },
  });
  const findings = repeatGap(ctx);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /some form/);
});

test('repeatGap: planned conflict within gap window surfaces as a warn finding', () => {
  const ctx = baseContext({
    repeatGap: { dishRule: null, lastActualDishGapDays: null, plannedDishConflictWithinGap: true, ingredientGaps: [] },
  });
  const findings = repeatGap(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

// --- directional compatibility ---
test('directionalCompatibility: not noon slot -> no findings even with a morning reference', () => {
  const ctx = baseContext({ slot: 'morning', morningReference: { dishItemId: 1, dishName: 'Mor Kuzhambu' }, compatibilityRules: [{ id: 1, preference: 'prefers' }] });
  assert.deepEqual(directionalCompatibility(ctx), []);
});

test('directionalCompatibility: noon slot with prefers rule -> info finding', () => {
  const ctx = baseContext({ slot: 'noon', morningReference: { dishItemId: 1, dishName: 'Mor Kuzhambu' }, compatibilityRules: [{ id: 1, preference: 'prefers', rationale_tag: 'other' }] });
  const findings = directionalCompatibility(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'info');
});

test('directionalCompatibility: noon slot with avoid rule -> warn finding', () => {
  const ctx = baseContext({ slot: 'noon', morningReference: { dishItemId: 1, dishName: 'X' }, compatibilityRules: [{ id: 1, preference: 'avoid', rationale_tag: 'other' }] });
  const findings = directionalCompatibility(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

// --- meal composition ---
test('mealComposition: slot not in enforcedSlots -> no findings', () => {
  const ctx = baseContext({ slot: 'noon', dish: baseDish({ meal_role: 'tiffin_main', can_lead: 0 }) });
  assert.deepEqual(mealComposition(ctx), []);
});

test('mealComposition: candidate is the only lead (meal_role in leadRoles) -> no findings', () => {
  const ctx = baseContext({ dish: baseDish({ meal_role: 'main_gravy', can_lead: 1 }) });
  assert.deepEqual(mealComposition(ctx), []);
});

test('mealComposition: candidate is lead via can_lead=1 even though meal_role is not a lead role', () => {
  const ctx = baseContext({ dish: baseDish({ meal_role: 'secondary_gravy', can_lead: 1 }) });
  assert.deepEqual(mealComposition(ctx), []);
});

test('mealComposition: candidate is not a lead and no sibling leads -> zero-leads warn', () => {
  const ctx = baseContext({ dish: baseDish({ meal_role: 'secondary_gravy', can_lead: 0 }) });
  const findings = mealComposition(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
  assert.match(findings[0].message, /No sambar\/kozhambu/);
});

test('mealComposition: candidate plus an already-planned lead sibling -> multiple-leads warn naming both', () => {
  const ctx = baseContext({
    dish: baseDish({ name_en: 'Vengaya Sambar', meal_role: 'main_gravy', can_lead: 1 }),
    mealComposition: baseMealComposition({ siblings: [{ name_en: 'Mor Kuzhambu', meal_role: 'main_gravy', can_lead: 1 }] }),
  });
  const findings = mealComposition(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
  assert.match(findings[0].message, /Mor Kuzhambu/);
  assert.match(findings[0].message, /Vengaya Sambar/);
});

test('mealComposition: severity settings are read from context, not hard-coded (block instead of warn)', () => {
  const ctx = baseContext({
    dish: baseDish({ meal_role: 'secondary_gravy', can_lead: 0 }),
    mealComposition: baseMealComposition({ zeroLeadsSeverity: 'block' }),
  });
  const findings = mealComposition(ctx);
  assert.equal(findings[0].severity, 'block');
});

// --- heaviness ---
test('heaviness: light dish never warns regardless of siblings', () => {
  const ctx = baseContext({ dish: baseDish({ heaviness: 'light' }), sameSlotDishesHeaviness: ['heavy'] });
  assert.deepEqual(heaviness(ctx), []);
});

test('heaviness: heavy dish with no heavy siblings -> no findings', () => {
  const ctx = baseContext({ dish: baseDish({ heaviness: 'heavy' }), sameSlotDishesHeaviness: ['light', 'medium'] });
  assert.deepEqual(heaviness(ctx), []);
});

test('heaviness: heavy dish with a heavy sibling in the same slot -> warn', () => {
  const ctx = baseContext({ dish: baseDish({ heaviness: 'heavy' }), sameSlotDishesHeaviness: ['heavy'] });
  const findings = heaviness(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
});

// --- availability ---
test('availability: no leftover flags -> no findings', () => {
  assert.deepEqual(availability(baseContext()), []);
});

test('availability: dish uses a leftover-flagged ingredient -> info finding', () => {
  const ctx = baseContext({
    dish: baseDish({ ingredients: [{ ingredient_id: 5, ingredient_name: 'Potato', role: 'primary' }] }),
    leftoverIngredientIds: new Set([5]),
  });
  const findings = availability(ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'info');
});

test('availability: dish does not use any leftover-flagged ingredient -> no findings', () => {
  const ctx = baseContext({
    dish: baseDish({ ingredients: [{ ingredient_id: 5, ingredient_name: 'Potato', role: 'primary' }] }),
    leftoverIngredientIds: new Set([99]),
  });
  assert.deepEqual(availability(ctx), []);
});

// --- evaluate composition ---
test('evaluate: any block finding -> status blocked, regardless of other warns/infos', () => {
  const ctx = baseContext({
    dish: baseDish({ slot_fit: ['noon'] }), // will fail slot fit (block) since slot is morning
    ingredientFamilyRules: [{ id: 1, ingredient_name: 'X', verdict: 'avoid', rationale_tag: 'other' }],
  });
  const result = evaluate(ctx);
  assert.equal(result.status, 'blocked');
});

test('evaluate: only warn findings -> status warn', () => {
  const ctx = baseContext({ ingredientFamilyRules: [{ id: 1, ingredient_name: 'X', verdict: 'avoid', rationale_tag: 'other' }] });
  const result = evaluate(ctx);
  assert.equal(result.status, 'warn');
});

test('evaluate: only info/no findings -> status allowed', () => {
  const ctx = baseContext({
    dish: baseDish({ meal_role: 'main_gravy', can_lead: 1 }), // satisfies meal_composition's lead requirement
    ingredientFamilyRules: [{ id: 1, ingredient_name: 'X', verdict: 'preferred', rationale_tag: 'other' }],
  });
  const result = evaluate(ctx);
  assert.equal(result.status, 'allowed');
});
