#!/bin/sh
# scripts/phase6a-migrate-data.sh — PK runs this manually, once, against the
# live data volume. Not run by Claude, not run by CI, not run automatically on
# deploy. See docs/KitchenPlanner_Phase6_Amendment_v1.0_2026-07-19.md Phase 6a.
#
# Does exactly one thing: renames data/kitchen.db (+ -wal/-shm sidecars, if
# present) to data/rp.db. It does NOT create data/ps.db or data/system.db —
# server.js's own bootstrap creates and seeds those on next start (see
# src/db/households.js / server.js), so this script stays a pure rename with
# no SQLite logic of its own to get wrong.
#
# Preconditions this script checks but does not enforce for you:
#   1. The kitchen-planner container must be STOPPED before running this
#      (WAL-mode SQLite + a live writer mid-rename is exactly the kind of
#      thing that corrupts a db — don't risk it for a rename that costs
#      nothing to do safely).
#   2. Take a backup first. This script does not take one for you.
set -eu

DATA_DIR="${KITCHEN_DATA_DIR:-$(dirname "$0")/../data}"

if [ ! -f "$DATA_DIR/kitchen.db" ]; then
  echo "No $DATA_DIR/kitchen.db found — already migrated, or nothing to do. Exiting." >&2
  exit 0
fi

if [ -f "$DATA_DIR/rp.db" ]; then
  echo "ERROR: $DATA_DIR/rp.db already exists — refusing to overwrite. Investigate before re-running." >&2
  exit 1
fi

echo "About to rename:"
echo "  $DATA_DIR/kitchen.db      -> $DATA_DIR/rp.db"
[ -f "$DATA_DIR/kitchen.db-wal" ] && echo "  $DATA_DIR/kitchen.db-wal  -> $DATA_DIR/rp.db-wal"
[ -f "$DATA_DIR/kitchen.db-shm" ] && echo "  $DATA_DIR/kitchen.db-shm  -> $DATA_DIR/rp.db-shm"
echo
echo "Confirm the kitchen-planner container is STOPPED and you've taken a backup"
echo "(scripts/backup.sh, or a manual copy of $DATA_DIR/kitchen.db*) before continuing."
printf "Type 'yes' to proceed: "
read -r confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted, nothing changed." >&2
  exit 1
fi

mv "$DATA_DIR/kitchen.db" "$DATA_DIR/rp.db"
[ -f "$DATA_DIR/kitchen.db-wal" ] && mv "$DATA_DIR/kitchen.db-wal" "$DATA_DIR/rp.db-wal"
[ -f "$DATA_DIR/kitchen.db-shm" ] && mv "$DATA_DIR/kitchen.db-shm" "$DATA_DIR/rp.db-shm"

echo "Done. Next steps:"
echo "  1. Restart the kitchen-planner container."
echo "  2. Watch GET /health — confirm ok:true, migration is the latest version."
echo "  3. KITCHEN_DB=$DATA_DIR/rp.db node seed/verify.js --summary"
echo "     KITCHEN_DB=$DATA_DIR/ps.db node seed/verify.js --summary"
echo "  4. Confirm data/ps.db and data/system.db now exist (created on server boot)."
