# Kitchen Knowledge Planner — Operations Runbook

v0.1 — 2026-07-17

This is the single ops runbook (CLAUDE.md A4: exactly one OPERATIONS.md, updated in place). This version contains only the §Smoke-Test section required at the end of Phase 4. Start/stop, migrate, seed, backup/restore drill, portability, troubleshooting, taxonomy-update procedure, and the Predator deployment section are Phase 5 deliverables and will be added here, not forked into a separate file.

## §Smoke-Test

12-step manual click-through script mirroring the day-one acceptance criteria (`kitchen-planner-counter-spec.md` §6). Executed here via a scripted HTTP run against a freshly seeded temp DB (`src/app.js`'s `createApp(db)`, same code path the real server uses) rather than by hand in a browser, since this session has no browser available — each step calls the exact API route the corresponding UI page calls, so a pass here means the page's own fetch call would have succeeded identically. Result: **12/12 passed.**

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 1 | Add an ingredient | PASS | `POST /api/ingredients` → 201, new row id assigned |
| 2 | Add a dish family | PASS | `POST /api/families` → 201 |
| 3 | Add a named dish | PASS | `POST /api/items` → 201 |
| 4 | Teach a suitability verdict with one tap; see it reflected in future suggestions immediately | PASS | `POST /api/teach` → 200, then `GET /api/suggest` for the same slot immediately shows an `ingredient_suitability` info finding for the taught verdict — no caching layer to invalidate, no delay |
| 5 | Plan morning for today | PASS | `POST /api/plans` → 201 |
| 6 | Plan noon for today | PASS | `POST /api/plans` → 201 |
| 7 | Plan the next 7 days, with a manual exception | PASS | 7 consecutive days planned via `POST /api/plans`; at least one day's chosen dish had `status: 'warn'` and was planned anyway (the "manual exception") |
| 8 | Get warned/blocked on a repeat-gap violation | PASS | Onion Sambar served, then `GET /api/explain` 5 days later shows the seeded 20-day `repeat_gap` warning, precedence-correct over the 14-day ingredient default |
| 9 | See morning → noon compatibility reflected in noon suggestions | PASS | Vengaya Morkuzhambu (mor kuzhambu family) served in the morning; `GET /api/suggest` for noon shows Plain Adai with a `directional_compatibility` info finding |
| 10 | Mark a day's meals as served with one tap | PASS | `POST /api/plans/:date/serve` → 200, copies both planned slots into `actual_meals` |
| 11 | Override with what was actually eaten | PASS | `POST /api/actual_meals` for a slot with nothing planned; `GET /api/display/today` immediately reports that slot's `source` as `'actual'` |
| 12 | See tomorrow's and the week's missing ingredients | PASS | `GET /api/shopping?from=<tomorrow>&to=<+7d>` returns both `tomorrow.to_buy` and `week.to_buy` arrays |

**Not covered by this pass — explicitly unverified, not silently skipped:**
- "Runs inside the existing `~/homelab/` Docker Compose setup; data persists across container restarts" (the 8th acceptance-criteria bullet) — this needs an actual `docker build`/`docker run`/restart cycle, which is Phase 5's backup/restore-drill + fresh-clone-drill territory, not something this session's sandboxed test run exercises.
- Anything requiring a real browser: 375px layout / no-horizontal-scroll, tap-target sizing by eye, dark-mode rendering, CSS view-transition smoothness, PWA installability (manifest + service-worker registration are present and unit-tested for presence, but "installs to a home screen and opens standalone" needs a real device or Lighthouse run). These are reported here as unverified so they aren't mistaken for a silent pass — see the Phase 4 report for the full list.
