-- 009_noon_chutney_fix.sql — fixes the noon condiment row's filter_class,
-- which was left as "thogayal" (the row's original value, seeded in
-- 006_meal_patterns.sql) after the "chutney" taxonomy class was added in the
-- v1.6/v1.7 reseed. Thogayal's slot_fit is ["morning","night"], so the noon
-- row always returned zero candidates — it was never rewired to the class it
-- was meant to use.
--
-- migrations are append-only (never edit an already-applied file, including
-- 006_meal_patterns.sql, which already shipped) — this UPDATEs the existing
-- settings row's noon condiment row in place via json_set, leaving every
-- other row byte-for-byte untouched. json_set is idempotent: running this
-- against a row that's already correct (a fresh seed created after this
-- migration existed) or running it twice both leave the value unchanged.
UPDATE settings
SET value = json_set(
  value,
  '$.noon.rows[2].filter_class', 'chutney',
  '$.noon.rows[2].label', 'Chutney'
)
WHERE key = 'meal_patterns'
  AND json_extract(value, '$.noon.rows[2].role') = 'condiment';
