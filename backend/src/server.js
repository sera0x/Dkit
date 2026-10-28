const express = require('express')
const cors = require('cors')
const path = require('path')
const rateLimit = require('express-rate-limit')
const helmet = require('helmet')
const { pool, redisClient, initPromise } = require('./db')
const { hashPassword, verifyPassword, generateToken, authenticate, authenticateProject, newRefreshToken, hashRefreshToken, verifyToken } = require('./auth')
const { sendVerificationCode, sendLoginCode, sendPasswordResetEmail, sendTeamInviteEmail, sendWelcomeEmail, sendAdminBroadcastEmail } = require('./email')
const jobs = require('./jobs')
const status = require('./status')
const { isTeamMember, isTeamWriteable, projectAccessFor, sharedTeamIdsForProject, listSharedProjects } = require('./teamAccess')
const r2 = require('./r2')
const { generateSecret, verifyTotp, otpauthUrl } = require('./totp')
const { encryptSecret, decryptSecret } = require('./secrets')
const crypto = require('crypto')
const app = express()
async function loadSelfSettings() {
  const r = await pool.query(`SELECT key, value FROM env_vars ev JOIN projects p ON p.id = ev.project_id WHERE p.name = 'dkit-self'`)
  let applied = 0
  for (const { key, value } of r.rows) {
    if (key.startsWith('PRIVATE_') || process.env[key] !== undefined) continue
    process.env[key] = decryptSecret(value)
    applied++
  }
  if (applied > 0) console.log('Loaded ' + applied + ' setting(s) from the dkit-self project')
}

async function ensureSelfProject() {
  let p = await pool.query('SELECT id FROM projects WHERE name = \'dkit-self\'')
  if (p.rows.length === 0) {
    const admin = await pool.query('SELECT id FROM users WHERE COALESCE(is_admin, FALSE) ORDER BY created_at LIMIT 1')
    if (admin.rows.length === 0) return
    p = await pool.query(`INSERT INTO projects (user_id, name, api_key, key_hash, key_prefix) VALUES ($1, 'dkit-self', NULL, $2, $3) RETURNING id`,
      [admin.rows[0].id, crypto.randomBytes(32).toString('hex'), 'dk_' + crypto.randomBytes(3).toString('hex')])
    console.log('Created the dkit-self project (owned by the first admin)')
  }
  const publicUrl = process.env.PUBLIC_URL
  if (publicUrl) {
    const seeded = await pool.query(
      `INSERT INTO env_vars (project_id, key, value, environment) VALUES ($1, 'PUBLIC_URL', $2, 'production') ON CONFLICT (project_id, key, environment) DO NOTHING`,
      [p.rows[0].id, encryptSecret(publicUrl)]
    )
    if (seeded.rowCount > 0) console.log('Seeded PUBLIC_URL into dkit-self')
  }
}
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors())
app.use(express.json())
const PORT = process.env.PORT || 3001
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip || req.socket.remoteAddress || ''

async function issueSession(userId, req) {
  const token = generateToken(userId)
  const refreshToken = newRefreshToken()
  await pool.query(
    'INSERT INTO sessions (user_id, refresh_hash, user_agent, last_ip) VALUES ($1, $2, $3, $4)',
    [userId, hashRefreshToken(refreshToken), String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req)]
  )
  return { token, refresh_token: refreshToken }
}
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, skip: (req) => req.originalUrl.startsWith('/api/kv'), message: { error: 'Too many requests. Please slow down.' } })
app.use('/api/', globalLimiter)
const projectLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.headers['x-api-key'] || req.ip, message: { error: 'Too many requests for this API key. Please slow down.' } })
const kvLimiter = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.KV_RATE_LIMIT) || 1200, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.headers['x-api-key'] || req.ip, message: { error: 'Cache rate limit exceeded. Raise KV_RATE_LIMIT if this is a real workload.' } })
const KV_MAX_BYTES = Number(process.env.KV_MAX_BYTES) || 128 * 1024
const KV_MAX_TTL = 30 * 24 * 60 * 60
const KV_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many failed attempts. Please wait a few minutes and try again.' } })
const emailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 6, skipFailedRequests: true, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip + '|' + String(req.body?.email || '').toLowerCase(), message: { error: 'Too many emails requested. Please wait a few minutes and try again.' } })
const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, handler: (req, res) => res.redirect((process.env.PUBLIC_URL || '') + '/login?error=rate') })
const TEAM_ROLES = ['admin', 'member']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEAMS_OWNED = 10
const MAX_PENDING_INVITES = 50
const teamWriteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => (req.user && req.user.id) || req.ip, message: { error: 'Too many team changes. Please wait a few minutes and try again.' } })
const inviteSendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => (req.user && req.user.id) || req.ip, message: { error: 'Too many invitations sent. Please wait a few minutes and try again.' } })
function validatePassword(password) {
const errors = []
if (password.length < 8) errors.push('Password must be at least 8 characters')
if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter')
if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter')
if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number')
return errors
}
app.get('/api/health', (req, res) => {
  const ascii = `
         d88888
       d8"  .88
     .d8"    .88
    d88888888888
   d8"      .d888
  d8"        .d8888
 d8"          .d88888
d8              .d888888
88              d88888888
8888888888888888888888888
`
  res.json({ status: 'ok', service: 'Dkit API', version: '0.3.0', ascii })})
app.get('/health', (req, res) => { res.redirect(302, '/api/health?force=true') })
app.get('/install.sh', (req, res) => { res.type('text/x-shellscript').sendFile(path.join(__dirname, '../../install.sh')) })

app.get('/api/status', async (req, res) => {
  try { res.json(await status.listPublic()) }
  catch (e) { console.error('status error:', e); res.status(500).json({ error: 'status failed' }) }
})

app.get('/api/admin/status', authenticate, requireAdmin, async (req, res) => {
  try { res.json(await status.listAdmin()) }
  catch (e) { console.error('admin status error:', e); res.status(500).json({ error: 'failed' }) }
})

app.post('/api/admin/status/services/:id/mode', authenticate, requireAdmin, async (req, res) => {
  try {
    const s = await status.setServiceMode(req.params.id, String(req.body?.mode || ''))
    res.json({ ok: true, mode: s.mode })
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }) }
})

app.post('/api/admin/status/services/:id/check', authenticate, requireAdmin, async (req, res) => {
  try { res.json(await status.forceCheck(req.params.id)) }
  catch (e) { res.status(400).json({ error: e.message || 'failed' }) }
})

app.post('/api/admin/status/incidents', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = await status.createIncident(req.body || {})
    res.json({ ok: true, id })
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }) }
})

app.post('/api/admin/status/incidents/:id/updates', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = await status.addIncidentUpdate(req.params.id, req.body || {})
    res.json({ ok: true, id })
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }) }
})

app.post('/api/admin/status/ack', authenticate, requireAdmin, async (req, res) => {
  try { await status.ackNotifications(); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: 'failed' }) }
})
app.post('/api/auth/signup', loginLimiter, emailLimiter, async (req, res) => {
const { email, password } = req.body
if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
const passwordErrors = validatePassword(password)
if (passwordErrors.length > 0) return res.status(400).json({ error: 'Password requirements not met', details: passwordErrors })
const hashed = await hashPassword(password)
try {
const result = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, hashed])
const code = crypto.randomInt(100000, 999999).toString()
await pool.query('INSERT INTO email_verifications (user_id, code) VALUES ($1, $2)', [result.rows[0].id, code])
const sent = await sendVerificationCode(email, code)
if (!sent) return res.status(502).json({ error: 'Could not send the verification email. Check server logs.' })
const token = generateToken(result.rows[0].id)
const refresh_token = (await issueSession(result.rows[0].id, req)).refresh_token
await pool.query('UPDATE users SET last_ip = $1, last_login_at = NOW() WHERE id = $2', [clientIp(req), result.rows[0].id]).catch(() => {})
sendWelcomeEmail(email).catch(() => {})
res.json({ user: result.rows[0], token, refresh_token, message: 'Welcome to Dkit. Verification code sent to your email.' })
} catch (err) {
if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' })
res.status(500).json({ error: 'Something went wrong' })
}
})
app.post('/api/auth/login/initiate', loginLimiter, emailLimiter, async (req, res) => {
const { email, password } = req.body
if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' })
const valid = await verifyPassword(password, result.rows[0].password_hash)
if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
if (result.rows[0].suspended) return res.status(403).json({ error: 'Account suspended', code: 'suspended' })
if (result.rows[0].totp_enabled) {
  const loginToken = crypto.randomBytes(32).toString('hex')
  await pool.query('INSERT INTO login_challenges (login_token, user_id) VALUES ($1, $2)', [loginToken, result.rows[0].id])
  return res.json({ login_token: loginToken, two_factor: true, message: 'Enter the code from your authenticator app' })
}
const code = crypto.randomInt(100000, 999999).toString()
const loginToken = crypto.randomBytes(32).toString('hex')
await pool.query(`INSERT INTO login_codes (user_id, code, login_token) VALUES ($1, $2, $3)`, [result.rows[0].id, code, loginToken])
const sent = await sendLoginCode(email, code)
if (!sent) return res.status(502).json({ error: 'Could not send the login code email. Check server logs.' })
res.json({ login_token: loginToken, message: 'Verification code sent to your email' })
})
app.post('/api/auth/login/verify', loginLimiter, async (req, res) => {
const { login_token, code } = req.body
if (!login_token || !code) return res.status(400).json({ error: 'Login token and code required' })
const challenge = await pool.query('SELECT user_id FROM login_challenges WHERE login_token = $1 AND expires_at > NOW()', [login_token])
if (challenge.rows.length > 0) {
  const uid = challenge.rows[0].user_id
  const u = await pool.query('SELECT id, email, suspended, totp_secret FROM users WHERE id = $1', [uid])
  if (u.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired code' })
  if (u.rows[0].suspended) return res.status(403).json({ error: 'Account suspended', code: 'suspended' })
  const t = String(code || '').replace(/\s/g, '')
  let ok = verifyTotp(decryptSecret(u.rows[0].totp_secret), t)
  if (!ok && /^\d{6}$/.test(t) === false && /^[0-9a-f]{10}$/i.test(t)) {
    const h = crypto.createHash('sha256').update(t.toLowerCase()).digest('hex')
    const rc = await pool.query('DELETE FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id', [uid, h])
    ok = rc.rows.length > 0
  }
  if (!ok) return res.status(400).json({ error: 'Invalid or expired code' })
  const claimed = await pool.query('DELETE FROM login_challenges WHERE login_token = $1 AND expires_at > NOW() RETURNING user_id', [login_token])
  if (claimed.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired code' })
  const token = generateToken(uid)
  const refreshToken = newRefreshToken()
  await pool.query('INSERT INTO sessions (user_id, refresh_hash, user_agent, last_ip) VALUES ($1, $2, $3, $4)', [uid, hashRefreshToken(refreshToken), String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req)])
  await pool.query('UPDATE users SET last_ip = $1, last_login_at = NOW() WHERE id = $2', [clientIp(req), uid]).catch(() => {})
  return res.json({ user: { id: u.rows[0].id, email: u.rows[0].email }, token, refresh_token: refreshToken, message: 'Login successful' })
}
const result = await pool.query(`SELECT user_id FROM login_codes WHERE login_token = $1 AND code = $2 AND expires_at > NOW()`, [login_token, code])
if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired code' })
const user = await pool.query('SELECT id, email, suspended FROM users WHERE id = $1', [result.rows[0].user_id])
if (user.rows[0].suspended) return res.status(403).json({ error: 'Account suspended', code: 'suspended' })
const token = generateToken(user.rows[0].id)
const refresh_token = (await issueSession(user.rows[0].id, req)).refresh_token
await pool.query('DELETE FROM login_codes WHERE login_token = $1', [login_token])
await pool.query('UPDATE users SET last_ip = $1, last_login_at = NOW() WHERE id = $2', [clientIp(req), user.rows[0].id]).catch(() => {})
res.json({ user: { id: user.rows[0].id, email: user.rows[0].email }, token, refresh_token, message: 'Login successful' })
})
app.post('/api/auth/send-verification', emailLimiter, authenticate, async (req, res) => {
const userId = req.user.id
const code = crypto.randomInt(100000, 999999).toString()
await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [userId])
await pool.query('INSERT INTO email_verifications (user_id, code) VALUES ($1, $2)', [userId, code])
const sent = await sendVerificationCode(req.user.email, code)
if (!sent) return res.status(502).json({ error: 'Could not send the verification email. Check the server logs for the Resend error.' })
res.json({ message: 'Verification code sent to your email', email: req.user.email })
})
app.post('/api/auth/verify', loginLimiter, authenticate, async (req, res) => {
const { code } = req.body
const userId = req.user.id
if (!code) return res.status(400).json({ error: 'Verification code required' })
const result = await pool.query(`UPDATE email_verifications SET verified = TRUE WHERE user_id = $1 AND code = $2 AND expires_at > NOW() RETURNING *`, [userId, code])
if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired verification code' })
res.json({ message: 'Email verified successfully!' })
})
app.get('/api/auth/verification-status', authenticate, async (req, res) => {
const result = await pool.query('SELECT verified FROM email_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id])
const verified = result.rows[0]?.verified || false
res.json({ verified })
})

app.get('/api/auth/2fa/status', authenticate, async (req, res) => {
  const r = await pool.query('SELECT totp_enabled FROM users WHERE id = $1', [req.user.id])
  const enabled = !!r.rows[0]?.totp_enabled
  const rc = await pool.query('SELECT COUNT(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [req.user.id])
  res.json({ enabled, unused_recovery_codes: rc.rows[0].n })
})

app.post('/api/auth/2fa/setup', loginLimiter, authenticate, async (req, res) => {
  const cur = await pool.query('SELECT totp_enabled FROM users WHERE id = $1', [req.user.id])
  if (cur.rows[0]?.totp_enabled) return res.status(409).json({ error: 'Two-factor is already enabled' })
  const secret = generateSecret()
  await pool.query('UPDATE users SET totp_secret = $2, totp_enabled = FALSE WHERE id = $1', [req.user.id, encryptSecret(secret)])
  res.json({ secret, otpauth_url: otpauthUrl(req.user.email, secret) })
})

app.post('/api/auth/2fa/enable', loginLimiter, authenticate, async (req, res) => {
  const { code } = req.body
  const u = await pool.query('SELECT email, totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id])
  if (!u.rows[0]?.totp_secret) return res.status(400).json({ error: 'Start the setup first' })
  if (u.rows[0].totp_enabled) return res.status(409).json({ error: 'Two-factor is already enabled' })
  if (!verifyTotp(decryptSecret(u.rows[0].totp_secret), code)) return res.status(400).json({ error: 'That code did not match. Wait for the next code and try again.' })
  await pool.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [req.user.id])
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'))
  await pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [req.user.id])
  for (const c of codes) {
    await pool.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [req.user.id, crypto.createHash('sha256').update(c).digest('hex')])
  }
  res.json({ enabled: true, recovery_codes: codes, message: 'Two-factor enabled. Store these recovery codes now; they are shown once.' })
})

