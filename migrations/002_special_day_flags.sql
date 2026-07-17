-- 002_special_day_flags.sql — Phase 2 gap fill.
-- Phase 1's special_day_assignments requires a family_id or dish_item_id target, so it
-- cannot express "this date is an amavasai" on its own — only per-dish/family overrides
-- for a date already known to be special. special_day_dates fills that: it declares which
-- special_day_type(s) apply to a date. restricts_onion/restricts_garlic on
-- special_day_types let the special-day engine step (spec: "consumes onion/garlic flags
-- + family/dish allow-avoid-block for that date") generically restrict every
-- onion/garlic-flagged dish on such a date, instead of requiring PK to enumerate every
-- onion dish as an explicit assignment row. See DECISIONS.md Phase 2 entry.

ALTER TABLE special_day_types ADD COLUMN restricts_onion INTEGER NOT NULL DEFAULT 0 CHECK (restricts_onion IN (0,1));
ALTER TABLE special_day_types ADD COLUMN restricts_garlic INTEGER NOT NULL DEFAULT 0 CHECK (restricts_garlic IN (0,1));

CREATE TABLE special_day_dates (
  date TEXT NOT NULL,
  special_day_type_id INTEGER NOT NULL REFERENCES special_day_types(id),
  PRIMARY KEY (date, special_day_type_id)
);
