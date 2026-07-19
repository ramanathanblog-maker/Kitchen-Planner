# Kitchen Planner — Phase 6 Amendment: Two Households + Cloudflare Access
**Artifact:** KitchenPlanner_Phase6_Amendment · **Version:** v1.0 · **Date:** 2026-07-19
**Applies to:** current `main` (post remediation R1–R4, commit ≥ f2e3f4b).
**Usage:** paste PART A once, then each PHASE block in order. Commit+push at every gate, per CLAUDE.md §A3.9. No worktrees.

---

## PART A — Scope and decisions (binding)

- **Two SQLite files, not one DB with `household_id`:** `data/rp.db`, `data/ps.db`, plus new `data/system.db` holding `users` (email, password_hash or is-Access-verified, household, is_admin) — per the original Phase 6 design decision. Each household DB is a full copy of the existing schema, seeded identically from the canonical taxonomy JSON.
- **PK is admin over both households**, can read/write either. **RP and PS are read-only on each other's household**, full read/write on their own.
- **Access model: dual-path for both households, not a split.** Both RP and PS get Cloudflare Tunnel + Access (Google login) as a fallback path, in addition to plain LAN access for whoever is on the home network. LAN stays the fast, no-login default when someone is home; Access covers "RP's phone dropped off home WiFi but has mobile data" or "PS is anywhere." **This does not cover a full home-internet outage** — if Predator's upstream internet is down, the tunnel is down too, and neither LAN-external nor Access reaches the app; only same-network LAN access still works in that case. Worth stating this limit in MANUAL.md so it's not a surprise later. PK is admin over both households via either path.
- **Kiosk defaults to RP's household.** A second kiosk instance for PS is optional, later, not part of this phase.
- **Never apply this tunnel technique to NeoTrack/EMR** — restated per the homelab CLAUDE.md hard line, and worth a comment in the Cloudflare config itself.
- **No new ORM, no Postgres, no session library.** Cloudflare Access does authentication; the app only reads a trusted header and maps it to a user row. This is less code than a hand-rolled password system, not more.

---

## PHASE 6a — Multi-DB foundation (no auth yet, no network changes)

**DO**
1. Create `data/system.db` with a `users` table: id, email, display_name, household ('rp'|'ps'|null for PK), is_admin, created_at. Seed three rows: PK (is_admin=1, household=null), RP (household='rp'), PS (household='ps').
2. Refactor DB access so the app can hold **multiple open connections keyed by household** instead of one global `db`. `createApp(db)` becomes `createApp(dbByHousehold)` or equivalent — minimize churn to existing routes; they should mostly stop caring which DB they're on, since that's resolved once per request.
3. Migration runner and seed loader both iterate over every `*.db` file found via a manifest (system.db excluded from taxonomy seeding — it has no taxonomy tables). Confirm `backup.sh` (already iterates `*.db`) needs no changes — verify, don't assume.
4. `data/rp.db` = your existing `data/kitchen.db`, renamed. `data/ps.db` = fresh, seeded from the same taxonomy v1.7 JSON, empty of any household-specific rules/plans/history — PS's household starts clean per PK's earlier "start clean" decision.
5. **No routing logic yet.** This phase only proves multiple DBs can be migrated, seeded, and queried side by side. Editor identity still resolves exactly as today (PK/RP/PS cookie) and everyone still hits `rp.db` — actual household routing is Phase 6b.

