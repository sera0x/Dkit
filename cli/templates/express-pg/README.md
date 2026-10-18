# {{Name}}

Scaffolded with `dkit new`. Secrets come from Dkit at runtime —
`npm run dev` runs through `dkit run`, so no `.env` file ever touches disk.

Set what the app needs once:

    dkit env:set DATABASE_URL <your-postgres-url>

Then:

    npm install
    npm run dev

Every request line ships to Dkit's log drain (`dkit logs:tail` to watch,
`dkit logs:ship` to add your own). No server-side key is stored in the app —
it reads `DKIT_API_KEY` from the environment.

## Also try

    dkit monitor:add api http://localhost:3000/health -i 60   # get emailed if it dies
    dkit cron:add rollup https://example.com/rollup -s "daily 03:00"   # schedule work
