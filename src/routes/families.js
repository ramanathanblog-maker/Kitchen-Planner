const { createResourceRouter } = require('./resource');
const { assertInDomain } = require('./validate');

function familiesRouter(db) {
  return createResourceRouter(db, {
    table: 'dish_families',
    fields: ['name_en', 'name_ta', 'parent_id', 'heaviness', 'slot_fit', 'meal_role', 'can_lead', 'notes'],
    transforms: { slot_fit: (v) => (Array.isArray(v) ? JSON.stringify(v) : v) },
    extraOnCreate: { origin: 'user' },
    validate: (body) => {
      assertInDomain(body.heaviness, 'heaviness', 'heaviness');
      assertInDomain(body.meal_role, 'meal_role', 'meal_role');
      assertInDomain(body.can_lead, 'bool', 'can_lead');
    },
  });
}

module.exports = { familiesRouter };
