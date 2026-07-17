// Step 4: repeat-gap, layered per counter-spec-v2 §3.2.
// Dish-specific dish_repeat_rules row takes precedence when present; otherwise fall
// back to the ingredient+form default (form = ingredient x dish family). Primary-role
// ingredient appearances count fully; support-role appearances count only toward the
// any-form (3-day) check, not the same-form (14-day) check — the v2 §3.1 assumption
// flagged for PK confirmation in DECISIONS.md.
//
// Gap-days are inclusive of the boundary: a violation is `gap < min_gap_days`, so a
// gap exactly equal to min_gap_days is compliant (see DECISIONS.md Phase 2 entry).
function repeatGap(context) {
  const { repeatGap: rg, repetitionDefaults, dish, date } = context;
  const findings = [];

  if (rg.dishRule) {
    const { min_gap_days, severity, note, id } = rg.dishRule;
    if (rg.lastActualDishGapDays !== null && rg.lastActualDishGapDays < min_gap_days) {
      findings.push({
        step: 'repeat_gap',
        severity: severity === 'hard' ? 'block' : 'warn',
        message: `${dish.name_en} was last served ${rg.lastActualDishGapDays} day(s) ago; needs ${min_gap_days} (${note || 'dish repeat rule'}).`,
        rule_ref: `dish_repeat_rule:${id}`,
      });
    }
  } else {
    for (const ing of rg.ingredientGaps || []) {
      if (ing.lastActualAnyFormGapDays !== null && ing.lastActualAnyFormGapDays < repetitionDefaults.any_form_gap_days) {
        findings.push({
          step: 'repeat_gap',
          severity: 'warn',
          message: `${ing.ingredient_name} appeared in some form ${ing.lastActualAnyFormGapDays} day(s) ago; default gap is ${repetitionDefaults.any_form_gap_days} day(s).`,
          rule_ref: null,
        });
      }
      if (
        ing.role === 'primary' &&
        ing.lastActualSameFormGapDays !== null &&
        ing.lastActualSameFormGapDays < repetitionDefaults.same_form_gap_days
      ) {
        findings.push({
          step: 'repeat_gap',
          severity: 'warn',
          message: `${ing.ingredient_name} appeared in ${dish.family_name} ${ing.lastActualSameFormGapDays} day(s) ago; default same-form gap is ${repetitionDefaults.same_form_gap_days} day(s).`,
          rule_ref: null,
        });
      }
    }
  }

  if (rg.plannedDishConflictWithinGap) {
    findings.push({
      step: 'repeat_gap',
      severity: 'warn',
      message: `${dish.name_en} is already planned within the repeat-gap window around ${date}.`,
      rule_ref: null,
    });
  }

  return findings;
}

module.exports = { repeatGap };