app.post('/api/auth/2fa/disable', loginLimiter, authenticate, async (req, res) => {
  const { password, code } = req.body
  const u = await pool.query('SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id])
  if (!u.rows[0]?.totp_enabled) return res.status(400).json({ error: 'Two-factor is not enabled' })
  const pwOk = u.rows[0].password_hash ? await verifyPassword(String(password || ''), u.rows[0].password_hash) : true
  if (!pwOk) return res.status(401).json({ error: 'Wrong password' })
  if (!verifyTotp(decryptSecret(u.rows[0].totp_secret), code)) return res.status(400).json({ error: 'Invalid or expired code' })
  await pool.query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1', [req.user.id])
  await pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [req.user.id])
  res.json({ enabled: false, message: 'Two-factor disabled' })
})

app.post('/api/projects/:id/rotate-key', authenticate, async (req, res) => {
  const id = req.params.id
  const own = await pool.query('SELECT id, user_id FROM projects WHERE id = $1', [id])
  if (own.rows.length === 0) return res.status(404).json({ error: 'Project not found' })
  const isOwner = own.rows[0].user_id === req.user.id
  if (!isOwner) {
    const shared = await sharedTeamIdsForProject(id)
    const role = await Promise.all(
      shared.map((t) => teamRole(t.id, req.user.id))
    )
    if (!role.some((r) => r === 'owner' || r === 'admin')) {
      return res.status(403).json({ error: 'Only the project owner or a team owner/admin can rotate the key' })
    }
  }
  const apiKey = 'dk_' + crypto.randomBytes(32).toString('hex')
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const r = await pool.query(
    'UPDATE projects SET api_key = NULL, key_hash = $2, key_prefix = $3, key_rotated_at = NOW() WHERE id = $1 RETURNING id, name, key_prefix, key_rotated_at',
    [id, keyHash, apiKey.slice(0, 8)]
  )
  res.json({ ...r.rows[0], api_key: apiKey, message: 'Key rotated. The previous key no longer works.' })
})

app.post('/api/projects/:id/api-key', authenticate, async (req, res) => {
  const id = req.params.id
  const own = await pool.query('SELECT id, user_id, key_hash FROM projects WHERE id = $1', [id])
  if (own.rows.length === 0) return res.status(404).json({ error: 'Project not found' })
  const isOwner = own.rows[0].user_id === req.user.id
  if (!isOwner) {
    const shared = await sharedTeamIdsForProject(id)
    const role = await Promise.all(
      shared.map((t) => teamRole(t.id, req.user.id))
    )
    if (!role.some((r) => r === 'owner' || r === 'admin')) {
      return res.status(403).json({ error: 'Only the project owner or a team owner/admin can create the key' })
    }
  }
  if (own.rows[0].key_hash) return res.status(409).json({ error: 'This project already has an API key. Rotate it to replace it, or revoke it first.' })
  const apiKey = 'dk_' + crypto.randomBytes(32).toString('hex')
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const r = await pool.query(
    'UPDATE projects SET api_key = NULL, key_hash = $2, key_prefix = $3, key_rotated_at = NOW() WHERE id = $1 RETURNING id, name, key_prefix, key_rotated_at',
    [id, keyHash, apiKey.slice(0, 8)]
  )
  res.json({ ...r.rows[0], api_key: apiKey, message: 'API key created. It is shown once and stored hashed.' })
})

app.delete('/api/projects/:id/api-key', authenticate, async (req, res) => {
  const id = req.params.id
  const own = await pool.query('SELECT id, user_id FROM projects WHERE id = $1', [id])
  if (own.rows.length === 0) return res.status(404).json({ error: 'Project not found' })
  const isOwner = own.rows[0].user_id === req.user.id
  if (!isOwner) {
    const shared = await sharedTeamIdsForProject(id)
    const role = await Promise.all(
      shared.map((t) => teamRole(t.id, req.user.id))
    )
    if (!role.some((r) => r === 'owner' || r === 'admin')) {
      return res.status(403).json({ error: 'Only the project owner or a team owner/admin can revoke the key' })
    }
  }
  await pool.query('UPDATE projects SET api_key = NULL, key_hash = NULL, key_prefix = NULL, key_rotated_at = NOW() WHERE id = $1', [id])
  res.json({ success: true, message: 'API key revoked. The project is keyless until a new one is created.' })
})

app.get('/api/auth/sessions', authenticate, async (req, res) => {
  const currentHash = req.get('x-session-token') ? hashRefreshToken(String(req.get('x-session-token'))) : null
  const r = await pool.query(
    `SELECT id, user_agent, last_ip, created_at, last_used_at, expires_at,
            (refresh_hash = $2) AS current
     FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_used_at DESC LIMIT 50`,
    [req.user.id, currentHash]
  )
  res.json(r.rows)
})

app.delete('/api/auth/sessions/:id', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Session not found' })
  const r = await pool.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id])
  if (r.rows.length === 0) return res.status(404).json({ error: 'Session not found' })
  res.json({ ok: true })
})

app.post('/api/auth/sessions/revoke-others', authenticate, async (req, res) => {
  const currentHash = req.get('x-session-token') ? hashRefreshToken(String(req.get("x-session-token"))) : null
  if (!currentHash) return res.status(400).json({ error: 'x-session-token header required' })
  const r = await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND refresh_hash <> $2 AND revoked_at IS NULL RETURNING id', [req.user.id, currentHash])
  res.json({ ok: true, revoked: r.rowCount })
})
app.get('/api/auth/session', authenticate, async (req, res) => {
  const r = await pool.query('SELECT is_admin, suspended FROM users WHERE id = $1', [req.user.id])
  if (r.rows[0]?.suspended) return res.status(403).json({ error: 'Account suspended' })
  pool.query('UPDATE users SET last_ip = $1, last_login_at = NOW() WHERE id = $2', [clientIp(req), req.user.id]).catch(() => {})
  res.json({ id: req.user.id, email: req.user.email })
})

