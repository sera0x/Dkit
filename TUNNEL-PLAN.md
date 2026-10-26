# `dkit tunnel` — a micro-ngrok on the existing Cloudflare tunnel (design)

Status: **planned, not built.** Media CDN + temporary share links shipped first
(see CHANGES.md, 2026-10-26). This is the design for the other half of the
"temp URL like ngrok" ask.

## Goal

```bash
cd my-app && dkit tunnel 3000
# → https://x7k2.fan.dkit.name.ng  (live for 60 minutes)
```

Anyone on the internet can hit that URL; requests reach `localhost:3000` on the
developer's machine. No ports opened, no DNS changes per tunnel, no extra
process to install beyond the dkit CLI already on the box.

## What we already have (and why it changes the plan)

- `cloudflared` runs as a systemd unit, ingress → `http://localhost:3001`.
- Cloudflare terminates TLS on `*.dkit.name.ng` when a wildcard DNS record
  exists; the tunnel config decides where each hostname points.
- The API already issues JWTs, knows projects, and runs a 30-second job ticker.

So the public edge (`*.fan.dkit.name.ng` → the same tunnel → :3001) is one
wildcard DNS record plus one ingress rule. Everything after that is dkit's own
routing — no custom TCP server, no public ports.

```
Browser ──https──▶ Cloudflare ──tunnel──▶ dkit API :3001
                                            │  Host: x7k2.fan.dkit.name.ng
                                            │  look up tunnel session → WebSocket
                                            ▼
                              dkit CLI (on the dev machine)
                                            │  http proxy to 127.0.0.1:3000
                                            ▼
                                   the app being developed
```

## Moving parts

### 1. One-time infrastructure
- DNS: `*.fan.dkit.name.ng` → CNAME `<tunnel-id>.cfargotunnel.com`, proxied.
- `cloudflared/config.yml` ingress entry:
  `hostname: "*.fan.dkit.name.ng"` → `service: http://localhost:3001`.
- API env: `TUNNEL_DOMAIN=fan.dkit.name.ng`.

### 2. CLI side (`dkit tunnel <port>`)
- Logs in with the existing session (`ensureSession`), opens
  `wss://dkit.name.ng/api/tunnel/connect` with `Authorization: Bearer <jwt>`
  and `x-dkit-project` (a tunnel belongs to a project, so it shows in the
  dashboard and dies with team access).
- Registers the requested subdomain (or gets a random 4-char one:
  `x7k2`). Named tunnels (`--name demo`) are owner-scoped and allowed if that
  project hasn't used the name in the last 24 h.
- Local HTTP server for the multiplexing protocol (below), forwarding every
  inbound request to `http://127.0.0.1:<port>` with Node's `http.request`
  (streams both directions, preserves method/headers/body).
- Prints the URL, the expiry countdown, and request lines as they arrive:
  `200 GET /api/users 12ms 1.4kb`.
- Reconnects with backoff if the WebSocket drops; re-registers the same
  subdomain (10 s grace window server-side).

### 3. Multiplexing protocol (one WebSocket, many requests)
No external dependency — a tiny JSON-framed protocol over the WS:

| Frame | Direction | Payload |
|---|---|---|
| `hello` | CLI → API | `{port, name?, auth}` |
| `registered` | API → CLI | `{subdomain, url, expires_at}` |
| `req` | API → CLI | `{id, method, path, headers, body_b64?}` |
| `res` | CLI → API | `{id, status, headers}` |
| `chunk` | both | `{id, body_b64, done: bool}` |
| `ping`/`pong` | both | keepalive, 20 s |

Binary uploads/downloads stream in ~64 KB chunks (base64 in JSON keeps the
protocol dependency-free; a binary side-channel is a later optimisation).
Backpressure: the API pauses TCP reads on the public request while >1 MB of
chunk frames is unacknowledged.

### 4. API side
- `GET /api/tunnels` / `DELETE /api/tunnels/:id` — dashboard list + kill switch.
- `POST /api/tunnel/connect` (WebSocket upgrade; express-rate-limit per user,
  1 tunnel per project on the free tier, 3 named tunnels max).
- Host-header router **before** the SPA fallback:
  ```
  Host = x7k2.fan.dkit.name.ng → active tunnel session → forward over WS
                               → 502 "tunnel offline" if none
  ```
- Hard guarantees:
  - TTL 60 min default (`--ttl 10m..6h`), hard cap 6 h, max 10 tunnelled
    requests/second, 50 MB per request body.
  - Each tunnel is scoped to one project; deleting the project or revoking the
    session closes the socket (close code 4001) and frees the subdomain.
  - No cookie forwarding from the dkit origin (the tunnel domain differs, so
    this is structural — never rewrite `Set-Cookie` to the parent domain).
  - `X-Forwarded-For` set to the real client IP; `X-Dkit-Tunnel: <id>` on the
    forwarded request so apps can tell a tunnel from production.
  - Idle tunnels (no requests for 10 min) are closed and logged in the audit
    feed.

### 5. Dashboard
- "tunnels" tab: active tunnels with subdomain, project, uptime, requests/min,
  and a kill button. Same data the CLI prints. Visible to project owners and
  team members with write access.
- Optional: a "request log" per tunnel (last 50) — useful for webhook debugging,
  cheap to keep in memory only.

## Security notes
- The URL is random, but it is public by design: anyone with the link can hit
  the dev server. Treat a tunnel as "the internet can see localhost:3000".
  Default TTL 60 min and per-project caps exist precisely because dev servers
  routinely have `DEBUG=1`.
- The API never stores tunnelled request bodies; only metadata (method, path,
  status) if the request log is enabled.
- The WS upgrade requires a valid JWT and is rate-limited by user, so a leaked
  tunnel URL cannot be re-registered by someone else.

## Effort estimate
- DNS + cloudflared ingress: 10 minutes (one-time).
- Protocol + API router + CLI client: the bulk — a focused day or two.
- Dashboard tab: a few hours, panel patterns already exist.
- Tests: a loopback harness that starts `dkit tunnel` against a fixture server
  and asserts body/header/status round-trips, plus an expiry/kill test.

## Ordered implementation plan
1. DNS wildcard + cloudflared ingress (safe, no code).
2. `backend/src/tunnel.js`: session registry, WS protocol, host router.
3. CLI `tunnel` command + reconnect logic.
4. Dashboard tab + audit entries.
5. Per-project quotas, idle reaping, request log.
6. Docs page section + `dkit doctor` check for the wildcard record.
