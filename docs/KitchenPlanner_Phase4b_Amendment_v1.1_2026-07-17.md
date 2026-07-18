# Kitchen Planner — Phase 4b Amendment: Meal-Pattern Wizard
**Artifact:** KitchenPlanner_Phase4b_Amendment · **Version:** v1.1 · **Date:** 2026-07-17
**v1.1:** all rows skippable (flag removed); sambar drill reflects taxonomy v1.5 arachuvitta/pitlai merge.
**Applies to:** Build Prompt v1.3, after Phase 4, before Phase 5.
**Scope:** View layer + one settings block. **No engine or API-contract changes.**
**Prerequisite:** canonical taxonomy **v1.5** seeded first (§0).
All 104 existing tests must still pass unmodified.

---

## 0. Prerequisite — reseed taxonomy v1.5 first

`taxonomy_comprehensive-ver-1_5.json` replaces v1.4 in `/seed/`. Changes:
- New ingredient `veg_073 poosanikkai` (aliases pumpkin/ash_gourd).
- Sambar families reduced from 3 to 2: `fam_004_001 regular_sambar` and
  `fam_004_002 arachuvitta_sambar_pitlai` (merged). **`fam_004_003 pitlai` is retired.**
- `dish_014` renamed in place (external_id stable) from generic `arachuvitta_sambar` →
  `poosanikkai_arachuvitta_pitlai`, primary ingredient poosanikkai.
- `dish_015`/`dish_016` moved to `fam_004_002` and renamed `katharikkai_` /
  `pavarkkai_arachuvitta_pitlai`.
- Counts: **17 classes, 73 ingredients, 191 items**, zero dangling refs.

Run `load.js` then `verify.js`. The retired `fam_004_003` must be removed by
`clearStaleSeedRows()` — it is `origin='seed'` with an `external_id` no longer in the JSON.
**Confirm that path works**: the existing clear logic keys on `external_id IS NULL`, which
will NOT catch a seed row whose external_id is present but *absent from the current JSON*.
If that's a gap, fix it (delete seed-origin rows whose external_id is not in the JSON) and add
a test — this is the first family retirement, and it will not be the last.
Report any rules/plans/actual_meals referencing `fam_004_003` before deleting; STOP if any exist.

---

## 1. The problem

The picker sheet lists every slot-eligible dish flat (~150 for morning). The taxonomy has
carried `class → family → item` and `meal_role` since v1.4, and the UI ignores all of it.
Consequences: unusable on a phone; verdict chips are wallpaper on a 150-item list but
actionable on a 5-item one; reverse-teach has no ingredient attribution because a bare
rejection doesn't know what was rejected *about* the dish.

## 2. The model — a pattern hub with drill-down

The **pattern screen is the hub** for a slot. Each row is a `meal_role` with a count. Tapping
a row drills: **class → family (style) → item (veg)**. Choosing returns to the hub. The hub
carries the zero-leads banner (from `zeroLeadsWarning`, already built) and the Save action.

```
MORNING
  Gravy      [ + ]        → Sambar | Kozhambu | Skip
  Rasam      [ + ]
  Kootu      [ + ]
  Kari       [ − 0 + ]    stepper, max 2
  Salad      [ + ]
  Crisp      [ − 0 + ]
  Thogayal   [ + ]
  Pachadi    [ + ]
  ⚠ No sambar or kozhambu yet
  [ Save day ]
```

Drill example: `Gravy → Sambar → Regular | Arachu Vitta / Pitlai → Murungakkai · Avaraikkai ·
Vengaya · Sundaikkai · Carrot` → chosen → hub row reads **"Vengaya Sambar ✎"**.
(Arachu Vitta / Pitlai drills to Poosanikkai · Katharikkai · Pavarkkai — taxonomy v1.5.)

Three taps to a dish; every screen shows 3–8 options.

## 3. Pattern spec is DATA, not code

New `settings` block `meal_patterns`, seeded by migration, admin-editable — same principle as
`meal_role` / `can_lead` / `meal_composition`. **Never hard-code role names or labels in views.**

```json
{
  "morning": {
    "rows": [
      {"role":"main_gravy","label":"Gravy","max":1},
      {"role":"secondary_gravy","label":"Rasam","max":1},
      {"role":"semi_solid_side","label":"Kootu","max":1},
      {"role":"dry_side","label":"Kari","max":2},
      {"role":"salad","label":"Salad","max":1},
      {"role":"condiment","label":"Thogayal","max":1,"filter_class":"thogayal"},
      {"role":"condiment","label":"Pachadi","max":1,"filter_class":"pachadi"},
      {"role":"crisp_side","label":"Crisp","max":2},
      {"role":"standalone","label":"Variety Rice","max":1,"collapses_pattern":true}
    ]
  },
  "noon": {
    "rows": [
      {"role":"tiffin_main","label":"Tiffin","max":2},
      {"role":"tiffin_side","label":"Side / Gravy","max":1,"offer_morning_carryover":true},
      {"role":"condiment","label":"Chutney / Thogayal","max":2,"filter_class":"thogayal"},
      {"role":"crisp_side","label":"Crisp","max":1}
    ]
  },
  "night": {"rows":[], "note":"Pattern pending PK confirmation — free-pick fallback until set"}
}
```

- `max` drives the stepper (Amazon-cart style: `− n +`, capped).
- **Every row is skippable** (per PK) — each drill offers an explicit **Skip**, and simply not
  choosing a row leaves it empty. No `skippable` flag exists; skipping is universal. Rasam,
  kootu, kari, salad, crisp, condiments and gravy alike may all be skipped.
- `filter_class` narrows a role to one dish class when two rows share a role (thogayal vs
  pachadi both being `condiment`).
