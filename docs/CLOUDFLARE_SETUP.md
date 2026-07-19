# Cloudflare Tunnel + Access Setup — Kitchen Knowledge Planner
Phase 6c runbook. PK executes every step in this file manually — nothing here
is run by Claude Code, and nothing here is applied to Predator automatically.
This is documentation, not a script that gets invoked on deploy.

Applies to `docs/KitchenPlanner_Phase6_Amendment_v1.0_2026-07-19.md` Phase 6c.
Prerequisite: Phase 6a (multi-DB) and 6b (household routing) are deployed and
working on Predator over plain LAN — this phase only *adds* an off-LAN login
path on top of that; it changes nothing about how LAN access already works.

---

## Scope warning (read this first)

**This tunnel/Access technique is approved for Kitchen Planner only.** Predator
is the intended future host for NeoTrack Hospital EMR — nothing on that host is
exposed to the public internet without PK's explicit instruction, and approving
this technique for a household app does **not** approve it for EMR. If you ever
set up a Cloudflare Tunnel config file for NeoTrack, do not copy this one's
`ingress` block — start over, and get explicit sign-off first.

Paste this comment verbatim into the actual `cloudflared` config file you
create for this tunnel (see step 2) so future-you or anyone else who opens it
sees the warning in place, not just in a docs folder:

```yaml
# This tunnel is scoped to kitchen-planner.<your-domain> ONLY.
# Do NOT add an ingress rule here for NeoTrack or any other homelab service
# without explicit fresh sign-off — see docs/CLOUDFLARE_SETUP.md in the
# kitchenplanner repo for why. NeoTrack is a hospital EMR; nothing about
# "this worked for the kitchen app" implies it's safe for EMR.
```

---

## What this does and does not cover

- **Does**: gives RP and PS (and PK) a second way to reach Kitchen Planner —
  Google login via Cloudflare Access — for when they're off the home WiFi
  (mobile data, travel, etc). LAN access stays exactly as it is today: no
  login, fast, the default whenever someone is physically home.
- **Does not** cover a full home-internet outage. The tunnel is an outbound
  connection *from* Predator *to* Cloudflare's edge — if Predator's own
  upstream internet is down, the tunnel is down too. In that specific failure
  mode, neither the Access URL nor any "LAN-but-off-network" trick reaches the
  app; only someone physically on the home network, hitting Predator's LAN IP
  directly, still works. Worth remembering before assuming the Access URL is a
  universal fallback — it isn't, for that one failure mode.

---

## Step 1 — Pre-flight: set real emails in system.db

`migrations-system/001_init.sql` seeds `system.db`'s `users` table with
placeholder emails (`pk@household.local` etc.) — deliberately never replaced
with real ones by Claude Code, since real personal email addresses are PII
that shouldn't be guessed, fabricated, or committed to git. Before Access can
work, run these three commands against the **live** `system.db` (stop the
container first, same caution as any other live-data operation on this repo's
data files):

```sh
sqlite3 ~/homelab/kitchenplanner/data/system.db <<'EOF'
UPDATE users SET email = 'REPLACE_WITH_PKS_REAL_GOOGLE_EMAIL' WHERE display_name = 'PK';
UPDATE users SET email = 'REPLACE_WITH_RPS_REAL_GOOGLE_EMAIL' WHERE display_name = 'RP';
UPDATE users SET email = 'REPLACE_WITH_PSS_REAL_GOOGLE_EMAIL' WHERE display_name = 'PS';
SELECT display_name, email, household, is_admin FROM users;
EOF
```

These must be the exact Google account emails PK/RP/PS will use to log in via
Access in step 4 — Cloudflare Access authenticates the login, but the app only
grants access if the authenticated email matches a `users` row exactly (case
-sensitive; Google emails are lowercase, so keep these lowercase too).

No migration, no redeploy, no code change — this is a direct data edit, same
category as any other live `sqlite3` operation against `data/*.db`.

---

## Step 2 — Install `cloudflared` and create the tunnel

On Predator:

```sh
# Install (Debian/Ubuntu — adjust if Predator's base image differs)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Authenticate cloudflared against your Cloudflare account (opens a browser
# link — follow it, select your zone/domain)
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create kitchen-planner
```

This produces a tunnel UUID and a credentials JSON file (typically under
`~/.cloudflared/`). Create `~/.cloudflared/config.yml`:

```yaml
# This tunnel is scoped to kitchen-planner.<your-domain> ONLY.
# Do NOT add an ingress rule here for NeoTrack or any other homelab service
# without explicit fresh sign-off — see docs/CLOUDFLARE_SETUP.md in the
# kitchenplanner repo for why. NeoTrack is a hospital EMR; nothing about
# "this worked for the kitchen app" implies it's safe for EMR.

tunnel: <the-tunnel-uuid-from-above>
credentials-file: /home/<you>/.cloudflared/<the-tunnel-uuid>.json

ingress:
  - hostname: kitchen-planner.<your-domain>
    service: http://localhost:3010
  - service: http_status:404
```

Route DNS for the tunnel, then run it (as a system service so it survives
reboots — `cloudflared service install` handles this, or manage it under the
same process supervision Predator already uses for the container stack):

```sh
cloudflared tunnel route dns kitchen-planner kitchen-planner.<your-domain>
sudo cloudflared service install
sudo systemctl start cloudflared
```

