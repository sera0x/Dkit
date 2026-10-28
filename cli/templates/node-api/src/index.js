const http = require('http')
const { log } = require('./dkit-logger')

const routes = {
  'GET /': (req, res) => json(res, 200, { name: '{{name}}', status: 'ok' }),
  'GET /health': (req, res) => json(res, 200, { status: 'ok', uptime: process.uptime() }),
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const started = Date.now()
  const handler = routes[req.method + ' ' + req.path] || routes[req.method + ' ' + req.url]
  res.on('finish', () => log(res.statusCode >= 500 ? 'error' : 'info', `${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`, { source: 'http' }))
  if (!handler) return json(res, 404, { error: 'Not found' })
  try { handler(req, res) } catch (err) { json(res, 500, { error: err.message }) }
})

server.listen(process.env.PORT || 3000, () => {
  log('info', '{{name}} listening on ' + (process.env.PORT || 3000), { source: 'boot' })
  console.log('{{name}} listening on ' + (process.env.PORT || 3000))
})
