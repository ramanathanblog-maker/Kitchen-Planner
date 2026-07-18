-- 008_night_pattern.sql — Audit 2026-07-18, UX #1: the night hub had an empty
-- `rows: []` pattern (amendment §10.1's own documented open item), and since
-- the flat suggestion-picker fallback was removed per PK ("the wizard ui will
-- be the default henceforth"), night planning was a hard dead end — no rows,
-- no fallback, nothing to tap.
--
-- This is a deliberately loose, generously-capped interim pattern (not a
-- designed night-meal shape) so night is at least usable while PK defines the
-- real one — every role below was confirmed against the seeded v1.7 taxonomy
-- to have real night-eligible items (main_gravy 27, dry_side 24, tiffin_main
-- 62, standalone 8, snack 10). The `note` field is surfaced verbatim on the
-- night hub's empty/interim banner (src/views/wizard.js) so RP/PS see it's
-- provisional, not a finished design.
--
-- migrations are append-only (never edit an already-applied file, including
-- 006_meal_patterns.sql, which already shipped) — this UPDATEs the existing
-- settings row's `night` key in place via json_set, leaving `morning`/`noon`
-- byte-for-byte untouched.
UPDATE settings
SET value = json_set(
  value,
  '$.night',
  json('{"rows":[{"role":"main_gravy","label":"Gravy","max":5},{"role":"dry_side","label":"Side","max":5},{"role":"tiffin_main","label":"Tiffin / Chapati","max":5},{"role":"standalone","label":"Rice / Standalone","max":2},{"role":"snack","label":"Snack","max":3}],"note":"Interim free-pick pattern — provisional, generously capped, pending PK''s actual night-meal shape. Not the intended long-term structure."}')
)
WHERE key = 'meal_patterns';
