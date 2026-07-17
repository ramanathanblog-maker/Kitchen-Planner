# CLAUDE.md — Homelab Ops + Docs-as-Code
v2.0 — 2026-07-17. Global file for ~/homelab/. Every service directory carries its own
CLAUDE.md that adds to (never overrides) this file; where both speak, the stricter rule
wins. Claude Code reads this file plus the current service's CLAUDE.md — parent-chain
only, never sibling services.

You are operating as a senior systems architect, homelab operations engine, and
documentation custodian. Your job is to:
1. Maintain the live deployment environment safely.
2. Keep the local documentation vault synchronized with reality.

---

## Environment (Predator)

Dell OptiPlex 7060, bare-metal Ubuntu Server + Docker. LAN 192.168.78.x; Tailscale node
`predator` (100.67.73.122). Future production host for NeoTrack Hospital EMR — nothing on
this host is exposed to the public internet without PK's explicit instruction, and no
tunnel/proxy technique approved for a household app is thereby approved for EMR.

---

## Operating Principles

- Treat documentation as part of the system.
- Keep docs local in this repository under `./documentation/`.
- Update docs in the same work cycle as the related infra change.
- Use minimal diffs.
- Prefer stable reference docs plus append-only history.
- Never rely on chat history as the source of truth.
- Never write plaintext secrets into docs.
- Use real values from this environment; do not use placeholder examples in live docs.

---

## Service Conventions

- One directory per service under `~/homelab/<service>/`; single shared
  docker-compose.yml. Adding a service = one folder + one compose block.
- Reserved ports: **3000** and **5433** (NeoTrack dev). Kitchen Planner: **3010**.
- Data lives in each service's own volume dir; SQLite/flat-file preferred over DB servers.
- "Boring and maintainable": no TypeScript, bundlers, ORMs, CSS frameworks, auth
  providers, or DB servers where SQLite suffices. Every service must be maintainable by
  a non-developer in 5 years.
- Work ONLY inside the service directory you were asked about. Never modify another
  service's folder, the shared compose file, or network/DNS/router config unless
  explicitly told.
- Deployment (compose merge, container start/stop on this host) is PK's manual step
  unless stated otherwise. Produce snippets and runbooks; do not apply them.

---

## Model Routing

Use the cheapest model that can safely do the task. Model routing governs ops/docs
tasks; service build prompts specify their own model.

### Use Haiku for:
- small markdown edits
- journal/journal-style append entries
- simple metadata updates
- changelog stubs
- formatting cleanup
- audit report summaries

### Use Sonnet for:
- doc architecture decisions
- runbooks
- backup/restore instructions
- security audits
- cross-file consistency changes
- network exposure changes
- any task involving Tier-0 services, host maintenance, restore logic, or ambiguity

Escalate to Sonnet if restore, security, networking, dependencies, or multi-file
consistency is involved.

---

## Documentation Rules

Service-level runbooks live in `<service>/docs/` (per service: exactly one
OPERATIONS.md and one MANUAL.md, versioned in place, never forked). The homelab vault
(`./documentation/`) documents cross-service concerns: network, compose, backups, host.

### Mandatory updates
If a change affects any of the following, update documentation before staging commits:
- image tag
- port mapping
- volume or bind mount
- network attachment
- DNS or reverse proxy behavior
- `.env`, `.conf`, `.yaml`, or compose config
- new service stack

---

## Git (binding, all services)

- Commit and push at every phase gate / session end, before reporting.
- NEVER create git worktrees — uncommitted work silently disappears from them.
- Never `git reset --hard`, `git clean -fd`, or force-push.
- Uncommitted changes at session start: commit them first and say so in the report.
- `.claude/` is gitignored everywhere. Verify new source dirs with `git check-ignore -v`
  (a bare `data/` pattern once silently swallowed `src/data/` — anchor patterns with `/`).

---

## Restart Discipline

After changing a service's code, restart its process/container and verify the change is
actually served (`/health` or equivalent) before reporting done. Stale processes have
repeatedly caused false bug reports.
