// Public status page (dkit.name.ng/status) engine.
//
// Dkit watches its own services with the same idea as user monitors
// (jobs.js), plus the pieces a status page needs on top:
//
//   - Seeded service list: API, Website, Docs (probed over HTTP).
//   - Admin override per service: mode = 'auto' | 'manual_up' | 'manual_down'.
//     'manual_down' is maintenance: probes stop, the page shows maintenance,
//     and a manual incident is opened. 'manual_up' forces the page green.
//   - Incident automation: a down-flip opens an 'auto' incident (if none is
//     open for that service); recovery resolves it with a downtime summary.
//     Admins see these as notifications on the dashboard until acknowledged.
//
// Everything here is best-effort — a failing probe is recorded, never thrown.

const { pool } = require('./db')
const { sendUptimeAlertEmail } = require('./email')

const PROBE_INTERVAL_S = 60       // how often each service is checked
const CHECK_RETENTION_HOURS = 48  // probe history kept for the uptime bar
const UPTIME_REFRESH_MS = 5 * 60 * 1000

function normalizeOrigin(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u.replace(/\/+$/, '') : 'https://' + u.replace(/\/+$/, '')
}

// Seed the core services once. Later boots keep admin edits (ON CONFLICT DO NOTHING).
async function ensureSeed() {
  const self = 'http://localhost:' + (process.env.PORT || 3001)
  const base = normalizeOrigin(process.env.PUBLIC_URL) || self
  const defs = [
    { name: 'API', url: self + '/api/health', description: 'Core API — auth, secrets, store, cron, monitors, logs', sort_order: 0 },
    { name: 'Website', url: base + '/', description: 'Dashboard and marketing site', sort_order: 1 },
    { name: 'Docs', url: base + '/docs', description: 'Documentation and CLI guides', sort_order: 2 },
  ]
  for (const d of defs) {
    await pool.query(
      'INSERT INTO status_services (name, url, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING',
      [d.name, d.url, d.description, d.sort_order]
    ).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------
async function probeService(s, { force = false } = {}) {
  // Manual modes mean a human owns this service's state right now — don't
  // fight them with probe results (force = the admin's explicit "check now").
  if (!force && s.mode !== 'auto') {
    await pool.query('UPDATE status_services SET last_checked_at = NOW() WHERE id = $1', [s.id]).catch(() => {})
    return { skipped: true }
  }

  const started = Date.now()
  let statusCode = null
  let errorText = null
  try {
    const res = await fetch(s.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15 * 1000),
    })
    statusCode = res.status
    if (res.status >= 400) errorText = 'HTTP ' + res.status
    await res.arrayBuffer().catch(() => {})
  } catch (err) {
    errorText = String(err?.cause?.message || err.message || err).slice(0, 300)
  }
  const ok = !errorText
  const latency = Date.now() - started

  const prevStatus = s.status
  const failures = ok ? 0 : (s.consecutive_failures || 0) + 1
  let status = s.status
  if (s.mode === 'manual_up') status = 'up'
  else if (s.mode === 'manual_down') status = 'down'
  else if (ok) status = 'up'
  else if (failures >= 2) status = 'down'
  else if (prevStatus === 'pending') status = 'down'

  const flippedDown = status === 'down' && prevStatus !== 'down' && s.mode === 'auto'
  const flippedUp = status === 'up' && prevStatus === 'down' && s.mode === 'auto'

  await pool.query(
    `UPDATE status_services
       SET last_checked_at = NOW(), last_latency_ms = $2, last_error = $3,
           status = $4, consecutive_failures = $5,
           down_since = CASE WHEN $4 = 'down' AND $1 <> 'down' THEN NOW()
                             WHEN $4 = 'up' THEN NULL
                             ELSE down_since END
     WHERE id = $6`,
    [prevStatus, latency, errorText, status, failures, s.id]
  ).catch(() => {})

  await pool.query(
    'INSERT INTO status_checks (service_id, status_code, ok, latency_ms, error) VALUES ($1, $2, $3, $4, $5)',
    [s.id, statusCode, ok, latency, errorText]
  ).catch(() => {})

  if (flippedDown) {
    await openAutoIncident(s, errorText).catch(() => {})
    // Email the admin account — down/up flips only, prober-driven flips only
    // (manual maintenance is an admin action, not a failure).
    sendStatusFlipEmail(s.name, s.url, 'down', errorText).catch(() => {})
  }
  if (flippedUp) {
    await resolveAutoIncidents(s).catch(() => {})
    sendStatusFlipEmail(s.name, s.url, 'up', null).catch(() => {})
  }

  return { ok, latency, statusCode, errorText, status, flippedDown, flippedUp }
}

