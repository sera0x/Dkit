const crypto = require('crypto')

const PREFIX = 'enc:v1:'
const rawKey = process.env.DKIT_ENCRYPTION_KEY

if (!rawKey) {
  throw new Error('Missing required env var: DKIT_ENCRYPTION_KEY. Generate one with: openssl rand -hex 32')
}

let key
if (/^[0-9a-f]{64}$/i.test(rawKey)) {
  key = Buffer.from(rawKey, 'hex')
} else {
  const decoded = Buffer.from(rawKey, 'base64')
  if (decoded.length !== 32) {
    throw new Error('DKIT_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)')
  }
  key = decoded
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

function encryptSecret(value) {
  const plaintext = String(value ?? '')
  if (isEncrypted(plaintext)) {
    try {
      decryptSecret(plaintext)
      return plaintext
    } catch {}
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

function decryptSecret(value) {
  const stored = String(value ?? '')
  if (!isEncrypted(stored)) return stored
  const parts = stored.slice(PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('Malformed encrypted value')
  const [iv, tag, ciphertext] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}

module.exports = { encryptSecret, decryptSecret, isEncrypted }
