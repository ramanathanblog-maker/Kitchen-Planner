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
- **Night `meal_patterns` is unspecified** — the wizard hub for the night slot has empty rows (no pattern defined yet), per the Phase 4b amendment's own §10.1 open item; night planning is effectively blocked in the guided wizard until PK defines a night pattern the same way morning/noon are defined.
- **`paruppu_usili` and `kosumalli` have empty `ingredient_roles`** — both `dish_057` (paruppu_usili) and `dish_056` (kosumalli) in the JSON have `"ingredient_roles": {"primary": [], "support": []}`, so neither dish currently drives any ingredient-suitability or repeat-gap checking despite being real, non-placeholder items.
