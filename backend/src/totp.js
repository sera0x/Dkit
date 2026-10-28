const crypto = require('crypto')

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')
  const out = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20))
}

function totpAt(secretBuf, counter) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest()
  const off = h[h.length - 1] & 0xf
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(code % 1000000).padStart(6, '0')
}

function verifyTotp(secret, token, window = 1) {
  if (!secret) return false
  const t = String(token || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(t)) return false
  const buf = base32Decode(secret)
  const now = Math.floor(Date.now() / 30000)
  for (let i = -window; i <= window; i++) {
    if (totpAt(buf, now + i) === t) return true
  }
  return false
}

function otpauthUrl(email, secret) {
  const label = encodeURIComponent('Dkit:' + email)
  return 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=Dkit&algorithm=SHA1&digits=6&period=30'
}

module.exports = { generateSecret, verifyTotp, totpAt, otpauthUrl, base32Decode }
