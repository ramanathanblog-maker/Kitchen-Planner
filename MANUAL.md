# Kitchen Knowledge Planner — Household Manual

v1.0 — 2026-07-18

For PK, RP (Sriranjani), and PS to use day-to-day. Updated in place as features ship — this is the one and only MANUAL.md (CLAUDE.md A4).

---

## Install to your phone's home screen

1. Open `http://<predator-LAN-IP>:3010` in your phone's browser while on the home WiFi (ask PK for the current LAN IP — it shows up in Predator's `docs/OPERATIONS.md`, or just ask).
2. First visit, you'll land on **Who's this?** — pick your name (PK / RP / PS). This is remembered on this device, no password — it's a home-LAN app, not picking your name doesn't lock anyone out, it just labels who made each change.
3. Use your browser's "Add to Home Screen" (Safari: Share → Add to Home Screen; Chrome: menu → Install app / Add to Home Screen).
4. Open it from the home screen icon from then on — it runs full-screen, like a normal app, and keeps working (read-only) briefly if your WiFi drops.

---

## Plan a day with the wizard

The **Guided plan** wizard is the only way to plan a slot (morning/noon/night) — there's no free-text "type a dish name" box, by design, so every planned dish stays connected to the knowledge base's suitability/repeat/compatibility checks.

- From **Plan**, tap a day's slot to open its wizard hub — one row per dish-role for that meal (e.g. Main Gravy, Dry Side, Rasam).
- Tap **+** on a row to **drill in**: pick a class → family → dish. If a class only has one family, or a family only has one dish, that screen is skipped automatically — you land straight on the item to choose.
- Each candidate dish shows a status chip: **• allowed**, **⚠ avoid** (still choosable — a soft warning, e.g. a repeat-gap nudge), or **✕ blocked** (not choosable — a hard rule, e.g. an allergy). Tap the chip's reason text if shown to see why.
- **Skip** a row if you don't want to fill it right now — it's fine to leave a row empty.
- Rows with a cap of more than one (**steppers**, shown as `+ (2/3)` etc.) let you add more than one dish to that row, up to the max; once at max the button becomes **Edit** so you can review/remove instead.
- Already-chosen dishes show their own **✕ Remove** next to the name, so you can drop one dish without re-drilling the whole row.
- Choosing a **variety rice** (or similar "this replaces the whole meal shape" dish) will ask you to confirm before it clears whatever else was already planned for that slot's now-hidden rows — it'll show you exactly what's about to be cleared first.
- **Save day** at the bottom returns you to the Plan view.

## Teach a rule — both kinds

Two ways to correct the suggestion engine, both one-tap from inside a flow you're already in:

1. **Reject a dish while drilling** (the ✕ next to a candidate, not the ✕ that removes an already-chosen dish) — asks "Remember this?" and offers either **Avoid `<ingredient>` in this dish family** (if the dish has clear primary ingredients) or **Just not for a while?** (a 90-day soft cooldown on that specific dish). Pick one, or **No thanks** to dismiss without teaching anything.
2. **From Knowledge** (the admin-style rules page) — Ingredient rules and Repeat rules tabs each have an **Add rule** form for a more deliberate edit (e.g. setting a `never` verdict, or a custom repeat-gap in days) rather than the quick in-flow correction above.

Both kinds show up immediately in future suggestions — there's no cache to wait out. Both are also recorded in **History** (see "fix a mistake," below) and can be undone.

## Mark served / log-as-eaten / make changes

- **Mark served** (one tap, from Today) copies everything planned for that day into the "what actually happened" log in one shot — use this when the day went exactly as planned.
- **Log something different as eaten** — if what you actually ate differs from the plan (swapped a dish, added an extra item), log it directly against `actual_meals` for that slot; it doesn't need to match what was planned, and doing this doesn't change the plan itself, just the record of what happened.
- **Make changes** to a not-yet-served day: re-open the wizard for that slot and adjust as normal, same drill/skip/stepper flow as planning it the first time — as long as the day isn't in the past (see below).

## Shopping list

The shopping view shows two lenses over the **same underlying plan**, not two separate lists:

- **Tomorrow** — ingredients needed for whatever is planned on the first day of the range only.
- **Week** — ingredients needed across the whole week ahead. This always includes everything in the Tomorrow view plus whatever else is planned later — it is not "the week minus tomorrow."

**Today is never included in either list** — today's ingredients are assumed already on hand, so both the Tomorrow and Week views start from tomorrow.

Ingredients marked "use up as leftovers first" are shown separately from what you actually need to buy, in both views, so you don't accidentally shop for something already sitting in the fridge.

## Fix a mistake — History + Undo

Every taxonomy/rule change (including one-tap "teach" corrections) is recorded in **Knowledge → History**, oldest-safe: nothing is ever silently overwritten or deleted from the log, even when you undo something. Find the entry for the change you want to reverse and tap **Undo** — this doesn't erase the original change, it records a *new* entry that puts the row back the way it was, so the full history of what happened and when stays intact and auditable. If you undo the same thing twice, or undo something someone else already fixed a different way, you'll see both entries in the history — nothing is hidden.

## Past days are locked

Once a day is in the past, RP and PS can no longer change what was planned for it — the wizard drill and Today's edit/✕ affordances are disabled with a **"past days are locked — ask PK to change this"** message. Only PK can still edit a past day's plan. This is enforced by the server itself, not just hidden on screen — it can't be worked around from a phone's browser.

This does **not** apply to what was actually eaten — RP and PS can still log/correct `actual_meals` for any past date, any time, since fixing the record of what happened is different from rewriting what was intended.

---

## Admin appendix (PK)

### Knowledge: add / edit / delete

**Knowledge** has tabs for Ingredient rules and Repeat rules — each supports Add (the form at the top of its tab), Edit (open a row, change its verdict/severity/etc. — protected by a `version` check: if someone else edited the same row since you loaded it, your save is rejected with a "this changed since you loaded it" message rather than silently overwriting; reload and reapply), and Delete (per-row action, works even on seed-origin rows). The **Needs input** tab surfaces rules the engine flagged as ambiguous/incomplete and could use a real verdict.

The one-tap "teach a rule" shortcut (used from the wizard's reject flow) does **not** have the version-check protection above — it's meant to be quick, not a negotiated edit. If two people teach the same rule within moments of each other, the second one wins with no warning. Every teach action is still recorded in History and can be undone, so nothing is permanently lost — but know this shortcut trades safety for speed.

### Special days

**Special Days** lets you define day types (e.g. a fasting day, a festival) and assign them to specific dates, each with an allow/avoid/block rule against dish families — these show up as suitability findings the same way ingredient/repeat rules do, on any date that has an assignment.

### Past-day override

You're exempt from the past-day plan lock described above — the wizard and Today's edit/✕ controls stay live for you on any date, past or future. Use this to backfill a plan that was never entered at the time, or to correct a mistake in a day that's already gone by; RP and PS will see a locked message on the same date and need to ask you.

### Taxonomy JSON update procedure

Full step-by-step is in `docs/OPERATIONS.md` → "Seed / taxonomy-update procedure." Short version: edit the canonical JSON → copy it into `seed/taxonomy-comprehensive.json` → `node seed/load.js` (upserts seed-origin rows, never touches anything a household member has hand-edited) → `node seed/verify.js --summary` to confirm zero divergence. `GET /health`'s `taxonomy_version`/`taxonomy_json_sha256` fields let you confirm the *running* server actually picked up the change after a restart.
