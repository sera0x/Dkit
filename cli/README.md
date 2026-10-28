# dkit-cli

The `dkit` command for [Dkit](https://github.com/sera0x/Dkit) — secrets, scaffolding, cron jobs, uptime monitors, and log shipping from one CLI.

## Install

```bash
curl -fsSL https://dkit.name.ng/install.sh | sh
```

The installer downloads the latest release tarball, verifies its checksum, and installs the CLI without npm.

## Quickstart

```bash
dkit signup        # create an account on your Dkit server
dkit login
dkit new my-app    # scaffold a project (express-pg, node-api, scheduled-job, static-site)
dkit env:set DATABASE_URL postgres://...
```

`dkit doctor` checks the whole setup (API reachability, session, project link, key validity) and exits non-zero on failure, so it works as a CI gate. Run `dkit --help` for every command.

## Configuration

The CLI talks to `https://dkit.name.ng` by default. Point it at a self-hosted server:

```bash
export DKIT_API_URL=https://your-server
```

Project settings (which project a folder talks to, cached session) live in `.dkit/state.json`, created by `dkit projects:link` or `dkit new`.
