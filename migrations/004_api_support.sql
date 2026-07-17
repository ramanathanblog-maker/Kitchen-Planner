-- 004_api_support.sql — Phase 3 (API Routes): optimistic-concurrency version columns
-- and editor attribution on the three taxonomy tables (ingredients, dish_families,
-- dish_items), which didn't need them before now since only the rule tables had
-- writeable API surfaces in the build-prompt spec through Phase 2. Also adds the
-- ingredients.leftover_flag column the GET /api/shopping roll-up honors (see
-- DECISIONS.md Phase 2 entry: "leftovers first" flag had no storage table yet).

ALTER TABLE ingredients ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ingredients ADD COLUMN updated_by TEXT;
ALTER TABLE ingredients ADD COLUMN leftover_flag INTEGER NOT NULL DEFAULT 0 CHECK (leftover_flag IN (0,1));

ALTER TABLE dish_families ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dish_families ADD COLUMN updated_by TEXT;

ALTER TABLE dish_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dish_items ADD COLUMN updated_by TEXT;
