// Step 5b: meal composition (Phase 1b Amendment §4). Exactly one "lead" dish per
// enforced slot (currently just morning — see settings.meal_composition_enforced_slots).
// A dish is a lead if its meal_role is in leadRoles OR its can_lead flag is set.
// Entirely data-driven: never hard-code which classes/items can lead — read the columns.
function isLead(item, leadRoles) {
  return leadRoles.includes(item.meal_role) || !!item.can_lead;
}

function mealComposition(context) {
  const { dish, slot, mealComposition: mc } = context;
  if (!mc || !mc.enforcedSlots.includes(slot)) return [];

  const candidate = { name_en: dish.name_en, meal_role: dish.meal_role, can_lead: dish.can_lead };
  const all = [...(mc.siblings || []), candidate];
  const leads = all.filter((item) => isLead(item, mc.leadRoles));

  if (leads.length === 0) {
    return [
      {
        step: 'meal_composition',
        severity: mc.zeroLeadsSeverity === 'block' ? 'block' : 'warn',
        message: `No sambar/kozhambu (or other lead dish) planned for ${slot} on ${context.date}.`,
        rule_ref: 'setting:meal_composition_zero_leads_severity',
      },
    ];
  }

  if (leads.length >= 2) {
    const names = leads.map((l) => l.name_en).join(', ');
    return [
      {
        step: 'meal_composition',
        severity: mc.multipleLeadsSeverity === 'block' ? 'block' : 'warn',
        message: `More than one lead dish planned for ${slot} on ${context.date}: ${names}.`,
        rule_ref: 'setting:meal_composition_multiple_leads_severity',
      },
    ];
  }

  return [];
}

module.exports = { mealComposition };