- `collapses_pattern` — see §4.
- `offer_morning_carryover` — see §5.
- Rows render in array order. Reordering the array reorders the UI. No code change.

## 4. Variety rice collapses the pattern

Per PK: variety rice takes **no gravy**; rasam is allowed; aviyal-as-side is allowed (aviyal
already exists in the taxonomy under `koottu` — surface it, do not create it); crisp allowed.

When a `collapses_pattern` item is chosen, the hub hides rows not in `collapsed_allows` and
clears any already-chosen dish in a hidden row (with a confirm before clearing):

```json
"collapsed_allows": ["secondary_gravy","semi_solid_side","crisp_side"]
```

Variety rice is `standalone` + `can_lead=1`, so it already satisfies step 5b — the zero-leads
banner clears on choosing it. No engine change.

## 5. Noon: morning carry-over

On the `Side / Gravy` row, list **today's morning gravy dishes first**, under a header like
"From this morning", before the `sides_gravy` class items. Two existing mechanisms cover this,
use both — build nothing new:

- `dish_compatibility_rules` (morning→noon, already seeded: mor kuzhambu → adai `prefers`)
  boosts ranking.
- Today's morning `actual_meals` (falling back to `plans`) supplies the carry-over list —
  the same precedence the display endpoints already use.

Tiffin drill: `Tiffin → Dosai | Pongal | Upma | … (13 subfamilies) → Plain · Ghee · Rava · …`.

## 6. Verdict chips inside the drill

Chips now render on a 3–8 item list where they are legible and actionable:
`✓ preferred · • allowed · ⚠ avoid/warn · ✕ blocked` (A5 tokens, already in theme.css).
Blocked items stay listed but disabled with the reason visible — RP must be able to see *why*
murungakkai kari is unavailable, not just find it missing.

`/api/suggest` already returns `mealRole`, `familyName`, `heaviness`, and `findings`; the
`compositionWarning` is already a sibling field. The wizard consumes what exists — **no API
contract change**.

## 7. Reverse-teach at the leaf

Rejecting inside a drill now has full attribution (class + family + item + primary
ingredient). Keep both one-tap choices from the Phase 4 fix, now correctly seeded:

- **"Avoid carrot in sambar?"** → `ingredient_family_rules` (ingredient = the item's
  `primary` role ingredient, family = the drilled family)
- **"Just not for a while?"** → `dish_repeat_rules`

## 8. Guardrails

- **View layer + one settings block only.** No changes to `/src/engine/*`, route contracts,
  or the canonical JSON.
- All 104 existing tests pass **unmodified**. If a change requires editing an existing engine
  or API test, STOP and report — that means the blast radius exceeded this amendment.
- No client-side routing: each drill level is a real URL (`/plan/:date/:slot/:role`,
  `/plan/:date/:slot/:role/:familyId`) or an in-sheet step of a server-rendered page. Data
  interpolated server-side, per the Phase 4 SSR fix. Keep the `.sheet__header/body/footer`
  anatomy and `85dvh` scroll fix.
- Multi-dish rows are multiple `plans` rows using the existing ordering column — **no
  quantity field on `plans`**.
- Alpine only for in-page interactivity; mutations still fetch + real reload.
- Read `meal_patterns` from settings on every render. A grep for hard-coded `'main_gravy'`,
  `'Gravy'`, `'Kari'` etc. in `/src/views` must return nothing.

## 9. Tests

- `meal_patterns` seeds; hub renders exactly the configured rows in array order.
- Reordering / relabelling / changing `max` in settings changes the UI with no code change
  (the data-driven proof, mirroring the `can_lead` toggle test).
- Stepper caps at `max` (kari 2, gravy 1).
- Drill: gravy → sambar → regular → item list is bounded (≤10) and contains only that
  family's items.
- Skip is offered on **every** row's drill (assert for all configured rows, not just gravy);
  skipping records no dish and leaves the zero-leads banner intact if no lead was chosen.
- Variety rice chosen → gravy/kari/salad/thogayal rows hidden; rasam/kootu/crisp remain;
  banner clears.
- Noon: with a morning gravy planned, the Side/Gravy row lists it under "From this morning"
  ahead of `sides_gravy` items; with no morning gravy, that group is absent.
- Blocked item renders disabled with its reason string, not omitted.
- Two karis save as two `plans` rows with distinct ordering values.
- Regression: `suggestions[].findings` still never contains a zero-leads entry;
  `compositionWarning` still a sibling field.

## 10. Open items — PK confirmation needed (do not invent)

1. **Night pattern** — still unspecified. Free-pick fallback until PK defines it (long-standing
   open item, Build Prompt appendix #6).
2. **Pachadi as its own row** — assumed here (own row, `filter_class:"pachadi"`) rather than
   merged with thogayal, since they're different things on the plate despite sharing the
   `condiment` role. Confirm.
3. **Dead-end drills — partially fixed in taxonomy v1.5.** Sambar is resolved: `arachuvitta_sambar`
   and `pitlai` are now one family (`fam_004_002`, "Arachu Vitta / Pitlai") with three real
   vegetable items — poosanikkai, katharikkai, pavarkkai — so the sambar drill is a genuine
   three-level path. **Still open** (families/items with no `ingredient_roles`, so their third
   level offers one nameless option): `paruppu_usili`, `aviyal`, `kosumalli`, `veg_stew`,
   `lemon_rice`, `coconut_rice`, `puliyodarai`, and most plain tiffin items. Fix belongs in the
   canonical JSON, not the wizard. Interim rule: if a family has ≤1 item, skip the third level
   and select directly.
4. **Thogayal-led days** — thogayal is `condiment` + `can_lead=1`, so choosing thengai or
   paruppu thogayal with Gravy=Skip clears the banner correctly. Confirm this is the intended
   behavior rather than thogayal needing its own lead affordance on the hub.
