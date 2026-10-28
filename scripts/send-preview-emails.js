
process.env.NODE_ENV = process.env.NODE_ENV || 'development'
const { pool } = require('../backend/src/db')
const mail = require('../backend/src/email')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let to = process.argv[2]
  if (!to) {
    const r = await pool.query('SELECT email FROM users WHERE COALESCE(is_admin, FALSE) ORDER BY created_at ASC LIMIT 1')
    to = r.rows[0]?.email
  }
  if (!to) throw new Error('No admin user found — pass an address: node scripts/send-preview-emails.js you@example.com')
  console.log('Sending all email designs to ' + to + '\n')

  const jobs = [
    ['verification', () => mail.sendVerificationCode(to, '481902')],
    ['login-code', () => mail.sendLoginCode(to, '736214')],
    ['password-reset', () => mail.sendPasswordResetEmail(to, 'https://dkit.name.ng/reset-password?token=preview-demo-only')],
    ['team-invite', () => mail.sendTeamInviteEmail(to, 'https://dkit.name.ng/accept-invite?token=preview-demo-only', { teamName: 'Acme Backend', inviterEmail: 'tayo@acme.dev', role: 'admin' })],
    ['uptime-down', () => mail.sendUptimeAlertEmail(to, { name: 'API', url: 'https://api.dkit.name.ng/health', status: 'down', statusCode: 503, error: 'connect ETIMEDOUT 76.76.21.21:443' })],
    ['uptime-up', () => mail.sendUptimeAlertEmail(to, { name: 'API', url: 'https://api.dkit.name.ng/health', status: 'up', statusCode: 200 })],
    ['welcome', () => mail.sendWelcomeEmail(to)],
    ['broadcast', () => mail.sendAdminBroadcastEmail(to, { subject: 'Preview: product update', body: 'Hey —\n\nThis is what a broadcast from Admin → mail looks like in your inbox.\n\nBlank lines become paragraphs, exactly like the composer.\n\n— The Dkit team' })],
  ]

  let failed = 0
  for (const [name, fn] of jobs) {
    const ok = await fn()
    console.log((ok ? '  sent    ' : '  FAILED  ') + name)
    if (!ok) failed++
    await wait(400)
  }
  console.log(failed === 0 ? '\nAll ' + jobs.length + ' sent — check the inbox.' : '\n' + failed + ' failed — check server logs for the Resend error.')
  await pool.end()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
