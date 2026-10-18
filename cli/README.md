# dkit-cli

The `dkit` command for [Dkit](https://github.com/sera0x/Dkit) — secrets, scaffolding, cron jobs, uptime monitors, and log shipping from one CLI.

## Install

```bash
npm install -g dkit-cli
```

No install script in this package: everything is plain JavaScript, so `npm ci --ignore-scripts` and pnpm's defaults work fine.

Prefer not to use npm? The same CLI ships as a tarball with every GitHub release, with an installer that verifies the checksum first:

```bash
curl -fsSL https://raw.githubusercontent.com/sera0x/Dkit/main/install.sh | sh
```

## Quickstart

```bash
dkit signup        # create an account on your Dkit server
dkit login
dkit new my-app    # scaffold a project (express-pg, node-api, scheduled-job, static-site)
dkit env:set DATABASE_URL postgres://...
```

`dkit doctor` checks the whole setup (API reachability, session, project link, key validity) and exits non-zero on failure, so it works as a CI gate. Run `dkit --help` for every command.

## Configuration

The CLI talks to `http://localhost:3001` by default. Point it at your server:

```bash
export DKIT_API_URL=https://your-server
```

Project settings (which project a folder talks to, cached session) live in `.dkit/state.json`, created by `dkit projects:link` or `dkit new`.