app.post('/api/auth/refresh', loginLimiter, async (req, res) => {
  const { refresh_token } = req.body
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' })
  const hash = hashRefreshToken(String(refresh_token))
  const r = await pool.query(
    `UPDATE sessions s SET last_used_at = NOW(), last_ip = $2
     FROM users u
     WHERE s.refresh_hash = $1 AND s.user_id = u.id
       AND s.revoked_at IS NULL AND s.expires_at > NOW() AND NOT u.suspended
     RETURNING s.user_id, u.email`,
    [hash, clientIp(req)]
  )
  if (r.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired session. Please log in again.', code: 'session_invalid' })
  const { user_id, email } = r.rows[0]
  const newToken = newRefreshToken()
  await pool.query('UPDATE sessions SET refresh_hash = $2 WHERE refresh_hash = $1', [hash, hashRefreshToken(newToken)])
  res.json({ token: generateToken(user_id), refresh_token: newToken, user: { id: user_id, email } })
})

app.post('/api/auth/logout', async (req, res) => {
  const { refresh_token } = req.body || {}
  if (refresh_token) {
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE refresh_hash = $1 AND revoked_at IS NULL', [hashRefreshToken(String(refresh_token))])
  }
  res.json({ ok: true })
})
app.post('/api/projects', authenticate, async (req, res) => {
const verifyResult = await pool.query('SELECT verified FROM email_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id])
if (!verifyResult.rows[0]?.verified) return res.status(403).json({ error: 'Email not verified. Please verify your email first.' })
const { name } = req.body
if (!name) return res.status(400).json({ error: 'Project name required' })
const result = await pool.query(
  'INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id, user_id, name, created_at, key_prefix, key_rotated_at',
  [req.user.id, name]
)
res.json({ ...result.rows[0], message: 'Project created successfully' })
})
app.get('/api/projects', authenticate, async (req, res) => {
const result = await pool.query('SELECT id, user_id, name, key_prefix, key_rotated_at, (api_key IS NOT NULL) AS has_plain_key, created_at FROM projects WHERE user_id = $1', [req.user.id])
const shared = await listSharedProjects(req.user.id)
res.json({ projects: result.rows, shared_projects: shared })
})
app.get('/api/projects/:id', authenticate, async (req, res) => {
const { id } = req.params
const result = await pool.query('SELECT id, user_id, name, key_prefix, key_rotated_at, (api_key IS NOT NULL) AS has_plain_key, created_at FROM projects WHERE id = $1 AND user_id = $2', [id, req.user.id])
if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' })
res.json({ ...result.rows[0], shared_teams: await sharedTeamIdsForProject(id) })
})

app.get('/api/projects/:id/audit', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const r = await pool.query(
    `SELECT key, environment, action, actor, actor_ip, created_at
     FROM env_history WHERE project_id = $1
     ORDER BY created_at DESC LIMIT 100`,
    [req.params.id]
  )
  res.json({ events: r.rows })
})
app.delete('/api/projects/:id', authenticate, async (req, res) => {
const { id } = req.params
const deleted = await pool.query('DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id])
if (deleted.rows.length) await clearProjectCache(id).catch(() => {})
res.json({ success: true, message: 'Project deleted' })
})

app.post('/api/projects/:id/verify-key', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  const { key } = req.body || {}
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key required' })
  const r = await projectAccessFor(req.params.id, req.user.id)
  if (!r) return res.status(404).json({ error: 'Project not found' })
  const matches = crypto.createHash('sha256').update(key).digest('hex') === r.key_hash
  res.json({ matches, key_prefix: r.key_prefix })
})

function validateSchedule(schedule) {
  return typeof jobs.parseSchedule(schedule) === 'number'
}

app.get('/api/projects/:id/cron', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const r = await pool.query('SELECT id, name, url, method, headers, body, schedule, enabled, last_run_at, next_run_at, last_status, created_at FROM cron_jobs WHERE project_id = $1 ORDER BY created_at ASC', [req.params.id])
  res.json({ jobs: r.rows })
})

app.post('/api/projects/:id/cron', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const { name, url, schedule, method = 'POST', headers, body } = req.body || {}
  if (!name || typeof name !== 'string' || name.length > 80) return res.status(400).json({ error: 'name required (max 80 chars)' })
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http:// or https://' })
  if (!validateSchedule(schedule)) return res.status(400).json({ error: 'Invalid schedule. Use "5m", "30s", "2h", "daily 09:30", or "mon 09:00" (UTC). Minimum interval is 10 seconds.' })
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(String(method).toUpperCase())) return res.status(400).json({ error: 'Invalid method' })
  if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers))) return res.status(400).json({ error: 'headers must be a JSON object' })
  const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM cron_jobs WHERE project_id = $1', [req.params.id])
  if (cnt.rows[0].n >= 20) return res.status(400).json({ error: 'Cron job limit reached for this project (20)' })
  try {
    const r = await pool.query(
      `INSERT INTO cron_jobs (project_id, name, url, method, headers, body, schedule, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, url, method, headers, body, schedule, enabled, last_run_at, next_run_at, last_status, created_at`,
      [req.params.id, name.trim(), url, String(method).toUpperCase(), headers || {}, body ?? null, String(schedule).trim().toLowerCase(), jobs.firstRunAt(String(schedule))]
    )
    res.json(r.rows[0])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A job named "' + name + '" already exists on this project' })
    throw e
  }
})

app.post('/api/projects/:id/cron/:jobId/run', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.jobId)) return res.status(404).json({ error: 'Job not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const job = await pool.query('SELECT * FROM cron_jobs WHERE id = $1 AND project_id = $2', [req.params.jobId, req.params.id])
  if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' })
  const result = await jobs.executeCronJob(job.rows[0])
  await jobs.recordCronRun(job.rows[0], result)
  res.json({ ok: !result.errorText, status_code: result.statusCode, duration_ms: result.durationMs, error: result.errorText })
})

app.patch('/api/projects/:id/cron/:jobId', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.jobId)) return res.status(404).json({ error: 'Job not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const job = await pool.query('SELECT * FROM cron_jobs WHERE id = $1 AND project_id = $2', [req.params.jobId, req.params.id])
  if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' })
  const { enabled, url, method, headers, body, schedule } = req.body || {}
  const nextRun = schedule !== undefined ? (validateSchedule(schedule) ? jobs.firstRunAt(schedule) : null) : (job.rows[0].next_run_at)
  if (schedule !== undefined && !validateSchedule(schedule)) return res.status(400).json({ error: 'Invalid schedule. Use "5m", "30s", "2h", "daily 09:30", or "mon 09:00" (UTC).' })
  const r = await pool.query(
    `UPDATE cron_jobs SET
       enabled = $3,
       url = COALESCE($4, url),
       method = COALESCE($5, method),
       headers = COALESCE($6, headers),
       body = COALESCE($7, body),
       schedule = COALESCE($8, schedule),
       next_run_at = CASE WHEN $9 THEN $10 ELSE next_run_at END
     WHERE id = $1 AND project_id = $2
     RETURNING id, name, url, method, headers, body, schedule, enabled, last_run_at, next_run_at, last_status, created_at`,
    [req.params.jobId, req.params.id,
     enabled !== undefined ? !!enabled : job.rows[0].enabled,
     typeof url === 'string' ? url : null,
     method !== undefined ? String(method).toUpperCase() : null,
     headers !== undefined ? headers : null,
     body !== undefined ? body : null,
     schedule !== undefined ? String(schedule).trim().toLowerCase() : null,
     schedule !== undefined,
     nextRun]
  )
  res.json(r.rows[0])
})

app.delete('/api/projects/:id/cron/:jobId', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.jobId)) return res.status(404).json({ error: 'Job not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const r = await pool.query('DELETE FROM cron_jobs WHERE id = $1 AND project_id = $2 RETURNING id', [req.params.jobId, req.params.id])
  if (r.rows.length === 0) return res.status(404).json({ error: 'Job not found' })
  res.json({ ok: true })
})

app.get('/api/projects/:id/cron/:jobId/runs', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.jobId)) return res.status(404).json({ error: 'Job not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const r = await pool.query('SELECT started_at, duration_ms, status_code, ok, error FROM cron_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT 20', [req.params.jobId])
  res.json({ runs: r.rows })
})

app.get('/api/projects/:id/monitors', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const r = await pool.query('SELECT id, name, url, method, interval_seconds, email, paused, status, last_checked_at, last_status_code, last_latency_ms, last_error, down_since, created_at FROM monitors WHERE project_id = $1 ORDER BY created_at ASC', [req.params.id])
  res.json({ monitors: r.rows })
})

app.post('/api/projects/:id/monitors', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const { name, url, method = 'GET', interval_seconds = 60, email } = req.body || {}
  if (!name || typeof name !== 'string' || name.length > 80) return res.status(400).json({ error: 'name required (max 80 chars)' })
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http:// or https://' })
  const interval = Number(interval_seconds)
  if (!Number.isFinite(interval) || interval < 30 || interval > 3600) return res.status(400).json({ error: 'interval_seconds must be between 30 and 3600' })
  if (!['GET', 'HEAD', 'POST'].includes(String(method).toUpperCase())) return res.status(400).json({ error: 'method must be GET, HEAD or POST' })
  if (email && !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Invalid alert email address' })
  const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM monitors WHERE project_id = $1', [req.params.id])
  if (cnt.rows[0].n >= 20) return res.status(400).json({ error: 'Monitor limit reached for this project (20)' })
  try {
    const r = await pool.query(
      `INSERT INTO monitors (project_id, name, url, method, interval_seconds, email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, url, method, interval_seconds, email, paused, status, last_checked_at, last_status_code, last_latency_ms, last_error, down_since, created_at`,
      [req.params.id, name.trim(), url, String(method).toUpperCase(), Math.round(interval), email || req.user.email]
    )
    res.json(r.rows[0])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A monitor named "' + name + '" already exists on this project' })
    throw e
  }
})

app.patch('/api/projects/:id/monitors/:monitorId', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.monitorId)) return res.status(404).json({ error: 'Monitor not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const { paused, email } = req.body || {}
  const r = await pool.query(
    `UPDATE monitors SET
       paused = COALESCE($3, paused),
       email = COALESCE($4, email)
     WHERE id = $1 AND project_id = $2
     RETURNING id, name, url, method, interval_seconds, email, paused, status, last_checked_at, last_status_code, last_latency_ms, last_error, down_since, created_at`,
    [req.params.monitorId, req.params.id, paused !== undefined ? !!paused : null, email !== undefined ? email : null]
  )
  if (r.rows.length === 0) return res.status(404).json({ error: 'Monitor not found' })
  res.json(r.rows[0])
})

app.delete('/api/projects/:id/monitors/:monitorId', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.monitorId)) return res.status(404).json({ error: 'Monitor not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const r = await pool.query('DELETE FROM monitors WHERE id = $1 AND project_id = $2 RETURNING id', [req.params.monitorId, req.params.id])
  if (r.rows.length === 0) return res.status(404).json({ error: 'Monitor not found' })
  res.json({ ok: true })
})

app.get('/api/projects/:id/monitors/:monitorId/checks', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.monitorId)) return res.status(404).json({ error: 'Monitor not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const mon = await pool.query('SELECT id FROM monitors WHERE id = $1 AND project_id = $2', [req.params.monitorId, req.params.id])
  if (mon.rows.length === 0) return res.status(404).json({ error: 'Monitor not found' })
  const r = await pool.query('SELECT checked_at, status_code, ok, latency_ms, error FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 100', [req.params.monitorId])
  res.json({ checks: r.rows })
})
const LOG_LEVELS = ['debug', 'info', 'warn', 'error']
const MAX_LOGS_PER_PROJECT = 5000