Confirm `https://kitchen-planner.<your-domain>` reaches the app (it'll load
the normal `/pick-editor` page at this point — Access isn't configured yet, so
this URL is currently just as open as the LAN one, only reachable from
anywhere. Do not skip step 4).

---

## Step 3 — Restrict the hostname to only Kitchen Planner

Double-check in the Cloudflare dashboard (Zero Trust → Networks → Tunnels)
that this tunnel's public hostname is **only** `kitchen-planner.<your-domain>`
pointing at `http://localhost:3010`. No other hostname, no other local
service, should ever be added to this same tunnel — a second app added later
should get its own tunnel, not a second ingress rule bolted onto this one,
so a mistake in one app's config can't accidentally expose another.

---

## Step 4 — Configure Access (Google login, all three identities)

In the Cloudflare Zero Trust dashboard:

1. **Access → Applications → Add an application → Self-hosted.**
2. **Application domain**: `kitchen-planner.<your-domain>` — exactly the
   tunnel hostname from step 2, nothing broader (no wildcard, no parent
   domain).
3. **Identity providers**: enable Google (add it under Settings →
   Authentication if not already configured — standard OAuth app registration
   in Google Cloud Console, redirect URI supplied by Cloudflare's setup flow).
4. **Policies**: one policy, action **Allow**, rule: **Emails** — list all
   three real addresses from step 1 (PK's, RP's, PS's). Not a domain-wide
   rule, not "anyone with a Google account" — exactly these three emails.
5. **Session duration**: set this long (Cloudflare's dashboard exposes this
   under the application's settings, e.g. 30 days or the maximum offered).
   Nobody should have to re-authenticate every day for a household meal-
   planning app — the goal is "log in once, mostly forget this exists."
6. Save.

At this point, visiting the tunnel URL prompts a Google login, and only the
three configured emails can get past it. Everyone else sees Cloudflare's own
"you don't have access" page — they never even reach the app.

---

## Step 5 — Set the app-side env vars and redeploy

Add to your merged compose file's `kitchen-planner` service (see
`docker-compose.snippet.yml` in this repo for where these lines go):

```yaml
    environment:
      - CF_ACCESS_TEAM_DOMAIN=<your-team-name>   # the subdomain in https://<team-name>.cloudflareaccess.com
      - CF_ACCESS_AUD=<the-application-audience-tag>   # Access → Applications → this app → Overview → Application Audience (AUD) Tag
```

Both values come from the Zero Trust dashboard (Access → Applications → the
kitchen-planner app you just created → Overview tab has the AUD tag; your team
domain is under Settings → Custom Pages or visible in the Access URL itself).

Neither of these is a secret in the traditional sense (they're not usable to
impersonate anyone without also controlling Cloudflare's signing keys), but
treat them as deploy config, not something to commit into a public place.

Redeploy:
```sh
docker compose build kitchen-planner && docker compose up -d kitchen-planner
```

Until these two env vars are set, the app's Access identity path is
completely inert — `GET /health` and every existing LAN flow behave exactly
as they did in Phase 6b (verified in Claude Code's own test suite:
`test/access-identity.test.js` includes an explicit "unconfigured" test
proving a stray Access header never gates a request when these vars are
unset). Setting them only *adds* the off-LAN path; it changes nothing about
LAN behavior.

---

## Step 6 — Verify

- From a device physically on the home network: confirm the LAN URL
  (`http://192.168.78.x:3010` or whatever it's normally accessed as) still
  works with zero login, exactly as before.
- From a device off the home network (mobile data, a friend's WiFi, etc.):
  visit `https://kitchen-planner.<your-domain>`, log in with RP's Google
  account, confirm it lands on RP's household data (not PK's, not PS's).
  Repeat for PS.
- Confirm a fourth Google account (not PK/RP/PS) gets rejected with
  "this Google account isn't set up — ask PK", not silently let through.
- Install as a PWA from the Cloudflare URL if that's the plan for RP/PS's
  phones (see `docs/MANUAL.md`, updated in Phase 6d, for the actual end-user
  instructions).

**This is the amendment's explicit deploy checkpoint** — do not consider
Phase 6c complete, and do not have Claude Code proceed to Phase 6d, until
both RP and PS have successfully logged in via their own Google accounts,
from off the home network, at least once.

---

## Troubleshooting

- **"you don't have access" from Cloudflare itself** (not the app's own 403):
  the email isn't in the Access policy's allow-list (step 4), or you're
  logged into the wrong Google account in the browser.
- **App's own 403 "this Google account isn't set up — ask PK"**: Access let
  the login through (so the email passed step 4's policy), but `system.db`'s
  `users` table doesn't have a matching row — re-check step 1's `UPDATE`
  commands ran against the actual live `system.db`, not a stale copy.
- **401 "invalid or expired Cloudflare Access session"**: either the session
  genuinely expired (re-login), or `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`
  (step 5) don't match the Access application actually protecting this
  hostname — double check the AUD tag was copied from the right application
  if more than one exists in the Zero Trust dashboard.
- **LAN access broke after this phase**: it shouldn't have — nothing in this
  phase changes LAN routing or the container's port mapping. If it did, that's
  a regression worth reporting, not an expected tradeoff of adding Access.
