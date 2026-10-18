# As-built deploy notes (bun + systemd, hardened)

This box was set up from the migration archive, but **not** with the original
`migrate-bootstrap.sh`. That script assumes npm + pm2 + root. This deployment
uses **bun**, **systemd**, a dedicated non-root user, and a firewall. Nothing
about the app changed except one line (see below).

Everything still lines up with `VPS-SETUP.md` / `MIGRATION.md` conceptually:
Postgres + Redis on localhost, one Express process serving the API and the
built site on :3001, Cloudflare tunnel in front, no nginx.

## Layout

| Thing | Where |
|---|---|
| Code | `/home/dkit/d-kit` (owned by `dkit`) |
| Secrets | `/home/dkit/d-kit/backend/.env` (mode 600, loaded by dotenv) |
| Bun | `/usr/local/bin/bun` (system-wide, so the service user can run it) |
| API service | `dkit-api.service` (bun, `User=dkit`, enabled + running) |
| Tunnel service | `dkit-tunnel.service` (enabled + running — cutover done 2026-10-16) |
| Tunnel config | `/home/dkit/.cloudflared/config.yml` → `http://localhost:3001` |
| Backups | `/home/dkit/backups` (weekly, keeps 4) |
| Logs | `journalctl -u dkit-api` |

## What differs from the guide

1. **bun instead of npm.** `bun install` in `backend/` and `website/`,
   `bun run build` for the site, and the API runs under bun. `bcrypt@6` ships
   prebuilt N-API binaries, so no native build step is needed.
2. **systemd instead of pm2.** Two units replace the pm2 processes. On boot,
   `dkit-api` starts; there is no pm2 daemon and no pm2 log directory.
3. **Dedicated user.** The app runs as `dkit`, not root, so a compromise of the
   API can't touch the rest of the server.
4. **Loopback bind (the one code change).** `backend/src/server.js` now calls
   `app.listen(PORT, '127.0.0.1', ...)`. The tunnel reaches it via localhost, so
   port 3001 is never exposed to the internet. Re-apply this after any update
   that overwrites `server.js`.
5. **Hardening.** ufw (deny inbound except SSH), fail2ban on sshd, Postgres and
   Redis bound to localhost, secret files mode 600.

## Operating it

```bash
systemctl status dkit-api            # state
journalctl -u dkit-api -f            # live logs
sudo systemctl restart dkit-api      # restart

# rebuild the site after a frontend change
sudo -u dkit -H bash -c 'cd /home/dkit/d-kit/website && bun run build'
sudo systemctl restart dkit-api
```

## Cutover — DONE (2026-10-16)

The domain was serving Cloudflare error 1033 (tunnel had zero connections) when
the tunnel was brought up here, so there was no live origin to disrupt and no
traffic to split — this box is now the sole connector.

```bash
sudo systemctl enable --now dkit-tunnel
```

The same tunnel UUID (`278f1d0d-…`) is reused, so DNS, Resend and the OAuth
redirect URIs were untouched. Verified from outside: `/api/health`, `/`,
`/robots.txt`, `/sitemap.xml`, `/llms.txt` and `/docs` all 200 over HTTPS with a
valid Let's Encrypt cert.

**If the old box ever comes back and runs its tunnel, stop it** — two connectors
would load-balance traffic between stale and current data.

## Backups

`~/backups/dkit-<date>.sql.gz` + `backend.env-<date>` are written weekly
(Sunday 04:00 UTC) by `scripts/backup-db.sh`. They live on the same disk as the
database — **copy them off-box** (scp / object storage) to make them real
backups. Keep a copy of `backend/.env` in a password manager too.
