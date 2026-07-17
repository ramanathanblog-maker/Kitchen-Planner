const { createResourceRouter } = require('./resource');
const { assertInDomain } = require('./validate');

function itemsRouter(db) {
  const router = createResourceRouter(db, {
    table: 'dish_items',
    fields: ['family_id', 'name_en', 'name_ta', 'onion_flag', 'garlic_flag', 'heaviness', 'is_placeholder', 'notes', 'meal_role', 'can_lead'],
    extraOnCreate: { origin: 'user' },
    listQuery: (req) => {
      if (req.query.family_id) return { where: 'family_id = ?', params: [req.query.family_id] };
      return null;
    },
    validate: (body) => {
      assertInDomain(body.onion_flag, 'bool', 'onion_flag');
      assertInDomain(body.garlic_flag, 'bool', 'garlic_flag');
      assertInDomain(body.heaviness, 'heaviness', 'heaviness');
      assertInDomain(body.is_placeholder, 'bool', 'is_placeholder');
      assertInDomain(body.meal_role, 'meal_role', 'meal_role');
      assertInDomain(body.can_lead, 'bool', 'can_lead');
    },
  });

  // Powers the Plan view's reverse-teach choice ("avoid carrot in kootu?" vs "just
  // not for a while?") — the rejection sheet needs to know the dish's primary
  // ingredient(s) to offer the ingredient-level option at all.
  router.get('/:id/ingredients', (req, res) => {
    const rows = db
      .prepare(
        `SELECT i.id, i.name_en, dii.role
         FROM dish_item_ingredients dii JOIN ingredients i ON i.id = dii.ingredient_id
         WHERE dii.dish_item_id = ? ORDER BY dii.role, i.name_en`
      )
      .all(req.params.id);
    res.json(rows);
  });

  return router;
}

module.exports = { itemsRouter };