async function insertLogEvents(projectId, events, fallbackSource) {
  const rows = []
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    const message = String(ev.message ?? '').slice(0, 4000)
    if (!message) continue
    rows.push([
      projectId,
      LOG_LEVELS.includes(String(ev.level || '').toLowerCase()) ? String(ev.level).toLowerCase() : 'info',
      message,
      ev.meta && typeof ev.meta === 'object' ? JSON.stringify(ev.meta).slice(0, 8000) : null,
      String(ev.source || fallbackSource || '').slice(0, 120) || null,
      ev.ts && !isNaN(Date.parse(ev.ts)) ? new Date(ev.ts) : new Date(),
    ])
  }
  if (rows.length === 0) return 0
  const values = rows.map((_, i) => {
    const b = i * 6
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5}, $${b + 6})`
  }).join(', ')
  const flat = rows.flat()
  const r = await pool.query(
    `INSERT INTO log_entries (project_id, level, message, meta, source, ts) VALUES ${values}`,
    flat
  )
  return r.rowCount
}

app.post('/api/projects/:id/logs', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [req.body || {}]
  try {
    const inserted = await insertLogEvents(req.params.id, events, 'dashboard')
    res.json({ ok: true, inserted })
  } catch (e) { res.status(500).json({ error: 'Could not store log events' }) }
})

app.post('/api/logs', projectLimiter, authenticateProject, async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [req.body || {}]
  try {
    const inserted = await insertLogEvents(req.project.id, events, 'api')
    res.json({ ok: true, inserted })
  } catch (e) { res.status(500).json({ error: 'Could not store log events' }) }
})

app.get('/api/projects/:id/logs', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  const level = LOG_LEVELS.includes(String(req.query.level || '')) ? String(req.query.level) : null
  const search = String(req.query.search || '').slice(0, 200)
  const before = req.query.before && !isNaN(Date.parse(req.query.before)) ? req.query.before : null
  const params = [req.params.id]
  let where = 'project_id = $1'
  if (level) { params.push(level); where += ` AND level = $${params.length}` }
  if (search) { params.push('%' + search + '%'); where += ` AND message ILIKE $${params.length}` }
  if (before) { params.push(before); where += ` AND ts < $${params.length}::timestamptz` }
  params.push(100)
  const r = await pool.query(
    `SELECT id, level, message, meta, source, ts FROM log_entries WHERE ${where} ORDER BY ts DESC LIMIT $${params.length}`,
    params
  )
  res.json({ logs: r.rows })
})

app.delete('/api/projects/:id/logs', authenticate, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  await pool.query('DELETE FROM log_entries WHERE project_id = $1 AND ts < NOW()', [req.params.id])
  res.json({ ok: true })
})

const FILE_MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES) || 15 * 1024 * 1024
const FILE_MIN_TTL = 60
const FILE_MAX_TTL = 30 * 24 * 3600
const CONTENT_TYPE_RE = /^[\w.+-]+\/[\w.+-]+$/

function fileUrlFor(row) {
  const base = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '')
  return (base || '') + '/f/' + row.key
}
function safeFilename(raw) {
  const name = String(raw || 'file').split(/[\\/]/).pop().slice(0, 200).trim()
  return name || 'file'
}
function newFileKey() { return crypto.randomBytes(9).toString('base64url') }

app.post('/api/files', projectLimiter, authenticateProject, express.raw({ type: () => true, limit: FILE_MAX_BYTES }), async (req, res) => {
  if (!(req.headers['content-length'] || '').trim() && req.body?.length === 0) return res.status(400).json({ error: 'Empty file' })
  if (!req.body || req.body.length === 0) return res.status(400).json({ error: 'Empty file' })
  const filename = safeFilename(req.headers['x-filename'])
  const contentType = CONTENT_TYPE_RE.test(String(req.headers['x-content-type'] || '')) ? String(req.headers['x-content-type']) : 'application/octet-stream'
  const ttlSeconds = req.headers['x-ttl'] ? Number(req.headers['x-ttl']) : null
  if (req.headers['x-ttl'] && (!Number.isFinite(ttlSeconds) || ttlSeconds < FILE_MIN_TTL || ttlSeconds > FILE_MAX_TTL)) {
    return res.status(400).json({ error: `TTL must be between ${FILE_MIN_TTL} and ${FILE_MAX_TTL} seconds` })
  }

  try {
    await r2.ensureReady()
  } catch (err) {
    console.error('media upload not ready:', err.message)
    return res.status(err.status && err.status !== 500 ? err.status : 500).json({ error: err.message })
  }

  const key = newFileKey()
  const r2Key = `u/${req.project.id}/${key}`
  const sha256 = crypto.createHash('sha256').update(req.body).digest('hex')
  try {
    await r2.putObject(r2Key, req.body, contentType)
    const expires = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null
    const ins = await pool.query(
      `INSERT INTO media_files (project_id, user_id, key, r2_key, filename, content_type, byte_size, sha256, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (key) DO NOTHING RETURNING *`,
      [req.project.id, req.project.user_id, key, r2Key, filename, contentType, req.body.length, sha256, expires]
    )
    if (ins.rows.length === 0) return res.status(409).json({ error: 'Key collision — try again' })
    const row = ins.rows[0]
    res.json({
      key: row.key,
      filename: row.filename,
      content_type: row.content_type,
      size: row.byte_size,
      sha256: row.sha256,
      expires_at: row.expires_at,
      url: fileUrlFor(row),
    })
  } catch (err) {
    console.error('media upload error:', err)
    res.status(500).json({ error: 'Could not store file' })
  }
})

const publicFileLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false })
app.get('/f/:key', publicFileLimiter, async (req, res) => {
  const key = String(req.params.key || '').slice(0, 40)
  if (!/^[\w-]{4,40}$/.test(key)) return res.status(404).json({ error: 'Not found' })
  const r = await pool.query('SELECT * FROM media_files WHERE key = $1 AND deleted_at IS NULL', [key])
  const row = r.rows[0]
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    return res.status(410).json({ error: 'This link has expired.' })
  }
  const base = r2.publicBase()
  if (base && !row.expires_at) {
    return res.redirect(302, base + '/' + row.r2_key.split('/').map(encodeURIComponent).join('/'))
  }
  try {
    const upstream = await r2.getObject(row.r2_key)
    res.setHeader('Content-Type', row.content_type)
    res.setHeader('Content-Length', row.byte_size)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', row.expires_at ? 'no-store' : 'public, max-age=31536000, immutable')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    if (!row.expires_at) pool.query('UPDATE media_files SET hits = hits + 1 WHERE id = $1', [row.id]).catch(() => {})
    const bodyStream = upstream.body
    const nodeReadable = bodyStream && typeof bodyStream.on === 'function' ? bodyStream : require('stream').Readable.fromWeb(bodyStream)
    nodeReadable.pipe(res)
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Not found' })
    console.error('media serve error:', err.message)
    res.status(502).json({ error: 'Could not load file from storage' })
  }
})

async function mediaAccessGuard(req, res, next) {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Project not found' })
  if (!(await projectAccessFor(req.params.id, req.user.id))) return res.status(404).json({ error: 'Project not found' })
  next()
}

app.get('/api/projects/:id/files', authenticate, mediaAccessGuard, async (req, res) => {
  const r = await pool.query(
    `SELECT id, key, filename, content_type, byte_size, sha256, expires_at, hits, created_at
     FROM media_files WHERE project_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 300`
  , [req.params.id])
  res.json({ files: r.rows.map((row) => ({ ...row, url: fileUrlFor(row) })) })
})

app.delete('/api/projects/:id/files/:key', authenticate, mediaAccessGuard, async (req, res) => {
  const key = String(req.params.key || '').slice(0, 40)
  if (!/^[\w-]{4,40}$/.test(key)) return res.status(404).json({ error: 'File not found' })
  const r = await pool.query(
    'SELECT * FROM media_files WHERE project_id = $1 AND key = $2 AND deleted_at IS NULL',
    [req.params.id, key]
  )
  if (r.rows.length === 0) return res.status(404).json({ error: 'File not found' })
  try {
    await r2.deleteObject(r.rows[0].r2_key)
  } catch (err) {
    console.error('R2 delete failed for ' + key + ':', err.message)
    return res.status(502).json({ error: 'File removed from the listing, but storage did not confirm deletion. It will be retried.' })
  }
  await pool.query('UPDATE media_files SET deleted_at = NOW() WHERE id = $1', [r.rows[0].id])
  res.json({ ok: true })
})


app.get('/api/env', projectLimiter, authenticateProject, async (req, res) => {
const { environment } = req.query
const mask = req.query.mask === '1'
const masked = (v) => '•'.repeat(Math.max(4, Math.min(String(v).length, 16)))
if (environment) {
const result = await pool.query('SELECT key, value FROM env_vars WHERE project_id = $1 AND environment = $2', [req.project.id, environment])
const env = {}
result.rows.forEach(row => { const plain = decryptSecret(row.value); env[row.key] = mask ? masked(plain) : plain })
return res.json({ env, count: Object.keys(env).length, environment })
}
const result = await pool.query('SELECT key, value, environment FROM env_vars WHERE project_id = $1', [req.project.id])
const env = {}
result.rows.forEach(row => {
const key = row.environment === 'production' ? row.key : row.key + '__' + row.environment
const plain = decryptSecret(row.value)
env[key] = mask ? masked(plain) : plain
})
res.json({ env, count: Object.keys(env).length })
})
app.get('/api/env/:key', projectLimiter, authenticateProject, async (req, res) => {
const { key } = req.params
const { environment = 'production' } = req.query
const result = await pool.query('SELECT value FROM env_vars WHERE project_id = $1 AND key = $2 AND environment = $3', [req.project.id, key, environment])
if (result.rows.length === 0) return res.status(404).json({ error: 'Environment variable not found' })
res.json({ key, value: decryptSecret(result.rows[0].value), environment })
})
app.post('/api/env', projectLimiter, authenticateProject, async (req, res) => {
const { key, value, environment = 'production' } = req.body
if (!key || value === undefined) return res.status(400).json({ error: 'Key and value required' })
const existing = await pool.query('SELECT value FROM env_vars WHERE project_id = $1 AND key = $2 AND environment = $3', [req.project.id, key, environment])
await pool.query('INSERT INTO env_history (project_id, key, environment, old_value, action, actor, actor_ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
[req.project.id, key, environment, encryptSecret(existing.rows[0]?.value || ''), existing.rows.length > 0 ? 'update' : 'set', String(req.headers['x-dkit-actor'] || '').slice(0, 120) || null, clientIp(req)])
await pool.query(`INSERT INTO env_vars (project_id, key, value, environment) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, key, environment) DO UPDATE SET value = $3`, [req.project.id, key, encryptSecret(value), environment])
res.json({ success: true, message: 'Environment variable saved' })
})

app.post('/api/env/import', projectLimiter, authenticateProject, async (req, res) => {
  const { vars, environment = 'production' } = req.body || {}
  if (!Array.isArray(vars) || vars.length === 0) return res.status(400).json({ error: 'vars array required' })
  if (vars.length > 200) return res.status(400).json({ error: 'Too many variables (max 200 per import)' })
  const keys = vars.map((v) => String(v?.key || '').trim())
  if (keys.some((k) => !k || k.length > 120)) return res.status(400).json({ error: 'Each variable needs a key (max 120 chars)' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < vars.length; i++) {
      const value = String(vars[i].value ?? '')
      const existing = await client.query('SELECT value FROM env_vars WHERE project_id = $1 AND key = $2 AND environment = $3', [req.project.id, keys[i], environment])
      await client.query('INSERT INTO env_history (project_id, key, environment, old_value, action, actor, actor_ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.project.id, keys[i], environment, encryptSecret(existing.rows[0]?.value || ''), existing.rows.length > 0 ? 'update' : 'set', String(req.headers['x-dkit-actor'] || '').slice(0, 120) || null, clientIp(req)])
      await client.query(`INSERT INTO env_vars (project_id, key, value, environment) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, key, environment) DO UPDATE SET value = $3`, [req.project.id, keys[i], encryptSecret(value), environment])
    }
    await client.query('COMMIT')
    res.json({ success: true, imported: vars.length })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: 'Import failed — nothing was saved' })
  } finally {
    client.release()
  }
})
app.post('/api/env/copy', projectLimiter, authenticateProject, async (req, res) => {
const { from, to } = req.body
if (!from || !to) return res.status(400).json({ error: 'from and to environments are required' })
if (from === to) return res.status(400).json({ error: 'from and to must be different environments' })
const result = await pool.query(`INSERT INTO env_vars (project_id, key, value, environment) SELECT project_id, key, value, $3 FROM env_vars WHERE project_id = $1 AND environment = $2 ON CONFLICT (project_id, key, environment) DO UPDATE SET value = EXCLUDED.value RETURNING key`, [req.project.id, from, to])
res.json({ success: true, copied: result.rows.length, message: `Copied ${result.rows.length} variable(s) from ${from} to ${to}` })
})
app.post('/api/env/rollback', projectLimiter, authenticateProject, async (req, res) => {
const { key, environment = 'production' } = req.body
if (!key) return res.status(400).json({ error: 'Key required' })
const history = await pool.query('SELECT old_value FROM env_history WHERE project_id = $1 AND key = $2 AND environment = $3 ORDER BY created_at DESC LIMIT 1', [req.project.id, key, environment])
if (history.rows.length === 0) return res.status(404).json({ error: 'No history to rollback to' })
const oldValue = decryptSecret(history.rows[0].old_value)
const current = await pool.query('SELECT value FROM env_vars WHERE project_id = $1 AND key = $2 AND environment = $3', [req.project.id, key, environment])
await pool.query('INSERT INTO env_history (project_id, key, environment, old_value, action, actor, actor_ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
[req.project.id, key, environment, encryptSecret(current.rows[0]?.value || ''), 'rollback', String(req.headers['x-dkit-actor'] || '').slice(0, 120) || null, clientIp(req)])
await pool.query(`INSERT INTO env_vars (project_id, key, value, environment) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, key, environment) DO UPDATE SET value = $3`, [req.project.id, key, encryptSecret(oldValue), environment])
res.json({ success: true, message: `Rolled back ${key} to previous value` })
})
app.delete('/api/env/:key', projectLimiter, authenticateProject, async (req, res) => {
const { key } = req.params
const { environment = 'production' } = req.query
const deleted = await pool.query('DELETE FROM env_vars WHERE project_id = $1 AND key = $2 AND environment = $3 RETURNING value', [req.project.id, key, environment])
if (deleted.rows.length > 0) {
await pool.query('INSERT INTO env_history (project_id, key, environment, old_value, action, actor, actor_ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
[req.project.id, key, environment, encryptSecret(deleted.rows[0].value), 'delete', String(req.headers['x-dkit-actor'] || '').slice(0, 120) || null, clientIp(req)])
}
res.json({ success: true, message: 'Environment variable deleted' })
})

app.get('/api/env/:key/history', projectLimiter, authenticateProject, async (req, res) => {
const { environment = 'production' } = req.query
const r = await pool.query(
`SELECT action, actor, actor_ip, old_value, created_at
 FROM env_history WHERE project_id = $1 AND key = $2 AND environment = $3
 ORDER BY created_at DESC LIMIT 100`,
[req.project.id, req.params.key, environment]
)
res.json({ events: r.rows.map(({ old_value, ...row }) => ({ ...row, old_length: decryptSecret(old_value).length })) })
})
app.get('/api/store/:key', projectLimiter, authenticateProject, async (req, res) => {
const { key } = req.params
const result = await pool.query('SELECT value, expires_at FROM kv_store WHERE project_id = $1 AND key = $2 AND (expires_at IS NULL OR expires_at > NOW())', [req.project.id, key])
if (result.rows.length === 0) return res.status(404).json({ error: 'Key not found' })
res.json(result.rows[0].value)
})
app.post('/api/store/:key', projectLimiter, authenticateProject, async (req, res) => {
const { key } = req.params
const { value, ttl } = req.body
if (value === undefined) return res.status(400).json({ error: 'Value required' })
if (ttl !== undefined && (typeof ttl !== 'number' || ttl <= 0)) return res.status(400).json({ error: 'ttl must be a positive number of seconds' })
await pool.query(`INSERT INTO kv_store (project_id, key, value, expires_at) VALUES ($1, $2, $3, ${ttl ? `NOW() + INTERVAL '${Number(ttl)} seconds'` : 'NULL'}) ON CONFLICT (project_id, key) DO UPDATE SET value = $3, updated_at = NOW(), expires_at = ${ttl ? `NOW() + INTERVAL '${Number(ttl)} seconds'` : 'NULL'}`, [req.project.id, key, JSON.stringify(value)])
res.json({ success: true, message: 'Key stored successfully', expires_in: ttl || null })
})
app.post('/api/store/:key/increment', projectLimiter, authenticateProject, async (req, res) => {
const { key } = req.params
const by = typeof req.body?.by === 'number' ? req.body.by : 1
const result = await pool.query(`INSERT INTO kv_store (project_id, key, value) VALUES ($1, $2, $3::jsonb) ON CONFLICT (project_id, key) DO UPDATE SET value = to_jsonb(COALESCE((kv_store.value)::text::numeric, 0) + $4), updated_at = NOW() RETURNING value`, [req.project.id, key, JSON.stringify(by), by])
res.json({ key, value: result.rows[0].value })
})
app.delete('/api/store/:key', projectLimiter, authenticateProject, async (req, res) => {
const { key } = req.params
await pool.query('DELETE FROM kv_store WHERE project_id = $1 AND key = $2', [req.project.id, key])
res.json({ success: true, message: 'Key deleted' })
})
app.get('/api/store', projectLimiter, authenticateProject, async (req, res) => {
const { prefix } = req.query
const params = [req.project.id]
let query = 'SELECT key, created_at, updated_at, expires_at FROM kv_store WHERE project_id = $1 AND (expires_at IS NULL OR expires_at > NOW())'
if (prefix) { params.push(prefix + '%'); query += ` AND key LIKE $${params.length}` }
const result = await pool.query(query, params)
res.json({ keys: result.rows, count: result.rows.length })
})

const cachePrefix = (projectId) => `dkit:kv:${projectId}:`
const cacheKey = (projectId, key) => cachePrefix(projectId) + key

function kvValue(body) {
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'object') {
    const v = Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : body
    return typeof v === 'string' ? v : JSON.stringify(v)
  }
  return String(body)
}

function kvTtl(raw) {
  if (raw === undefined || raw === null || raw === '') return { ttl: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > KV_MAX_TTL) {
    return { error: `ttl must be an integer between 0 and ${KV_MAX_TTL} seconds` }
  }
  return { ttl: n === 0 ? null : n }
}

const kvTextParser = express.text({ type: () => true, limit: KV_MAX_BYTES })
function readKvValue(req, res, next) {
  kvTextParser(req, res, (err) => {
    if (!err) return next()
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: `Value too large (max ${KV_MAX_BYTES} bytes)` })
    }
    return res.status(400).json({ error: 'Could not read request body' })
  })
}

async function scanProjectCache(projectId, prefix, limit) {
  const match = cachePrefix(projectId) + prefix + '*'
  const found = new Set()
  let cursor = '0'
  do {
    const page = await redisClient.scan(cursor, { MATCH: match, COUNT: 250 })
    cursor = String(page.cursor)
    for (const k of page.keys) found.add(k.slice(cachePrefix(projectId).length))
    if (found.size >= limit) break
  } while (cursor !== '0')
  const keys = [...found].slice(0, limit)
  const multi = redisClient.multi()
  for (const k of keys) multi.ttl(cacheKey(projectId, k))
  const ttls = keys.length ? await multi.exec() : []
  return {
    keys: keys.map((k, i) => ({ key: k, ttl: ttls[i] > 0 ? ttls[i] : null })),
    truncated: found.size > keys.length || cursor !== '0',
  }
}

async function clearProjectCache(projectId) {
  let cursor = '0'
  let deleted = 0
  do {
    const page = await redisClient.scan(cursor, { MATCH: cachePrefix(projectId) + '*', COUNT: 500 })
    cursor = String(page.cursor)
    if (page.keys.length) deleted += await redisClient.unlink(page.keys)
  } while (cursor !== '0')
  return deleted
}

app.get('/api/kv', kvLimiter, authenticateProject, async (req, res) => {
  const prefix = String(req.query.prefix || '')
  if (prefix && !KV_KEY_RE.test(prefix)) return res.status(400).json({ error: 'Invalid prefix (letters, digits, . _ : - only)' })
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
  try {
    const result = await scanProjectCache(req.project.id, prefix, limit)
    res.set('Cache-Control', 'no-store')
    res.json({ ...result, count: result.keys.length })
  } catch (err) {
    console.error('cache list failed:', err.message)
    res.status(503).json({ error: 'Cache unavailable' })
  }
})

app.post('/api/kv/flush', kvLimiter, authenticateProject, async (req, res) => {
  try {
    const deleted = await clearProjectCache(req.project.id)
    res.json({ deleted })
  } catch (err) {
    console.error('cache flush failed:', err.message)
    res.status(503).json({ error: 'Cache unavailable' })
  }
})

app.get('/api/kv/:key', kvLimiter, authenticateProject, async (req, res) => {
  if (!KV_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Invalid key (1-128 of A-Z a-z 0-9 . _ : -)' })
  try {
    const value = await redisClient.get(cacheKey(req.project.id, req.params.key))
    if (value === null) return res.status(404).json({ error: 'Key not found' })
    const ttl = await redisClient.ttl(cacheKey(req.project.id, req.params.key))
    res.set('Cache-Control', 'no-store')
    if (req.query.raw === '1') {
      res.set('x-kv-ttl', String(ttl === -1 ? 'none' : ttl))
      return res.type('text/plain').send(value)
    }
    res.json({ key: req.params.key, value, ttl: ttl === -1 ? null : ttl })
  } catch (err) {
    console.error('cache get failed:', err.message)
    res.status(503).json({ error: 'Cache unavailable' })
  }
})

app.put('/api/kv/:key', kvLimiter, authenticateProject, readKvValue, async (req, res) => {
  if (!KV_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Invalid key (1-128 of A-Z a-z 0-9 . _ : -)' })
  const value = kvValue(req.body)
  const bytes = Buffer.byteLength(value)
  if (bytes > KV_MAX_BYTES) return res.status(413).json({ error: `Value too large (max ${KV_MAX_BYTES} bytes)` })
  const ttlInput = req.query.ttl !== undefined ? req.query.ttl
    : (req.body && typeof req.body === 'object' && req.body.ttl !== undefined) ? req.body.ttl
    : req.headers['x-ttl']
  const parsed = kvTtl(ttlInput)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  try {
    const key = cacheKey(req.project.id, req.params.key)
    if (parsed.ttl) await redisClient.set(key, value, { EX: parsed.ttl })
    else await redisClient.set(key, value)
    res.json({ key: req.params.key, bytes, ttl: parsed.ttl })
  } catch (err) {
    console.error('cache set failed:', err.message)
    res.status(503).json({ error: 'Cache unavailable' })
  }
})

app.post('/api/kv/:key/incr', kvLimiter, authenticateProject, async (req, res) => {
  if (!KV_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Invalid key (1-128 of A-Z a-z 0-9 . _ : -)' })
  const by = req.body === undefined || req.body?.by === undefined ? 1 : Number(req.body.by)
  if (!Number.isSafeInteger(by) || Math.abs(by) > 1e12) return res.status(400).json({ error: 'by must be a safe integer' })
  const parsed = kvTtl(req.query.ttl !== undefined ? req.query.ttl : req.body?.ttl)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  try {
    const key = cacheKey(req.project.id, req.params.key)
    if (parsed.ttl) await redisClient.set(key, '0', { NX: true, EX: parsed.ttl })
    let value
    try {
      value = await redisClient.incrBy(key, by)
    } catch (err) {
      if (/not an integer/i.test(err.message)) {
        return res.status(400).json({ error: 'Existing value is not an integer; set it with PUT first' })
      }
      throw err
    }
    const ttl = await redisClient.ttl(key)
    res.json({ key: req.params.key, value, ttl: ttl === -1 ? null : ttl })
  } catch (err) {
    console.error('cache incr failed:', err.message)
    res.status(503).json({ error: 'Cache unavailable' })
  }
})

app.delete('/api/kv/:key', kvLimiter, authenticateProject, async (req, res) => {
  if (!KV_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Invalid key (1-128 of A-Z a-z 0-9 . _ : -)' })
  try {
    const deleted = await redisClient.unlink(cacheKey(req.project.id, req.params.key))
    if (!deleted) return res.status(404).json({ error: 'Key not found' })
    res.json({ deleted: true })
  } catch (err) {
    console.error('cache delete failed:', err.message)
    res.status(503).json({ error: 'Cache unavailable' })
  }
})

app.post('/api/auth/forgot-password', emailLimiter, async (req, res) => {
const { email } = req.body
if (!email) return res.status(400).json({ error: 'Email required' })
const result = await pool.query('SELECT id FROM users WHERE email = $1', [email])
if (result.rows.length > 0) {
const token = crypto.randomBytes(32).toString('hex')
await pool.query('INSERT INTO password_resets (user_id, token) VALUES ($1, $2)', [result.rows[0].id, token])
const base = process.env.PUBLIC_URL || 'http://localhost:' + PORT
const sent = await sendPasswordResetEmail(email, base + '/reset-password?token=' + token)
if (!sent) { return res.status(502).json({ error: 'Could not send the reset email. Check server logs.' }) }
}
res.json({ message: 'If that email has an account, a reset link has been sent.' })
})
app.post('/api/auth/reset-password', loginLimiter, async (req, res) => {
const { token, password } = req.body
if (!token || !password) return res.status(400).json({ error: 'Token and new password required' })
const passwordErrors = validatePassword(password)
if (passwordErrors.length > 0) return res.status(400).json({ error: 'Password requirements not met', details: passwordErrors })
const result = await pool.query('SELECT user_id FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()', [token])
if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset link' })
const userId = result.rows[0].user_id
const currentUser = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId])
if (currentUser.rows[0]?.password_hash) {
const sameAsCurrent = await verifyPassword(password, currentUser.rows[0].password_hash)
if (sameAsCurrent) return res.status(400).json({ error: 'New password must be different from your current password.' })
}
const hashed = await hashPassword(password)
await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, userId])
await pool.query('UPDATE password_resets SET used = TRUE WHERE token = $1', [token])
await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId])
res.json({ message: 'Password updated. You can now log in.' })
})
const OAUTH_PROVIDERS = {
google: { clientId: () => process.env.GOOGLE_CLIENT_ID, clientSecret: () => process.env.GOOGLE_CLIENT_SECRET, authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scope: 'openid email profile', async fetchProfile(accessToken) { const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + accessToken } }); const data = await res.json(); if (!data.verified_email) { return { id: null, email: null } } return { id: data.id, email: data.email } } },
github: { clientId: () => process.env.GITHUB_CLIENT_ID, clientSecret: () => process.env.GITHUB_CLIENT_SECRET, authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scope: 'read:user user:email', async fetchProfile(accessToken) { const headers = { Authorization: 'Bearer ' + accessToken, 'User-Agent': 'dkit-app' }; const userRes = await fetch('https://api.github.com/user', { headers }); const user = await userRes.json(); let email = user.email; if (!email) { const emailsRes = await fetch('https://api.github.com/user/emails', { headers }); const emails = await emailsRes.json(); const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) || emails.find(e => e.verified) : null; email = primary?.email } return { id: String(user.id), email } } }
}
function oauthRedirectUri(provider) { const base = process.env.PUBLIC_URL || 'http://localhost:' + PORT; return base + '/api/auth/oauth/' + provider + '/callback' }
app.get('/api/auth/oauth/providers', (req, res) => { res.json({ google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) }) })
app.get('/api/auth/oauth/:provider', oauthLimiter, async (req, res) => {
const provider = OAUTH_PROVIDERS[req.params.provider]
if (!provider || !provider.clientId()) return res.status(404).json({ error: 'Unknown or unconfigured provider' })
const state = crypto.randomBytes(24).toString('hex')
await pool.query('INSERT INTO oauth_states (state, provider) VALUES ($1, $2)', [state, req.params.provider])
const url = new URL(provider.authUrl)
url.searchParams.set('client_id', provider.clientId())
url.searchParams.set('redirect_uri', oauthRedirectUri(req.params.provider))
url.searchParams.set('scope', provider.scope)
url.searchParams.set('state', state)
if (req.params.provider === 'google') { url.searchParams.set('response_type', 'code'); url.searchParams.set('access_type', 'online') }
res.redirect(url.toString())
})
app.get('/api/auth/oauth/:provider/callback', oauthLimiter, async (req, res) => {
const providerName = req.params.provider
const provider = OAUTH_PROVIDERS[providerName]
const { code, state } = req.query
const failUrl = (process.env.PUBLIC_URL || 'http://localhost:' + PORT) + '/login?error=oauth'
if (!provider || !code || !state) return res.redirect(failUrl)
try {
const stateResult = await pool.query('DELETE FROM oauth_states WHERE state = $1 AND provider = $2 AND expires_at > NOW() RETURNING state', [state, providerName])
if (stateResult.rows.length === 0) return res.redirect(failUrl)
const tokenRes = await fetch(provider.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ client_id: provider.clientId(), client_secret: provider.clientSecret(), code, redirect_uri: oauthRedirectUri(providerName), grant_type: 'authorization_code' }) })
const tokenData = await tokenRes.json()
if (!tokenData.access_token) { console.error('OAuth token exchange failed:', tokenData); return res.redirect(failUrl) }
const profile = await provider.fetchProfile(tokenData.access_token)
if (!profile.email || !profile.id) return res.redirect(failUrl)
const idColumn = providerName + '_id'
let userResult = await pool.query(`SELECT id, email FROM users WHERE ${idColumn} = $1`, [profile.id])
if (userResult.rows.length === 0) {
const existing = await pool.query('SELECT id, email FROM users WHERE email = $1', [profile.email])
if (existing.rows.length > 0) { await pool.query(`UPDATE users SET ${idColumn} = $1 WHERE id = $2`, [profile.id, existing.rows[0].id]); userResult = existing }
else {
const created = await pool.query(`INSERT INTO users (email, ${idColumn}) VALUES ($1, $2) RETURNING id, email`, [profile.email, profile.id])
await pool.query('INSERT INTO email_verifications (user_id, code, verified) VALUES ($1, $2, TRUE)', [created.rows[0].id, crypto.randomInt(100000, 999999).toString()])
userResult = created
}
}
const user = userResult.rows[0]
const redirectBase = process.env.PUBLIC_URL || 'http://localhost:' + PORT
const banned = await pool.query('SELECT suspended, totp_enabled FROM users WHERE id = $1', [user.id])
if (banned.rows[0]?.suspended) return res.redirect(redirectBase + '/suspended')
if (banned.rows[0]?.totp_enabled) {
  const loginToken = crypto.randomBytes(32).toString('hex')
  await pool.query('INSERT INTO login_challenges (login_token, user_id) VALUES ($1, $2)', [loginToken, user.id])
  return res.redirect(redirectBase + '/login?challenge=' + loginToken)
}
const token = generateToken(user.id)
const refresh_token = (await issueSession(user.id, req)).refresh_token
const payload = encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, refresh_token }))
res.redirect(redirectBase + '/oauth/callback#token=' + token + '&user=' + payload)
} catch (err) { console.error('OAuth callback error:', err); res.redirect(failUrl) }
})
const STAT_WEEKS = 12
const weeklySql = (inner) => `
  SELECT to_char(w.wk, 'YYYY-MM-DD') AS wk, COALESCE(c.n, 0)::int AS n
  FROM generate_series(
    date_trunc('week', NOW()::timestamp) - make_interval(weeks => ($1::int - 1)),
    date_trunc('week', NOW()::timestamp),
    interval '1 week') AS w(wk)
  LEFT JOIN (${inner}) c ON c.wk = w.wk
  ORDER BY w.wk`
const weekly = async (inner, extra = []) => (await pool.query(weeklySql(inner), [STAT_WEEKS, ...extra])).rows

app.get('/api/stats/activity', authenticate, async (req, res) => {
  try {
    const uid = req.user.id
    const projects = await weekly(`SELECT date_trunc('week', created_at) AS wk, COUNT(*)::int AS n FROM projects WHERE user_id = $2 GROUP BY 1`, [uid])
    const envSets = await weekly(`SELECT date_trunc('week', h.created_at) AS wk, COUNT(*)::int AS n FROM env_history h JOIN projects p ON p.id = h.project_id WHERE p.user_id = $2 GROUP BY 1`, [uid])
    res.json({
      weeks: envSets.map((r) => r.wk),
      series: { envSets: envSets.map((r) => r.n), injects: envSets.map((r) => r.n), projects: projects.map((r) => r.n) },
    })
  } catch (e) { console.error('stats error:', e); res.status(500).json({ error: 'stats failed' }) }
})

app.get('/api/stats/activity/daily', authenticate, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT to_char(date_trunc('day', h.created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
      FROM env_history h JOIN projects p ON p.id = h.project_id
      WHERE p.user_id = $1 AND h.created_at >= NOW() - INTERVAL '26 weeks'
      GROUP BY 1 ORDER BY 1`, [req.user.id])
    res.json(r.rows)
  } catch (e) { console.error('stats error:', e); res.status(500).json({ error: 'stats failed' }) }
})

