#!/bin/bash
# Disk hygiene for a 6.7GB VPS that has hit 92-99% and caused real outages.
# Run daily via cron (see install instructions below). Logs to
# ~/disk-check.log so `tail -f` gives a running history without needing to
# re-run this manually to check status.

set -u

LOG_FILE="$HOME/disk-check.log"
THRESHOLD=80
DKIT_DIR="$HOME/d-kit"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

USAGE=$(df -h "$HOME" | awk 'NR==2 {gsub("%","",$5); print $5}')
log "Disk usage: ${USAGE}%"

# Clean up the specific clutter this project has repeatedly accumulated:
# stray nested backup archives left in the repo root from earlier manual
# tar/zip commands (harmless individually, but they've shown up more than
# once and each one is real, permanent disk usage doing nothing).
if [ -d "$DKIT_DIR" ]; then
  STRAY=$(find "$DKIT_DIR" -maxdepth 1 -name "*.tar.gz" -o -maxdepth 1 -name "*.zip" 2>/dev/null)
  if [ -n "$STRAY" ]; then
    log "Removing stray archives found in repo root:"
    echo "$STRAY" | while read -r f; do
      log "  - $f ($(du -h "$f" | cut -f1))"
      rm -f "$f"
    done
  fi
fi

if [ "$USAGE" -ge "$THRESHOLD" ]; then
  log "WARNING: disk usage at ${USAGE}%, threshold is ${THRESHOLD}%"
  log "Largest items under $DKIT_DIR:"
  du -sh "$DKIT_DIR"/* 2>/dev/null | sort -rh | head -10 >> "$LOG_FILE"
  log "Largest pm2 log files:"
  du -sh "$HOME"/.pm2/logs/* 2>/dev/null | sort -rh | head -5 >> "$LOG_FILE"
fi
