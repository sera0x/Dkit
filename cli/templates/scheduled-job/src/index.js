// {{Name}} — a scheduled job. Pair this with a Dkit cron entry and it runs
// on a timer without a server that stays awake:
//
//   dkit cron:add run-{{name}} https://your-runner.example/hook -s "daily 03:00"
//
// ...or run it yourself wherever you like: `dkit run -- node src/index.js`.
// Secrets arrive as environment variables via `dkit run`.

async function main() {
  const started = Date.now()
  console.log('{{name}} starting at', new Date().toISOString())

  // --- do the work ---------------------------------------------------------
  // Example: pull a secret, call an API, write something somewhere.
  // const apiKey = process.env.UPSTREAM_API_KEY
  // -------------------------------------------------------------------------

  console.log('{{name}} finished in ' + (Date.now() - started) + 'ms')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('{{name}} failed:', err)
  process.exit(1)
})
