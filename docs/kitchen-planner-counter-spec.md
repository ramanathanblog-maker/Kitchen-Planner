# Kitchen Knowledge Planner — Reconciled Counter-Spec (v1)

*Reconciling Perplexity's domain model + panel review with PK's HomeLab (Tier B)
constraints and established patterns. This supersedes the stack/scope sections of the
original build spec; the domain model sections are kept in full.*

---

## 1. What's kept, unchanged, from the original spec

The domain model is the valuable part and stays as specified:

- Three-tier entity model: **vegetable → dish family → named dish item**, with
  parent/sub-family nesting (e.g., Sambar → Arachu Vitta Sambar).
- **Suitability verdicts** (preferred / allowed / avoid / never / unsure) at the
  vegetable-to-dish-family level, with example dish + note + updated date.
- **Repeat-gap rules** at the exact named-dish level (e.g., onion sambar ≥ 20 days),
  each either a hard block or a soft warning.
- **Directional compatibility rules**, breakfast → lunch only (e.g., mor kuzhambu
  breakfast prefers adai lunch), not the reverse.
- **Heaviness balancing** (light/medium/heavy) to warn on heavy-heavy same-day pairing.
- **Planned vs. actual** meals as distinct, first-class records — actual is authoritative
  for repeat-gap math once recorded, planned drives shopping/forward view.
- **Special-day handling** (e.g., amavasai) with per-day dish/family allow-avoid-block and
  notes (no onion/garlic etc.).
- **7-day forward planner** with weekly vegetable shopping roll-up and tomorrow's missing
  vegetables.
- **Frictionless in-context teaching**: a rejected/avoided choice offers a one-tap
  "remember this?" that writes directly to the rule tables.
- **`knowledge_events`** as an append-only log of every rule create/update, for review and
  undo.
- Two co-equal household editors, no permissions model needed.
- Data model allows future Tamil labels (`display_name_en` / `display_name_ta`) without
  a later migration, but v1 UI stays English-only.

## 2. Additions from the multi-lens panel review (adopted)

- **Ingredient Constraint Architecture**: generalize the "vegetable" registry to an
  ingredient registry that can also hold dals/pulses and key aromatics (toor dal, chana
  dal, moong dal, curry leaves, coriander) — since mor kuzhambu's dal base or kootu's
  moong dal are as rule-relevant as the vegetable choice. Same table shape as
  `vegetables`, just not artificially restricted to produce.
- **Rule rationale tags**: the `note` field on a suitability or compatibility rule gets a
  small structured tag alongside the free text — e.g., `texture_clash`,
  `traditional_restriction`, `flavor_overlap` — so the *why* survives, not just the *what*.
  Cheap to add now, expensive to reconstruct later.
- **Simple write-conflict guard**: since both editors can edit rules, use a `version`
  integer column on the rule tables and reject/warn on a stale write, rather than building
  real optimistic-locking UI. Last-editor-wins is fine as long as the other editor gets a
  visible "this rule changed since you loaded it" notice.
- **One-tap "mark planned as served"**: a single button on the day view that copies the
  planned dish straight into `actual_meals` with today's date, for the common case where
  the day went as planned. Manual override still available for days that didn't.
- **"Use up leftovers first" flag**: a binary checkbox on the shopping view per vegetable,
  instead of any partial-quantity/pantry tracking. Keeps the "no pantry module" boundary
  from the original spec while covering the real leftover-vegetable case the Economist
  lens raised.

## 3. What's explicitly dropped or deferred, and why

