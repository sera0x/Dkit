# {{Name}}

Scaffolded with `dkit new --template node-api`. Zero runtime dependencies —
plain Node. Secrets come from Dkit at runtime: `npm run dev` runs through
`dkit run`, so no `.env` file ever touches disk.

## Run it

    npm run dev

## Ship a log line

    dkit logs:ship "hello from {{name}}"

## Schedule something

    dkit cron:add cleanup http://localhost:3000/health -s "daily 03:00"

## Watch it

    dkit monitor:add prod http://localhost:3000/health -i 60
