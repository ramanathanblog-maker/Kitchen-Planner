// Step 7: availability. v1 has no stock ledger — only the "leftovers first" flag can
// boost ordering (info finding only, never blocks/warns). See DECISIONS.md Phase 2
// entry: leftoverIngredientIds is a context input, not yet backed by a schema table.
function availability(context) {
  const { dish, leftoverIngredientIds } = context;
  if (!leftoverIngredientIds || leftoverIngredientIds.size === 0) return [];
  const findings = [];
  for (const ing of dish.ingredients || []) {
    if (leftoverIngredientIds.has(ing.ingredient_id)) {
      findings.push({
        step: 'availability',
        severity: 'info',
        message: `${ing.ingredient_name} is flagged to use up as leftovers first.`,
        rule_ref: null,
      });
    }
  }
  return findings;
}

module.exports = { availability };
