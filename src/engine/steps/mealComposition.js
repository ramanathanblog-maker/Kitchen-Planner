// Step 5b: meal composition (Phase 1b Amendment §4). Exactly one "lead" dish per
// enforced slot (currently just morning — see settings.meal_composition_enforced_slots).
// A dish is a lead if its meal_role is in leadRoles OR its can_lead flag is set.
// Entirely data-driven: never hard-code which classes/items can lead — read the columns.
//
// Zero-leads is deliberately NOT evaluated here. Whether a slot has zero leads
// doesn't depend on the candidate being evaluated — it's a fact about the slot's
// currently-planned dishes, and folding it into every non-lead candidate's own
// findings meant an identical warn chip on ~150+ suggestions at once. That check
// now lives in ../slotComposition.js and is surfaced once as a page-level banner.
// multiple_leads is genuinely per-candidate: it only fires for a candidate whose
// own lead-ness would push the slot to a second lead, so it stays a per-dish chip.
function isLead(item, leadRoles) {
  return leadRoles.includes(item.meal_role) || !!item.can_lead;
}

function mealComposition(context) {
  const { dish, slot, mealComposition: mc } = context;
  if (!mc || !mc.enforcedSlots.includes(slot)) return [];

  const candidate = { name_en: dish.name_en, meal_role: dish.meal_role, can_lead: dish.can_lead };
  const all = [...(mc.siblings || []), candidate];
  const leads = all.filter((item) => isLead(item, mc.leadRoles));

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
