// Deploy script for {{name}}. Swap the copy step for whatever actually
// publishes your site (rsync, netlify, s3 sync — your call). What you get out
// of the box: every deploy logs to Dkit, so `dkit logs:tail -s deploy` is a
// history of every push.
const { execSync } = require('child_process')
const { log } = require('../src/dkit-logger')

async function main() {
  const started = Date.now()
  log('info', 'deploy starting', { source: 'deploy' })

  // --- replace with your real deploy step ---------------------------------
  // execSync('rsync -az public/ user@host:/var/www/{{name}}/', { stdio: 'inherit' })
  console.log('(no real deploy configured — edit scripts/deploy.js)')
  // ------------------------------------------------------------------------

  log('info', 'deploy finished in ' + (Date.now() - started) + 'ms', { source: 'deploy' })
  setTimeout(() => process.exit(0), 500) // give the log queue a beat to flush
}

main().catch((err) => {
  log('error', 'deploy failed: ' + err.message, { source: 'deploy' })
  console.error(err)
  process.exit(1)
})
