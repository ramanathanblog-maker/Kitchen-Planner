#!/bin/sh
# scripts/backup.sh — online-safe SQLite backup for every *.db in the data dir.
#
# Iterates over all *.db files rather than hard-coding kitchen.db: Phase 6 splits
# this into data/rp.db + data/ps.db + data/system.db (see docs/ROADMAP_V2.md), and
# this script should not need to change when that lands.
#
# Uses `sqlite3 <db> ".backup <dest>"`, which goes through SQLite's online backup
# API — safe to run against a live WAL-mode DB with the app still writing to it,
# unlike `cp`, which can copy a torn/inconsistent snapshot mid-write.
#
# Retention: keeps the last 14 backups per source db (matched by filename prefix),
# oldest deleted first.
set -eu

DATA_DIR="${KITCHEN_DATA_DIR:-$(dirname "$0")/../data}"
BACKUP_DIR="$DATA_DIR/backups"
KEEP=14
DATE="$(date +%Y-%m-%d)"

mkdir -p "$BACKUP_DIR"

for db in "$DATA_DIR"/*.db; do
  [ -e "$db" ] || continue
  name="$(basename "$db" .db)"
  dest="$BACKUP_DIR/${name}-${DATE}.db"
  sqlite3 "$db" ".backup '$dest'"
  echo "backed up $db -> $dest"

  # Prune: keep only the $KEEP most recent backups for this source db.
  ls -1t "$BACKUP_DIR/${name}"-*.db 2>/dev/null | tail -n "+$((KEEP + 1))" | while IFS= read -r stale; do
    rm -f "$stale"
    echo "pruned $stale"
  done
done
