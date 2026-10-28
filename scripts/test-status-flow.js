process.env.NODE_ENV = process.env.NODE_ENV || 'development'
const { pool } = require('../backend/src/db')
const status = require('../backend/src/status')

const log = (label, obj) => console.log(label, typeof obj === 'object' ? JSON.stringify(obj, null, 2) : obj)

async function main() {
  const svc = (await pool.query("SELECT id, name, url, mode FROM status_services WHERE name = 'Docs'")).rows[0]
  if (!svc) throw new Error('Docs service not found — is the server running?')
  const originalUrl = svc.url
  log('service:', svc)

  try {
    const deadUrl = 'http://127.0.0.1:9/test-down'
    await pool.query('UPDATE status_services SET url = $2, consecutive_failures = 0, status = CASE WHEN mode = $2 THEN status ELSE status END WHERE id = $1', [svc.id, deadUrl])
    console.log('\n--- probe 1 (first failure: should stay up, record failure) ---')
    log('probe:', await status.probeService({ ...svc, url: deadUrl, status: 'up', consecutive_failures: 0 }, { force: true }))
    console.log('\n--- probe 2 (second failure: should flip down) ---')
    const afterDown = await status.probeService({ ...svc, url: deadUrl, status: 'up', consecutive_failures: 1 }, { force: true })
    log('probe:', afterDown)
    if (!afterDown.flippedDown) throw new Error('EXPECTED flippedDown=true')

    console.log('\n--- public page after down ---')
    const pub1 = await status.listPublic()
    log('overall:', pub1.overall)
    log('docs:', pub1.services.find((s) => s.name === 'Docs'))
    log('open incidents:', pub1.incidents.filter((i) => !i.resolved_at).map((i) => ({ title: i.title, source: i.source, state: i.state })))

    console.log('\n--- admin feed (notification) ---')
    const adm1 = await status.listAdmin()
    log('unseen_count:', adm1.unseen_count)
    log('latest notification:', adm1.notifications[0] && { title: adm1.notifications[0].title, service: adm1.notifications[0].service_name, updates: adm1.notifications[0].updates.length })

    console.log('\n--- ack ---')
    await status.ackNotifications()
    log('unseen after ack:', (await status.listAdmin()).unseen_count)

    console.log('\n--- restore + probe (should flip up + auto-resolve) ---')
    await pool.query('UPDATE status_services SET url = $2 WHERE id = $1', [svc.id, originalUrl])
    const afterUp = await status.probeService({ ...svc, url: originalUrl, status: 'down', consecutive_failures: 2 }, { force: true })
    log('probe:', afterUp)
    if (!afterUp.flippedUp) throw new Error('EXPECTED flippedUp=true')

    console.log('\n--- public page after recovery ---')
    const pub2 = await status.listPublic()
    log('overall:', pub2.overall)
    const inc = pub2.incidents.find((i) => i.title.includes('Docs'))
    log('docs incident:', inc && { state: inc.state, resolved_at: inc.resolved_at, last_update: inc.updates[inc.updates.length - 1] })

    console.log('\n--- maintenance mode round-trip ---')
    await status.setServiceMode(svc.id, 'manual_down')
    const pub3 = await status.listPublic()
    log('overall in maintenance:', pub3.overall)
    log('docs effective:', pub3.services.find((s) => s.name === 'Docs').effective_status)
    await status.setServiceMode(svc.id, 'auto')
    log('overall after back to auto:', (await status.listPublic()).overall)

    console.log('\nALL CHECKS PASSED (check pm2 logs for the two DOWN/UP emails to the admin address)')
  } finally {
    await pool.query('UPDATE status_services SET url = $2, mode = $3 WHERE id = $1', [svc.id, originalUrl, svc.mode]).catch(() => {})
    await pool.end()
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error('TEST FAILED:', err.message); process.exit(1) }
)
