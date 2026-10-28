
const { pool } = require('./db')
const r2 = require('./r2')
const { sendUptimeAlertEmail } = require('./email')

const TICK_MS = 30 * 1000
const RETENTION_DAYS = 7

const DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function parseSchedule(schedule, from = new Date()) {
  const s = String(schedule || '').trim().toLowerCase()
  const base = from.getTime()

  const interval = s.match(/^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)$/)
  if (interval) {
    const n = Number(interval[1])
    const unit = interval[2][0]
    const ms = unit === 's' ? n * 1000 : unit === 'm' ? n * 60 * 1000 : n * 3600 * 1000
    if (ms < 10 * 1000) return null
    return Math.floor(base / ms) * ms + ms
  }

  const daily = s.match(/^daily\s+(\d{1,2}):(\d{2})$/)
  if (daily) {
    const h = Number(daily[1]), m = Number(daily[2])
    if (h > 23 || m > 59) return null
    const d = new Date(base)
    d.setUTCHours(h, m, 0, 0)
    if (d.getTime() <= base) d.setUTCDate(d.getUTCDate() + 1)
    return d.getTime()
  }

  const weekly = s.match(/^(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}):(\d{2})$/)
  if (weekly) {
    const target = DAY_NAMES[weekly[1]]
    const h = Number(weekly[2]), m = Number(weekly[3])
    if (h > 23 || m > 59) return null
    const d = new Date(base)
    const cur = d.getUTCDay()
    let add = (target - cur + 7) % 7
    d.setUTCDate(d.getUTCDate() + add)
    d.setUTCHours(h, m, 0, 0)
    if (d.getTime() <= base) { d.setUTCDate(d.getUTCDate() + 7) }
    return d.getTime()
  }

  return null
}

function firstRunAt(schedule) {
  return parseSchedule(schedule, new Date(Date.now() - 1000))
}

function describeSchedule(schedule) {
  const next = parseSchedule(schedule, new Date())
  return next ? new Date(next).toISOString() : null
}

async function executeCronJob(job) {
  const started = Date.now()
  let statusCode = null
  let errorText = null
  try {
    const custom = (typeof job.headers === 'object' && job.headers) || {}
    const hasCT = Object.keys(custom).some((k) => k.toLowerCase() === 'content-type')
    const res = await fetch(job.url, {
      method: job.method || 'POST',
      headers: {
        ...(job.body != null && job.body !== '' && !hasCT ? { 'Content-Type': 'application/json' } : {}),
        ...custom,
      },
      body: job.method === 'GET' || job.method === 'HEAD' ? undefined : (job.body ?? undefined),
      signal: AbortSignal.timeout(30 * 1000),
    })
    statusCode = res.status
    if (!res.ok) errorText = 'HTTP ' + res.status
    await res.arrayBuffer().catch(() => {})
  } catch (err) {
    errorText = String(err?.cause?.message || err.message || err).slice(0, 300)
  }
  return { statusCode, errorText, durationMs: Date.now() - started }
}

async function recordCronRun(job, result) {
  const next = parseSchedule(job.schedule)
  await pool.query(
    'UPDATE cron_jobs SET last_run_at = NOW(), next_run_at = $2, last_status = $3 WHERE id = $1',
    [job.id, next ? new Date(next) : null, result.errorText ? 'error: ' + result.errorText : 'ok (' + result.statusCode + ')']
  ).catch(() => {})
  await pool.query(
    'INSERT INTO cron_runs (job_id, duration_ms, status_code, ok, error) VALUES ($1, $2, $3, $4, $5)',
    [job.id, result.durationMs, result.statusCode, !result.errorText, result.errorText]
  ).catch(() => {})
}

async function runDueCronJobs() {
  const due = await pool.query(
    `UPDATE cron_jobs SET next_run_at = NULL
     WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= NOW()
     RETURNING id, project_id, name, url, method, headers, body, schedule`
  )
  for (const job of due.rows) {
    const result = await executeCronJob(job)
    await recordCronRun(job, result)
  }
  return due.rows.length
}

async function pruneCronRuns() {
  await pool.query(`
    DELETE FROM cron_runs cr WHERE (
      SELECT COUNT(*) FROM cron_runs cr2
      WHERE cr2.job_id = cr.job_id AND cr2.started_at >= cr.started_at
    ) > 200`).catch(() => {})
}