async function requireAdmin(req, res, next) {
  const r = await pool.query('SELECT is_admin, suspended FROM users WHERE id = $1', [req.user.id])
  if (!r.rows[0]?.is_admin || r.rows[0]?.suspended) return res.status(403).json({ error: 'Forbidden' })
  next()
}

app.get('/api/admin/session', authenticate, requireAdmin, (req, res) => { res.json({ ok: true }) })

app.post('/api/admin/broadcast', authenticate, requireAdmin, async (req, res) => {
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()
  if (!subject || subject.length > 150) return res.status(400).json({ error: 'Subject required (max 150 chars)' })
  if (!body || body.length > 10000) return res.status(400).json({ error: 'Body required (max 10000 chars)' })
  const verifiedOnly = req.body?.verified_only !== false
  const q = verifiedOnly
    ? `SELECT u.email FROM users u
       WHERE COALESCE(u.suspended, FALSE) = FALSE
         AND EXISTS (SELECT 1 FROM email_verifications v WHERE v.user_id = u.id AND v.verified)`
    : 'SELECT email FROM users WHERE COALESCE(suspended, FALSE) = FALSE'
  const users = await pool.query(q + ' ORDER BY created_at ASC')
  let sent = 0
  const failed = []
  for (const u of users.rows) {
    const ok = await sendAdminBroadcastEmail(u.email, { subject, body })
    if (ok) sent++; else failed.push(u.email)
  }
  console.log('broadcast: ' + sent + ' sent, ' + failed.length + ' failed, subject: ' + JSON.stringify(subject))
  res.json({ sent, failed, total: users.rows.length })
})

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const totals = (await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM users WHERE COALESCE(is_admin, FALSE)) AS admins,
        (SELECT COUNT(*)::int FROM users WHERE COALESCE(suspended, FALSE)) AS suspended,
        (SELECT COUNT(DISTINCT user_id)::int FROM email_verifications WHERE verified) AS verified,
        (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '7 days') AS new_7d,
        (SELECT COUNT(*)::int FROM users WHERE last_login_at >= NOW() - INTERVAL '7 days') AS active_7d,
        (SELECT COUNT(*)::int FROM projects) AS projects,
        (SELECT COUNT(*)::int FROM env_vars) AS env_vars,
        (SELECT COUNT(*)::int FROM kv_store) AS store_keys,
        (SELECT COUNT(*)::int FROM (
           SELECT 1 FROM users WHERE last_ip IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days'
           GROUP BY last_ip HAVING COUNT(*) > 1) x) AS flagged_ips`)).rows[0]
    const signups = await weekly(`SELECT date_trunc('week', created_at) AS wk, COUNT(*)::int AS n FROM users GROUP BY 1`)
    const projects = await weekly(`SELECT date_trunc('week', created_at) AS wk, COUNT(*)::int AS n FROM projects GROUP BY 1`)
    const envSets = await weekly(`SELECT date_trunc('week', created_at) AS wk, COUNT(*)::int AS n FROM env_history GROUP BY 1`)
    res.json({
      totals,
      weeks: signups.map((r) => r.wk),
      series: { signups: signups.map((r) => r.n), projects: projects.map((r) => r.n), envSets: envSets.map((r) => r.n) },
    })
  } catch (e) { console.error('admin stats error:', e); res.status(500).json({ error: 'stats failed' }) }
})

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  const r = await pool.query(`
    SELECT u.id, u.email, u.created_at, u.is_admin, u.suspended, u.last_ip, u.last_login_at,
           EXISTS (SELECT 1 FROM email_verifications v WHERE v.user_id = u.id AND v.verified) AS verified,
           (SELECT COUNT(*)::int FROM projects p WHERE p.user_id = u.id) AS projects
    FROM users u ORDER BY u.created_at DESC LIMIT 500`)
  res.json(r.rows)
})

app.post('/api/admin/users/:id/suspend', authenticate, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('UPDATE users SET suspended = $1 WHERE id = $2 AND COALESCE(is_admin, FALSE) = FALSE RETURNING id', [!!req.body?.suspended, req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found, or is an admin' })
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: 'Invalid user id' }) }
})

app.delete('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account here" })
  try {
    const r = await pool.query('DELETE FROM users WHERE id = $1 AND COALESCE(is_admin, FALSE) = FALSE RETURNING email', [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found, or is an admin' })
    res.json({ ok: true, email: r.rows[0].email })
  } catch (e) { res.status(400).json({ error: 'Invalid user id' }) }
})

app.get('/api/admin/ip-clusters', authenticate, requireAdmin, async (req, res) => {
  const r = await pool.query(`
    SELECT last_ip AS ip, COUNT(*)::int AS accounts,
           array_agg(email ORDER BY created_at DESC) AS emails,
           MAX(created_at) AS latest
    FROM users
    WHERE last_ip IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY last_ip HAVING COUNT(*) > 1
    ORDER BY accounts DESC, latest DESC LIMIT 100`)
  res.json(r.rows)
})

function appBaseUrl(req) {
  return process.env.PUBLIC_URL || (req ? req.protocol + '://' + req.get('host') : '')
}

async function assertProjectOwner(req, res) {
  const r = await pool.query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
  if (r.rows.length === 0) { res.status(404).json({ error: 'Project not found (you can only share projects you own)' }); return null }
  return r.rows[0]
}

async function assertTeamAdmin(req, res, teamId) {
  const role = await teamRole(teamId, req.user.id)
  if (!isOwnerOrAdmin(role)) { res.status(403).json({ error: 'Only team owners and admins can do that' }); return null }
  return role
}

app.get('/api/teams/:id/projects', authenticate, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (!role) return res.status(404).json({ error: 'Team not found' })
  const r = await pool.query(`
    SELECT p.id, p.name, p.key_prefix, p.key_rotated_at, p.created_at,
           tp.added_at, u.email AS owner_email, $2::text AS my_team_role
    FROM team_projects tp
    JOIN projects p ON p.id = tp.project_id
    JOIN users u ON u.id = p.user_id
    WHERE tp.team_id = $1
    ORDER BY tp.added_at DESC
  `, [req.params.id, role])
  res.json(r.rows)
})

app.post('/api/teams/:id/projects', authenticate, teamWriteLimiter, async (req, res) => {
  if (!(await assertTeamAdmin(req, res, req.params.id))) return
  const projectId = String(req.body?.project_id || '')
  if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'Valid project_id required' })
  const project = await pool.query('SELECT id, name FROM projects WHERE id = $1 AND user_id = $2', [projectId, req.user.id])
  if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found (you can only share projects you own)' })
  const ins = await pool.query(
    `INSERT INTO team_projects (team_id, project_id, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (team_id, project_id) DO NOTHING
     RETURNING id, team_id, project_id, added_at`,
    [req.params.id, projectId, req.user.id]
  )
  if (ins.rows.length === 0) return res.status(409).json({ error: 'That project is already in this team' })
  res.json({ ...ins.rows[0], name: project.rows[0].name })
})

app.delete('/api/teams/:id/projects/:projectId', authenticate, teamWriteLimiter, async (req, res) => {
  if (!(await assertTeamAdmin(req, res, req.params.id))) return
  if (!UUID_RE.test(req.params.projectId)) return res.status(404).json({ error: 'Project not found in this team' })
  const del = await pool.query('DELETE FROM team_projects WHERE team_id = $1 AND project_id = $2', [req.params.id, req.params.projectId])
  if (del.rowCount === 0) return res.status(404).json({ error: 'Project not found in this team' })
  res.json({ ok: true })
})

const inviteLink = (token) => `${process.env.PUBLIC_URL || ''}/accept-invite?token=${token}`
const isOwnerOrAdmin = (role) => role === 'owner' || role === 'admin'
async function teamRole(teamId, userId) {
  if (!UUID_RE.test(String(teamId))) return null
  const r = await pool.query('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId])
  return r.rows[0] ? r.rows[0].role : null
}
async function emailVerified(userId) {
  const r = await pool.query('SELECT verified FROM email_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId])
  return !!(r.rows[0] && r.rows[0].verified)
}
const VERIFY_FIRST = { error: 'Verify your email first (banner at the top of the dashboard), then accept the invitation from the Teams tab.', code: 'unverified' }
async function emailInvite(invite, teamName, inviterEmail) {
  return sendTeamInviteEmail(invite.email, inviteLink(invite.token), { teamName, inviterEmail, role: invite.role })
}

app.post('/api/teams', authenticate, teamWriteLimiter, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name required' })
  if (name.length > 60) return res.status(400).json({ error: 'Team name must be 60 characters or fewer' })
  const owned = await pool.query('SELECT COUNT(*)::int AS n FROM teams WHERE owner_id = $1', [req.user.id])
  if (owned.rows[0].n >= MAX_TEAMS_OWNED) return res.status(400).json({ error: `You can own up to ${MAX_TEAMS_OWNED} teams` })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const team = await client.query('INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING *', [name, req.user.id])
    await client.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [team.rows[0].id, req.user.id, 'owner'])
    await client.query('COMMIT')
    res.json({ ...team.rows[0], role: 'owner', member_count: 1 })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
})

app.get('/api/teams', authenticate, async (req, res) => {
  const r = await pool.query(`
    SELECT t.id, t.name, t.created_at, tm.role,
           (SELECT COUNT(*)::int FROM team_members m WHERE m.team_id = t.id) AS member_count
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = $1
    ORDER BY t.created_at DESC
  `, [req.user.id])
  res.json(r.rows)
})

app.get('/api/teams/invites/mine', authenticate, async (req, res) => {
  if (!(await emailVerified(req.user.id))) return res.json([])
  const r = await pool.query(`
    SELECT i.id, i.token, i.role, i.created_at, i.expires_at, t.name AS team_name, u.email AS invited_by_email
    FROM team_invites i
    JOIN teams t ON t.id = i.team_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE LOWER(i.email) = LOWER($1) AND i.accepted_at IS NULL AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `, [req.user.email])
  res.json(r.rows)
})

app.get('/api/teams/invites/preview', async (req, res) => {
  const token = String(req.query.token || '')
  if (!token) return res.status(400).json({ error: 'Token required' })
  const r = await pool.query(`
    SELECT i.email, i.role, i.accepted_at, i.expires_at, t.name AS team_name, u.email AS invited_by_email
    FROM team_invites i
    JOIN teams t ON t.id = i.team_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.token = $1
  `, [token])
  const inv = r.rows[0]
  if (!inv) return res.status(404).json({ error: 'This invitation link is not valid.' })
  if (inv.accepted_at) return res.status(410).json({ error: 'This invitation has already been used.' })
  if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'This invitation has expired. Ask the team for a new one.' })
  res.json({ team_name: inv.team_name, role: inv.role, email: inv.email, invited_by_email: inv.invited_by_email })
})

app.post('/api/teams/invites/accept', authenticate, teamWriteLimiter, async (req, res) => {
  const token = String(req.body?.token || '')
  if (!token) return res.status(400).json({ error: 'Token required' })
  if (!(await emailVerified(req.user.id))) return res.status(403).json(VERIFY_FIRST)
  const r = await pool.query(`SELECT * FROM team_invites WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`, [token])
  const inv = r.rows[0]
  if (!inv) return res.status(400).json({ error: 'Invalid or expired invite' })
  if (inv.email.toLowerCase() !== String(req.user.email).toLowerCase()) {
    return res.status(403).json({ error: `This invitation was sent to ${inv.email}. Log in with that account to accept it.`, code: 'wrong_account', invited_email: inv.email })
  }
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO NOTHING`,
    [inv.team_id, req.user.id, inv.role]
  )
  await pool.query('UPDATE team_invites SET accepted_at = NOW() WHERE id = $1', [inv.id])
  const team = await pool.query('SELECT id, name FROM teams WHERE id = $1', [inv.team_id])
  res.json({ ok: true, team: team.rows[0] })
})

