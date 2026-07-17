// Step 5: directional compatibility, morning -> noon only. Reads today's morning
// plan/actual (resolved into context.morningReference by the context loader) when
// evaluating a noon candidate.
function directionalCompatibility(context) {
  const { slot, morningReference, compatibilityRules, dish } = context;
  if (slot !== 'noon' || !morningReference) return [];

  const findings = [];
  for (const rule of compatibilityRules || []) {
    if (rule.preference === 'avoid') {
      findings.push({
        step: 'directional_compatibility',
        severity: 'warn',
        message: `${dish.name_en} is best avoided after ${morningReference.dishName} this morning (${rule.note || rule.rationale_tag}).`,
        rule_ref: `dish_compatibility_rule:${rule.id}`,
      });
    } else if (rule.preference === 'prefers') {
      findings.push({
        step: 'directional_compatibility',
        severity: 'info',
        message: `${dish.name_en} pairs well with ${morningReference.dishName} this morning (${rule.note || rule.rationale_tag}).`,
        rule_ref: `dish_compatibility_rule:${rule.id}`,
      });
    }
  }
  return findings;
}

module.exports = { directionalCompatibility };
