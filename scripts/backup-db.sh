#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# backup-db.sh — protect the two things on this box that cannot be regenerated.
#
#   1. the Postgres `dkit` database  (users, projects, env secrets + history)
#   2. backend/.env                  (DB / JWT / Resend / OAuth secrets)
#
# BOTH are encrypted with `age` before they can be read anywhere, because the
# database stores env values and env history in PLAINTEXT.
#
# The `age` PRIVATE key that can decrypt these lives at ~/.config/age/keys.txt.
# *** Copy that file into a password manager. If this box dies and you do not
#     have that key off-box, the backups cannot be opened. ***
#
# Off-box copy (optional, but this is the whole point): ~/.config/dkit-backup.env
#       REMOTE=rclone-remote-name:bucket-name
#       REMOTE_KEEP=720       # newest N snapshots (hourly, 30 days)
#       NOTIFY_EMAIL=you@...  # get an email if a run fails
#
# Cron:  15 * * * * $HOME/d-kit/scripts/backup-db.sh >> $HOME/backup.log 2>&1
# Log:   ~/backup.log
# -----------------------------------------------------------------------------
set -o pipefail
set -u

# cron's PATH is minimal (/usr/bin:/bin) and would pick the distro's ancient
# rclone; the R2-capable build lives in /usr/local/bin.
export PATH="/usr/local/bin:/usr/bin:/bin"

DKIT_DIR="$HOME/d-kit"
ENV_FILE="$DKIT_DIR/backend/.env"
BACKUP_DIR="$HOME/backups"
AGE_KEYS="$HOME/.config/age/keys.txt"
STAMP="$(date +%Y%m%d-%H%M)"
LOCAL_KEEP=4

REMOTE=""
REMOTE_KEEP=30
NOTIFY_EMAIL=""
[ -f "$HOME/.config/dkit-backup.env" ] && . "$HOME/.config/dkit-backup.env"

fail() {
    echo "[$(date '+%F %T')] ✗ BACKUP FAILED: $1" >> "$HOME/backup.log"
    if [ -n "$NOTIFY_EMAIL" ] && [ -f "$ENV_FILE" ]; then
        KEY="$(grep -E '^RESEND_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
        if [ -n "$KEY" ]; then
            SAFEMSG="${1//\"/}"
            BODY="{\"from\":\"Dkit <noreply@dkit.name.ng>\",\"to\":[\"$NOTIFY_EMAIL\"],\"subject\":\"Dkit backup FAILED on $(hostname)\",\"text\":\"Backup failed at $STAMP: $SAFEMSG. Check ~/backup.log on the server.\"}"
            if curl -sf -m 20 https://api.resend.com/emails \
                -H "Authorization: Bearer $KEY" \
                -H 'Content-Type: application/json' \
                -d "$BODY" >/dev/null 2>&1; then
                echo "[$(date '+%F %T')]   (notice emailed to $NOTIFY_EMAIL)" >> "$HOME/backup.log"
            else
                echo "[$(date '+%F %T')]   (warning: could not send notice email)" >> "$HOME/backup.log"
            fi
        fi
    fi
    exit 1
}

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found"
[ -f "$AGE_KEYS" ] || fail "$AGE_KEYS not found — run: age-keygen -o $AGE_KEYS"
PUBKEY="$(grep -oE 'age1[0-9a-z]+' "$AGE_KEYS" | head -1)"
[ -n "$PUBKEY" ] || fail "no age public key found in $AGE_KEYS"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
OUT_DB="$BACKUP_DIR/dkit-$STAMP.sql.gz.age"
OUT_ENV="$BACKUP_DIR/env-$STAMP.age"

# --- 1. dump -> gzip -> encrypt ---------------------------------------------
PGPASSWORD="$DB_PASSWORD" pg_dump --no-owner --no-privileges \
     -h 127.0.0.1 -U dkituser -d dkit \
     | gzip \
     | age -r "$PUBKEY" > "$OUT_DB" \
  || fail "pg_dump | gzip | age encrypt failed"
age -r "$PUBKEY" "$ENV_FILE" > "$OUT_ENV" 2>"$BACKUP_DIR/.stderr.last" \
  || fail "age encrypt of backend/.env failed"
chmod 600 "$OUT_DB" "$OUT_ENV"
rm -f "$BACKUP_DIR/.stderr.last"

