-- 007_actual_meals_unique.sql — Audit 2026-07-18, code #8: actual_meals had no
-- uniqueness guard on (date, slot, dish_item_id), so a double-tap on "Log as
-- eaten" / "Mark day as served" (or any client retry after a network blip)
-- could insert the same dish twice for the same slot, which then skews the
-- engine's repeat-gap history (src/engine/context.js reads actual_meals as the
-- source of truth for "was this dish/ingredient recently eaten").
--
-- Dedupe first (keeps the lowest-id — i.e. earliest-logged — row per
-- (date, slot, dish_item_id); a no-op DELETE if there are no duplicates, which
-- was confirmed true against the live DB before this migration was written).
-- knowledge_events rows for any deleted duplicate are left as-is: they have no
-- FK to actual_meals and the append-only audit rule (CLAUDE.md A3.5) means
-- history is never rewritten, only added to.
DELETE FROM actual_meals
WHERE id NOT IN (
  SELECT MIN(id) FROM actual_meals GROUP BY date, slot, dish_item_id
);

CREATE UNIQUE INDEX idx_actual_meals_unique ON actual_meals(date, slot, dish_item_id);
