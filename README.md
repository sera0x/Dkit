```console
# dkit — secrets, cron, monitors and a log drain, self-hosted.
# one CLI, one dashboard, one API.

$ curl -fsSL https://raw.githubusercontent.com/sera0x/Dkit/main/install.sh | sh

$ dkit login
Email: you@work.dev
✔ Verification code sent to your email
Check your email (and spam folder) for the code.
Enter verification code: 419202
✔ Logged in successfully — sessions auto-renew, no weekly re-login
Welcome back, you@work.dev

$ dkit new api
✔ Scaffolded api and linked it to project "api"
```

Dkit is for the parts of a side project nobody wants to build twice: where secrets live, what runs on a schedule, whether the site is up, where the logs went. One backend serves a CLI, a dashboard and a plain HTTP API, so you can script it, click it, or both.

```text
   dkit CLI                dashboard
      │  bearer token         │  session cookie
      ▼                       ▼
   ┌──────────────────────────────────────┐
   │          one Express server          │
   │   API + dashboard + job runner       │
   └──────────────────────────────────────┘
      │             │              │
   Postgres       Redis         Resend
```

## What it replaces

A `.env` file synced by hand, a cron box you ssh into to check on, an uptime service with a free tier you keep outgrowing, logs scattered across every machine you've deployed from, and the group chat where your teammate asks for the Stripe key.

## How it treats your secrets

Values are stored in Postgres, one project and environment at a time, and listings come back masked. The plaintext never travels until you ask for one value by name:

```console
$ dkit env:list

  (masked — plaintext never left the API; use dkit env:get <key> to reveal one)
```

`dkit run -- npm start` goes one better: the command's process gets the secrets injected directly and exits with that process's own status. Nothing is written to disk. `env:pull > .env` exists for the times you actually want the file.

Environments are first-class. `development`, `staging`, `production`, or your own names, all inside one project. `env:diff` shows which keys differ, `env:copy` syncs them, `env:rollback <key>` restores a previous value, and `env:history <key>` shows the audit feed with value lengths instead of values.

## Cron you can read

Schedules are human strings, not star fields: `30s`, `5m`, `2h`, `daily 09:30`, `mon 09:00`. All UTC, with a 10-second floor so a typo can't hammer anything.

```console
$ dkit cron:add nightly-export https://api.you.dev/export -s "daily 03:00"
```

The API fires the HTTP call, keeps the run history, and lets you pause, resume or trigger a job on demand from the CLI or dashboard. No server of yours stays awake to tick.

## One email per incident

`dkit monitor:add api https://api.you.dev/health` checks from every 30 seconds to every hour. When the URL goes down you get one email; when it comes back, one more. Not forty.

## A drain for logs

Anything that can POST can ship logs: single lines or JSON batches, from any app on any box. Tail them with level and search filters, and let the 7-day retention handle cleanup. The runtime store (`store:set/get/incr`) takes the state that isn't a secret: JSON values, optional TTL, atomic increments.

## When it's not just you

Teams get owner, admin and member roles, projects shared into a team, and invitations that only work for a verified address. Deletes stay deliberate: projects and secrets confirm through a type-to-confirm prompt, and rotating an API key kills the old one on the spot.

## Run it on your own box

```bash
git clone https://github.com/sera0x/Dkit.git
cd Dkit
cp backend/.env.example backend/.env     # fill in the three values below
./scripts/start.sh
```

That brings up the API serving the dashboard on `localhost:3001`. The database schema creates itself on first boot. You need Node 18+, PostgreSQL and Redis running, plus:

| Variable | What it is |
|---|---|
| `DB_PASSWORD` | Password for the `dkituser` Postgres role |
| `JWT_SECRET` | Signs session tokens — `openssl rand -hex 32` |
| `RESEND_API_KEY` | Sends verification codes, invites and uptime alerts |


## Every command, one screen

| Command | What it does |
|---|---|
| `dkit login` / `dkit logout` | Sign in with email and one-time code; revoke the device session |
| `dkit verify <code>` | Verify your email from the terminal |
| `dkit new <name>` | Scaffold a project from a template and link this folder to it |
| `dkit projects:create <name>` | Create a project, keyless until a key is issued |
| `dkit keys:rotate [name]` | Issue or replace the API key; the old one stops working immediately |
| `dkit env:set <key> <value>` | Set a variable, `-e` picks the environment |
| `dkit env:get <key>` / `dkit env:list` | Read one; list all, masked unless `--show` |
| `dkit env:rollback <key>` | Restore a previous value |
| `dkit env:history <key>` | The audit feed for one key, lengths instead of values |
| `dkit env:diff <a> <b>` / `env:copy <a> <b>` | Compare or sync two environments |
| `dkit env:pull` / `env:push <file>` | Print the environment as `.env`; bulk-set from one |
| `dkit run -- <command>` | Run a command with secrets injected, nothing written to disk |
| `dkit store:set/get/incr` | The runtime store: JSON values, TTL, atomic increments |
| `dkit cron:add <name> <url> -s "daily 03:00"` | Schedule an HTTP call |
| `dkit cron:runs <name>` / `cron:pause` / `cron:rm` | Run history, pause, delete |
| `dkit monitor:add <name> <url>` | Watch a URL; email on down and on recovery |
| `dkit logs:ship` / `logs:tail` | Ship lines or JSON batches; tail with filters |
| `dkit 2fa status / setup / enable / disable` | Manage two-factor auth for your account |
| `dkit doctor [--fix]` | Diagnose the setup and apply the safe fixes |

Full reference lives at `/docs` on your deployment.

## Under the hood

API keys and refresh tokens are stored as SHA-256 hashes, with the plaintext existing only in the response that issued them. Refresh tokens rotate on every use, so a stolen token dies the next time the real client refreshes. One-time codes and invitations are rate-limited.

## License

MIT — see [LICENSE](LICENSE).
