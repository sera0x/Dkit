require('dotenv').config()
const { Pool } = require('pg')
const redis = require('redis')
const crypto = require('crypto')
const required = ['DB_PASSWORD']
const missing = required.filter(key => !process.env[key])
if (missing.length > 0) {
throw new Error('Missing required env vars: ' + missing.join(', ') + '. Set them in backend/.env')
}
const pool = new Pool({
user: process.env.DB_USER || 'dkituser',
host: process.env.DB_HOST || 'localhost',
database: process.env.DB_NAME || 'dkit',
password: process.env.DB_PASSWORD,
port: process.env.DB_PORT || 5432,
})
const redisClient = redis.createClient({ url: 'redis://localhost:6379' })
// A restarted/idle-dropped Postgres kills pooled connections; the pool then
// emits 'error', and with no listener that crashes the whole API (site 502s
// until systemd restarts it). Log it and let the pool self-heal instead.
pool.on('error', (err) => console.error('Idle DB client error:', err && err.message))
redisClient.connect().catch(err => console.error('Redis connect failed:', err))
async function initDB() {
await pool.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`)
await pool.query(`CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, api_key TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT NOW())`)
await pool.query(`CREATE TABLE IF NOT EXISTS env_vars (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, environment TEXT DEFAULT 'production', UNIQUE(project_id, key, environment))`)
await pool.query(`CREATE TABLE IF NOT EXISTS kv_store (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, value JSONB NOT NULL, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(project_id, key))`)
await pool.query(`CREATE TABLE IF NOT EXISTS email_verifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL, expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '15 minutes', verified BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`)
await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '30 minutes', used BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`)
await pool.query(`CREATE TABLE IF NOT EXISTS login_codes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL, login_token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '10 minutes', created_at TIMESTAMP DEFAULT NOW())`)
await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id TEXT UNIQUE`)
await pool.query(`ALTER TABLE kv_store ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`)
await pool.query(`CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
)`)

await pool.query(`CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, user_id)
)`)

await pool.query(`CREATE TABLE IF NOT EXISTS team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  accepted_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMP DEFAULT NOW()
)`)

await pool.query(`ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites (LOWER(email))`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites (team_id)`)

// Team workspaces: projects shared into a team stay owned by the user who added
// them (they keep their api_key and personal listing); membership grants access.
await pool.query(`CREATE TABLE IF NOT EXISTS team_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, project_id)
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_projects_team ON team_projects (team_id)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_projects_project ON team_projects (project_id)`)

await pool.query(`CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, provider TEXT NOT NULL, expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '10 minutes', created_at TIMESTAMP DEFAULT NOW())`)
// Long-lived sessions for the website + CLI. The refresh token is stored as a
// SHA-256 hash (the plaintext value is only ever known by the client), so a DB
// leak can't be replayed into new access tokens. Absolute expiry of 180 days
// means even active users re-authenticate quarterly.
await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT UNIQUE NOT NULL,
  user_agent TEXT,
  last_ip TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '180 days',
  revoked_at TIMESTAMP
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions (refresh_hash)`)
await pool.query(`CREATE TABLE IF NOT EXISTS env_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, environment TEXT NOT NULL, old_value TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_env_history_lookup ON env_history(project_id, key, environment, created_at DESC)`)
// Audit trail columns: what happened ('set'/'update'/'delete'/'rollback'), who
// (advisory — the CLI tags requests with the logged-in email) and from where.
await pool.query(`ALTER TABLE env_history ADD COLUMN IF NOT EXISTS action TEXT DEFAULT 'set'`)
await pool.query(`ALTER TABLE env_history ADD COLUMN IF NOT EXISTS actor TEXT`)
await pool.query(`ALTER TABLE env_history ADD COLUMN IF NOT EXISTS actor_ip TEXT`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`)
// Boot-time settings: the API fills any missing env var from the special
// 'dkit-self' project (see loadSelfSettings in server.js). Dkit configures
// itself with Dkit.
await pool.query(`CREATE TABLE IF NOT EXISTS self_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW())`)
// Two-factor auth (TOTP). The secret is stored as-is (obfuscating it client-side
// would be theater — the server has to read it to derive codes); totp_enabled
// flips on only after the first code verifies, so a half-finished setup can't
// lock anyone out. Recovery codes are SHA-256 hashes, plaintext shown once.
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE`)
await pool.query(`CREATE TABLE IF NOT EXISTS recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, code_hash)
)`)
// Pending second-factor challenges (password or OAuth passed, 2FA code not yet
// given). Separate from login_codes so an email-code and a TOTP challenge can
// never collide on the same token.
await pool.query(`CREATE TABLE IF NOT EXISTS login_challenges (
  login_token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '10 minutes',
  created_at TIMESTAMP DEFAULT NOW()
)`)
// API keys are stored as SHA-256 hashes — the plaintext is shown once at
// creation (or rotation) and lives only on a client. key_prefix keeps a
// recognisable "dk_…" hint for the dashboard; key_rotated_at feeds the UI.
await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_hash TEXT UNIQUE`)
await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_prefix TEXT`)
await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_rotated_at TIMESTAMP`)
await pool.query(`ALTER TABLE projects ALTER COLUMN api_key DROP NOT NULL`)