async function probeMonitor(m) {
  const started = Date.now()
  let statusCode = null
  let errorText = null
  try {
    const res = await fetch(m.url, {
      method: m.method || 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.min(Math.max((m.interval_seconds || 60) * 1000 - 5000, 10000), 30000)),
    })
    statusCode = res.status
    if (!res.ok) errorText = 'HTTP ' + res.status
    await res.arrayBuffer().catch(() => {})
  } catch (err) {
    errorText = String(err?.cause?.message || err.message || err).slice(0, 300)
  }
  const ok = !errorText
  const latency = Date.now() - started

  const prevStatus = m.status
  const failures = ok ? 0 : (m.consecutive_failures || 0) + 1
  let status = prevStatus
  if (ok) status = 'up'
  else if (failures >= 2) status = 'down'
  else if (prevStatus === 'pending') status = 'down'

  await pool.query(
    `UPDATE monitors SET last_checked_at = NOW(), last_status_code = $2, last_latency_ms = $3,
       last_error = $4, status = $5, consecutive_failures = $6,
       down_since = CASE WHEN $5 = 'down' AND ($1 <> 'down') THEN NOW()
                         WHEN $5 = 'up' THEN NULL
                         ELSE down_since END
     WHERE id = $7`,
    [prevStatus, statusCode, latency, errorText, status, failures, m.id]
  ).catch(() => {})

  await pool.query(
    'INSERT INTO monitor_checks (monitor_id, status_code, ok, latency_ms, error) VALUES ($1, $2, $3, $4, $5)',
    [m.id, statusCode, ok, latency, errorText]
  ).catch(() => {})

  if (m.email && status !== prevStatus && (status === 'down' || status === 'up')) {
    sendUptimeAlertEmail(m.email, {
      name: m.name,
      url: m.url,
      status,
      statusCode,
      error: errorText,
      downSince: status === 'down' ? new Date() : null,
    }).catch(() => {})
  }
  return { ok, latency }
}

async function runDueMonitors() {
  const due = await pool.query(`
    SELECT id, project_id, name, url, method, interval_seconds, email, status, consecutive_failures, paused
    FROM monitors
    WHERE NOT paused
      AND (last_checked_at IS NULL
           OR last_checked_at <= NOW() - (LEAST(GREATEST(interval_seconds, 30), 3600) * INTERVAL '1 second'))
    LIMIT 25`)
  for (const m of due.rows) await probeMonitor(m)
  return due.rows.length
}

async function scheduleMonitors() {}

async function pruneLogs() {
  const r = await pool.query(`DELETE FROM log_entries WHERE ts < NOW() - ($1 || ' days')::interval`, [RETENTION_DAYS])
  return r.rowCount
}

async function sweepMediaExpiry() {
  if (!r2.configured()) return 0
  const due = await pool.query(
    `SELECT id, r2_key FROM media_files
     WHERE expires_at IS NOT NULL AND deleted_at IS NULL AND expires_at <= NOW()
     LIMIT 50`
  )
  let swept = 0
  for (const row of due.rows) {
    try {
      await r2.deleteObject(row.r2_key)
      await pool.query('UPDATE media_files SET deleted_at = NOW() WHERE id = $1', [row.id])
      swept++
    } catch (err) {
      console.error('media sweep failed for ' + row.r2_key + ':', err.message)
    }
  }
  return swept
}

function startJobs() {
  let busy = false
  let lastLogPrune = 0
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const cronRan = await runDueCronJobs()
      const probesRan = await runDueMonitors()
      const mediaSwept = await sweepMediaExpiry()
      if (mediaSwept > 0) console.log('jobs: swept ' + mediaSwept + ' expired media file(s)')
      if (Date.now() - lastLogPrune > 60 * 60 * 1000) {
        lastLogPrune = Date.now()
        const pruned = await pruneLogs()
        if (pruned > 0) console.log('Pruned ' + pruned + ' old log entries')
        await pruneCronRuns()
      }
      if (cronRan || probesRan) console.log('jobs: ran ' + cronRan + ' cron job(s), ' + probesRan + ' monitor probe(s)')
    } catch (err) {
      console.error('jobs tick failed:', err.message)
    } finally {
      busy = false
    }
  }, TICK_MS)
  timer.unref?.()
  return timer
}

module.exports = { startJobs, parseSchedule, firstRunAt, describeSchedule, executeCronJob, recordCronRun, sweepMediaExpiry, RETENTION_DAYS }
