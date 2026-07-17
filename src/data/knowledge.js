function getKnowledgeData(db) {
  const ingredients = db.prepare('SELECT * FROM ingredients ORDER BY name_en').all();
  const families = db.prepare('SELECT * FROM dish_families ORDER BY name_en').all();
  const items = db.prepare('SELECT * FROM dish_items ORDER BY name_en').all();
  const ingredientRules = db
    .prepare(
      `SELECT ifr.*, i.name_en AS ingredient_name, df.name_en AS family_name
       FROM ingredient_family_rules ifr
       JOIN ingredients i ON i.id = ifr.ingredient_id
       JOIN dish_families df ON df.id = ifr.family_id
       ORDER BY ifr.id DESC`
    )
    .all();
  const repeatRules = db
    .prepare(
      `SELECT drr.*, di.name_en AS dish_name
       FROM dish_repeat_rules drr JOIN dish_items di ON di.id = drr.dish_item_id
       ORDER BY drr.id DESC`
    )
    .all();
  const events = db.prepare('SELECT * FROM knowledge_events ORDER BY id DESC LIMIT 50').all();
  const placeholders = items.filter((i) => i.is_placeholder);
  return { ingredients, families, items, ingredientRules, repeatRules, events, placeholders };
}

module.exports = { getKnowledgeData };
