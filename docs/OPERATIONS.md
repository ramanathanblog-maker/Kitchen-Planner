# Kitchen Knowledge Planner — Operations Runbook

v1.0 — 2026-07-18

This is the single ops runbook (CLAUDE.md A4: exactly one OPERATIONS.md, updated in place, never forked). Audience: PK, operating this as a homelab service on Predator.

## Contents
- Start / stop
- Migrate
- Seed / taxonomy-update procedure
- Backup / restore (incl. the executed drill transcript)
- Folder-copy migration to another host
- Troubleshooting
- Predator deployment
- §Smoke-Test (Phase 4, unchanged)

---

## Start / stop

**Local (no Docker), for development or a quick check:**
```
npm ci
node src/db/migrate.js     # applies any unapplied migrations, safe to re-run
node seed/load.js          # loads/updates seed-origin taxonomy rows, safe to re-run
node server.js              # listens on $KITCHEN_PORT (default 3010)
```
Stop with Ctrl-C, or `kill` the process — there's no separate stop script; the process holds the SQLite WAL files and shuts down cleanly on SIGTERM/SIGINT.

**Docker (production, on Predator):**
```
docker compose up -d kitchen-planner      # start
docker compose restart kitchen-planner    # restart
docker compose stop kitchen-planner       # stop, keeps the container
docker compose logs -f kitchen-planner    # tail logs
```
The container runs `migrate()` on every boot (`server.js` calls it before `app.listen`), so a restart after a code update that includes new migration files applies them automatically. Seeding is **not** automatic — run it manually after a taxonomy JSON change (see below).

---

## Migrate

Migrations live in `/migrations/*.sql`, applied in filename order, tracked in the `schema_migrations` table (one row per applied file, never re-applied). They are append-only — once a migration file has been applied anywhere, it is never edited; a schema change ships as a new numbered file.

```
node src/db/migrate.js
```
Safe to run any number of times — already-applied files are skipped. `GET /health`'s `migration` field reports the most recently applied filename, so after a deploy you can confirm the new migration actually landed without opening the DB by hand.

---

## Seed / taxonomy-update procedure

The taxonomy (ingredients, dish families, dish items) is authored as JSON, never edited directly in the DB. The **only** input `seed/load.js` reads is `seed/taxonomy-comprehensive.json` — prose docs are never consulted by the loader (CLAUDE.md A1).

1. **Edit the canonical JSON** — the source of truth lives outside this repo in the taxonomy design docs' companion working copy; make your edits there first (family/item additions, ingredient changes, rule tweaks), bump the top-level `"version"` field.
2. **Copy it into `seed/`** — overwrite `seed/taxonomy-comprehensive.json` with the edited file.
3. **Load it**:
   ```
   node seed/load.js
   ```
   This is an upsert: seed-origin rows (`origin='seed'`) are updated/inserted keyed on the JSON's stable `external_id`; a family/item/ingredient a household member has since hand-edited (`origin='user'`) is never touched. Rows retired from the JSON (a family/item that used to exist and no longer does) are removed if they're still seed-origin and have no user data hanging off them — see `seed/load.js`'s `StaleRowError` handling if that check fails, it means something needs manual attention before the row can be dropped.
4. **Verify**:
   ```
   node seed/verify.js --summary
   ```
   Re-reads the JSON and the DB and reports any divergence (missing/extra/mismatched seed-origin rows), keyed on `external_id`. `No divergence found.` is the expected clean result; `--summary` additionally prints the full family tree with item counts per family, useful for eyeballing that a reseed did what you expected.
5. **Confirm via `/health`** — `taxonomy_version` and `taxonomy_json_sha256` reflect exactly what's loaded, so after a deploy you can `curl localhost:3010/health` and confirm the running container actually picked up the new JSON (both fields are written by `seed/load.js`'s `upsertSetting` calls, from the JSON's own `version` field and a SHA-256 of the raw file).

---

## Backup / restore

### Backup

