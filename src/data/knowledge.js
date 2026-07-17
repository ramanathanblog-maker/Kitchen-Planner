// Data for the server-rendered /knowledge view: ingredient/family rules and
// dish-repeat rules with their names denormalized in (so the page is truly SSR,
// per the "GET /knowledge is truly server-rendered" test — no client fetch needed
// to show the seeded drumstick-never-in-kari rule), the append-only knowledge_events
// history, and the placeholder rows (sbm_unresolved, child_bento_box) surfaced as
// "needs input" per CLAUDE.md A3.3 — never filled in automatically.
function getKnowledgeData(db) {
  const ingredientRules = db
    .prepare(
      `SELECT r.*, i.name_en AS ingredient_name, f.name_en AS family_name
       FROM ingredient_family_rules r
       JOIN ingredients i ON i.id = r.ingredient_id
       JOIN dish_families f ON f.id = r.family_id
       ORDER BY i.name_en, f.name_en`
    )
    .all();

  const repeatRules = db
    .prepare(
      `SELECT r.*, di.name_en AS dish_name
       FROM dish_repeat_rules r
       JOIN dish_items di ON di.id = r.dish_item_id
       ORDER BY di.name_en`
    )
    .all();

  const events = db.prepare('SELECT * FROM knowledge_events ORDER BY at DESC, id DESC LIMIT 200').all();

  const placeholders = db
    .prepare("SELECT id, name_en, external_id FROM dish_items WHERE is_placeholder = 1 ORDER BY name_en")
    .all();

  const ingredients = db.prepare('SELECT * FROM ingredients ORDER BY name_en').all();
  const families = db.prepare('SELECT * FROM dish_families ORDER BY name_en').all();
  const items = db.prepare('SELECT * FROM dish_items ORDER BY name_en').all();

  return { ingredientRules, repeatRules, events, placeholders, ingredients, families, items };
}

module.exports = { getKnowledgeData };
