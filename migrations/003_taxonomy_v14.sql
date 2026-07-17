-- 003_taxonomy_v14.sql — Phase 1b Amendment: schema changes for taxonomy JSON v1.4.
-- Append-only: never edit this file after it has been applied anywhere.
-- Numbered 003 (not 002, per the amendment's suggested name) because 002 was already
-- taken by special_day_flags — migrations are append-only and never renumbered.

-- 1. Widen ingredients.category CHECK to the v1.4 vocabulary. SQLite can't ALTER a CHECK
-- in place, so rebuild the table. 'dal_pulse' (old vocabulary) maps to 'pulse'.
-- Built under a fresh name and swapped into place (rather than renaming the original
-- table out of the way first) because SQLite's ALTER TABLE RENAME rewrites REFERENCES
-- clauses in dependent tables (dish_item_ingredients, ingredient_family_rules) to
-- follow the renamed table — which would leave them pointing at a since-dropped
-- "ingredients_old" once the swap finishes.
CREATE TABLE ingredients_v14 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL UNIQUE,
  name_ta TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('vegetable','pulse','pulse_nut','nut','dal','grain','greens','aromatic','spice','dairy','protein','fruit','other')),
  allergy_flag INTEGER NOT NULL DEFAULT 0 CHECK (allergy_flag IN (0,1)),
  seasonality_note TEXT,
  stock_note TEXT,
  external_id TEXT,
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO ingredients_v14 (id, name_en, name_ta, aliases, category, allergy_flag, seasonality_note, stock_note, origin, created_at, updated_at)
SELECT id, name_en, name_ta, aliases,
  CASE WHEN category = 'dal_pulse' THEN 'pulse' ELSE category END,
  allergy_flag, seasonality_note, stock_note, origin, created_at, updated_at
FROM ingredients;

DROP TABLE ingredients;
ALTER TABLE ingredients_v14 RENAME TO ingredients;

CREATE UNIQUE INDEX idx_ingredients_external_id ON ingredients(external_id);

-- 2. meal_role / can_lead / external_id on dish_families and dish_items.
-- meal_role legend per taxonomy JSON metadata.meal_role_legend.
ALTER TABLE dish_families ADD COLUMN meal_role TEXT
  CHECK (meal_role IN ('main_gravy','secondary_gravy','semi_solid_side','dry_side','condiment','salad','standalone','crisp_side','tiffin_main','tiffin_side','snack'));
ALTER TABLE dish_families ADD COLUMN can_lead INTEGER CHECK (can_lead IN (0,1));
ALTER TABLE dish_families ADD COLUMN external_id TEXT;

ALTER TABLE dish_items ADD COLUMN meal_role TEXT
  CHECK (meal_role IN ('main_gravy','secondary_gravy','semi_solid_side','dry_side','condiment','salad','standalone','crisp_side','tiffin_main','tiffin_side','snack'));
ALTER TABLE dish_items ADD COLUMN can_lead INTEGER CHECK (can_lead IN (0,1));
ALTER TABLE dish_items ADD COLUMN external_id TEXT;

-- 3. external_id supersedes seed_index as the upsert identity (the v1.4 JSON provides
-- its own stable ids). Drop seed_index.
ALTER TABLE dish_families DROP COLUMN seed_index;
ALTER TABLE dish_items DROP COLUMN seed_index;

CREATE UNIQUE INDEX idx_dish_families_external_id ON dish_families(external_id);
CREATE UNIQUE INDEX idx_dish_items_external_id ON dish_items(external_id);
