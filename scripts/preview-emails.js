// Render the five transactional emails to files so you can eyeball the design
// (and the plain-text parts) without sending anything through Resend.
//
//   node scripts/preview-emails.js            # writes into scripts/preview/
//
// RESEND_API_KEY must exist in backend/.env (email.js refuses to load without
// it) but nothing is sent — this only renders.

const fs = require('fs')
const path = require('path')

// email.js refuses to load without RESEND_API_KEY. dotenv isn't resolvable from
// scripts/, so parse backend/.env by hand (no values are printed or sent).
try {
  for (const line of fs.readFileSync(path.join(__dirname, '../backend/.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
} catch { /* no .env — email.js will report the missing var clearly */ }

// Intercept the resend module BEFORE email.js loads it, capturing rendered
// payloads instead of sending. Nothing leaves the machine.
let captured = null
const Module = require('module')
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'resend') {
    return {
      Resend: class {
        constructor() {}
        get emails() {
          return {
            send: async (payload) => {
              captured = payload
              return { error: null }
            },
          }
        }
      },
    }
  }
  return origLoad.apply(this, arguments)
}

const { sendVerificationCode, sendLoginCode, sendPasswordResetEmail, sendTeamInviteEmail, sendUptimeAlertEmail, sendWelcomeEmail, sendAdminBroadcastEmail } = require('../backend/src/email')

const OUT_DIR = path.join(__dirname, 'preview')
fs.mkdirSync(OUT_DIR, { recursive: true })

const samples = [
  { fn: () => sendVerificationCode('you@example.com', '481902'), base: 'verification' },
  { fn: () => sendLoginCode('you@example.com', '736214'), base: 'login-code' },
  { fn: () => sendPasswordResetEmail('you@example.com', 'https://dkit.name.ng/reset-password?token=demo'), base: 'password-reset' },
  { fn: () => sendTeamInviteEmail('you@example.com', 'https://dkit.name.ng/accept-invite?token=demo', { teamName: 'Acme Backend', inviterEmail: 'tayo@acme.dev', role: 'admin' }), base: 'team-invite' },
  { fn: () => sendUptimeAlertEmail('you@example.com', { name: 'API', url: 'https://api.dkit.name.ng/health', status: 'down', statusCode: 503, error: 'connect ETIMEDOUT 76.76.21.21:443' }), base: 'uptime-down' },
  { fn: () => sendUptimeAlertEmail('you@example.com', { name: 'API', url: 'https://api.dkit.name.ng/health', status: 'up', statusCode: 200 }), base: 'uptime-up' },
  { fn: () => sendWelcomeEmail('you@example.com'), base: 'welcome' },
  { fn: () => sendAdminBroadcastEmail('you@example.com', { subject: 'Preview: product update', body: 'Hey —\n\nThis is what a broadcast from Admin → mail looks like.\n\n— The Dkit team' }), base: 'broadcast' },
]

;(async () => {
  for (const sample of samples) {
    captured = null
    await sample.fn()
    if (!captured) { console.error('No payload captured for ' + sample.base); process.exit(1) }
    fs.writeFileSync(path.join(OUT_DIR, sample.base + '.html'), captured.html)
    fs.writeFileSync(path.join(OUT_DIR, sample.base + '.txt'), captured.text)
    console.log('wrote ' + sample.base + '.html / .txt   subject: ' + captured.subject)
  }
  console.log('\nDone — open scripts/preview/ in a browser to review the designs.')
})().catch((err) => { console.error(err); process.exit(1) })
