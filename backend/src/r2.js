
const crypto = require('crypto')

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = process.env.R2_BUCKET

const HOST = ACCOUNT_ID ? ACCOUNT_ID + '.r2.cloudflarestorage.com' : null
const REGION = 'auto'
const SERVICE = 's3'

function configured() { return !!(HOST && ACCESS_KEY && SECRET_KEY && BUCKET) }

function objectUrl(r2Key) {
  return `https://${HOST}/${BUCKET}/` + r2Key.split('/').map(encodeURIComponent).join('/')
}

function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest() }
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex')
function sha256Hex(data) { return crypto.createHash('sha256').update(data).digest('hex') }
function lowerKeys(obj) { const o = {}; for (const [k, v] of Object.entries(obj || {})) o[k.toLowerCase()] = v; return o }
function canonicalPath(pathname) { return pathname.split('/').map(encodeURIComponent).join('/') }
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
  const sessionToken = process.env.R2_SESSION_TOKEN
  if (sessionToken) h['x-amz-security-token'] = sessionToken

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
  delete h.host
  return { ...h, Authorization: authorization }
}

async function s3Request(method, url, { payload, headers = {} } = {}) {
  const signedHeaders = signRequest(method, url, { payload, headers })
  const res = await fetch(url, {
    method,
    headers: signedHeaders,
    body: payload || undefined,
    signal: AbortSignal.timeout(120 * 1000),
  })
  return res
}

async function putObject(r2Key, buffer, contentType) {
  const res = await s3Request('PUT', objectUrl(r2Key), { payload: buffer, headers: { 'Content-Type': contentType } })
  if (!res.ok) throw new R2Error('R2 put failed: ' + res.status, res.status, await safeText(res))
  return true
}

async function deleteObject(r2Key) {
  const res = await s3Request('DELETE', objectUrl(r2Key))
  if (!res.ok && res.status !== 404) throw new R2Error('R2 delete failed: ' + res.status, res.status, await safeText(res))
  return true
}

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

async function ensureBucket() {
  const res = await s3Request('PUT', `https://${HOST}/${encodeURIComponent(BUCKET)}`)
  if (res.ok) { console.log('Created R2 bucket ' + BUCKET); return true }
  if (res.status === 409) return true
  const body = await safeText(res)
  if (/AlreadyOwned|BucketAlready/i.test(body)) return true
  throw new R2Error('R2 bucket bootstrap failed: ' + res.status, res.status, body)
}

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
