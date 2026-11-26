#!/usr/bin/env bash
set -euo pipefail
umask 077
# Set PGHOST, PGUSER, PGDATABASE and configure ~/.pgpass; do not pass passwords on command line.
: "${PGDATABASE:?Set PGDATABASE}"
DEST=${BACKUP_DIR:-$HOME/shiftcare-backups}
mkdir -p "$DEST"
FILE="$DEST/shiftcare-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --file="$FILE.tmp"
pg_restore --list "$FILE.tmp" >/dev/null
mv "$FILE.tmp" "$FILE"
printf '%s\n' "$FILE"
