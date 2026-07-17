// Step 6: heaviness. Scoped to the same date+slot (the dishes actually eaten
// together in a multi-dish slot), not the whole day — see DECISIONS.md Phase 2 entry.
function heaviness(context) {
  const { dish, sameSlotDishesHeaviness } = context;
  if (dish.heaviness !== 'heavy') return [];
  const hasHeavySibling = (sameSlotDishesHeaviness || []).some((h) => h === 'heavy');
  if (!hasHeavySibling) return [];
  return [
    {
      step: 'heaviness',
      severity: 'warn',
      message: `${dish.name_en} is heavy and another heavy dish is already planned for this slot.`,
      rule_ref: null,
    },
  ];
}

module.exports = { heaviness };
