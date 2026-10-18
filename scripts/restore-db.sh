#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# restore-db.sh — decrypt and load a Dkit backup.
#
#   restore-db.sh <dkit-....sql.gz.age> [target_db]    restore into target_db
#   restore-db.sh --verify [<backup>]                  throwaway db + auto-check
#
# --verify loads the backup into a scratch database (dkit_verify), counts rows,
# then drops it. Use it in cron if you want proof-of-restorable, or after any
# change to the backup script.
#
# Needs ~/.config/age/keys.txt (the `age` PRIVATE key). Without that file the
# backups are unreadable — so keep a copy of it somewhere safe OFF this box.
#
# If this box is gone: install age + postgres on the replacement box, put the
# key in ~/.config/age/keys.txt, restore backend/.env, then run
#     restore-db.sh <the .age file> dkit --force
#
# --force is required before overwriting a database that already has data.
# -----------------------------------------------------------------------------
set -u

ENV_FILE="$HOME/d-kit/backend/.env"
AGE_KEYS="$HOME/.config/age/keys.txt"
PGHOST=127.0.0.1
PGUSER=dkituser

usage() {
    echo "usage: $0 [--verify] [--force] <dkit-YYYYMMDD-HHMM.sql.gz.age> [target_db]"
    echo ""
    echo "  --verify   restore into a throwaway db, then drop it (safe)"
    echo "  --force    drop + recreate the target db before restoring (destroys data)"
}

VERIFY=0; FORCE=0; FILE=""; TARGET=""
while [ $# -gt 0 ]; do
    case "$1" in
        --verify) VERIFY=1 ;;
        --force)  FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "✗ unknown option: $1"; usage; exit 1 ;;
        *) if [ -z "$FILE" ]; then FILE="$1"; else TARGET="$1"; fi ;;
    esac
    shift
done

if [ -z "$TARGET" ]; then
    if [ "$VERIFY" -eq 1 ]; then TARGET=dkit_verify; else TARGET=dkit; fi
fi

[ -f "$ENV_FILE" ]  || { echo "✗ no $ENV_FILE"; exit 1; }
[ -f "$AGE_KEYS" ]  || { echo "✗ no $AGE_KEYS — put the age PRIVATE key file there first"; exit 1; }
[ -n "$FILE" ]      || { usage; exit 1; }
[ -f "$FILE" ]      || { echo "✗ no such file: $FILE"; exit 1; }
[ -s "$FILE" ]      || { echo "✗ empty file: $FILE"; exit 1; }

PGPASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
export PGPASSWORD
PSQL="psql -h $PGHOST -U $PGUSER"

# Prove the key can actually decrypt before doing anything destructive.
if ! age -d -i "$AGE_KEYS" "$FILE" 2>/dev/null | head -c 8 | grep -q .; then
    echo "✗ cannot decrypt $FILE with $AGE_KEYS (wrong/missing key?)"
    exit 1
fi

EXISTS="$($PSQL -d postgres -tAc "SELECT count(*) FROM pg_database WHERE datname='$TARGET'")"
TABLES=0
if [ "$EXISTS" -gt 0 ]; then
    TABLES="$($PSQL -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" -d "$TARGET")"
fi

if [ "$VERIFY" -eq 1 ]; then
    if [ "$EXISTS" -eq 0 ]; then
        echo "==> creating scratch db $TARGET"
        $PSQL -d postgres -c 'CREATE DATABASE "'"$TARGET"'"' >/dev/null \
            || { echo "✗ cannot create scratch db"; exit 1; }
    fi
elif [ "$FORCE" -eq 1 ]; then
    echo "==> dropping + recreating $TARGET (--force; current data destroyed)"
    [ "$EXISTS" -gt 0 ] && { $PSQL -d postgres -c 'DROP DATABASE "'"$TARGET"'"' >/dev/null; }
    $PSQL -d postgres -c 'CREATE DATABASE "'"$TARGET"'"' >/dev/null \
        || { echo "✗ could not create $TARGET"; exit 1; }
elif [ "$EXISTS" -eq 0 ]; then
    echo "==> creating $TARGET"
    $PSQL -d postgres -c 'CREATE DATABASE "'"$TARGET"'"' >/dev/null \
        || { echo "✗ could not create $TARGET"; exit 1; }
elif [ "$TABLES" -gt 0 ]; then
    echo "✗ refusing to overwrite '$TARGET' ($TABLES tables already present)."
    echo "  Add --force to drop + recreate it (destroys current data)."
    exit 1
fi

echo "==> decrypting + restoring into $TARGET"
if ! age -d -i "$AGE_KEYS" "$FILE" \
        | gunzip -c \
        | $PSQL -v ON_ERROR_STOP=1 -d "$TARGET" >/dev/null; then
    echo "✗ restore failed (decrypt / gunzip / psql error — see output above)"
    exit 1
fi

TABLES="$($PSQL -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" -d "$TARGET")"

if [ "$VERIFY" -eq 1 ]; then

    DETAIL="$($PSQL -tAc "SELECT (SELECT count(*) FROM users)||' users / '||(SELECT count(*) FROM projects)||' projects / '||(SELECT count(*) FROM env_vars)||' secrets'" -d "$TARGET")"
    echo "    restored $TABLES tables — $DETAIL"
    if [ "$TABLES" -lt 20 ]; then
        echo "✗ restore looks incomplete ($TABLES tables, expected ~26)"
        exit 1
    fi
    $PSQL -d postgres -c 'DROP DATABASE "'"$TARGET"'"' >/dev/null
    echo "✓ restore verified — this backup is genuinely restorable."
else
    echo "✓ restored $TABLES tables into '$TARGET'."
    systemctl --quiet is-enabled dkit-api 2>/dev/null && systemctl restart dkit-api \
        && echo "  (restarted dkit-api)"
fi