async function runDueProbes() {
  const due = await pool.query(`
    SELECT id, name, url, mode, status, consecutive_failures
    FROM status_services
    WHERE last_checked_at IS NULL OR last_checked_at <= NOW() - INTERVAL '60 seconds'
    ORDER BY sort_order, name`)
  for (const s of due.rows) await probeService(s)
  return due.rows.length
}

// ---------------------------------------------------------------------------
// Incident automation
// ---------------------------------------------------------------------------
// The status prober emails the first admin account on down/up flips, reusing
// the monitor alert mail. Best-effort; no recipient configured → skip.
async function adminEmail() {
  const r = await pool.query('SELECT email FROM users WHERE COALESCE(is_admin, FALSE) ORDER BY created_at LIMIT 1')
  return r.rows[0]?.email || null
}

async function sendStatusFlipEmail(serviceName, url, status, errorText) {
  try {
    const to = await adminEmail()
    if (!to) return
    await sendUptimeAlertEmail(to, { name: 'Dkit · ' + serviceName, url, status, error: errorText })
  } catch { /* never let a mail failure touch the probe loop */ }
}

async function openAutoIncident(service, errorText) {
  const open = await pool.query(
    `SELECT id FROM status_incidents WHERE service_id = $1 AND source = 'auto' AND resolved_at IS NULL`,
    [service.id])
  if (open.rows.length > 0) return
  const inc = await pool.query(
    `INSERT INTO status_incidents (service_id, title, state, source, impact)
     VALUES ($1, $2, 'investigating', 'auto', 'major') RETURNING id, created_at`,
    [service.id, service.name + ' is down'])
  const detail = errorText ? 'Automated checks failed two probes in a row: ' + errorText + '.' : 'Automated checks failed two probes in a row.'
  await pool.query(
    'INSERT INTO status_updates (incident_id, state, message) VALUES ($1, $2, $3)',
    [inc.rows[0].id, 'investigating', detail])
}

async function resolveAutoIncidents(service) {
  const open = await pool.query(
    `UPDATE status_incidents SET state = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE service_id = $1 AND source = 'auto' AND resolved_at IS NULL
     RETURNING id, created_at`, [service.id])
  for (const row of open.rows) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000))
    await pool.query(
      'INSERT INTO status_updates (incident_id, state, message) VALUES ($1, $2, $3)',
      [row.id, 'resolved', 'Automated checks are passing again — down for about ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.'])
  }
}

