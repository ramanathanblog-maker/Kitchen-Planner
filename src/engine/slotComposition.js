const { loadMealCompositionSettings } = require('./context');

// Slot-level "zero leads" composition check (Phase 1b Amendment §4), split out of
// the per-dish meal_composition step. Whether a slot currently has a lead dish
// planned does not depend on which candidate a picker is looking at — it was a bug
// to fold it into every candidate's own findings/status (it fired identically for
// every non-lead candidate, ~150+ duplicate warn chips). This is the single place
// that answers "does this date+slot have a lead dish planned right now", for
// rendering once as a page-level banner (Today/Plan), never as a per-dish chip.
function zeroLeadsWarning(db, { date, slot }) {
  const mc = loadMealCompositionSettings(db);
  if (!mc.enforcedSlots.includes(slot)) return null;

  const siblings = db
    .prepare(`SELECT di.name_en, di.meal_role, di.can_lead FROM plans p JOIN dish_items di ON di.id = p.dish_item_id WHERE p.date = ? AND p.slot = ?`)
    .all(date, slot);
  const leads = siblings.filter((item) => mc.leadRoles.includes(item.meal_role) || !!item.can_lead);
  if (leads.length > 0) return null;

  return {
    step: 'meal_composition',
    severity: mc.zeroLeadsSeverity === 'block' ? 'block' : 'warn',
    message: `No sambar/kozhambu (or other lead dish) planned for ${slot} on ${date}.`,
    rule_ref: 'setting:meal_composition_zero_leads_severity',
  };
}

module.exports = { zeroLeadsWarning };
