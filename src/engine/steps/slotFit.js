// Step 1: slot fit. dish.slot_fit is an array of allowed slots (editable seed data,
// per CLAUDE.md A1 slot-semantics — not hard-coded here).
function slotFit(context) {
  const { dish, slot } = context;
  if (!dish.slot_fit.includes(slot)) {
    return [
      {
        step: 'slot_fit',
        severity: 'block',
        message: `${dish.name_en} is not planned for the ${slot} slot.`,
        rule_ref: null,
      },
    ];
  }
  return [];
}

module.exports = { slotFit };
