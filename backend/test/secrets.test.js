const test = require('node:test')
const assert = require('node:assert/strict')

process.env.DKIT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const { encryptSecret, decryptSecret, isEncrypted } = require('../src/secrets')

test('round-trips plaintext', () => {
  const value = 'postgres://user:pass@example.test/db?sslmode=require'
  const sealed = encryptSecret(value)
  assert.notEqual(sealed, value)
  assert.equal(isEncrypted(sealed), true)
  assert.equal(decryptSecret(sealed), value)
})

test('round-trips empty and unicode values', () => {
  assert.equal(decryptSecret(encryptSecret('')), '')
  assert.equal(decryptSecret(encryptSecret('clé-🔐-値')), 'clé-🔐-値')
})

test('does not double-encrypt', () => {
  const sealed = encryptSecret('secret')
  assert.equal(encryptSecret(sealed), sealed)
  assert.equal(decryptSecret(sealed), 'secret')
})

test('passes through legacy plaintext', () => {
  assert.equal(isEncrypted('legacy'), false)
  assert.equal(decryptSecret('legacy'), 'legacy')
})

test('encrypts a plaintext value that starts with the ciphertext prefix', () => {
  const value = 'enc:v1:not-a-real-ciphertext'
  const sealed = encryptSecret(value)
  assert.notEqual(sealed, value)
  assert.equal(decryptSecret(sealed), value)
})

test('rejects tampered ciphertext', () => {
  const sealed = encryptSecret('secret')
  const parts = sealed.split(':')
  const ciphertext = Buffer.from(parts[3], 'base64')
  ciphertext[0] ^= 1
  parts[3] = ciphertext.toString('base64')
  assert.throws(() => decryptSecret(parts.join(':')))
})
