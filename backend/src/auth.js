const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''

require('dotenv').config()
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const { pool } = require('./db')
const { projectAccessFor } = require('./teamAccess')

if (!process.env.JWT_SECRET) {
  throw new Error('Missing required env var: JWT_SECRET. Set it in backend/.env (generate one with: openssl rand -hex 32)')
}
const JWT_SECRET = process.env.JWT_SECRET

async function hashPassword(password) {
  return await bcrypt.hash(password, 10)
}

async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash)
}

const ACCESS_TOKEN_TTL = '15m'

function generateToken(userId, sessionId) {
  return jwt.sign({ userId, ...(sessionId ? { sid: sessionId } : {}) }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL })
}

function newRefreshToken() {
  return crypto.randomBytes(48).toString('hex')
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]
    if (!token) {
      return res.status(401).json({ error: 'Malformed token' })
    }

    let decoded = null
    let expired = false
    try { decoded = jwt.verify(token, JWT_SECRET) } catch (err) { expired = err?.name === 'TokenExpiredError' }
    if (!decoded) {
      return res.status(401).json(expired
        ? { error: 'Token expired', code: 'token_expired' }
        : { error: 'Invalid or expired token' })
    }

    const user = await pool.query('SELECT id, email, suspended FROM users WHERE id = $1', [decoded.userId])
    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' })
    }
    if (user.rows[0].suspended) {
      return res.status(403).json({ error: 'Account suspended', code: 'suspended' })
    }

    req.user = user.rows[0]
    req.sessionId = decoded.sid || null
    next()
  } catch (err) {
    console.error('Authentication Error:', err)
    return res.status(500).json({ error: 'Internal server error during authentication' })
  }
}

async function authenticateProject(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key']
    if (!apiKey) {
      const authHeader = req.headers.authorization || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const projectId = req.headers['x-project-id']
      if (!token || !projectId) {
        return res.status(401).json({ error: 'No API key provided' })
      }
      const decoded = verifyToken(token)
      if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' })
      const project = await projectAccessFor(projectId, decoded.userId)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const ownerRow = await pool.query('SELECT suspended FROM users WHERE id = $1', [project.user_id])
      if (ownerRow.rows[0]?.suspended) return res.status(403).json({ error: 'Account suspended', code: 'suspended' })
      req.project = project
      return next()
    }

    const project = await pool.query(
      'SELECT p.id, p.user_id, u.suspended FROM projects p JOIN users u ON u.id = p.user_id WHERE p.key_hash = $1',
      [require('crypto').createHash('sha256').update(apiKey).digest('hex')]
    )
    if (project.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' })
    }
    if (project.rows[0].suspended) {
      return res.status(403).json({ error: 'Account suspended', code: 'suspended' })
    }

    req.project = project.rows[0]
    next()
  } catch (err) {
    console.error('Project Authentication Error:', err)
    return res.status(500).json({ error: 'Internal server error during API key validation' })
  }
}

module.exports = {
  clientIp,
  hashPassword,
  verifyPassword,
  generateToken,
  newRefreshToken,
  hashRefreshToken,
  verifyToken,
  authenticate,
  authenticateProject
}
