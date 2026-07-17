# Kitchen Knowledge Planner — Household Manual

v0.1 — 2026-07-17

For PK, RP (Sriranjani), and PS to use day-to-day. Updated in place as features ship — this is the one and only MANUAL.md (CLAUDE.md A4).

## Shopping list

The shopping view (`GET /api/shopping?from=<date>&to=<date>`, UI arriving in a later phase) shows two views over the **same underlying plan**, not two separate lists:

- **Tomorrow** — ingredients needed for whatever is planned on the first day of the range only.
- **Week** — ingredients needed across the *whole* range you asked for, `from` through `to`. This always includes everything in the Tomorrow view plus whatever else is planned later in the range — it is not "the week minus tomorrow."

So if you've planned meals for the next 7 days, the Week view is your full grocery run, and Tomorrow is just a quick "what do I need before my next shop" glance at a subset of it — not a different day's list.

Both views on the `/shopping` page and the `/display` kiosk start from **tomorrow, not today** — today's ingredients are assumed already on hand, so they never appear in either list.

Ingredients marked "use up as leftovers first" are shown separately from what you actually need to buy, in both views, so you don't accidentally shop for something already sitting in the fridge.

## Past-day plans are locked

Once a day is in the past, RP and PS can no longer change what was planned for it (the wizard drill and Today's edit/✕ affordances are disabled with a "past days are locked — ask PK to change this" message) — only PK can. This is enforced by the server itself, not just hidden in the UI.

This does **not** apply to what was actually eaten (`actual_meals`) — RP and PS can still correct that log for any past date, any time, since fixing a record of what happened is different from rewriting what was intended.

## Editing rules and ingredients (PK, admin)

Every ingredient/family/item/rule row remembers a `version` number. If you and another editor (currently only PK edits taxonomy/rules) both open the same row and one of you saves first, the second save is rejected with a clear "this changed since you loaded it" message rather than silently overwriting — reload and reapply your edit.

The one-tap "teach a rule" action (used from the Today/Plan view to correct a suggestion on the spot) does **not** have this protection — it's meant to be quick, not a negotiated edit. If two people teach the same rule within moments of each other, the second one wins with no warning. Every teach action is still recorded in the audit history and can be undone, so nothing is ever permanently lost — but the household should know this shortcut exists.