// ---------------------------------------------------------------------------
// Cron jobs: schedule outbound HTTP calls from the API. next_run_at is the
// work queue — the background ticker in jobs.js claims due rows.
// ---------------------------------------------------------------------------
await pool.query(`CREATE TABLE IF NOT EXISTS cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST',
  headers JSONB NOT NULL DEFAULT '{}',
  body TEXT,
  schedule TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  last_status TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, name)
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_cron_jobs_due ON cron_jobs (next_run_at) WHERE enabled`)
await pool.query(`CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES cron_jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT NOW(),
  duration_ms INTEGER,
  status_code INTEGER,
  ok BOOLEAN,
  error TEXT
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs (job_id, started_at DESC)`)

// ---------------------------------------------------------------------------
// Uptime monitors: the API probes your URLs and emails you on down/up. Status
// flips to 'down' after 2 consecutive failures, back to 'up' after 1 success.
// ---------------------------------------------------------------------------
await pool.query(`CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  interval_seconds INTEGER NOT NULL DEFAULT 60,
  email TEXT,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  last_checked_at TIMESTAMP,
  last_status_code INTEGER,
  last_latency_ms INTEGER,
  last_error TEXT,
  down_since TIMESTAMP,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, name)
)`)
await pool.query(`CREATE TABLE IF NOT EXISTS monitor_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at TIMESTAMP DEFAULT NOW(),
  status_code INTEGER,
  ok BOOLEAN,
  latency_ms INTEGER,
  error TEXT
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_monitor_checks ON monitor_checks (monitor_id, checked_at DESC)`)

// ---------------------------------------------------------------------------
// Log drain: ship logs from any app over HTTP, tail them from the CLI or the
// dashboard. 7-day retention (cleaned in jobs.js) keeps this table small.
// ---------------------------------------------------------------------------
await pool.query(`CREATE TABLE IF NOT EXISTS log_entries (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  meta JSONB,
  source TEXT,
  ts TIMESTAMP DEFAULT NOW()
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_logs_project_ts ON log_entries (project_id, ts DESC)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_logs_project_level ON log_entries (project_id, level)`)

// ---------------------------------------------------------------------------
// Public status page (dkit.name.ng/status). Dkit watches its own services
// with the same prober that powers user monitors, but with admin control on
// top: an admin can force a service up/down for maintenance and post incidents.
// ---------------------------------------------------------------------------
await pool.query(`CREATE TABLE IF NOT EXISTS status_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- 'auto' = the prober decides; 'manual_up'/'manual_down' = admin override
  mode TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'pending',
  uptime_24h REAL NOT NULL DEFAULT 100,
  last_checked_at TIMESTAMP,
  last_latency_ms INTEGER,
  last_error TEXT,
  down_since TIMESTAMP,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)`)
await pool.query(`CREATE TABLE IF NOT EXISTS status_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES status_services(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- 'investigating' | 'identified' | 'monitoring' | 'resolved'
  state TEXT NOT NULL DEFAULT 'investigating',
  -- 'auto' = opened by the prober on down; 'manual' = posted by an admin
  source TEXT NOT NULL DEFAULT 'manual',
  impact TEXT NOT NULL DEFAULT 'minor',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_status_incidents_open ON status_incidents (resolved_at) WHERE resolved_at IS NULL`)
await pool.query(`CREATE TABLE IF NOT EXISTS status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES status_incidents(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_status_updates_incident ON status_updates (incident_id, created_at DESC)`)
await pool.query(`CREATE TABLE IF NOT EXISTS status_checks (
  id BIGSERIAL PRIMARY KEY,
  service_id UUID REFERENCES status_services(id) ON DELETE CASCADE,
  checked_at TIMESTAMP DEFAULT NOW(),
  status_code INTEGER,
  ok BOOLEAN,
  latency_ms INTEGER,
  error TEXT
)`)
await pool.query(`CREATE INDEX IF NOT EXISTS idx_status_checks_service ON status_checks (service_id, checked_at DESC)`)
await pool.query(`ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS seen_by_admin_at TIMESTAMP`)

console.log('Database initialized')
}

// One-time migration: projects created before hashing keep their plaintext key
// in api_key. Hash it into key_hash, keep the prefix, then scrub the plaintext.
async function migrateProjectKeys() {
  const legacy = await pool.query('SELECT id, api_key FROM projects WHERE key_hash IS NULL AND api_key IS NOT NULL')
  for (const row of legacy.rows) {
    const hash = crypto.createHash('sha256').update(row.api_key).digest('hex')
    await pool.query('UPDATE projects SET key_hash = $2, key_prefix = $3 WHERE id = $1', [row.id, hash, row.api_key.slice(0, 8)])
  }
  if (legacy.rows.length > 0) {
    await pool.query('UPDATE projects SET api_key = NULL WHERE key_hash IS NOT NULL AND api_key IS NOT NULL')
    console.log('Migrated ' + legacy.rows.length + ' project API key(s) to hashed storage')
  }
}

const initPromise = (async () => {
  await initDB()
  await migrateProjectKeys()
})()

module.exports = { pool, redisClient, initPromise }
