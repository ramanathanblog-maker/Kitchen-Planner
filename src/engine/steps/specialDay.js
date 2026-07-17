// Step 2: special-day. Consumes explicit per-day family/dish assignment rows
// (allow/avoid/block) plus the dish's onion/garlic flags against any special-day type
// active on the date that broadly restricts onion/garlic (see DECISIONS.md Phase 2
// entry on special_day_dates / restricts_onion / restricts_garlic).
function matchesAssignment(dish, assignment) {
  if (assignment.dish_item_id != null && assignment.dish_item_id === dish.id) return true;
  if (assignment.family_id != null && assignment.family_id === dish.family_id) return true;
  return false;
}

function specialDay(context) {
  const { dish, specialDay: sd } = context;
  if (!sd) return [];
  const findings = [];

  const matching = (sd.assignments || []).filter((a) => matchesAssignment(dish, a));
  const explicitAllow = matching.some((a) => a.rule === 'allow');

  for (const a of matching) {
    if (a.rule === 'block') {
      findings.push({
        step: 'special_day',
        severity: 'block',
        message: `Blocked on ${context.date} (${a.type_name}): ${a.note || 'blocked for this special day'}.`,
        rule_ref: `special_day_assignment:${a.id}`,
      });
    } else if (a.rule === 'avoid') {
      findings.push({
        step: 'special_day',
        severity: 'warn',
        message: `Avoid on ${context.date} (${a.type_name}): ${a.note || 'avoid for this special day'}.`,
        rule_ref: `special_day_assignment:${a.id}`,
      });
    }
  }

  if (!explicitAllow) {
    for (const type of sd.activeTypes || []) {
      if (type.restricts_onion && dish.onion_flag) {
        findings.push({
          step: 'special_day',
          severity: 'block',
          message: `${dish.name_en} contains onion, restricted on ${context.date} (${type.name}).`,
          rule_ref: `special_day_type:${type.id}`,
        });
      }
      if (type.restricts_garlic && dish.garlic_flag) {
        findings.push({
          step: 'special_day',
          severity: 'block',
          message: `${dish.name_en} contains garlic, restricted on ${context.date} (${type.name}).`,
          rule_ref: `special_day_type:${type.id}`,
        });
      }
    }
  }

  return findings;
}

module.exports = { specialDay };