app.post('/api/teams/invites/decline', authenticate, teamWriteLimiter, async (req, res) => {
  const token = String(req.body?.token || '')
  if (!token) return res.status(400).json({ error: 'Token required' })
  await pool.query('DELETE FROM team_invites WHERE token = $1 AND LOWER(email) = LOWER($2) AND accepted_at IS NULL', [token, req.user.email])
  res.json({ ok: true })
})

app.get('/api/teams/:id', authenticate, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (!role) return res.status(404).json({ error: 'Team not found' })
  const team = await pool.query('SELECT id, name, owner_id, created_at FROM teams WHERE id = $1', [req.params.id])
  const members = await pool.query(`
    SELECT u.id AS user_id, u.email, tm.role, tm.created_at AS joined_at
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = $1
    ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tm.created_at
  `, [req.params.id])
  const projects = await pool.query(`
    SELECT p.id, p.name, p.key_prefix, p.key_rotated_at, p.created_at,
           tp.added_at, u.email AS owner_email
    FROM team_projects tp
    JOIN projects p ON p.id = tp.project_id
    JOIN users u ON u.id = p.user_id
    WHERE tp.team_id = $1
    ORDER BY tp.added_at DESC
  `, [req.params.id])
  let invites = []
  if (isOwnerOrAdmin(role)) {
    const inv = await pool.query(`
      SELECT i.id, i.email, i.role, i.token, i.created_at, i.expires_at, (i.expires_at <= NOW()) AS expired, u.email AS invited_by_email
      FROM team_invites i LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.team_id = $1 AND i.accepted_at IS NULL
      ORDER BY i.created_at DESC
    `, [req.params.id])
    invites = inv.rows.map((i) => ({ ...i, link: inviteLink(i.token), token: undefined }))
  }
  res.json({ team: team.rows[0], role, members: members.rows, invites, projects: projects.rows })
})

