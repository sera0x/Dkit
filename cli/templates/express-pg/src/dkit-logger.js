// Ships logs to Dkit's log drain over HTTP. Enabled whenever DKIT_API_KEY
// and DKIT_API_URL are present in the environment (dkit run injects them if
// you set them with: dkit env:set DKIT_API_KEY dk_...  — or export them).
//
// Fire-and-forget with a tiny queue: logs never block or crash the app.
const fs = require('fs')
const path = require('path')

const API_URL = process.env.DKIT_API_URL || 'http://localhost:3001'
const API_KEY = process.env.DKIT_API_KEY || ''
const STATE = path.join(process.cwd(), '.dkit', 'state.json')

function projectId() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')).projectId } catch { return null }
}

let queue = []
let timer = null

function flush() {
  timer = null
  if (queue.length === 0 || !API_KEY) return
  const events = queue.splice(0, queue.length)
  fetch(API_URL + '/api/logs', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  }).catch(() => {})
}

function log(level, message, opts = {}) {
  queue.push({ level, message, source: opts.source, meta: opts.meta, ts: new Date().toISOString() })
  if (queue.length >= 25) return flush()
  if (!timer) timer = setTimeout(flush, 2000)
}

module.exports = { log, projectId }