// ---------------------------------------------------------------------------
// Admin controls
// ---------------------------------------------------------------------------
async function setServiceMode(serviceId, mode) {
  if (!['auto', 'manual_up', 'manual_down'].includes(mode)) throw new Error('Invalid mode')
  const cur = await pool.query('SELECT id, name, mode FROM status_services WHERE id = $1', [serviceId])
  const s = cur.rows[0]
  if (!s) throw new Error('Service not found')
  if (s.mode === mode) return s

  await pool.query('UPDATE status_services SET mode = $2 WHERE id = $1', [serviceId, mode])

  if (mode === 'manual_down') {
    // Maintenance: open a manual incident unless one is already open.
    const open = await pool.query(
      'SELECT id FROM status_incidents WHERE service_id = $1 AND resolved_at IS NULL', [serviceId])
    if (open.rows.length === 0) {
      const inc = await pool.query(
        `INSERT INTO status_incidents (service_id, title, state, source, impact)
         VALUES ($1, $2, 'monitoring', 'manual', 'maintenance') RETURNING id`,
        [serviceId, 'Maintenance — ' + s.name])
      await pool.query(
        'INSERT INTO status_updates (incident_id, state, message) VALUES ($1, $2, $3)',
        [inc.rows[0].id, 'monitoring', 'An admin marked this service as down for maintenance. Checks are paused until it is marked back up.'])
    }
  }

  if (mode !== 'manual_down') {
    // Leaving maintenance (either direction) resolves the manual incident.
    const open = await pool.query(
      `UPDATE status_incidents SET state = 'resolved', resolved_at = NOW(), updated_at = NOW()
       WHERE service_id = $1 AND source = 'manual' AND resolved_at IS NULL RETURNING id`, [serviceId])
    for (const row of open.rows) {
      await pool.query(
        'INSERT INTO status_updates (incident_id, state, message) VALUES ($1, $2, $3)',
        [row.id, 'resolved', 'An admin marked this service back up.'])
    }
  }
  return { ...s, mode }
}