| Original spec item | Disposition | Reason |
|---|---|---|
| PostgreSQL | **Dropped → SQLite** | None of the household's existing containerized services (Homepage, Uptime Kuma, ntfy, Home Assistant) run a standalone DB server; they're SQLite/flat-file under the hood. This dataset (a few thousand rows of household rules) doesn't need Postgres's concurrency model. SQLite inside the same container keeps the exact portability property Docker was chosen for — "copy the folder to the Inspiron" — with a fraction of the memory footprint, which matters directly on a VM that is *currently* soft-locking from resource starvation. |
| Docker Compose | **Kept** | This is not a new infra pattern — it's the household's already-established one. Everything under `~/homelab/` runs in Docker specifically so migration to the Inspiron is a folder copy, not a rebuild. Adding this app the same way is consistency, not scope creep. |
| Tailscale exposure (phase 1) | **Deferred to Inspiron phase** | Matches the precedent already set for Vaultwarden and Paperless-ngx in the HomeLab plan: test on the tower now, go live for real dependency only once it's on the dedicated always-on box. The kitchen planner is at least as daily-critical as either of those, so it gets the same treatment. |
| Home Assistant read-only integration (phase 1) | **Deferred to Inspiron phase** | Same reasoning as Tailscale — no reason to wire a new consumer into HA while HA itself is still mid soft-lockup troubleshooting on the same VM. |
| Multi-service Docker Compose stack (`kitchen-app` + `postgres`) | **Collapsed to one container** | Single container, SQLite file inside its mounted volume. One fewer moving part, one fewer thing competing for the VM's RAM. |

## 4. Sequencing / timing guardrail

Do not add this container to the tower VM until the current HA soft-lockup issue is
confirmed settled at the 4-CPU/8-GB allocation (a day or two of stable runtime is enough
signal). Build and test it can happen anytime; running it as a real daily dependency
should wait for that confirmation, exactly as already planned for Vaultwarden and
Paperless-ngx.

## 5. Revised technical shape

- **Deployment**: one more service folder under `~/homelab/`, one more block in the
  existing `docker-compose.yml` — no new orchestration pattern introduced.
- **Stack**: Node/Express (matching the language/ecosystem already used for NeoBrain,
  though this is a separate app, not a NeoBrain module) + `better-sqlite3`, plain
  server-rendered or lightweight HTML/JS frontend, mobile-first per the original UX spec.
- **Database**: single SQLite file inside the container's mounted volume — same file
  travels with the folder copy to the Inspiron later.
- **No Tailscale, no HA endpoint, no public exposure in v1** — LAN-only, same as the rest
  of the homelab today (`http://192.168.78.23:<port>`).
- **Schema**: as specified in the original spec's table list (`vegetables` generalized to
  `ingredients`, `dish_families`, `dish_items`, `dish_item_ingredients`,
  `ingredient_family_rules`, `dish_repeat_rules`, `dish_compatibility_rules`,
  `special_day_types`, `special_day_assignments`, `plans`, `actual_meals`,
  `knowledge_events`), translated to SQLite types (no native ENUM — use `CHECK`
  constraints instead; no `SERIAL` — use `INTEGER PRIMARY KEY AUTOINCREMENT`).
- **Rule evaluation order**: unchanged from the original spec's 7-step pipeline (slot fit
  → special-day → ingredient suitability → repeat-gap → directional compatibility →
  heaviness → availability).

## 6. Day-one acceptance criteria (unchanged from original, restated for clarity)

- Add an ingredient, a dish family, a named dish.
- Teach a suitability verdict with one tap; see it reflected in future suggestions
  immediately.
- Plan breakfast + lunch for today and the next 7 days, with manual exceptions.
- Get warned/blocked on a repeat-gap violation.
- See breakfast → lunch compatibility reflected in lunch suggestions.
- Mark a day's meals as served with one tap, or override with what was actually eaten.
- See tomorrow's and the week's missing ingredients.
- Runs inside the existing `~/homelab/` Docker Compose setup; data persists across
  container restarts; no dependency introduced outside the current LAN.

## 7. Explicit note on rule examples

Rule examples used anywhere in discussion so far (onion sambar 20-day gap, drumstick
never in kari, mor kuzhambu → adai preference) came from direct interview with PK and are
treated as real starting data, not placeholder illustrations — they can be seeded as
actual rows in `ingredient_family_rules` / `dish_repeat_rules` / `dish_compatibility_rules`
rather than discarded as scaffolding.
