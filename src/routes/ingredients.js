const { createResourceRouter } = require('./resource');
const { assertInDomain } = require('./validate');

function ingredientsRouter(db) {
  return createResourceRouter(db, {
    table: 'ingredients',
    fields: ['name_en', 'name_ta', 'aliases', 'category', 'allergy_flag', 'seasonality_note', 'stock_note', 'leftover_flag'],
    transforms: { aliases: (v) => (Array.isArray(v) ? JSON.stringify(v) : v) },
    extraOnCreate: { origin: 'user' },
    validate: (body) => {
      assertInDomain(body.category, 'ingredient_category', 'category');
      assertInDomain(body.allergy_flag, 'bool', 'allergy_flag');
      assertInDomain(body.leftover_flag, 'bool', 'leftover_flag');
    },
  });
}

module.exports = { ingredientsRouter };
