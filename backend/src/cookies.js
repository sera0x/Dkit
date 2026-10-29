const crypto = require('crypto')

const REFRESH_COOKIE = 'dkit_refresh'
const CSRF_COOKIE = 'dkit_csrf'
const REFRESH_PATH = '/api/auth'
const SESSION_MAX_AGE = 180 * 24 * 60 * 60

function secureCookies() {
  return /^https:\/\//i.test(process.env.PUBLIC_URL || '')
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const name = part.slice(0, i).trim()
    let value = part.slice(i + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try { out[name] = decodeURIComponent(value) } catch { out[name] = value }
  }
  return out
}

function serialize(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`]
  bits.push(`Path=${opts.path || '/'}`)
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`)
  if (opts.httpOnly) bits.push('HttpOnly')
  if (opts.secure) bits.push('Secure')
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`)
  return bits.join('; ')
}

function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex')
}

function setSessionCookies(res, refreshToken, csrfToken) {
  const csrf = csrfToken || newCsrfToken()
  const secure = secureCookies()
  res.append('Set-Cookie', serialize(REFRESH_COOKIE, refreshToken, {
    path: REFRESH_PATH, maxAge: SESSION_MAX_AGE, httpOnly: true, secure, sameSite: 'Lax',
  }))
  res.append('Set-Cookie', serialize(CSRF_COOKIE, csrf, {
    path: '/', maxAge: SESSION_MAX_AGE, httpOnly: false, secure, sameSite: 'Lax',
  }))
  return csrf
}

function clearSessionCookies(res) {
  const secure = secureCookies()
  res.append('Set-Cookie', serialize(REFRESH_COOKIE, '', {
    path: REFRESH_PATH, maxAge: 0, httpOnly: true, secure, sameSite: 'Lax',
  }))
  res.append('Set-Cookie', serialize(CSRF_COOKIE, '', {
    path: '/', maxAge: 0, httpOnly: false, secure, sameSite: 'Lax',
  }))
}

function csrfIsValid(req) {
  const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE]
  const header = req.get('x-csrf-token')
  if (!cookie || !header) return false
  const a = Buffer.from(cookie)
  const b = Buffer.from(header)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function wantsCliToken(req) {
  return String(req.get('x-dkit-client') || '').toLowerCase() === 'cli'
}

module.exports = {
  REFRESH_COOKIE,
  CSRF_COOKIE,
  parseCookies,
  newCsrfToken,
  setSessionCookies,
  clearSessionCookies,
  csrfIsValid,
  wantsCliToken,
}
