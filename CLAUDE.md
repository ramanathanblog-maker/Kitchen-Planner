# CLAUDE.md — Kitchen Knowledge Planner Constitution

v1.0 — 2026-07-16

This file is the standing constitution for this project. Re-read it at the start of every session and every phase.

## A1. Source-of-truth hierarchy (resolve conflicts in this order)
1. **`kitchen-planner-counter-spec-v2.md`** — governs **scope** (what is in v1, what is deferred). Its §4 deferral list is binding, subject only to the "minimal hooks" clause below.
2. **`/seed/taxonomy-comprehensive.json`** — the **canonical machine-readable baseline** for dish classes, items, ingredient entries, and repetition defaults. Checked in **verbatim** (byte-identical to PK's homelab docs copy); the *only* input the seed loader reads. Where the JSON and any prose doc disagree, **the JSON wins**. Never transcribe, reorder, rename, or "clean up" its contents — if it appears to contain an error, STOP and report; do not fix it in place.
3. **`meal-planner-taxonomy-design.md`** (Perplexity) — authoritative for **domain semantics not expressible in the JSON**: rule meaning, evaluation-order intent, primary/support roles, observance behavior, normalization rationale.
4. **`kitchen-planner-counter-spec.md` (v1)** — governs **stack and infra** decisions not restated in v2 (Docker+SQLite, single container, LAN-only).

**Deferral, with minimal hooks:** Inventory, the people/guest model, scoped pairing memory, notifications, and analytics remain **unbuilt in v1** — no tables, no routes, no UI for them. v1 may lay **cheap forward-compatible hooks**, strictly limited to:
- `scope` TEXT NOT NULL DEFAULT `'household'` column on `ingredient_family_rules`, `dish_repeat_rules`, `dish_compatibility_rules`. App-level validation (not a CHECK) restricts it to `'household'` in v1.
- Nullable `headcount` INTEGER on `plans` and `actual_meals`.
- Nullable free-text `stock_note` on `ingredients`.
- Reserved `knowledge_events.source` values (`inventory_event`, `person_pref`) documented in code comments but never emitted in v1. (`manual_edit`, `one_tap_teach`, `seed`, and `undo` are ordinary v1 source values, actively emitted — not hooks; only `inventory_event`/`person_pref` are the reserved-and-dormant ones this bullet covers.)

Anything beyond these four is scope creep — refuse it. The evaluation pipeline is the **7-step v1 pipeline** (slot fit → special-day → ingredient suitability → repeat-gap → directional compatibility → heaviness → availability).

**Slot semantics (household reality):** rice-based traditional meal in the **MORNING**, tiffin at **NOON**. Slots are `morning | noon | night` (CHECK-constrained). "Breakfast" in source docs = morning (rice meal); "lunch" = noon (tiffin). Directional compatibility is **morning → noon**. Default slot_fit: rice-course classes → morning; Tiffin families → noon; night = secondary, both allowed. Slot_fit is editable seed data, not hard-coded logic.

**Users:** Three named people, no auth (LAN trust): **PK** = admin (desktop). **RP** (wife), **PS** (sister-in-law) = daily users, **phone-only** — every daily-use flow must be flawless at 375px. Admin surfaces may be desktop-optimized but not desktop-only.

## A2. Stack — non-negotiable ("boring and maintainable")
- Node.js 20, Express, `better-sqlite3`. Plain server-rendered HTML + lightweight vanilla JS (Alpine.js permitted). Mobile-first CSS, no framework.
- Modern platform features are **required**: CSS Grid, container queries, `:has()`, CSS view transitions, scroll-snap, `dvh` units, `env(safe-area-inset-*)`, `prefers-color-scheme` dark mode, CSS custom properties for A5 tokens, PWA manifest + minimal service worker (app-shell caching only).
- **Forbidden:** TypeScript, React/Vue/Svelte, bundlers (webpack/vite/esbuild), ORMs (Prisma/Sequelize/Knex), CSS frameworks (Tailwind/Bootstrap), PostgreSQL, Redis, message queues, GraphQL, WebSockets, any auth provider. If one seems essential, STOP and ask.
- SQLite: `CHECK` constraints instead of ENUMs; `INTEGER PRIMARY KEY AUTOINCREMENT`; foreign keys ON; WAL mode.
- One Docker container. SQLite file in a mounted volume (`./data/kitchen.db`). One service block added to `~/homelab/docker-compose.yml` on **Predator**. Default port **3010** — 3000 and 5433 are reserved by NeoTrack; never bind those.
- Runs LAN-only (192.168.78.x). No external network calls at runtime. No telemetry, no CDN assets — vendor Alpine.js locally.

## A3. Working discipline (every phase)
1. Plan before code. List files to create/modify and tests to write at phase start. Wait for "proceed" only if the phase block says CHECKPOINT.
2. Tests are part of the phase, not optional. `node:test` only — no jest/mocha.
3. Never invent domain data. Seed data comes only from the taxonomy doc and counter-specs. `sbm_unresolved` and `child_bento_box` are seeded as placeholders and surfaced as "needs input" — do not fill them.
4. Migrations are append-only. Numbered SQL files in `/migrations`, applied by a tiny runner recording applied versions in `schema_migrations`. Never edit an applied migration.
5. Every rule mutation writes to `knowledge_events` (append-only audit): who, when, table, row id, old value, new value, source (`manual_edit` | `one_tap_teach` | `seed`).
6. **Stop conditions:** spec conflict unresolvable via A1; a phase exceeding ~15 files changed; needing a forbidden dependency; a test only passable by weakening it; touching deployment targets (the compose file on the server — deployment is manual, by PK).
7. End of each phase, output: (a) files changed, (b) test results verbatim, (c) deviations from spec with justification, (d) a one-line git commit message. PK commits; Claude does not run git push or destructive git commands.
8. **Sonnet working notes (binding):** work in small sub-steps — implement one module or route group at a time and run its tests before moving on; never write a whole phase then test at the end. Re-read this file at the start of every session and every phase. When a detail is unspecified, choose the simplest option consistent with A1–A5 and record it in `DECISIONS.md` — do not silently invent features, tables, or dependencies. If the same test fails twice, stop and report rather than repeatedly rewriting. Never "improve" earlier phases' code while working on a later phase unless the phase block says so.

## A4. Repo layout (created in Phase 0, not restructured later)
```
kitchen-planner/
  server.js
  /src
    /engine
    /db
    /routes
    /views
  /public
  /migrations
  /seed
  /test
  /docs
  Dockerfile
  docker-compose.snippet.yml
  /data
```
Project docs discipline: exactly **one** OPERATIONS.md, **one** MANUAL.md, **one** ROADMAP_V2.md, each versioned (`vX.Y — YYYY-MM-DD`), updated in place — never forked.

## A5. Design system (binding)
Implemented as CSS custom properties in `public/theme.css`.

- **Tokens:** warm off-white background `#FAF7F2` (dark: `#1C1917`); ink `#292524`; accent deep leaf green `#3F6212` with tint `#ECFCCB` (primary actions, "preferred" states); warn amber `#B45309` / tint `#FEF3C7`; blocked red `#B91C1C` / tint `#FEE2E2`; info slate `#475569`. No other hues.
- **Type:** system font stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`) — no webfonts. 16px base, 1.25 ratio; page titles 28px/700, section heads 20px/600, body 16px/400, chips 13px/600. Line-height 1.5 body, 1.2 headings.
- **Shape & space:** 4px spacing grid; cards radius 12px, chips radius 999px; borders `1px solid rgb(0 0 0 / 8%)`; elevation `0 1px 3px rgb(0 0 0 / 8%)` — never heavy drop shadows.
- **Components:** dish card (name, family tag, heaviness dot, warning/blocked chip); verdict chip (✓ preferred, • allowed, ⚠ avoid, ✕ blocked); slot header (label + date + special-day badge); bottom tab bar (Today / Plan / Shopping / Knowledge); large-type kiosk variants.
- **Interaction:** every tap gives visible feedback ≤100ms; destructive/blocked confirmations as a bottom sheet, not `window.confirm()`; CSS view transitions on navigation; skeleton rows (CSS only) while loading.
- **Accessibility floor:** contrast ≥ 4.5:1, visible focus states, `aria-live` for warnings, controls ≥44px.
- **Litmus test:** the Today view should read like a calm printed menu card, not an admin table.

## Deferred to v2 (do not build; only the four A1 hooks may exist in v1)
Live inventory/stock ledger · people/guest model, per-person allergies/likes, meal-slot attendance counts · pairing memory with household/person/guest/festival scope + reason codes beyond the v1 morning→noon rule · notifications, reminders, digests · analytics on accepted/rejected suggestions · Tailscale-published access for the app · Home Assistant integration (the in-scope `/display` kiosk page + `/api/display/*` JSON is the v1 dashboard output; pushing into HA entities is v2) · Tamil UI (schema supports it; UI stays English) · auto-planning mode (v1 is manual-mode only).

## Known placeholders awaiting PK
1. `sbm_unresolved` — Sides/Gravy item "SBM", real name pending.
2. `child_bento_box` — 4 chambers, 17 idea slots, all empty.
3. Cookie types ×3 — names pending.
4. Onion-sambar 20-day rule severity — seeded soft, PK to confirm hard vs soft.
5. Support-role repetition assumption (Phase 2 step 4) — PK to confirm.
6. Night-slot defaults — seeded "both allowed"; PK to confirm actual household night eating pattern.