**VERIFY (GATE)**
- Both DBs migrate and seed independently; `verify.js --summary` clean on each (18/78/199).
- Full existing test suite passes unmodified against `rp.db` (proves the refactor didn't change behavior for the current single-household case).
- New tests: `system.db` schema and seed rows; a query helper resolves 'rp'→rp.db and 'ps'→ps.db correctly; PK's household resolves to null/both.

**STOP. Report before 6b.**

---

## PHASE 6b — Household routing

**DO**
1. `editorMiddleware` (or a new middleware layered on it) resolves **which DB a request uses**: RP's cookie → rp.db; PS's cookie → ps.db; PK's cookie → session-selected household (default rp.db, with a switcher — see 6d) for read/write, but read access to whichever household a request explicitly asks for.
2. **Read-only cross-household enforcement is server-side**, same standard as the past-day lock: any write attempt against a household you're not PK or the household's own editor for → 403. Add tests exactly mirroring the past-day-lock test shape (RP write to ps.db → 403; RP read ps.db → 200; PK write to either → succeeds).
3. Kiosk (`/display`) hardcodes household='rp' unless an env var overrides it — no per-request household resolution for the kiosk.
4. `meal_patterns` and all `settings` become **per-household** (they already live in each household's own DB from 6a, so this may already be correct — verify explicitly, don't assume, since a global-settings assumption could have leaked in anywhere).

**VERIFY (GATE)**
- RP's existing daily flow (wizard, Today, Shopping, Knowledge) works identically against rp.db with zero visible change.
- New household (ps.db) is independently plannable — teach a rule in ps.db, confirm it does not appear when querying rp.db.
- Cross-household 403/read tests pass.
- Kiosk unaffected by household routing changes.

**STOP. Report before 6c.**

---

## PHASE 6c — Cloudflare Tunnel + Access for RP and PS

**DO — infrastructure, PK executes manually per your runbook; you write the runbook and the app-side header handling**
1. App-side: a new identity path that trusts `Cf-Access-Authenticated-User-Email` header (only when present and only from requests that also carry Cloudflare's signed Access JWT — verify the JWT server-side, do not trust the header alone) and maps the email to a `system.db` user row → household. This runs **alongside**, not instead of, the existing cookie-based PK/RP/PS picker — LAN requests without the header continue exactly as today.
2. **Identity precedence when both are present:** if a request arrives through the tunnel with a valid Access JWT, that identity wins over any stale editor cookie — don't let an old LAN cookie silently override a verified Access login. If a request has no Access JWT (i.e. genuinely on the LAN), the existing cookie picker is authoritative, unchanged.
3. Access application in Cloudflare is configured with **three** authorized Google identities (PK, RP, PS), each mapped to their `system.db` row — not PS alone.
4. If the email doesn't match a known user, reject with a clear message ("this Google account isn't set up — ask PK"), never silently create a household.
5. Write `docs/CLOUDFLARE_SETUP.md`: tunnel install on Predator, Access application config scoped to only the kitchen-planner hostname, Google as the identity provider for all three, session duration (long — nobody should have to re-login often), and the explicit warning that this technique must never be pointed at NeoTrack. Also document the outage limitation from Part A (tunnel depends on Predator's upstream internet; it is not a substitute for a home-internet outage). This is PK's manual infra step; you are producing the runbook, not running `cloudflared` yourself.

**VERIFY (GATE)**
- Unit test: a valid Access JWT for PS's email resolves to ps.db with correct permissions; same for RP's email resolving to rp.db.
- Unit test: a JWT for an unknown email is rejected.
- Unit test: a request with the header but no valid JWT is rejected (can't be spoofed by just setting a header).
- Unit test: Access JWT identity takes precedence over a stale/mismatched editor cookie on the same request.
- Existing LAN-cookie-only flow (no Access header at all) completely unaffected — regression test confirms.

**STOP. This is PK's deploy checkpoint — do not proceed to 6d until PK confirms both RP and PS have successfully logged in via their own Google accounts, from off the home network, at least once.**

---

## PHASE 6d — PK admin polish

**DO**
1. Household switcher for PK: visible only to PK, in the header near the existing editor-switch link, toggling which household's data PK is currently viewing/editing.
2. Update `docs/MANUAL.md` with an off-LAN access section for both RP and PS (what they'll see logging in via Google when away from home WiFi, how to install the PWA from the Cloudflare URL, and the outage caveat from Part A) and `docs/OPERATIONS.md` with the two-household backup/restore procedure (both DBs, independently).
3. Update `docs/ROADMAP_V2.md`: mark the two-household item done; note whatever's now newly deferred (e.g. a second kiosk for PS, cross-household comparison views, shared shopping lists — do not build any of these now, just record if PK wants them noted).

**VERIFY (GATE)**
- Full suite passing.
- Fresh-clone drill re-run with the multi-DB setup (migrate, seed both households, boot, smoke test both).
- PK confirms via the switcher that both households are independently visible and editable.

---

## Guardrails throughout
- Every phase's blast radius stays inside its stated scope; if a fix requires touching auth *and* the engine *and* the wizard in one phase, STOP and report rather than expanding.
- RP's experience must not regress at any point — she is mid-use of this app daily; every phase's gate includes "RP's existing flow unaffected."
- No code changes to NeoTrack, Predator's shared compose file structure, or any other homelab service.