async function forceCheck(serviceId) {
  const r = await pool.query(
    'SELECT id, name, url, mode, status, consecutive_failures FROM status_services WHERE id = $1', [serviceId])
  if (r.rows.length === 0) throw new Error('Service not found')
  return probeService(r.rows[0], { force: true })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function effectiveStatus(row) {
  if (row.mode === 'manual_down') return 'down'
  if (row.mode === 'manual_up') return 'up'
  return row.status
}

async function refreshUptime24h() {
  await pool.query(`
    UPDATE status_services s SET uptime_24h = COALESCE((
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE c.ok) / NULLIF(COUNT(*), 0), 2)
      FROM status_checks c WHERE c.service_id = s.id AND c.checked_at >= NOW() - INTERVAL '24 hours'
    ), 100)`).catch(() => {})
}

const INCIDENT_SELECT = `
  SELECT i.id, i.service_id, i.title, i.state, i.source, i.impact, i.created_at, i.resolved_at, i.updated_at,
         s.name AS service_name,
         COALESCE((SELECT json_agg(json_build_object('id', u.id, 'state', u.state, 'message', u.message, 'created_at', u.created_at) ORDER BY u.created_at)
                   FROM status_updates u WHERE u.incident_id = i.id), '[]'::json) AS updates
  FROM status_incidents i
  LEFT JOIN status_services s ON s.id = i.service_id`

async function listPublic() {
  const services = await pool.query(`
    SELECT id, name, description, mode, status, uptime_24h, last_checked_at, last_latency_ms, down_since
    FROM status_services ORDER BY sort_order, name`)
  const incidents = await pool.query(`
    ${INCIDENT_SELECT}
    WHERE i.resolved_at IS NULL OR i.updated_at >= NOW() - INTERVAL '7 days'
    ORDER BY (i.resolved_at IS NULL) DESC, i.created_at DESC LIMIT 20`)
  const rows = services.rows.map((s) => ({ ...s, effective_status: effectiveStatus(s) }))
  const anyDown = rows.some((s) => s.effective_status === 'down')
  const anyMaint = rows.some((s) => s.effective_status === 'down' && s.mode === 'manual_down')
  const openIncidents = incidents.rows.filter((i) => !i.resolved_at)
  const overall = openIncidents.length > 0 && openIncidents.every((i) => i.impact === 'maintenance') ? 'maintenance'
    : anyDown && !anyMaint ? 'outage'
    : anyDown ? 'maintenance'
    : openIncidents.length > 0 ? 'degraded'
    : 'operational'
  return {
    overall,
    services: rows,
    incidents: incidents.rows,
    open_incident_count: openIncidents.length,
    checked_at: new Date().toISOString(),
  }
}

async function listAdmin() {
  const services = await pool.query(`
    SELECT id, name, url, description, mode, status, uptime_24h, last_checked_at, last_latency_ms,
           last_error, down_since, consecutive_failures, sort_order
    FROM status_services ORDER BY sort_order, name`)
  const incidents = await pool.query(`
    ${INCIDENT_SELECT}
    WHERE i.resolved_at IS NULL
    ORDER BY i.created_at DESC LIMIT 50`)
  const unseen = await pool.query(
    `SELECT COUNT(*)::int AS n FROM status_incidents WHERE source = 'auto' AND seen_by_admin_at IS NULL`)
  const recent = await pool.query(`
    ${INCIDENT_SELECT}
    WHERE i.source = 'auto' AND i.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY i.created_at DESC LIMIT 25`)
  return {
    services: services.rows,
    open_incidents: incidents.rows,
    notifications: recent.rows,
    unseen_count: unseen.rows[0]?.n || 0,
  }
}

async function createIncident({ service_id, title, message, impact, state }) {
  if (!title || !String(title).trim()) throw new Error('Title required')
  const allowedImpact = ['maintenance', 'minor', 'major', 'critical']
  const allowedState = ['investigating', 'identified', 'monitoring', 'resolved']
  const inc = await pool.query(
    `INSERT INTO status_incidents (service_id, title, state, source, impact)
     VALUES ($1, $2, $3, 'manual', $4) RETURNING id`,
    [service_id || null, String(title).trim().slice(0, 200), allowedState.includes(state) ? state : 'investigating',
     allowedImpact.includes(impact) ? impact : 'minor'])
  await pool.query(
    'INSERT INTO status_updates (incident_id, state, message) VALUES ($1, $2, $3)',
    [inc.rows[0].id, allowedState.includes(state) ? state : 'investigating',
     String(message || '').trim().slice(0, 2000) || 'An admin opened this incident.'])
  return inc.rows[0].id
}

async function addIncidentUpdate(incidentId, { state, message }) {
  const allowedState = ['investigating', 'identified', 'monitoring', 'resolved']
  const st = allowedState.includes(state) ? state : 'monitoring'
  const r = await pool.query(
    'INSERT INTO status_updates (incident_id, state, message) VALUES ($1, $2, $3) RETURNING id',
    [incidentId, st, String(message || '').trim().slice(0, 2000) || 'Update posted.'])
  if (st === 'resolved') {
    await pool.query(
      `UPDATE status_incidents SET state = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`, [incidentId])
  } else {
    await pool.query(`UPDATE status_incidents SET state = $2, updated_at = NOW() WHERE id = $1`, [incidentId, st])
  }
  return r.rows[0].id
}

async function ackNotifications() {
  await pool.query(
    `UPDATE status_incidents SET seen_by_admin_at = NOW() WHERE source = 'auto' AND seen_by_admin_at IS NULL`)
}

async function pruneChecks() {
  const r = await pool.query(
    `DELETE FROM status_checks WHERE checked_at < NOW() - ($1 || ' hours')::interval`, [String(CHECK_RETENTION_HOURS)])
  return r.rowCount
}

// ---------------------------------------------------------------------------
// Main loop — same pattern as jobs.js: busy-guarded interval, never throws.
// ---------------------------------------------------------------------------
function startStatusProbes() {
  let busy = false
  let lastUptime = 0
  let lastPrune = 0
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const probed = await runDueProbes()
      if (Date.now() - lastUptime > UPTIME_REFRESH_MS) {
        lastUptime = Date.now()
        await refreshUptime24h()
      }
      if (Date.now() - lastPrune > 60 * 60 * 1000) {
        lastPrune = Date.now()
        await pruneChecks()
      }
      if (probed) console.log('status: probed ' + probed + ' service(s)')
    } catch (err) {
      console.error('status tick failed:', err.message)
    } finally {
      busy = false
    }
  }, 30 * 1000)
  timer.unref?.()
  return timer
}

module.exports = {
  ensureSeed,
  startStatusProbes,
  probeService,
  setServiceMode,
  forceCheck,
  listPublic,
  listAdmin,
  createIncident,
  addIncidentUpdate,
  ackNotifications,
  refreshUptime24h,
  pruneChecks,
  effectiveStatus,
}
