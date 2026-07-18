#!/bin/sh
# scripts/backup-preflight.sh — read-only checks that scripts/backup.sh's daily
# cron job will actually work, without installing or modifying the cron itself
# (that's PK's manual step — see OPERATIONS.md "Backup"). Audit 2026-07-18,
# threat: backups weren't actually running — no cron entry, no sqlite3 CLI on
# the host, and a single drill backup were all true at once, and none of that
# was visible without checking three separate things by hand. Run this before
# trusting that the cron entry below is doing anything.
set -eu

DATA_DIR="${KITCHEN_DATA_DIR:-$(dirname "$0")/../data}"
BACKUP_DIR="$DATA_DIR/backups"
FAIL=0

check() {
  if [ "$1" = "0" ]; then
    echo "OK   $2"
  else
    echo "FAIL $2"
    FAIL=1
  fi
}

echo "=== Backup preflight ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="

# 1. sqlite3 binary present — backup.sh shells out to `sqlite3 <db> ".backup"`;
#    it is not bundled in the app's own node_modules.
if command -v sqlite3 >/dev/null 2>&1; then
  check 0 "sqlite3 CLI found: $(command -v sqlite3)"
else
  check 1 "sqlite3 CLI not found on PATH — install with: apt-get install sqlite3"
fi

# 2. backup dir exists (or can be created, matching backup.sh's own mkdir -p)
#    and is writable by the current user.
mkdir -p "$BACKUP_DIR" 2>/dev/null || true
if [ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ]; then
  check 0 "backup dir writable: $BACKUP_DIR"
else
  check 1 "backup dir missing or not writable: $BACKUP_DIR"
fi

# 3. at least one *.db file actually exists to back up.
DB_COUNT=$(find "$DATA_DIR" -maxdepth 1 -name '*.db' 2>/dev/null | wc -l | tr -d ' ')
if [ "$DB_COUNT" -gt 0 ]; then
  check 0 "$DB_COUNT database file(s) found in $DATA_DIR"
else
  check 1 "no *.db files found in $DATA_DIR — nothing for backup.sh to back up"
fi

# 4. a cron entry exists for the current user and references backup.sh, with
#    at least 5 schedule fields + a command. This is a cheap sanity check, not
#    a full cron-syntax validator — crontab itself is the final authority on
#    whether the schedule fields themselves are valid.
if command -v crontab >/dev/null 2>&1; then
  CRONTAB_OUT="$(crontab -l 2>/dev/null || true)"
  CRON_LINE="$(printf '%s\n' "$CRONTAB_OUT" | grep -v '^[[:space:]]*#' | grep 'backup.sh' || true)"
  if [ -n "$CRON_LINE" ]; then
    NF=$(printf '%s\n' "$CRON_LINE" | awk '{print NF}')
    if [ "$NF" -ge 6 ]; then
      check 0 "cron entry found for $(whoami): $CRON_LINE"
    else
      check 1 "cron entry found but has too few fields to be a valid <5-field schedule><command>: $CRON_LINE"
    fi
  else
    check 1 "no crontab entry referencing backup.sh for $(whoami) — backups are not scheduled (see OPERATIONS.md 'Backup' for the line to add; this script never installs it)"
  fi
else
  check 1 "crontab command not found — cannot check for a scheduled backup"
fi

echo "==="
if [ "$FAIL" = "0" ]; then
  echo "All checks passed."
else
  echo "One or more checks failed — see FAIL lines above."
fi
exit "$FAIL"
