// Minimal Cloudflare R2 (S3-compatible) client — no external dependency.
// Signs requests with AWS SigV4 over the crypto module. Only the handful of
// operations the media CDN needs are implemented: put/delete/get and bucket
// bootstrap. Objects are addressed against the account-scoped endpoint.
//
// Config (backend/.env — treat the secret like a private key, env-only):
//   R2_ACCOUNT_ID       Cloudflare account id
//   R2_ACCESS_KEY_ID    R2 API token access key (dashboard: R2 → Manage API tokens)
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET           bucket name (created automatically if missing)
//   R2_PUBLIC_BASE      optional public base, e.g. https://cdn.example.com —
//                       when set, permanent files redirect there instead of
//                       being proxied through this API. Uploads and deletes
//                       work without it; v1 is fully functional proxy-only.
//
// R2 uses the literal region 'auto' for SigV4 scoping.

const crypto = require('crypto')

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = process.env.R2_BUCKET

const HOST = ACCOUNT_ID ? ACCOUNT_ID + '.r2.cloudflarestorage.com' : null
const REGION = 'auto'
const SERVICE = 's3'

function configured() { return !!(HOST && ACCESS_KEY && SECRET_KEY && BUCKET) }

// Path-inside-bucket → full request URL. Segments are URI-encoded, slashes kept.
function objectUrl(r2Key) {
  return `https://${HOST}/${BUCKET}/` + r2Key.split('/').map(encodeURIComponent).join('/')
}

// ---------------------------------------------------------------------------
// SigV4. Canonical request = method, canonical path, sorted query, sorted
// headers, signed-header list, hashed payload — then the string-to-sign is
// HMAC'd down a day-scoped key chain. All string forms; no XML libs needed.
// ---------------------------------------------------------------------------
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest() }
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex')
function sha256Hex(data) { return crypto.createHash('sha256').update(data).digest('hex') }
function lowerKeys(obj) { const o = {}; for (const [k, v] of Object.entries(obj || {})) o[k.toLowerCase()] = v; return o }
// S3 canonical path: the URI-encoded form of each segment, '/' left intact.
function canonicalPath(pathname) { return pathname.split('/').map(encodeURIComponent).join('/') }
// Query params sorted by key then value; both URI-encoded.
function canonicalQuery(searchParams) {
  const pairs = []
  searchParams.forEach((v, k) => pairs.push([encodeURIComponent(k), encodeURIComponent(v)]))
  pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)
  return pairs.map(([k, v]) => k + '=' + v).join('&')
}

function signRequest(method, url, { payload, headers = {} } = {}) {
  const u = new URL(url)
  const payloadHash = payload ? sha256Hex(payload) : EMPTY_SHA256
  const amzDate = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z')

  const h = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...lowerKeys(headers) }
  // Standard S3 keys need no session token; if one is set (scoped API tokens), sign it.
  const sessionToken = process.env.R2_SESSION_TOKEN
  if (sessionToken) h['x-amz-security-token'] = sessionToken

  // Host + the x-amz-* headers MUST be signed; user headers only when present.
  const sorted = Object.keys(h).sort().filter((k) => h[k] !== undefined && h[k] !== '')
  const canonicalHeaders = sorted.map((k) => k + ':' + String(h[k]).trim() + '\n').join('')
  const signedHeaders = sorted.join(';')

  const canonicalRequest = [method, canonicalPath(u.pathname), canonicalQuery(u.searchParams), canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = amzDate.slice(0, 8) + '/' + REGION + '/' + SERVICE + '/aws4_request'
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const kDate = hmac('AWS4' + SECRET_KEY, amzDate.slice(0, 8))
  const kSigning = hmac(hmac(hmac(kDate, REGION), SERVICE), 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  // The exact header set to send back so request == canonical request.
  delete h.host // fetch sets Host itself
  return { ...h, Authorization: authorization }
}

async function s3Request(method, url, { payload, headers = {} } = {}) {
  const signedHeaders = signRequest(method, url, { payload, headers })
  const res = await fetch(url, {
    method,
    headers: signedHeaders,
    body: payload || undefined,
    // R2 on the S3 endpoint is fast; give slow links room for big uploads.
    signal: AbortSignal.timeout(120 * 1000),
  })
  return res
}

// ---------------------------------------------------------------------------
// Public operations. Payloads are buffered: uploads are capped at
// MEDIA_MAX_BYTES (small screenshots/images), so buffering is fine and keeps
// the signer honest (exact hash of what we sent).
// ---------------------------------------------------------------------------
async function putObject(r2Key, buffer, contentType) {
  const res = await s3Request('PUT', objectUrl(r2Key), { payload: buffer, headers: { 'Content-Type': contentType } })
  if (!res.ok) throw new R2Error('R2 put failed: ' + res.status, res.status, await safeText(res))
  return true
}

// 404 counts as success — the object is gone either way.
async function deleteObject(r2Key) {
  const res = await s3Request('DELETE', objectUrl(r2Key))
  if (!res.ok && res.status !== 404) throw new R2Error('R2 delete failed: ' + res.status, res.status, await safeText(res))
  return true
}

// Streams back the raw Response — callers pipe it straight to the HTTP
// response, so big objects are never buffered twice in this process.
async function getObject(r2Key) {
  const res = await s3Request('GET', objectUrl(r2Key))
  if (!res.ok) throw new R2Error('R2 get failed: ' + res.status, res.status, await safeText(res))
  return res
}

async function safeText(res) { try { return (await res.text()).slice(0, 300) } catch { return '' } }

class R2Error extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

// ---------------------------------------------------------------------------
// Bucket bootstrap. Idempotent — creating an already-owned bucket is R2 error
// "BucketAlreadyOwnedByYou" / 409. Called lazily before the first upload in a
// process, then cached.
// ---------------------------------------------------------------------------
async function ensureBucket() {
  const res = await s3Request('PUT', `https://${HOST}/${encodeURIComponent(BUCKET)}`)
  if (res.ok) { console.log('Created R2 bucket ' + BUCKET); return true }
  if (res.status === 409) return true // already exists (and we own it)
  // Some R2 versions answer 409 with an XML body only — treat any 409 as fine.
  const body = await safeText(res)
  if (/AlreadyOwned|BucketAlready/i.test(body)) return true
  throw new R2Error('R2 bucket bootstrap failed: ' + res.status, res.status, body)
}

// One bucket check per process; a failure (bad creds, network) resets it so
// the next upload retries after config/infra is fixed.
let bucketReadyPromise = null
function ensureReady() {
  if (!configured()) throw new R2Error('Media storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in backend/.env', 501)
  if (!bucketReadyPromise) {
    bucketReadyPromise = ensureBucket().catch((err) => {
      bucketReadyPromise = null
      throw err
    })
  }
  return bucketReadyPromise
}

function publicBase() { return (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '') || null }

module.exports = { configured, ensureReady, putObject, deleteObject, getObject, publicBase, R2Error }
