// Ships logs to Dkit's log drain. Enabled when DKIT_API_KEY is in the
// environment (dkit run injects it if you've stored it: dkit env:set DKIT_API_KEY dk_...).
const API_URL = process.env.DKIT_API_URL || 'http://localhost:3001'
const API_KEY = process.env.DKIT_API_KEY || ''

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

module.exports = { log }