`scripts/backup.sh` backs up every `*.db` file in the data directory (not hard-coded to `kitchen.db` — Phase 6 splits this into `rp.db`/`ps.db`/`system.db`, see `docs/ROADMAP_V2.md`, and this script doesn't need to change when that lands).

```
KITCHEN_DATA_DIR=./data ./scripts/backup.sh
```
(`KITCHEN_DATA_DIR` defaults to `<script dir>/../data` if unset — in the Docker deployment that's `/app/data`, matching the compose volume mount, so inside the container you can just run `./scripts/backup.sh` with no env var.)

Each `<name>.db` in the data dir is backed up to `data/backups/<name>-YYYY-MM-DD.db` via `sqlite3 <db> ".backup <dest>"` — SQLite's online backup API, safe to run against a live WAL-mode DB while the app is still writing to it (unlike `cp`, which can copy a torn snapshot mid-write). The last 14 backups per source db are kept; older ones are pruned automatically on every run.

**Requires the `sqlite3` CLI** to be installed on the host (or inside the container, if run via `docker compose exec`). It is not bundled in the app's own `node_modules` — `apt-get install sqlite3` on Predator if it's not already present.

**Cron (PK's manual step — not installed by this script or by Claude):**
```
# crontab -e, as the user that owns ~/homelab/kitchen-planner/data
0 3 * * * cd ~/homelab/kitchen-planner && KITCHEN_DATA_DIR=./data ./scripts/backup.sh >> ./data/backups/backup.log 2>&1
```
Daily at 3am, log appended so a failed run is visible without cron's own mail setup. If running against the Dockerized deployment, either run the cron job on the host against the bind-mounted `./data` directory directly (works fine — SQLite doesn't care whether the reader is inside or outside the container, only that it uses the backup API, not a raw file copy of a live db), or `docker compose exec kitchen-planner ./scripts/backup.sh`.

### Restore

```
# stop the app first so nothing writes to kitchen.db while you swap it in
docker compose stop kitchen-planner        # or: kill the local node process
cp data/backups/kitchen-<date>.db data/kitchen.db
rm -f data/kitchen.db-wal data/kitchen.db-shm   # stale WAL/SHM from the old db, if present
docker compose start kitchen-planner       # or: node server.js
curl localhost:3010/health                 # confirm db:"ready" and a sane migration/taxonomy_version
```

### Restore drill — actually executed, 2026-07-18

Run against a scratch copy (`/tmp/kp-drill`, outside the repo, deleted after) seeded with real data — the full 78-ingredient/199-item/58-family taxonomy plus one manually-inserted `plans` row, so the drill also proves user data (not just seed data) survives.

```
$ node -e "
const { openDb } = require('./src/db/connection');
const { migrate } = require('./src/db/migrate');
const { seed } = require('./seed/load');
const db = openDb();  // KITCHEN_DB=/tmp/kp-drill/data/kitchen.db
migrate(db);
seed(db);
db.close();
console.log('scratch db seeded');
"
scratch db seeded

$ sqlite3 /tmp/kp-drill/data/kitchen.db \
    "INSERT INTO plans (date, slot, dish_item_id, ordering) SELECT '2026-07-20', 'morning', id, 0 FROM dish_items WHERE external_id='dish_001';"

=== 1. Baseline row counts (before backup) ===
$ sqlite3 data/kitchen.db "SELECT 'ingredients', COUNT(*) FROM ingredients UNION ALL SELECT 'dish_items', COUNT(*) FROM dish_items UNION ALL SELECT 'dish_families', COUNT(*) FROM dish_families UNION ALL SELECT 'dish_item_ingredients', COUNT(*) FROM dish_item_ingredients;"
ingredients|78
dish_items|199
dish_families|58
dish_item_ingredients|199

=== spot-check query (before) ===
$ sqlite3 data/kitchen.db "SELECT external_id, name_en FROM dish_items WHERE external_id = 'dish_001';"
dish_001|Murungakkai Vathakozhambu

=== 2. Run backup.sh against scratch data dir ===
$ KITCHEN_DATA_DIR=/tmp/kp-drill/data ./scripts/backup.sh
backed up /tmp/kp-drill/data/kitchen.db -> /tmp/kp-drill/data/backups/kitchen-2026-07-18.db

=== 3. Simulate disaster: delete the live db (+ wal/shm) ===
$ rm -f data/kitchen.db data/kitchen.db-wal data/kitchen.db-shm
$ sqlite3 data/kitchen.db "SELECT COUNT(*) FROM ingredients;"
Error: in prepare, no such table: ingredients      # confirms data is actually gone, not just locked

=== 4. Restore from the most recent backup ===
$ rm -f data/kitchen.db
$ cp data/backups/kitchen-2026-07-18.db data/kitchen.db

=== 5. Verify: row counts after restore ===
$ sqlite3 data/kitchen.db "SELECT 'ingredients', COUNT(*) FROM ingredients UNION ALL SELECT 'dish_items', COUNT(*) FROM dish_items UNION ALL SELECT 'dish_families', COUNT(*) FROM dish_families UNION ALL SELECT 'dish_item_ingredients', COUNT(*) FROM dish_item_ingredients UNION ALL SELECT 'plans', COUNT(*) FROM plans;"
ingredients|78
dish_items|199
dish_families|58
dish_item_ingredients|199
plans|1                                             # the manually-inserted user row survived too

=== 6. Spot-check query after restore (matches step 1) ===
$ sqlite3 data/kitchen.db "SELECT external_id, name_en FROM dish_items WHERE external_id = 'dish_001';"
dish_001|Murungakkai Vathakozhambu

=== 7. Verify the user-entered plans row survived the backup/restore ===
$ sqlite3 data/kitchen.db "SELECT date, slot FROM plans;"
2026-07-20|morning

=== 8. App boots against the restored db and /health confirms it ===
$ KITCHEN_DB=/tmp/kp-drill/data/kitchen.db KITCHEN_PORT=13011 node server.js &
Kitchen Knowledge Planner listening on :13011
$ curl -s http://localhost:13011/health
{"ok":true,"db":"ready","migration":"006_meal_patterns.sql","taxonomy_version":"1.7","taxonomy_json_sha256":"1d7b6bfd96fc7b477cb4b4f06e0b6be086d042a245858b86777c595e55a8986f"}
```

All row counts, the spot-check query, and the user-entered `plans` row matched exactly before and after. **Restore verified working end-to-end**, including the running app confirming a healthy DB via `/health` against the restored file.

(Note: this sandbox had no `sqlite3` CLI preinstalled and no root to `apt install` it — the drill above used `apt-get download sqlite3 && dpkg-deb -x ... ` to extract the binary into a user-local path without root, purely to run this drill. Predator, a full Ubuntu Server install, should have `sqlite3` available via a normal `apt-get install sqlite3` as PK, or may already have it.)

---

## Folder-copy migration to another host

The whole app is one directory + one SQLite file (well, `*.db` files, plural after Phase 6) — no external DB server, no separate config store beyond `.env`/`KITCHEN_DB`/`KITCHEN_PORT`. To move it:

1. On the old host: stop the container (`docker compose stop kitchen-planner`), then `./scripts/backup.sh` for a clean snapshot (or just `cp` the `.db` files once the process is confirmed stopped and not writing).
2. `rsync -a` (or `scp -r`) the whole `~/homelab/kitchen-planner/` directory — code and `data/` both — to the new host at the same relative path under its own `~/homelab/`.
3. On the new host: `docker compose build kitchen-planner && docker compose up -d kitchen-planner` (merge the `kitchen-planner:` block from `docker-compose.snippet.yml` into the new host's compose file first, same as the initial Predator deploy below).
4. `curl localhost:${KITCHEN_PORT:-3010}/health` — confirm `db:"ready"`, and that `migration`/`taxonomy_version` match what the old host reported before the move (nothing should have changed in transit; if `migration` is *older* than expected, the new host's image predates a migration file that was already applied on the old host's data — rebuild the image from the same commit as the old host was running).

No database export/import step, no schema translation — the `.db` file *is* the portable unit.

---

## Troubleshooting

**`/health` shows `db: "pending"`, `migration: null`** — this was the Phase 0 stub's *only* possible response, returned unconditionally regardless of actual DB state. If you ever see this shape again on a build that should have Phase 5's real `/health` (this file's §Real `/health`), it means a stale process from before the Phase 5 deploy is still the one answering requests on that port — most likely an old `node server.js` process, or an old Docker image, that never got restarted after the code update. This exact symptom caused a stale-build misdiagnosis earlier in this project (debugging a "DB not connecting" ghost that was actually just an old process still listening). Fix: `docker compose up -d --build kitchen-planner` (forces a rebuild + restart) or, locally, find and kill the stale `node server.js`/`node src/db/migrate.js` process (`pgrep -af server.js`) and restart it.

**`/health` returns HTTP 503, `{"ok":false,"db":"error",...}`** — the DB connection itself is broken (e.g., the file is missing, corrupted, or the container's volume mount didn't land). Check `docker compose logs kitchen-planner` for the underlying SQLite error in `error`, and confirm the `./data` bind mount exists and is writable by the `kitchen` user the container runs as (Dockerfile creates it non-root — a host-side permission mismatch on `./data` after a fresh `git clone` is the most common cause).

**A taxonomy edit doesn't show up after `node seed/load.js`** — check `node seed/verify.js --summary` for divergence first; if it reports `No divergence found.` but the app still looks stale, you're hitting the same "stale process" symptom above — the load script updated the DB file correctly, but the running server process (or an old container) never picked it up. Restart it.

**A household member's manual taxonomy edit got overwritten by a reseed** — shouldn't happen: `seed/load.js` only touches `origin='seed'` rows, never `origin='user'`. If it did, that's a bug, not expected behavior — check the row's `origin` column and file it.

---

## Predator deployment

**Environment:** Dell OptiPlex 7060, bare-metal Ubuntu Server + Docker. LAN `192.168.78.x`. Kitchen Planner is reserved port **3010** (3000 and 5433 are taken by NeoTrack dev on the same host — see the root `CLAUDE.md`).

**Compose merge (PK's manual step):** copy the `kitchen-planner:` service block from this repo's `docker-compose.snippet.yml` into `~/homelab/docker-compose.yml`'s existing `services:` section (do not paste a second top-level `services:` key). The build context (`build: ./kitchen-planner`) assumes this repo is checked out at `~/homelab/kitchen-planner/` — adjust the path if it lives elsewhere. Then:
```
cd ~/homelab
docker compose up -d --build kitchen-planner
curl localhost:3010/health
```

**Phone access:** any phone on the same LAN reaches it at `http://<predator-LAN-IP>:3010` (find Predator's current LAN IP with `ip addr show` on Predator, or its usual DHCP-assigned address — not the Tailscale IP, which is for PK's own remote access, not RP/PS's day-to-day phone use). Install-to-home-screen works from there — see `MANUAL.md` for the PWA install steps.

**Homepage widget:** point a custom-API widget at `http://<predator-LAN-IP>:3010/api/display/today` and `/api/display/shopping` — both are deliberately mounted outside `editorMiddleware` (no `X-Editor` header required), since the dashboard has no household member sitting at a keyboard to pick an identity. `/api/display/today` returns the day's planned/actual/none status per slot; `/api/display/shopping` returns the tomorrow/week ingredient roll-up (today's date is never included in either — see `MANUAL.md`'s shopping-list note).

**Kiosk display:** `http://<predator-LAN-IP>:3010/display` is the full-page, auto-refreshing kiosk view (same underlying data as the Homepage widgets, rendered as a standalone page) — point the dashboard monitor's browser at this URL directly rather than embedding it, if a full-screen view is preferred over the Homepage widget tiles.

---

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

Phase 5's fresh-clone drill (below, this file's companion section is the drill transcript itself, pasted into the Phase 5 completion report and this file's git history) covers the previously-unverified "runs inside Docker Compose, data persists across restarts" bullet. Real-device/browser items (375px layout, dark mode, PWA installability) remain unverified by this session — no browser or phone available here; verify by hand on a real device before relying on them.
