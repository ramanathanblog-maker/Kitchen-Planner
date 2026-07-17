const { createResourceRouter } = require('./resource');
const { assertInDomain, assertRequired } = require('./validate');
const { ApiError } = require('./errors');

function ingredientFamilyRulesRouter(db) {
  return createResourceRouter(db, {
    table: 'ingredient_family_rules',
    fields: ['ingredient_id', 'family_id', 'verdict', 'example_dish', 'rationale_tag', 'note', 'scope'],
    validate: (body, current) => {
      if (!current) assertRequired(body, ['ingredient_id', 'family_id', 'verdict']);
      assertInDomain(body.verdict, 'verdict', 'verdict');
      assertInDomain(body.rationale_tag, 'rationale_tag', 'rationale_tag');
      assertInDomain(body.scope, 'scope', 'scope');
    },
  });
}

function dishRepeatRulesRouter(db) {
  return createResourceRouter(db, {
    table: 'dish_repeat_rules',
    fields: ['dish_item_id', 'min_gap_days', 'severity', 'rationale_tag', 'note', 'scope'],
    validate: (body, current) => {
      if (!current) assertRequired(body, ['dish_item_id', 'min_gap_days', 'severity']);
      assertInDomain(body.severity, 'severity', 'severity');
      assertInDomain(body.rationale_tag, 'rationale_tag', 'rationale_tag');
      assertInDomain(body.scope, 'scope', 'scope');
    },
  });
}

function dishCompatibilityRulesRouter(db) {
  return createResourceRouter(db, {
    table: 'dish_compatibility_rules',
    fields: [
      'source_dish_item_id', 'source_family_id', 'target_dish_item_id', 'target_family_id',
      'direction', 'preference', 'rationale_tag', 'note', 'scope',
    ],
    validate: (body, current) => {
      const merged = { ...current, ...body };
      if (!current) assertRequired(body, ['preference']);
      assertInDomain(body.direction, 'direction', 'direction');
      assertInDomain(body.preference, 'preference', 'preference');
      assertInDomain(body.rationale_tag, 'rationale_tag', 'rationale_tag');
      assertInDomain(body.scope, 'scope', 'scope');
      if (!merged.source_dish_item_id && !merged.source_family_id) {
        throw new ApiError(400, 'one of source_dish_item_id / source_family_id is required');
      }
      if (!merged.target_dish_item_id && !merged.target_family_id) {
        throw new ApiError(400, 'one of target_dish_item_id / target_family_id is required');
      }
    },
  });
}

module.exports = { ingredientFamilyRulesRouter, dishRepeatRulesRouter, dishCompatibilityRulesRouter };
