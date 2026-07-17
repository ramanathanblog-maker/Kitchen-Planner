// Step 3: ingredient suitability. verdict 'never' blocks, 'avoid' warns,
// 'preferred'/'allowed'/'unsure' produce no blocking finding ('preferred' surfaces as
// an info finding so ranking can boost it without affecting status).
function ingredientSuitability(context) {
  const findings = [];
  for (const rule of context.ingredientFamilyRules || []) {
    if (rule.verdict === 'never') {
      findings.push({
        step: 'ingredient_suitability',
        severity: 'block',
        message: `${rule.ingredient_name} is never used in ${context.dish.family_name} (${rule.note || rule.rationale_tag}).`,
        rule_ref: `ingredient_family_rule:${rule.id}`,
      });
    } else if (rule.verdict === 'avoid') {
      findings.push({
        step: 'ingredient_suitability',
        severity: 'warn',
        message: `${rule.ingredient_name} is best avoided in ${context.dish.family_name} (${rule.note || rule.rationale_tag}).`,
        rule_ref: `ingredient_family_rule:${rule.id}`,
      });
    } else if (rule.verdict === 'preferred') {
      findings.push({
        step: 'ingredient_suitability',
        severity: 'info',
        message: `${rule.ingredient_name} is preferred in ${context.dish.family_name}.`,
        rule_ref: `ingredient_family_rule:${rule.id}`,
      });
    }
  }
  return findings;
}

module.exports = { ingredientSuitability };