app.post('/api/teams/:id/invites', authenticate, inviteSendLimiter, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (!isOwnerOrAdmin(role)) return res.status(403).json({ error: 'Only team owners and admins can invite people' })
  if (!(await emailVerified(req.user.id))) return res.status(403).json(VERIFY_FIRST)
  const email = String(req.body?.email || '').trim().toLowerCase()
  const inviteRole = req.body?.role || 'member'
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address' })
  if (!TEAM_ROLES.includes(inviteRole)) return res.status(400).json({ error: 'Role must be admin or member' })
  if (inviteRole === 'admin' && role !== 'owner') return res.status(403).json({ error: 'Only the team owner can invite admins' })
  const already = await pool.query(
    `SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 AND LOWER(u.email) = $2`,
    [req.params.id, email]
  )
  if (already.rows.length > 0) return res.status(409).json({ error: `${email} is already on this team` })
  const pending = await pool.query('SELECT COUNT(*)::int AS n FROM team_invites WHERE team_id = $1 AND accepted_at IS NULL AND expires_at > NOW()', [req.params.id])
  if (pending.rows[0].n >= MAX_PENDING_INVITES) return res.status(400).json({ error: 'Too many pending invitations. Revoke a few first.' })
  await pool.query('DELETE FROM team_invites WHERE team_id = $1 AND LOWER(email) = $2 AND accepted_at IS NULL', [req.params.id, email])
  const token = crypto.randomBytes(24).toString('hex')
  const ins = await pool.query(
    'INSERT INTO team_invites (team_id, email, token, role, invited_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, token, created_at, expires_at',
    [req.params.id, email, token, inviteRole, req.user.id]
  )
  const team = await pool.query('SELECT name FROM teams WHERE id = $1', [req.params.id])
  const emailSent = await emailInvite(ins.rows[0], team.rows[0].name, req.user.email)
  const { token: _t, ...safe } = ins.rows[0]
  res.json({ invite: { ...safe, link: inviteLink(token) }, email_sent: emailSent })
})

