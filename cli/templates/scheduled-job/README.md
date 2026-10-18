# {{Name}}

A headless scheduled job scaffolded with `dkit new --template scheduled-job`.

Pair it with a Dkit cron entry so the API calls a runner on a timer:

    dkit cron:add run-{{name}} https://your-runner.example/hook -s "daily 03:00"

Or trigger it from CI / any machine:

    dkit run -- node src/index.js

Secrets come from Dkit at runtime — nothing touches disk.
