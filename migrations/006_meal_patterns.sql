-- 006_meal_patterns.sql — Phase 4b Amendment §3: the meal-pattern wizard's hub
-- screen (one row per meal_role per slot) reads its shape entirely from this
-- settings row — role/label/max/filter_class/collapses_pattern/
-- offer_morning_carryover/collapsed_allows — so reordering, relabelling, or
-- changing a cap is a data edit, never a view-code change (amendment §9's
-- data-driven proof, mirroring how meal_composition_lead_roles already works).
-- Seeded verbatim from the amendment's §3 JSON; admin-editable later via the
-- existing settings table, same principle as can_lead / meal_role.

INSERT INTO settings (key, value) VALUES ('meal_patterns', '{
  "morning": {
    "rows": [
      {"role":"main_gravy","label":"Gravy","max":1},
      {"role":"secondary_gravy","label":"Rasam","max":1},
      {"role":"semi_solid_side","label":"Kootu","max":1},
      {"role":"dry_side","label":"Kari","max":2},
      {"role":"salad","label":"Salad","max":1},
      {"role":"condiment","label":"Thogayal","max":1,"filter_class":"thogayal"},
      {"role":"condiment","label":"Pachadi","max":1,"filter_class":"pachadi"},
      {"role":"crisp_side","label":"Crisp","max":2},
      {"role":"standalone","label":"Variety Rice","max":1,"collapses_pattern":true,"collapsed_allows":["secondary_gravy","semi_solid_side","crisp_side"]}
    ]
  },
  "noon": {
    "rows": [
      {"role":"tiffin_main","label":"Tiffin","max":2},
      {"role":"tiffin_side","label":"Side / Gravy","max":1,"offer_morning_carryover":true},
      {"role":"condiment","label":"Chutney / Thogayal","max":2,"filter_class":"thogayal"},
      {"role":"crisp_side","label":"Crisp","max":1}
    ]
  },
  "night": {"rows":[], "note":"Pattern pending PK confirmation — free-pick fallback until set"}
}');