app.post('/api/teams/:id/invites/:inviteId/resend', authenticate, inviteSendLimiter, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (!isOwnerOrAdmin(role)) return res.status(403).json({ error: 'Forbidden' })
  if (!(await emailVerified(req.user.id))) return res.status(403).json(VERIFY_FIRST)
  if (!UUID_RE.test(req.params.inviteId)) return res.status(404).json({ error: 'Invitation not found' })
  const r = await pool.query(
    `UPDATE team_invites SET expires_at = NOW() + INTERVAL '7 days' WHERE id = $1 AND team_id = $2 AND accepted_at IS NULL RETURNING id, email, role, token, expires_at`,
    [req.params.inviteId, req.params.id]
  )
  if (r.rows.length === 0) return res.status(404).json({ error: 'Invitation not found' })
  const team = await pool.query('SELECT name FROM teams WHERE id = $1', [req.params.id])
  const emailSent = await emailInvite(r.rows[0], team.rows[0].name, req.user.email)
  res.json({ ok: true, email_sent: emailSent, expires_at: r.rows[0].expires_at, link: inviteLink(r.rows[0].token) })
})

app.delete('/api/teams/:id/invites/:inviteId', authenticate, teamWriteLimiter, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (!isOwnerOrAdmin(role)) return res.status(403).json({ error: 'Forbidden' })
  if (!UUID_RE.test(req.params.inviteId)) return res.status(404).json({ error: 'Invitation not found' })
  await pool.query('DELETE FROM team_invites WHERE id = $1 AND team_id = $2 AND accepted_at IS NULL', [req.params.inviteId, req.params.id])
  res.json({ ok: true })
})

app.patch('/api/teams/:id/members/:userId', authenticate, teamWriteLimiter, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (role !== 'owner') return res.status(403).json({ error: 'Only the team owner can change roles' })
  if (!TEAM_ROLES.includes(req.body?.role)) return res.status(400).json({ error: 'Role must be admin or member' })
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'The owner\u2019s role can\u2019t be changed' })
  if (!UUID_RE.test(req.params.userId)) return res.status(404).json({ error: 'Member not found' })
  const r = await pool.query('UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3 AND role <> $4 RETURNING user_id, role', [req.body.role, req.params.id, req.params.userId, 'owner'])
  if (r.rows.length === 0) return res.status(404).json({ error: 'Member not found' })
  res.json(r.rows[0])
})

app.delete('/api/teams/:id/members/:userId', authenticate, teamWriteLimiter, async (req, res) => {
  const myRole = await teamRole(req.params.id, req.user.id)
  if (!myRole) return res.status(404).json({ error: 'Team not found' })
  if (!UUID_RE.test(req.params.userId)) return res.status(404).json({ error: 'Member not found' })
  const leaving = req.params.userId === req.user.id
  if (leaving) {
    if (myRole === 'owner') return res.status(400).json({ error: 'Owners can\u2019t leave their own team. Delete the team instead.' })
  } else {
    const targetRole = await teamRole(req.params.id, req.params.userId)
    if (!targetRole) return res.status(404).json({ error: 'Member not found' })
    const allowed = myRole === 'owner' || (myRole === 'admin' && targetRole === 'member')
    if (!allowed) return res.status(403).json({ error: 'You don\u2019t have permission to remove this member' })
  }
  await pool.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [req.params.id, req.params.userId])
  res.json({ ok: true })
})

app.delete('/api/teams/:id', authenticate, teamWriteLimiter, async (req, res) => {
  const role = await teamRole(req.params.id, req.user.id)
  if (role !== 'owner') return res.status(403).json({ error: 'Only the team owner can delete the team' })
  await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

app.get('/api/projects/shared', authenticate, async (req, res) => {
  res.json({ projects: await listSharedProjects(req.user.id) })
})

app.get('/api/overview', authenticate, async (req, res) => {
  try {
    const envR = await pool.query(`
      SELECT p.id, COUNT(ev.id)::int AS env_count,
             (SELECT COUNT(*)::int FROM kv_store k WHERE k.project_id = p.id AND (k.expires_at IS NULL OR k.expires_at > NOW())) AS store_count,
             (SELECT COUNT(*)::int FROM cron_jobs c WHERE c.project_id = p.id) AS cron_count,
             (SELECT COUNT(*)::int FROM monitors m WHERE m.project_id = p.id) AS monitor_count
      FROM projects p
      LEFT JOIN env_vars ev ON ev.project_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id`, [req.user.id])
    const totals = envR.rows.reduce((acc, r) => ({
      env: acc.env + r.env_count,
      store: acc.store + r.store_count,
      cron: acc.cron + r.cron_count,
      monitors: acc.monitors + r.monitor_count,
    }), { env: 0, store: 0, cron: 0, monitors: 0 })
    res.json({ totals, projects: envR.rows })
  } catch (e) { console.error('overview error:', e); res.status(500).json({ error: 'overview failed' }) }
})

const websiteDist = path.join(__dirname, '../../website/dist')
app.use(express.static(websiteDist, { setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.setHeader('Access-Control-Allow-Origin', '*'); } }));
app.use((req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(websiteDist, 'index.html')) })
;(async () => {
  await initPromise
  await ensureSelfProject()
  await loadSelfSettings()
  if (process.env.DKIT_DISABLE_JOBS === '1') console.log('Job runner disabled (DKIT_DISABLE_JOBS=1)')
  else jobs.startJobs()
  status.startStatusProbes()
  app.listen(PORT, '127.0.0.1', () => {
    console.log('Dkit API running on port ' + PORT)
    console.log('http://localhost:' + PORT + '/api/health')
  })
})().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
