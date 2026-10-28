const { execSync } = require('child_process')
const { log } = require('../src/dkit-logger')

async function main() {
  const started = Date.now()
  log('info', 'deploy starting', { source: 'deploy' })

  console.log('(no real deploy configured — edit scripts/deploy.js)')

  log('info', 'deploy finished in ' + (Date.now() - started) + 'ms', { source: 'deploy' })
  setTimeout(() => process.exit(0), 500)
}

main().catch((err) => {
  log('error', 'deploy failed: ' + err.message, { source: 'deploy' })
  console.error(err)
  process.exit(1)
})
