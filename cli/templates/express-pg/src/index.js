const express = require('express')
const { Pool } = require('pg')
const app = express()
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
app.use(express.json())

let dkit
try { dkit = require('./dkit-logger') } catch { dkit = null }

app.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => {
    if (!dkit) return
    const ms = Date.now() - started
    dkit.log(res.statusCode >= 500 ? 'error' : 'info', `${req.method} ${req.path} ${res.statusCode} ${ms}ms`, { source: 'http' })
  })
  next()
})

app.get('/', (req, res) => {
  res.json({ name: '{{name}}', status: 'ok' })
})

app.get('/health', async (req, res) => {
  const db = await pool.query('SELECT 1 AS ok').then(() => 'up').catch(() => 'down')
  res.json({ service: '{{name}}', db })
})

app.listen(process.env.PORT || 3000, () => {
  console.log('{{name}} listening on ' + (process.env.PORT || 3000))
})
