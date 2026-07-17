const { buildContext } = require('./context');
const { evaluate } = require('./evaluate');

// Ranks candidate dish items for a date+slot: blocked excluded, warned demoted,
// preferred-ingredient / directional-prefers / leftover-flagged info findings boost.
function scoreOf(result) {
  let score = result.status === 'allowed' ? 100 : 0; // warn demoted below allowed
  for (const f of result.findings) {
    if (f.severity !== 'info') continue;
    if (f.step === 'ingredient_suitability') score += 3;
    else if (f.step === 'directional_compatibility') score += 3;
    else if (f.step === 'availability') score += 1;
  }
  return score;
}

function rank(db, { date, slot, dishItemIds, leftoverIngredientIds = new Set() }) {
  const evaluated = dishItemIds.map((dishItemId) => {
    const context = buildContext(db, { dishItemId, date, slot, leftoverIngredientIds });
    const result = evaluate(context);
    return {
      dishItemId,
      dishName: context.dish.name_en,
      mealRole: context.dish.meal_role,
      familyName: context.dish.family_name,
      heaviness: context.dish.heaviness,
      status: result.status,
      findings: result.findings,
      score: scoreOf(result),
    };
  });
  return evaluated
    .filter((r) => r.status !== 'blocked')
    .sort((a, b) => b.score - a.score);
}

module.exports = { rank };
