-- 001_init.sql — Phase 1 schema per CLAUDE.md A1/A4 and build-prompt Phase 1.
-- Append-only: never edit this file after it has been applied anywhere.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL UNIQUE,
  name_ta TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('vegetable','dal_pulse','aromatic','dairy','grain','other')),
  allergy_flag INTEGER NOT NULL DEFAULT 0 CHECK (allergy_flag IN (0,1)),
  seasonality_note TEXT,
  stock_note TEXT, -- A1 forward-compat hook: human note only, never a stock ledger
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dish_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL,
  name_ta TEXT,
  parent_id INTEGER REFERENCES dish_families(id),
  heaviness TEXT CHECK (heaviness IN ('light','medium','heavy')),
  slot_fit TEXT NOT NULL DEFAULT '[]', -- JSON array of allowed slots
  notes TEXT,
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user')),
  seed_index INTEGER, -- position within its source JSON array; identity key for seed-origin upserts across renames
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dish_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES dish_families(id),
  name_en TEXT NOT NULL,
  name_ta TEXT,
  onion_flag INTEGER NOT NULL DEFAULT 0 CHECK (onion_flag IN (0,1)),
  garlic_flag INTEGER NOT NULL DEFAULT 0 CHECK (garlic_flag IN (0,1)),
  heaviness TEXT CHECK (heaviness IN ('light','medium','heavy')),
  is_placeholder INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0,1)),
  notes TEXT,
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user')),
  seed_index INTEGER, -- position within its source JSON array; identity key for seed-origin upserts across renames
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dish_item_ingredients (
  dish_item_id INTEGER NOT NULL REFERENCES dish_items(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','support')),
  PRIMARY KEY (dish_item_id, ingredient_id)
);

CREATE TABLE ingredient_family_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  family_id INTEGER NOT NULL REFERENCES dish_families(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('preferred','allowed','avoid','never','unsure')),
  example_dish TEXT,
  rationale_tag TEXT NOT NULL DEFAULT 'other'
    CHECK (rationale_tag IN ('texture_clash','traditional_restriction','flavor_overlap','dislike','allergy','other')),
  note TEXT,
  scope TEXT NOT NULL DEFAULT 'household', -- A1 hook; app-level validation restricts to 'household' in v1
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE dish_repeat_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_item_id INTEGER NOT NULL REFERENCES dish_items(id),
  min_gap_days INTEGER NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('hard','soft')),
  rationale_tag TEXT NOT NULL DEFAULT 'other'
    CHECK (rationale_tag IN ('texture_clash','traditional_restriction','flavor_overlap','dislike','allergy','other')),
  note TEXT,
  scope TEXT NOT NULL DEFAULT 'household',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE dish_compatibility_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_dish_item_id INTEGER REFERENCES dish_items(id),
  source_family_id INTEGER REFERENCES dish_families(id),
  target_dish_item_id INTEGER REFERENCES dish_items(id),
  target_family_id INTEGER REFERENCES dish_families(id),
  direction TEXT NOT NULL DEFAULT 'morning_to_noon' CHECK (direction = 'morning_to_noon'),
  preference TEXT NOT NULL CHECK (preference IN ('prefers','avoid')),
  rationale_tag TEXT NOT NULL DEFAULT 'other'
    CHECK (rationale_tag IN ('texture_clash','traditional_restriction','flavor_overlap','dislike','allergy','other')),
  note TEXT,
  scope TEXT NOT NULL DEFAULT 'household',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  CHECK (
    (source_dish_item_id IS NOT NULL OR source_family_id IS NOT NULL) AND
    (target_dish_item_id IS NOT NULL OR target_family_id IS NOT NULL)
  )
);

CREATE TABLE special_day_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  default_notes TEXT
);

CREATE TABLE special_day_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  special_day_type_id INTEGER NOT NULL REFERENCES special_day_types(id),
  family_id INTEGER REFERENCES dish_families(id),
  dish_item_id INTEGER REFERENCES dish_items(id),
  rule TEXT NOT NULL CHECK (rule IN ('allow','avoid','block')),
  note TEXT,
  CHECK (family_id IS NOT NULL OR dish_item_id IS NOT NULL)
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning','noon','night')),
  dish_item_id INTEGER NOT NULL REFERENCES dish_items(id),
  note TEXT,
  ordering INTEGER NOT NULL DEFAULT 0,
  headcount INTEGER, -- A1 hook, optional capture only
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE actual_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning','noon','night')),
  dish_item_id INTEGER NOT NULL REFERENCES dish_items(id),
  note TEXT,
  ordering INTEGER NOT NULL DEFAULT 0,
  headcount INTEGER, -- A1 hook, optional capture only
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only audit. `source` reserved values 'inventory_event' and 'person_pref'
-- are documented here per A1 but never emitted by v1 code.
CREATE TABLE knowledge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual_edit','one_tap_teach','seed','inventory_event','person_pref'))
);