# --- 2. prove it round-trips: decrypt and confirm it is a Postgres dump -----
PROBE="$( age -d -i "$AGE_KEYS" "$OUT_DB" 2>/dev/null \
        | gunzip -c 2>/dev/null \
        | head -c 64 )" || true
[ -n "$PROBE" ] || fail "encrypted dump will not decrypt with the private key"
printf '%s' "$PROBE" | grep -qE '^(PGDMP|--)' \
  || fail "decrypted dump does not look like a Postgres dump"

# --- 3. off-box copy + rotate ----------------------------------------------
if [ -n "$REMOTE" ]; then
    rclone copy "$OUT_DB"  "${REMOTE}/db/"  --quiet 2>>"$HOME/backup.log" \
      || fail "rclone upload of $(basename "$OUT_DB") to $REMOTE/db/ failed"
    rclone copy "$OUT_ENV" "${REMOTE}/env/" --quiet 2>>"$HOME/backup.log" \
      || fail "rclone upload of $(basename "$OUT_ENV") to $REMOTE/env/ failed"
    echo "[$(date '+%F %T')]   shipped to $REMOTE" >> "$HOME/backup.log"

    rclone lsf "${REMOTE}/db/" --files-only 2>>"$HOME/backup.log" | sort -r \
        | tail -n +"$((REMOTE_KEEP + 1))" \
        | while IFS= read -r f; do
            [ -n "$f" ] && rclone deletefile "${REMOTE}/db/${f}" --quiet 2>>"$HOME/backup.log" || true
          done
    rclone lsf "${REMOTE}/env/" --files-only 2>>"$HOME/backup.log" | sort -r \
        | tail -n +"$((REMOTE_KEEP + 1))" \
        | while IFS= read -r f; do
            [ -n "$f" ] && rclone deletefile "${REMOTE}/env/${f}" --quiet 2>>"$HOME/backup.log" || true
          done
fi

# --- 4. local rotation (keeps 4 of each) -----------------------------------
ls -1t "$BACKUP_DIR"/dkit-*.age 2>/dev/null | tail -n +"$((LOCAL_KEEP + 1))" | xargs -r rm -f --
ls -1t "$BACKUP_DIR"/env-*.age  2>/dev/null | tail -n +"$((LOCAL_KEEP + 1))" | xargs -r rm -f --

DBSZ="$(du -h "$OUT_DB" | cut -f1)"
echo "[$(date '+%F %T')] backup ok: $OUT_DB ($DBSZ)" >> "$HOME/backup.log"

# --- 5. daily success digest (one email a day, not 24) ---------------------
# Runs only on the DIGEST_HOUR UTC cron run (default 06).DIGEST_HOUR can be
# overridden in the environment to force a real test send.
if [ -n "$NOTIFY_EMAIL" ] && [ "$(date -u +%H)" = "${DIGEST_HOUR:-06}" ] && [ -f "$ENV_FILE" ]; then
    NDB="$(find "$BACKUP_DIR" -name 'dkit-*.age' -mmin -1440 2>/dev/null | wc -l)"
    NENV="$(find "$BACKUP_DIR" -name 'env-*.age' -mmin -1440 2>/dev/null | wc -l)"
    REMOTE_STATE="not configured (local disk only)"
    [ -n "$REMOTE" ] && REMOTE_STATE="shipped to $REMOTE"
    KEY="$(grep -E '^RESEND_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
    if [ -n "$KEY" ]; then
        TEXT="Last 24h on $(hostname): $NDB database snapshot(s), $NENV .env snapshot(s), newest $(basename "$OUT_DB") ($DBSZ). Off-box: $REMOTE_STATE."
        BODY="{\"from\":\"Dkit <noreply@dkit.name.ng>\",\"to\":[\"$NOTIFY_EMAIL\"],\"subject\":\"✅ Dkit backup digest — snapshots healthy\",\"text\":\"$TEXT\"}"
        if curl -sf -m 20 https://api.resend.com/emails \
            -H "Authorization: Bearer $KEY" \
            -H 'Content-Type: application/json' \
            -d "$BODY" >/dev/null 2>&1; then
            echo "[$(date '+%F %T')]   (daily digest emailed to $NOTIFY_EMAIL)" >> "$HOME/backup.log"
        else
            echo "[$(date '+%F %T')]   (warning: daily digest email failed)" >> "$HOME/backup.log"
        fi
    fi
fi
