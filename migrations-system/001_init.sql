-- 001_init.sql (migrations-system) — Phase 6 Amendment §6a: system.db is a
-- separate, much smaller schema from the household DBs (migrations/) — just
-- who's allowed to log in and which household they belong to. It uses the
-- same runner/schema_migrations bookkeeping as household migrations (see
-- src/db/migrate.js's migrationsDir param), just pointed at this directory.
--
-- household is 'rp' | 'ps' | NULL — NULL means PK, who is admin over both
-- households rather than scoped to one (Part A: "PK is admin over both
-- households, can read/write either").
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  household TEXT CHECK (household IN ('rp', 'ps') OR household IS NULL),
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seeded verbatim per Part A's three known users. Real email addresses are
-- PK's to fill in (Cloudflare Access identity, wired up in Phase 6c) — left
-- as placeholders here since this migration only needs to prove the schema
-- and household mapping, not carry real PII this early.
INSERT INTO users (email, display_name, household, is_admin) VALUES
  ('pk@household.local', 'PK', NULL, 1),
  ('rp@household.local', 'RP', 'rp', 0),
  ('ps@household.local', 'PS', 'ps', 0);
