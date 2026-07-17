# Kitchen Knowledge Planner — Counter-Spec v2

*Supersedes v1's domain-model seed data with the full taxonomy from
`taxonomy-comprehensive.json` and `meal-planner-taxonomy-design.md`. Stack/infra
decisions from v1 (Docker + SQLite, no Tailscale/HA in phase 1, sequencing behind VM
stability) are unchanged and not repeated in full here — see v1 for those.*

---

## 1. Scope decision for this revision

Per PK's direction: **taxonomy and observance richness comes into v1 now; inventory
tracking and the people/guest model are deferred to v2.** This is a deliberate split, not
an oversight — the original spec's own non-goals ("no full pantry management," "no
per-person preference engine in v1") still hold. What changes is the *depth of the
knowledge model itself* (dish classes, ingredient roles, repetition granularity), which
is squarely v1 territory — it's the same kind of thing as the original combo/repeat/
compatibility rules, just more accurately modeled.

## 2. Taxonomy seed data (replaces the v1 placeholder families)

The dish-class list from `taxonomy-comprehensive.json` becomes the actual seed for
`dish_families` / `dish_items`, replacing the earlier illustrative list
(sambar/rasam/kari/kootu/adai/dosa):

| Class | Notes |
|---|---|
| Vathakozhambu, Kozhambu, Rasam | Core traditional, minimal sub-structure needed |
| Koottu | Suraikkai, Beans, Katharikkai, Cabbage, Chow Chow, Vaazhaithandu; variants Aviyal, Porichakootu (Sundaikkai nested under Porichakootu) |
| Kari | Carrot, Beans, Vaazhaithandu, Cabbage, Vazhaipoo, Avaraikkai, Broccoli, Beetroot, plus combo forms (Cabbage+Peas, Carrot+Peas) |
| Roast Kari | Potato, Senaikkizhangu, Seppankizhangu, Vendaikkai, Cauliflower, Katharikkai, Karunaikkizhangu, Kovakkai, Vazhaikkai; variants Soya Chukka, Mushroom Chukka, Potato Idicha Kari |
| Thuruval (= salad/kosumalli, umbrella class) | Groundnut, Black/White Channa, Payaru, Carrot, Cucumber, Sweet Corn, Red Kidney Beans, Double Beans |
| Usili | Paruppu Usili, Beans Paruppu Usili |
| Pachadi | Carrot Thayir Pachadi |
| Thogayal/Thuvayal | Paruppu, Thengai, Peerkangai, Kollu, Vallarai Keerai |
| Variety Rice | Lemon, Coconut, Puliyodarai, Katharikkai/Vaangi Bath, Sambar Sadham, Tomato Sadham, Ellu Sadham, Arisi Paruppu Sadham |
| Tiffin (13 sub-families) | Dosai, Oothappam, Aval, Sevai, Pongal, Upma, Adai, Chapathi, Poori, Bajji, Aapam, Vadai, North-Indian-tiffin (fried rice variants, biriyani, parathas, cutlet, paneer 65, channa chat, omelette) — full item lists as given in the JSON |
| Sides/Gravy | Road Style Mushroom, Paneer Butter Masala, **SBM (name unresolved — flagged below)**, Veg Stew, Green Peas Masala, Paneer Burji, Dal Makhani, Kerala Kadalai Curry, Baby Corn Gravy, Soya Chunks Gravy, Pachapayaru Kuruma, Green Mushroom Palak |
| Children's Snacks | Cut fruits, Muffins, Dates Cake, Dates Brownie, 3 cookie types, Nuts, Popcorn, Store-bought |
| Child Bento Box | 4-chamber structure, **17 ideas expected, currently empty — flagged below** |

Ingredient normalization decisions carried forward as-is: canonical English name + Tamil
name + aliases (e.g., Kadalai stored as Groundnut, alias "peanut," flagged
allergy-sensitive); ingredients are shared entities mapped across multiple dish classes
(carrot's cross-class mapping is the worked example in both source docs).

## 3. Refinements to the rule engine (v1, not deferred)

Two genuine improvements from the taxonomy design doc, both fit inside the existing
schema shape from v1 with small additions:

### 3.1 Primary vs. support vegetable role
`dish_item_ingredients` gets a `role` field (`primary` | `support`) rather than treating
every listed ingredient as equal. Example: Avarai, Onion, and Sundaikkai can anchor a
sambar; other vegetables may appear in a supporting capacity only. This also matters for
repetition tracking — a support appearance may reasonably repeat faster than a primary
one, since it's not "the same dish" in the way the household thinks about it.

### 3.2 Form-based repetition, with per-dish override
Repetition is tracked at **ingredient + form** (form = the dish family/context it
appears in — "carrot in sambar" and "carrot in kari" are different forms), with global
defaults:

- No form of a vegetable repeats within **3 days**.
- The *same* form may repeat only after **14 days**.

This is the general engine default. It sits **underneath**, not instead of, the
exact-dish repeat-gap rules already in v1 (e.g., onion sambar specifically at 20 days) —
a dish-level override always takes precedence over the ingredient+form default when both
apply. Evaluation order: check for a dish-specific override first; fall back to the
ingredient+form default if none exists.

### 3.3 Onion/garlic flags on tiffin items
Tiffin dish items carry `onion_flag` / `garlic_flag` booleans, consumed by the existing
special-day evaluation step (step 2 in the rule pipeline) exactly as designed in v1 —
this document just confirms tiffin is where the flags actually live in the taxonomy.

## 4. Explicitly deferred to v2 (per PK's decision this turn)

- **Live inventory tracking** (purchase quantities, consumption drawdown, fridge/pantry/
  leftover state, anchor-vs-support stock distinction). V1 keeps the existing "missing
  vegetables for tomorrow / the week" shopping roll-up only — a derived view from planned
  meals, not a stateful stock ledger.
- **People/guest model** (named family members, roles, age groups, per-person
  likes/dislikes/allergies, guest-specific logic, meal-slot-specific attendance counts).
  V1 stays household-level, as originally scoped.
- **Broader pairing-memory system** (dish-to-dish/accompaniment pairings with
  household/person/guest/festival scope and reason codes). V1 keeps the narrower
  breakfast→lunch directional compatibility rule already specified — this is a superset
  to design properly once the people model exists to scope it against.
- **Notification/reminder design and analytics** (timed inventory nudges, digest
  grouping, accepted/rejected-suggestion tracking). Not meaningful without the inventory
  and pairing-memory layers above; deferred alongside them.

These aren't rejected — they're sequenced. The taxonomy/rules work in this revision is
what those later layers will attach to, so doing it first is the right order regardless.

## 5. Open items needing PK's input, not further LLM design

- **`sbm_unresolved`**: the sides-gravy class has a placeholder entry "SBM" with no
  expanded name yet. Needs the actual dish name before it can be seeded.
- **`child_bento_box`**: structure is defined (4 chambers) but the 17 expected ideas are
  empty. Needs to be populated from PK/wife's actual bento repertoire, not invented.

## 6. What stays unchanged from v1

- Stack: single Docker container under `~/homelab/`, SQLite (not Postgres), no
  Tailscale/HA integration in phase 1.
- Sequencing guardrail: don't add this to the tower VM as a live dependency until the
  current HA soft-lockup issue is confirmed settled.
- Panel-review additions: rule rationale tags, simple write-conflict version guard,
  one-tap mark-as-served, "use up leftovers first" flag.
- Planned vs. actual meals as distinct records; `knowledge_events` as append-only audit
  log; two co-equal editors, no permissions model.
