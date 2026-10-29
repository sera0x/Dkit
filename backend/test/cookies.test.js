const test = require('node:test')
const assert = require('node:assert/strict')

const {
  REFRESH_COOKIE,
  CSRF_COOKIE,
  parseCookies,
  setSessionCookies,
  clearSessionCookies,
  csrfIsValid,
  wantsCliToken,
} = require('../src/cookies')

function fakeRes() {
  return {
    headers: [],
    append(name, value) { this.headers.push([name, value]) },
    get cookies() { return this.headers.map(([, v]) => v) },
  }
}

function fakeReq(headers = {}) {
  return { headers, get(name) { return headers[name.toLowerCase()] } }
}

test('parses cookie headers and ignores malformed parts', () => {
  const parsed = parseCookies('a=1; b=two%20words; broken; c="quoted"')
  assert.equal(parsed.a, '1')
  assert.equal(parsed.b, 'two words')
  assert.equal(parsed.c, 'quoted')
  assert.equal(parsed.broken, undefined)
})

test('sets an httpOnly refresh cookie and a readable CSRF cookie', () => {
  const res = fakeRes()
  const csrf = setSessionCookies(res, 'refresh-value')
  assert.equal(csrf.length, 64)
  const [refresh, csrfCookie] = res.cookies
  assert.match(refresh, new RegExp(`^${REFRESH_COOKIE}=`))
  assert.match(refresh, /HttpOnly/)
  assert.match(refresh, /Path=\/api\/auth/)
  assert.match(refresh, /SameSite=Lax/)
  assert.match(csrfCookie, new RegExp(`^${CSRF_COOKIE}=${csrf}`))
  assert.doesNotMatch(csrfCookie, /HttpOnly/)
  assert.match(csrfCookie, /Path=\//)
})

test('marks cookies secure only for an https public url', () => {
  const previous = process.env.PUBLIC_URL
  process.env.PUBLIC_URL = 'https://dkit.name.ng'
  const secureRes = fakeRes()
  setSessionCookies(secureRes, 'x')
  assert.match(secureRes.cookies[0], /Secure/)

  process.env.PUBLIC_URL = 'http://localhost:3001'
  const plainRes = fakeRes()
  setSessionCookies(plainRes, 'x')
  assert.doesNotMatch(plainRes.cookies[0], /Secure/)
  if (previous === undefined) delete process.env.PUBLIC_URL
  else process.env.PUBLIC_URL = previous
})

test('clears both cookies with max-age zero', () => {
  const res = fakeRes()
  clearSessionCookies(res)
  assert.equal(res.cookies.length, 2)
  for (const cookie of res.cookies) assert.match(cookie, /Max-Age=0/)
})

test('validates a matching CSRF double-submit pair', () => {
  const token = 'a'.repeat(64)
  assert.equal(csrfIsValid(fakeReq({ cookie: `${CSRF_COOKIE}=${token}`, 'x-csrf-token': token })), true)
  assert.equal(csrfIsValid(fakeReq({ cookie: `${CSRF_COOKIE}=${token}`, 'x-csrf-token': 'b'.repeat(64) })), false)
  assert.equal(csrfIsValid(fakeReq({ cookie: `${CSRF_COOKIE}=${token}` })), false)
  assert.equal(csrfIsValid(fakeReq({ 'x-csrf-token': token })), false)
})

test('only treats an explicit cli header as a cli client', () => {
  assert.equal(wantsCliToken(fakeReq({ 'x-dkit-client': 'cli' })), true)
  assert.equal(wantsCliToken(fakeReq({ 'x-dkit-client': 'web' })), false)
  assert.equal(wantsCliToken(fakeReq({})), false)
})
