const { slotFit } = require('./steps/slotFit');
const { specialDay } = require('./steps/specialDay');
const { ingredientSuitability } = require('./steps/ingredientSuitability');
const { repeatGap } = require('./steps/repeatGap');
const { directionalCompatibility } = require('./steps/directionalCompatibility');
const { mealComposition } = require('./steps/mealComposition');
const { heaviness } = require('./steps/heaviness');
const { availability } = require('./steps/availability');

const STEPS = [
  slotFit,
  specialDay,
  ingredientSuitability,
  repeatGap,
  directionalCompatibility,
  mealComposition,
  heaviness,
  availability,
];

// Composes the 8-step pipeline (Phase 1b Amendment adds step 5b meal_composition)
// against a pre-built context (see context.js). Pure given context: no Date.now(),
// no HTTP, no caching.
function evaluate(context) {
  const findings = STEPS.flatMap((step) => step(context));
  let status = 'allowed';
  if (findings.some((f) => f.severity === 'block')) status = 'blocked';
  else if (findings.some((f) => f.severity === 'warn')) status = 'warn';
  return { status, findings };
}

module.exports = { evaluate, STEPS };
