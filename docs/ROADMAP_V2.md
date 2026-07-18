# Kitchen Knowledge Planner — v2 Design Carry

v1.0 — 2026-07-18

The single document for what v1 deliberately left out and what's settled for later. Two kinds of content live here, kept separate:

1. **Deferred models** — transcribed faithfully from `docs/meal-planner-taxonomy-design.md` (no invention; each item below is that document's own language, condensed, with its `[cite:N]` markers preserved where present in the source), each paired with the v1 forward-compat hook it attaches to (CLAUDE.md's original A1 — see `git show 6134634~1:CLAUDE.md` for the full text, since the current top-level `CLAUDE.md` was consolidated into the homelab-wide ops file and no longer carries this project's build constitution verbatim).
2. **The settled Phase 6 plan** — decisions PK has already made about the next phase, recorded here so they don't live only in chat history.

Nothing in this file is built. v1 has exactly four hooks; everything else described here is schema-less and route-less today.

---

## Deferred models

### Live inventory

> Inventory should be treated as a live system that updates from purchases and planned or actual usage, with manual override when estimates are wrong.[cite:452] The system should be able to understand user actions like buying 5 kg of potato and then track the remaining journey of that stock through planning and cooking.[cite:452]

Recommended principles, transcribed from the source:
- Auto-update inventory from purchase and consumption events where possible.[cite:452]
- Allow manual correction as the truth source when estimates drift.[cite:452]
- Support fridge, pantry, and leftover contexts.[cite:452]
- Distinguish anchor use from support use for ingredients such as carrot.[cite:452]
- Use inventory as a key input to shopping-gap calculation.[cite:373][cite:452]

**v1 hook:** nullable free-text `stock_note` on `ingredients` — a human-written note only, never a stock ledger. No quantity tracking, no auto-update, no purchase/consumption event table exists.

### People / guest model + meal-slot attendance

> The planner should track regular family members' likes, dislikes, allergies, and preference constraints so that plans can be personalized rather than generic.[cite:449] ... Guest counts should be meal-slot-specific rather than only day-specific.[cite:373] The planner should separately model breakfast, lunch, and dinner attendance, because dish choice and quantity scaling depend on the actual people present in that slot.[cite:373]

Recommended people-related fields, transcribed from the source:
- Name.
- Role, such as regular family member or guest.[cite:449]
- Age group for child-aware logic.[cite:449]
- Likes and dislikes.[cite:449]
- Allergies and strict avoid items.[cite:449]
- Observance participation where relevant.[cite:377][cite:449]

Example meal-slot attendance shape from the source: Breakfast 4 people, Lunch 8 people, Dinner 6 people.[cite:373] The planner should also account for guest-specific likes/dislikes/allergies (example given: including Potato Kari when a young child guest is known to like it).[cite:449]

**v1 hook:** nullable `headcount` INTEGER on `plans` and `actual_meals` — a single number per slot, no per-person breakdown, no names, no likes/dislikes/allergy table.

### Pairing memory and household repertoire

> The planner should not treat pairings as universal truths.[cite:449] Instead, it should remember accepted and blocked pairings at the household or person level, together with reasons such as dislike, allergy, non-traditional pairing, or repertoire mismatch.[cite:449]

Recommended pairing memory fields, transcribed from the source:
- Source dish.
- Target dish or accompaniment.
- Status: preferred, allowed, blocked, or conditional.
- Reason code, for example allergy or non-traditional pairing.[cite:449]
- Scope: household, person-specific, guest-specific, festival-only, or temporary.[cite:449]

**v1 hook:** `scope` TEXT NOT NULL DEFAULT `'household'` column on `ingredient_family_rules`, `dish_repeat_rules`, `dish_compatibility_rules` — app-level validation (not a CHECK constraint, deliberately, so the schema itself never hard-codes v1's restriction) restricts it to `'household'` today (`src/routes/validate.js`'s `DOMAINS.scope`). The richer status/reason-code/scope model above (preferred/allowed/blocked/conditional, person/guest/festival/temporary scope) is not built — v1's `dish_compatibility_rules` only has the one morning→noon directional rule shape.

### Notifications and behavioral design

> Notifications should be helpful and sparse rather than noisy.[cite:452] Inventory reminders should be timed, selective, and capped so the system behaves more like a polite assistant than a constant interrupter.[cite:452]

Recommended controls, transcribed from the source:
- Reminder windows such as morning, midday, and night.[cite:452]
- Frequency caps per day.[cite:452]
- Cooldowns after dismissal or ignore.[cite:452]
- Digest-style grouping of pending inventory updates.[cite:452]

**v1 hook:** reserved `knowledge_events.source` values `inventory_event` and `person_pref`, documented in code comments but never emitted in v1 (`manual_edit`, `one_tap_teach`, `seed`, and `undo` are ordinary v1 source values already actively emitted — not hooks). No notification delivery mechanism, no reminder scheduling, no cooldown/cap logic exists.

### Analytics signals

> The system should also collect analytics that improve planning quality, such as accepted suggestions, rejected pairings, repeated overrides, and common manual corrections.[cite:544][cite:449][cite:452]

**v1 hook:** none dedicated — the append-only `knowledge_events` audit log (every manual_edit/one_tap_teach/seed/undo, who/when/old-value/new-value) is the only data that could feed this later; there is no aggregation, dashboard, or "acceptance rate" computation over it today.

---

## Settled Phase 6 plan

Decisions PK has made for the next phase, not yet implemented:

- **Two-household data split**: `data/rp.db` and `data/ps.db` (one SQLite file per household) plus `data/system.db` for users/household metadata. `scripts/backup.sh` was written in Phase 5 to iterate over every `*.db` in the data directory rather than assume a single `kitchen.db`, specifically so this split doesn't require touching the backup script.
- **Remote access for PS**: **Cloudflare Tunnel + Cloudflare Access with Google login** — explicitly **not** Tailscale (that's PK's own remote-access mechanism, not meant for household members) and **not** Cloudflare Funnel (Access's login gate is the point; Funnel alone would expose the app with no auth). **The tunnel technique approved here is never approved for NeoTrack/EMR** — that's a hard line from the root `CLAUDE.md`'s Environment section, repeated here so it isn't lost in a phase-specific doc: nothing about Kitchen Planner's exposure approach transfers to the hospital EMR host.
- **Access model**: PK is admin over both households' data. RP and PS are read-only on each other's household (each can fully edit their own, per the existing editor model, but not the other's).
- **Kiosk default**: the `/display` kiosk page defaults to showing RP's household when no other selection is made.
- **Observance ICS feed**: a read-only calendar feed (ICS) drives *proposed* special-day assignments — proposals land for PK's approval before they become real `special_day_assignments` rows, never auto-applied. No OAuth — a plain read-only ICS URL, not a connected-calendar integration.
- **PS's 50-week archive import**: a one-time backfill of PS's ~50 weeks of historical meal data into `actual_meals`, plus a rule-mining report (candidate ingredient/repeat/compatibility rules inferred from the historical pattern) for PK to review and decide on one at a time. This **explicitly never auto-plans** — the import populates history and suggests candidate rules; it does not write anything into `plans` or silently activate a mined rule.
- **JSON editor (Phase 4c)**: an in-app editor for `seed/taxonomy-comprehensive.json` itself, so taxonomy changes don't require an out-of-band file edit + manual copy into `seed/`. No detailed spec for this exists yet in this repo's docs (PK's own working notes are the source PK referenced; nothing further to transcribe here without inventing scope) — recorded as a named, scoped-for-later item, not designed.

---

## Open items (not decisions, just unresolved data)

- **Chutney item list is PROPOSED, pending PK confirmation** — `dc_019` (chutney) and every `dish_19x` item in it (`thengai_chutney`, `thakkali_chutney`, `kothamalli_chutney`, `pudhina_chutney`, `vengaya_chutney`, `thengai_pudhina_chutney`) carry `"notes": "PROPOSED by Claude - PK to confirm."` in `seed/taxonomy-comprehensive.json`. Not yet reviewed.
- **Cookies (3 types) and child bento box remain placeholders** — `dish_156`/`dish_157`/`dish_158` (`cookies_type_1/2/3`) and `dish_162` (`child_bento_box`, "4 chambers, 17 ideas pending") are all `is_placeholder: true, placeholder_status: "needs_input"` in the JSON. The bento box's 4-chamber, ~17-idea structure is designed per `meal-planner-taxonomy-design.md` but not populated — needs PK's/RP's actual bento repertoire, not invented content.
- ~~**Night `meal_patterns` is unspecified**~~ — resolved by migration 008 (Audit 2026-07-18 remediation, Phase R3): night now carries a minimal interim free-pick pattern (5 generously-capped rows), with a `note` field explaining it's provisional, so night planning is no longer a hard dead end. Still open: PK has not yet defined the *real* night-meal shape the way morning/noon were designed (amendment §10.1's original ask) — the interim pattern is a stopgap, not a finished design.
- **`paruppu_usili` and `kosumalli` have empty `ingredient_roles`** — both `dish_057` (paruppu_usili) and `dish_056` (kosumalli) in the JSON have `"ingredient_roles": {"primary": [], "support": []}`, so neither dish currently drives any ingredient-suitability or repeat-gap checking despite being real, non-placeholder items.

---

## Audit 2026-07-18 remediation — deferred to a later phase

Findings from `docs/AUDIT_2026-07-18.md` that Phases R1-R3 deliberately did not fix — each was either out of the phase's stated scope, or (per the R1/R2 phase instructions) would have expanded a fix's blast radius beyond the one weakness it was meant to close. Recorded here, not in chat history, so they aren't lost. No code changes in this entry.

- **`clearStaleSeedRows` silent-cascade branches (audit code #6)** — `seed/load.js`'s stale-row cleanup already has the right pattern for `dish_items`/`dish_families`/`ingredients`: before deleting a retired seed-origin row, check whether anything still references it and `throw StaleSeedRowReferencedError` rather than silently delete (lines ~144-215). Two cascade deletes inside that same function skip the check entirely: a stale **item**'s `special_day_assignments` rows are deleted unconditionally (`seed/load.js:166`), and a stale **family**'s `ingredient_family_rules` and `special_day_assignments` rows are too (`seed/load.js:191-192`). A household-taught ingredient rule or an observance assignment attached to a family/item that gets retired from the taxonomy JSON currently disappears with no STOP and no report — exactly the failure mode the error class exists to prevent everywhere else in this function. Fix: extend the existing reference-check-and-throw pattern to cover these two DELETE statements; no schema change, no new table.
  **v1 hook:** no hook — this is existing `seed/load.js` logic (the seed/taxonomy-update pipeline, not one of the four v1 forward-compat hooks) that needs to apply its own established safety pattern consistently, not new functionality.

- **Undo's scope-validation bypass (audit code #7)** — `POST /api/knowledge_events/:id/undo` (`src/routes/knowledgeEvents.js`) re-inserts/rewrites a row's `old_value` verbatim to reverse a create/update/delete. That bypasses `assertInDomain(scope, 'scope', 'scope')` (`src/routes/validate.js`), the only thing enforcing v1's restriction that `scope` stay `'household'` — every other write path to the three rule tables (`src/routes/rules.js`, `src/routes/teach.js`) validates it. In practice this can't currently smuggle in a bad scope value from nowhere (undo only ever writes back a value that was itself validated when originally written), but an update-undo also writes the row's pre-undo `version` number back verbatim, silently rewinding optimistic concurrency — a client still holding the pre-undo `version` can now overwrite the undo with no 409, reopening the exact stale-write window optimistic concurrency exists to close. Needs a decision on whether undo should re-validate scope on the value it's restoring and/or bump `version` forward instead of restoring it verbatim — either changes undo's semantics, which is why R2 explicitly left this alone (its remit was rendering/description, not touching execution semantics).
  **v1 hook:** attaches to the **pairing memory `scope` hook** (this file, "Pairing memory and household repertoire" — `scope TEXT NOT NULL DEFAULT 'household'` on `ingredient_family_rules`/`dish_repeat_rules`/`dish_compatibility_rules`, app-level-validated per `src/routes/validate.js`'s `DOMAINS.scope`). Any future work here must keep the hook's own rule intact: the schema column stays open for v2's richer scope model, but v1's app-level restriction to `'household'` must hold on every write path, including undo.

- **Uniqueness constraints on `ingredient_family_rules(ingredient_id, family_id)` and `dish_repeat_rules(dish_item_id)` (audit code #9)** — neither table has a unique index. `POST /api/teach` always `INSERT`s when no `id` is passed, so rejecting the same dish (or teaching the same ingredient-family avoid) twice creates two rules rather than updating one. `src/engine/context.js`'s `loadDishRepeatRule` uses `.get()` (single row), so only the **lowest-id** repeat rule is ever consulted — a later, stricter rule a household member taught is silently ignored with no error and no indication anything is wrong. Mirrors the `actual_meals` fix already shipped in migration 007 (dedupe-then-`CREATE UNIQUE INDEX`), but needs a decision on *upsert* behavior first: unlike `actual_meals` (where a duplicate POST should just no-op), a duplicate ingredient/dish rule POST arguably should update the existing rule's verdict/severity rather than silently no-op or 409 — that's a real design choice, not just a migration.
  **v1 hook:** no hook — new work (schema hardening + a teach-endpoint upsert decision; unrelated to any of the four v1 forward-compat hooks).

- **Variety-rice collapse as one server-side transaction (audit code #10)** — choosing a `collapses_pattern` row (e.g. variety rice) is currently two client-sequenced calls from `src/views/wizard.js`: `POST /api/wizard/choose` then `POST /api/wizard/clear-collapsed` (`src/routes/wizard.js`). If the second call fails, or the phone sleeps/loses connectivity between them, the hidden rows' plans stay in the DB — invisible on the hub (the collapse logic hides them from view), but still counted by the shopping list and fed into the engine's repeat-gap/composition checks. Fix: fold both operations into one `db.transaction()` inside a single new route (or extend `/choose` itself to also clear collapsed rows when `row.collapses_pattern` is true), removing the two-call client sequence entirely.
  **v1 hook:** no hook — new work (an engine/API atomicity fix inside the Phase 4b wizard, not a v2-deferred model).

- **Date format validation on all date-accepting routes (audit code #11)** — `plans`/`actual_meals`/wizard/serve routes accept any string as `date` with no format check; a malformed value (e.g. `18-07-2026` instead of `2026-07-18`) creates rows no page will ever render correctly, and the past-day lock's string comparison (`date < todayStr()` in `src/routes/planLock.js`) is meaningless against a non-ISO string. Needs a shared `assertValidDate`-style helper (mirroring `assertInDomain`/`assertRequired` in `src/routes/validate.js`) applied consistently across every date-accepting route.
  **v1 hook:** no hook — new work (general input validation, unrelated to any of the four v1 forward-compat hooks).

- **Migration runner hardening (audit code #13's sub-points)** — `src/db/migrate.js` has three real gaps: (1) no lock, so a container-boot `migrate()` racing a manually-run `node src/db/migrate.js` could both attempt the same unapplied file concurrently; (2) no checksum of applied migration files, so hand-editing an already-applied file (against the append-only convention `docs/OPERATIONS.md` documents) diverges silently between environments with nothing to catch it; (3) `currentVersion()` picks the max-lexical filename, which only stays correct while every migration number is zero-padded to the same width (a `010` would sort before `02x` once double digits arrive) — the convention exists today only by consistent habit, never written down or enforced.
  **v1 hook:** no hook — new work (operational/infra hardening to the migration runner itself, not a deferred product model).

- **`knowledge_events` retention policy** — the append-only audit log has no size cap or archival strategy; every plan/actual/rule mutation writes a full-row JSON event (117 rows after ~2 days of light single-household use at the time of the audit). The History UI only reads the last 50 via `LIMIT 50` (`src/data/knowledge.js`), so old events age out of *undo-ability via the UI* long before storage becomes the bottleneck. Needs a retention decision before Phase 6's two-household split roughly doubles write volume: candidates include archiving old `plans`/`actual_meals`-sourced events (high volume, lower long-term value) after some number of months while never archiving rule-table events (`ingredient_family_rules`/`dish_repeat_rules`/`dish_compatibility_rules` — low volume, high long-term value as the "why does the engine suggest this" record).
  **v1 hook:** no dedicated hook, but directly interacts with the **Analytics signals** deferred model above (this file, "Analytics signals") — that section already names the append-only `knowledge_events` log as the *only* substrate any future acceptance-rate/rejected-pairing analytics would read from. A retention/archival policy must preserve whatever shape that future work would need (at minimum: don't archive in a way that changes `table_name`/`row_id`/`old_value`/`new_value`'s meaning), even though analytics itself isn't built.

- **Past `actual_meals` correction UI for dates other than today (audit UX #11)** — `MANUAL.md` promises RP/PS can "log/correct `actual_meals` for any past date, any time," and the API genuinely allows it (`src/routes/plans.js`'s `simpleCrudRouter` never date-restricts `actual_meals` writes, unlike `plans`' `assertPlanEditable` gate). But no page actually reaches a past date's actuals — Today (`src/views/today.js`) only ever renders `todayStr()`. The promise in the manual is real at the API layer and false at the UI layer today.
  **v1 hook:** no hook — new work (a UI-only gap; the underlying capability already exists and needs no schema or route change, only a page/view that can address a date other than today).

- **Shopping leftover-checkbox relabeling (audit UX #12)** — the checkbox next to a shopping-list ingredient (`src/views/shopping.js`) universally reads as "got it / bought it" to anyone who's used a shopping-list app, but it actually toggles `ingredients.leftover_flag` — a global, sticky flag that stays set until manually unchecked, quietly excluding that ingredient from every future shopping list until someone remembers to undo it. Needs a copy/label fix at minimum ("use up leftovers first," not a bare checkbox) and arguably a rethink of whether a single sticky household-wide flag is the right model at all versus something scoped to a specific shopping trip.
  **v1 hook:** no hook — new work (UI relabeling, and possibly a data-model rethink, of `ingredients.leftover_flag`, added in migration 004 for Phase 3's shopping-list feature; not one of the four v1 forward-compat hooks — the **Live inventory** deferred model above is the closest related concept, but `leftover_flag` was never designed as that hook and shouldn't be conflated with it).
