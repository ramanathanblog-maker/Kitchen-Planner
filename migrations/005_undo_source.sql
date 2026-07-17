-- 005_undo_source.sql — adds 'undo' to knowledge_events.source's CHECK vocabulary.
-- A1's hooks clause already anticipated reserved source values (inventory_event,
-- person_pref) documented but unemitted in v1; 'undo' is the same idea but emitted
-- immediately — without it, a reversal is indistinguishable from a fresh manual_edit
-- in the audit timeline, which defeats the point of keeping the timeline at all.
-- SQLite can't ALTER a CHECK in place, so rebuild the table (same swap-under-a-
-- temporary-name technique as migration 003, to avoid ALTER TABLE RENAME rewriting
-- nothing here since no other table holds a REFERENCES to knowledge_events).

CREATE TABLE knowledge_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual_edit','one_tap_teach','seed','inventory_event','person_pref','undo'))
);

INSERT INTO knowledge_events_v2 (id, who, at, table_name, row_id, old_value, new_value, source)
SELECT id, who, at, table_name, row_id, old_value, new_value, source FROM knowledge_events;

DROP TABLE knowledge_events;
ALTER TABLE knowledge_events_v2 RENAME TO knowledge_events;
