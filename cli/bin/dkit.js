#!/usr/bin/env node
const { program } = require('commander')
const axios = require('axios')
const chalk = require('chalk')
const ora = require('ora')
const inquirer = require('inquirer')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { scaffold } = require('../lib/scaffold')
const { deriveNames, validateNpmName } = require('../lib/names')
const CONFIG_PATH = path.join(os.homedir(), '.dkitrc')
const API_BASE = process.env.DKIT_API_URL || 'http://localhost:3001'
function loadConfig() { try { const raw = fs.readFileSync(CONFIG_PATH, 'utf8'); return JSON.parse(raw) } catch { return {} } }
function saveConfig(config) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 }); try { fs.chmodSync(CONFIG_PATH, 0o600) } catch {} }
function getApiClient(apiKey) { return axios.create({ baseURL: API_BASE, headers: { 'x-api-key': apiKey, 'x-dkit-actor': loadConfig().user?.email || '' } }) }
// x-session-token lets the backend flag which listed session is THIS device
// (used by the dashboard's devices list and 'revoke other sessions').
function getAuthClient(token) {
  const config = loadConfig()
  return axios.create({ baseURL: API_BASE, headers: { Authorization: 'Bearer ' + token, ...(config.refresh_token ? { 'x-session-token': config.refresh_token } : {}) } })
}
// Sessions: the API hands out a 15-minute access token plus a 180-day refresh
// token. We renew a minute before expiry so commands never fail mid-run.
async function refreshSession() {
  const config = loadConfig()
  if (!config.refresh_token) return null
  const response = await axios.post(API_BASE + '/api/auth/refresh', { refresh_token: config.refresh_token })
  const next = loadConfig()
  next.token = response.data.token
  next.refresh_token = response.data.refresh_token
  next.token_expires_at = Date.now() + 14 * 60 * 1000
  saveConfig(next)
  return next.token
}
function jwtExpiry(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).exp * 1000 } catch { return 0 } }
async function ensureSession() {
  const config = loadConfig()
  if (!config.token) { console.log(chalk.red('Not logged in. Run: dkit login')); process.exit(1) }
  // Freshness comes from our own expiry bookkeeping, or straight from the JWT
  // payload (covers configs written by older CLI versions).
  const expiresAt = config.token_expires_at || jwtExpiry(config.token)
  if (config.refresh_token && Date.now() > expiresAt - 60 * 1000) {
    try { return await refreshSession() } catch {
      console.log(chalk.red('Session expired. Run: dkit login'))
      process.exit(1)
    }
  }
  return config.token
}
const getUserToken = ensureSession
function maskKey(key) { if (!key) return 'dk_…'; if (key.length < 10) return key + '…'; return key.slice(0, 6) + '…' + key.slice(-4) }
function findLinkState(dir) { let cur = dir || process.cwd(); while (true) { const p = path.join(cur, '.dkit', 'state.json'); if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } } const parent = path.dirname(cur); if (parent === cur) return null; cur = parent } }
function getProjectApiKey() { const config = loadConfig(); const state = findLinkState(); if (state && state.project) { const key = config.apiKeys && config.apiKeys[state.project]; if (key) return key; console.log(chalk.yellow('This folder is linked to "' + state.project + '" but no API key for it is cached on this machine. Run: dkit projects:list')); process.exit(1) } if (!config.currentProject || !config.apiKeys) { console.log(chalk.red('No project selected. Run: dkit projects:list')); process.exit(1) } return config.apiKeys[config.currentProject] }
program.name('dkit').description('Dkit CLI - Developer Toolkit').version('0.3.0')
program.command('login').description('Login to Dkit').action(async () => {
const { email, password } = await inquirer.prompt([{ type: 'input', name: 'email', message: 'Email:' }, { type: 'password', name: 'password', message: 'Password:' }])
const spinner = ora('Initiating login...').start()
try {
const response = await axios.post(API_BASE + '/api/auth/login/initiate', { email, password })
if (response.data.two_factor) {
  spinner.succeed('Two-factor required')
  const { code } = await inquirer.prompt([{ type: 'input', name: 'code', message: 'Authenticator or recovery code:' }])
  const verifySpinner = ora('Verifying...').start()
  try {
    const verifyResponse = await axios.post(API_BASE + '/api/auth/login/verify', { login_token: response.data.login_token, code: code.trim() })
    const config = loadConfig(); config.token = verifyResponse.data.token; config.refresh_token = verifyResponse.data.refresh_token; config.token_expires_at = Date.now() + 14 * 60 * 1000; config.user = verifyResponse.data.user; saveConfig(config)
    verifySpinner.succeed('Logged in successfully — sessions auto-renew, no weekly re-login'); console.log('Welcome back, ' + verifyResponse.data.user.email)
  } catch (verifyError) { verifySpinner.fail('Verification failed'); console.log(chalk.red(verifyError.response?.data?.error || verifyError.message)) }
  return
}
spinner.succeed('Verification code sent to your email')
console.log('Check your email (and spam folder) for the code.')
const { code } = await inquirer.prompt([{ type: 'input', name: 'code', message: 'Enter verification code:' }])
const verifySpinner = ora('Verifying code...').start()
try {
const verifyResponse = await axios.post(API_BASE + '/api/auth/login/verify', { login_token: response.data.login_token, code: code })
const config = loadConfig(); config.token = verifyResponse.data.token; config.refresh_token = verifyResponse.data.refresh_token; config.token_expires_at = Date.now() + 14 * 60 * 1000; config.user = verifyResponse.data.user; saveConfig(config)
verifySpinner.succeed('Logged in successfully — sessions auto-renew, no weekly re-login'); console.log('Welcome back, ' + verifyResponse.data.user.email)
} catch (verifyError) { verifySpinner.fail('Verification failed'); console.log(chalk.red(verifyError.response?.data?.error || verifyError.message)) }
} catch (error) { spinner.fail('Login failed'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('logout').description("Log out and revoke this device's session").action(async () => {
const config = loadConfig()
try { if (config.refresh_token) await axios.post(API_BASE + '/api/auth/logout', { refresh_token: config.refresh_token }) } catch { /* revocation is best-effort */ }
delete config.token; delete config.refresh_token; delete config.token_expires_at; delete config.user
saveConfig(config)
console.log(chalk.green('Logged out'))
})
const twofa = program.command('2fa').description('Manage two-factor authentication')
twofa.command('status').description('Show whether 2FA is enabled').action(async () => {
  const token = await getUserToken()
  try { const r = await getAuthClient(token).get('/api/auth/2fa/status'); console.log('2FA ' + (r.data.enabled ? 'enabled' : 'disabled') + (r.data.enabled ? ' — ' + r.data.unused_recovery_codes + ' unused recovery code(s)' : '')) }
  catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
twofa.command('setup').description('Start 2FA setup; prints the secret for your authenticator app').action(async () => {
  const token = await getUserToken()
  const spinner = ora('Generating secret...').start()
  try {
    const r = await getAuthClient(token).post('/api/auth/2fa/setup')
    spinner.succeed('Add this secret to your authenticator app (Dkit:<your email>):')
    console.log(chalk.bold(r.data.secret))
    console.log(chalk.gray(r.data.otpauth_url))
    console.log('Then run: dkit 2fa enable <code>')
  } catch (error) { spinner.fail('Setup failed'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
twofa.command('enable <code>').description('Confirm setup with a 6-digit code; prints recovery codes once').action(async (code) => {
  const token = await getUserToken()
  const spinner = ora('Enabling...').start()
  try {
    const r = await getAuthClient(token).post('/api/auth/2fa/enable', { code })
    spinner.succeed('2FA enabled. Recovery codes (shown once, each works once):')
    r.data.recovery_codes.forEach((c) => console.log('  ' + c))
  } catch (error) { spinner.fail('Could not enable'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
twofa.command('disable').description('Turn 2FA off (needs password and a current code)').action(async () => {
  const token = await getUserToken()
  const { password } = await inquirer.prompt([{ type: 'password', name: 'password', message: 'Password:' }])
  const { code } = await inquirer.prompt([{ type: 'input', name: 'code', message: 'Current authenticator code:' }])
  const spinner = ora('Disabling...').start()
  try { await getAuthClient(token).post('/api/auth/2fa/disable', { password, code }); spinner.succeed('2FA disabled') }
  catch (error) { spinner.fail('Could not disable'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('projects:create <name>').description('Create a new project (starts keyless — a key is issued for CLI use)').action(async (name) => {
const token = await getUserToken(); const spinner = ora('Creating project...').start()
try {
const authed = getAuthClient(token)
const response = await authed.post('/api/projects', { name })
const project = response.data
const config = loadConfig(); if (!config.apiKeys) config.apiKeys = {}; config.currentProject = name; saveConfig(config)
// The project starts keyless; issue its first key now (one-time display).
spinner.text = 'Issuing API key...'
const keyRes = await authed.post('/api/projects/' + project.id + '/api-key')
config.apiKeys[name] = keyRes.data.api_key; saveConfig(config)
spinner.succeed('Project created (key issued for this machine)'); console.log('Name: ' + name); console.log('API Key: ' + chalk.yellow(keyRes.data.api_key)); console.log('It is stored hashed server-side and saved to this machine\'s dkit config.')
} catch (error) { spinner.fail('Failed to create project'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('projects:list').description('List all projects').option('-s, --show', 'Reveal full API keys').action(async (options) => {
const token = await getUserToken(); const spinner = ora('Loading projects...').start()
try {
const response = await getAuthClient(token).get('/api/projects'); spinner.succeed('Projects loaded')
const projects = response.data.projects
if (projects.length === 0) { console.log('No projects found. Create one with: dkit projects:create <name>'); return }
const config = loadConfig()
projects.forEach(p => { if (p.api_key) config.apiKeys[p.name] = p.api_key })
saveConfig(config)
projects.forEach(p => {
const isCurrent = config.currentProject === p.name
console.log((isCurrent ? '>' : ' ') + ' ' + p.name + (isCurrent ? ' ' + chalk.green('(active)') : ''))
// Keys are hashed server-side, so the full key only exists where the user saved it.
console.log('   API Key: ' + chalk.dim(p.api_key ? (options.show ? p.api_key : maskKey(p.api_key)) : (p.key_prefix ? p.key_prefix + '…' : 'hidden — use dkit keys:rotate to reissue'))) 
console.log('   ID: ' + chalk.dim(p.id))
console.log()
})
if (projects.length > 1) {
const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: 'Switch to project? (or press Enter to keep current)', choices: projects.map(p => p.name).concat(['Cancel']) }])
if (selected && selected !== 'Cancel') { config.currentProject = selected; saveConfig(config); console.log(chalk.green('Switched to: ' + selected)) }
}
} catch (error) { spinner.fail('Failed to load projects'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:set <key> <value>').description('Set an environment variable').option('-e, --env <environment>', 'Environment (development/staging/production)', 'development').action(async (key, value, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); const spinner = ora('Setting ' + key + '...').start()
try { await client.post('/api/env', { key, value, environment: options.env }); spinner.succeed(key + ' set for ' + options.env) } catch (error) { spinner.fail('Failed to set environment variable'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:get <key>').description('Get an environment variable').option('-e, --env <environment>', 'Environment', 'production').action(async (key, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try { const response = await client.get('/api/env/' + key, { params: { environment: options.env } }); console.log(key + '=' + response.data.value) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:list').description('List environment variables (masked server-side unless --show)').option('-e, --env <environment>', 'Environment', 'production').option('-s, --show', 'Reveal real values (fetched explicitly)').action(async (options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try {
const response = await client.get('/api/env', { params: options.show ? {} : { mask: 1 } }); const env = response.data.env
if (Object.keys(env).length === 0) { console.log('No environment variables set.'); return }
console.log(chalk.cyan('\nEnvironment Variables (' + Object.keys(env).length + ' total)\n'))
Object.entries(env).forEach(([key, value]) => { console.log('  ' + chalk.yellow(key) + ' = ' + chalk.green(value)) })
if (!options.show) console.log(chalk.dim('\n(masked — plaintext never left the API; use dkit env:get <key> to reveal one)\n'))
} catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:unset <key>').description('Remove an environment variable').option('-e, --env <environment>', 'Environment', 'production').action(async (key, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); const spinner = ora('Removing ' + key + '...').start()
try { await client.delete('/api/env/' + key, { params: { environment: options.env } }); spinner.succeed(key + ' removed from ' + options.env) } catch (error) { spinner.fail('Failed to remove environment variable'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:history <key>').description('Audit trail for one env var key: set / update / delete / rollback events').option('-e, --env <environment>', 'Environment', 'production').action(async (key, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try {
const response = await client.get('/api/env/' + key + '/history', { params: { environment: options.env } })
const events = response.data.events
if (events.length === 0) { console.log('No recorded changes for ' + key + '.'); return }
console.log(chalk.cyan('\n' + key + ' (' + options.env + ') — ' + events.length + ' event(s)\n'))
events.forEach((ev) => {
const who = ev.actor ? ev.actor.split('@')[0] : 'api'
const ip = ev.actor_ip ? ' from ' + ev.actor_ip : ''
console.log('  ' + chalk.dim(ev.created_at) + '  ' + chalk.yellow(ev.action.padEnd(9)) + ' by ' + who + ip)
})
console.log()
} catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:rollback <key>').description('Restore an environment variable to its previous value').option('-e, --env <environment>', 'Environment', 'production').action(async (key, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); const spinner = ora('Rolling back ' + key + '...').start()
try { const response = await client.post('/api/env/rollback', { key, environment: options.env }); spinner.succeed(response.data.message) } catch (error) { spinner.fail('Failed to rollback'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('run <command...>').description('Inject secrets into a command and run it — nothing touches disk').option('-e, --env <environment>', 'Environment', 'production').allowUnknownOption().action(async (command, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); let secrets = {}
try { const response = await client.get('/api/env', { params: { environment: options.env } }); secrets = response.data.env } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)); process.exit(1) }
const args = command.filter((arg) => arg !== '--')
if (args.length === 0) { console.log(chalk.red('No command given. Usage: dkit run -- npm start')); process.exit(1) }
const { spawn } = require('child_process')
const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: { ...process.env, ...secrets } })
let exiting = false
const cleanup = (signal) => { if (exiting) return; exiting = true; if (!child.killed) child.kill(signal) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
child.on('exit', (code, signal) => { process.removeListener('SIGINT', cleanup); process.removeListener('SIGTERM', cleanup); if (signal) { process.kill(process.pid, signal) } else { process.exit(code === null ? 1 : code) } })
child.on('error', (err) => { console.log(chalk.red('Failed to start "' + args[0] + '": ' + err.message)); process.exit(1) })
})
program.command('env:diff <envA> <envB>').description('Compare which keys differ between two environments (values stay masked)').action(async (envA, envB) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try {
const [a, b] = await Promise.all([ client.get('/api/env', { params: { environment: envA } }), client.get('/api/env', { params: { environment: envB } }) ])
const envAData = a.data.env; const envBData = b.data.env
const keysA = new Set(Object.keys(envAData)); const keysB = new Set(Object.keys(envBData))
const onlyA = [...keysA].filter((k) => !keysB.has(k)); const onlyB = [...keysB].filter((k) => !keysA.has(k))
const common = [...keysA].filter((k) => keysB.has(k)); const different = common.filter((k) => envAData[k] !== envBData[k])
if (onlyA.length === 0 && onlyB.length === 0 && different.length === 0) { console.log(chalk.green('No differences between ' + envA + ' and ' + envB + '.')); return }
if (onlyA.length) { console.log(chalk.yellow('\nOnly in ' + envA + ':')); onlyA.forEach((k) => console.log('  ' + k)) }
if (onlyB.length) { console.log(chalk.yellow('\nOnly in ' + envB + ':')); onlyB.forEach((k) => console.log('  ' + k)) }
if (different.length) { console.log(chalk.yellow('\nDifferent values (masked):')); different.forEach((k) => console.log('  ' + k)) }
console.log()
} catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:copy <fromEnv> <toEnv>').description('Copy all variables from one environment to another').action(async (fromEnv, toEnv) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); const spinner = ora('Copying ' + fromEnv + ' -> ' + toEnv + '...').start()
try { const response = await client.post('/api/env/copy', { from: fromEnv, to: toEnv }); spinner.succeed(response.data.message) } catch (error) { spinner.fail('Failed to copy environment'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('env:pull').description('Print an environment as .env-format text — use: dkit env:pull > .env').option('-e, --env <environment>', 'Environment', 'production').action(async (options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try { const response = await client.get('/api/env', { params: { environment: options.env } }); const env = response.data.env; Object.entries(env).forEach(([key, value]) => { const needsQuotes = /\s|"/.test(value); const safeValue = needsQuotes ? '"' + value.replace(/"/g, '\\"') + '"' : value; console.log(key + '=' + safeValue) }) } catch (error) { console.error(chalk.red(error.response?.data?.error || error.message)); process.exit(1) }
})
program.command('env:push <file>').description('Bulk-set variables from a local .env-format file').option('-e, --env <environment>', 'Environment', 'production').action(async (file, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); let lines
try { lines = fs.readFileSync(file, 'utf8').split('\n') } catch (error) { console.log(chalk.red('Could not read ' + file + ': ' + error.message)); process.exit(1) }
const pairs = lines.map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => { const idx = line.indexOf('='); if (idx === -1) return null; const key = line.slice(0, idx).trim(); let value = line.slice(idx + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) { value = value.slice(1, -1) } return key ? [key, value] : null }).filter(Boolean)
if (pairs.length === 0) { console.log(chalk.yellow('No KEY=VALUE lines found in ' + file)); return }
const spinner = ora('Pushing ' + pairs.length + ' variable(s) to ' + options.env + '...').start(); let succeeded = 0
for (const [key, value] of pairs) { try { await client.post('/api/env', { key, value, environment: options.env }); succeeded++ } catch (error) { spinner.warn(key + ' failed: ' + (error.response?.data?.error || error.message)) } }
spinner.succeed(succeeded + '/' + pairs.length + ' variable(s) pushed to ' + options.env)
})
program.command('store:set <key> <value>').description('Store a value in the key-value store (value must be JSON)').option('--ttl <seconds>', 'Expire this key automatically after N seconds').action(async (key, value, options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try { const parsed = JSON.parse(value); const body = { value: parsed }; if (options.ttl) body.ttl = Number(options.ttl); const spinner = ora('Storing ' + key + '...').start(); const response = await client.post('/api/store/' + key, body); spinner.succeed(key + ' stored' + (response.data.expires_in ? ' (expires in ' + response.data.expires_in + 's)' : '')) } catch (error) { if (error instanceof SyntaxError) { console.log(chalk.red('Value must be valid JSON (e.g., \'{"name":"Jane"}\')')) } else { console.log(chalk.red(error.response?.data?.error || error.message)) } }
})
program.command('store:incr <key> [amount]').description('Atomically increment (or decrement, with a negative amount) a numeric key').action(async (key, amount) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try { const response = await client.post('/api/store/' + key + '/increment', { by: amount !== undefined ? Number(amount) : 1 }); console.log(chalk.green(key + ' = ' + response.data.value)) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('store:get <key>').description('Get a value from the key-value store').action(async (key) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try { const response = await client.get('/api/store/' + key); console.log(JSON.stringify(response.data, null, 2)) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('store:list').description('List all keys in the store').option('--prefix <prefix>', 'Only show keys starting with this prefix').action(async (options) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
try { const response = await client.get('/api/store', { params: options.prefix ? { prefix: options.prefix } : {} }); const keys = response.data.keys; if (keys.length === 0) { console.log('No keys in store.'); return }; console.log(chalk.cyan('\nStore Keys (' + keys.length + ' total)\n')); keys.forEach(k => { console.log('  ' + chalk.yellow(k.key)); console.log('    Created: ' + chalk.dim(k.created_at)); console.log('    Updated: ' + chalk.dim(k.updated_at)); if (k.expires_at) console.log('    Expires: ' + chalk.dim(k.expires_at)); console.log() }) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('store:delete <key>').description('Delete a key from the key-value store').action(async (key) => {
const apiKey = getProjectApiKey(); const client = getApiClient(apiKey); const spinner = ora('Deleting ' + key + '...').start()
try { await client.delete('/api/store/' + key); spinner.succeed(key + ' deleted') } catch (error) { spinner.fail('Failed to delete key'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
// ==========================================================================
// CACHE — Redis-backed KV. This is the fast, TTL-first sibling of `store:*`:
// values are plain strings, counters are atomic, and entries are EVICTABLE
// (maxmemory 64mb / allkeys-lru). Never keep the only copy of anything here.
// ==========================================================================
function kvClient() { return getApiClient(getProjectApiKey()) }
function kvError(error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
program.command('kv:set <key> <value>').description('Set a cache value (string), optionally with a TTL').option('--ttl <seconds>', 'Expire after N seconds (1-2592000)').action(async (key, value, options) => {
  try {
    const params = options.ttl ? { ttl: Number(options.ttl) } : {}
    const response = await kvClient().put('/api/kv/' + encodeURIComponent(key), value, { headers: { 'content-type': 'text/plain' }, params })
    console.log(chalk.green(key + ' cached') + (response.data.ttl ? chalk.dim(' · expires in ' + response.data.ttl + 's') : chalk.dim(' · no expiry')))
  } catch (error) { kvError(error) }
})
program.command('kv:get <key>').description('Read a cache value (prints the raw string)').action(async (key) => {
  try { const response = await kvClient().get('/api/kv/' + encodeURIComponent(key)); console.log(response.data.value) } catch (error) { kvError(error) }
})
program.command('kv:incr <key> [amount]').description('Atomically increment a counter (negative to decrement)').option('--ttl <seconds>', 'Set a TTL when the counter is first created').action(async (key, amount, options) => {
  try {
    const body = { by: amount !== undefined ? Number(amount) : 1 }
    if (options.ttl) body.ttl = Number(options.ttl)
    const response = await kvClient().post('/api/kv/' + encodeURIComponent(key) + '/incr', body)
    console.log(chalk.green(key + ' = ' + response.data.value) + (response.data.ttl ? chalk.dim(' · expires in ' + response.data.ttl + 's') : ''))
  } catch (error) { kvError(error) }
})
program.command('kv:list').description('List cache keys with their remaining TTL').option('--prefix <prefix>', 'Only keys starting with this prefix').option('--limit <n>', 'Max keys to show', '100').action(async (options) => {
  try {
    const params = { limit: Number(options.limit) || 100 }
    if (options.prefix) params.prefix = options.prefix
    const response = await kvClient().get('/api/kv', { params })
    const keys = response.data.keys
    if (!keys.length) { console.log('Cache is empty.'); return }
    console.log(chalk.cyan('\nCache keys (' + keys.length + (response.data.truncated ? '+' : '') + ')\n'))
    for (const k of keys) console.log('  ' + chalk.yellow(k.key) + (k.ttl === null ? chalk.dim('  · no expiry') : chalk.dim('  · ' + k.ttl + 's left')))
  } catch (error) { kvError(error) }
})
program.command('kv:del <key>').description('Delete a cache key').action(async (key) => {
  try { await kvClient().delete('/api/kv/' + encodeURIComponent(key)); console.log(chalk.green(key + ' deleted')) } catch (error) { kvError(error) }
})
program.command('kv:flush').description('Delete every cache key in this project').option('--yes', 'Skip the confirmation prompt').action(async (options) => {
  if (!options.yes) {
    const { sure } = await inquirer.prompt([{ type: 'confirm', name: 'sure', message: 'Delete every cache key for this project?', default: false }])
    if (!sure) { console.log('Aborted.'); return }
  }
  try { const response = await kvClient().post('/api/kv/flush'); console.log(chalk.green('Flushed ' + response.data.deleted + ' key(s)')) } catch (error) { kvError(error) }
})
// ==========================================================================
// CRON — schedule HTTP calls from the API. Schedules are human strings:
//   5m, 30s, 2h, daily 09:30, mon 09:00  (all UTC)
// ==========================================================================
function linkedProjectId() { const state = findLinkState(); if (!state?.projectId) { console.log(chalk.red('This folder is not linked to a project. Run: dkit new <name>')); process.exit(1) } return state.projectId }
function authClientForJobs() { return getAuthClient(loadConfig().token) }
function printCronJob(j) {
  console.log(chalk.cyan('\n' + j.name) + (j.enabled ? '' : chalk.red(' (paused)')))
  console.log('  ' + j.method + ' ' + j.url)
  console.log('  Schedule: ' + chalk.yellow(j.schedule))
  if (j.next_run_at) console.log('  Next run: ' + chalk.dim(j.next_run_at))
  if (j.last_status) console.log('  Last:     ' + (String(j.last_status).startsWith('ok') ? chalk.green(j.last_status) : chalk.red(j.last_status)))
  console.log('  ID: ' + chalk.dim(j.id))
}
program.command('cron:add <name> <url>').description('Schedule an HTTP call from the API (e.g. cron:add nightly-rollup https://api.example.com/rollup -s "daily 03:00")').option('-s, --schedule <schedule>', 'Schedule: 5m, 30s, 2h, daily 09:30, mon 09:00 (UTC)', '5m').option('-m, --method <method>', 'HTTP method (default POST)', 'POST').option('-b, --body <json>', 'Request body (JSON string)').option('-H, --header <pairs>', 'Extra headers, e.g. "Authorization: Bearer x" (repeatable)', (v, acc) => (acc.push(v), acc), []).action(async (name, url, options) => {
  const token = await getUserToken()
  const projectId = linkedProjectId()
  const headers = {}
  for (const pair of options.header || []) { const idx = pair.indexOf(':'); if (idx === -1) { console.log(chalk.red('Bad header (want "Name: value"): ' + pair)); process.exit(1) } headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim() }
  const spinner = ora('Creating cron job...').start()
  try {
    const r = await authClientForJobs().post('/api/projects/' + projectId + '/cron', { name, url, schedule: options.schedule, method: options.method.toUpperCase(), headers, body: options.body })
    spinner.succeed('Cron job "' + name + '" created')
    printCronJob(r.data)
  } catch (error) { spinner.fail('Failed to create cron job'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('cron:list').description('List cron jobs for the linked project').action(async () => {
  const token = await getUserToken()
  try { const r = await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/cron'); const list = r.data.jobs; if (list.length === 0) { console.log('No cron jobs. Add one: dkit cron:add <name> <url> -s 5m'); return } list.forEach(printCronJob) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('cron:runs <name>').description('Recent runs for a cron job (status, duration, errors)').action(async (name) => {
  const token = await getUserToken()
  try {
    const list = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/cron')).data.jobs
    const job = list.find((j) => j.name === name)
    if (!job) { console.log(chalk.red('No cron job named "' + name + '". Try: dkit cron:list')); return }
    const runs = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/cron/' + job.id + '/runs')).data.runs
    if (runs.length === 0) { console.log('No runs recorded yet.'); return }
    console.log(chalk.cyan('\n' + name + ' — ' + runs.length + ' recent run(s)\n'))
    runs.forEach((run) => console.log('  ' + chalk.dim(run.started_at) + '  ' + (run.ok ? chalk.green('ok ' + (run.status_code || '')) : chalk.red(run.error || 'failed')) + '  ' + chalk.dim((run.duration_ms || 0) + 'ms')))
    console.log()
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('cron:run <name>').description('Run a cron job right now (schedule is unaffected)').action(async (name) => {
  const token = await getUserToken()
  try {
    const list = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/cron')).data.jobs
    const job = list.find((j) => j.name === name)
    if (!job) { console.log(chalk.red('No cron job named "' + name + '".')); return }
    const spinner = ora('Running ' + name + '...').start()
    const r = await authClientForJobs().post('/api/projects/' + linkedProjectId() + '/cron/' + job.id + '/run')
    if (r.data.ok) spinner.succeed('ok (' + r.data.status_code + ') in ' + r.data.duration_ms + 'ms')
    else { spinner.fail('Run failed'); console.log(chalk.red(r.data.error || ('HTTP ' + r.data.status_code))) }
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('cron:pause <name>').description('Pause / resume a cron job (toggle, or --resume)').option('--resume', 'Resume a paused job').action(async (name, options) => {
  const token = await getUserToken()
  try {
    const list = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/cron')).data.jobs
    const job = list.find((j) => j.name === name)
    if (!job) { console.log(chalk.red('No cron job named "' + name + '".')); return }
    const enabled = !!options.resume
    const r = await authClientForJobs().patch('/api/projects/' + linkedProjectId() + '/cron/' + job.id, { enabled })
    console.log(chalk.green(name + (r.data.enabled ? ' resumed' : ' paused')))
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('cron:rm <name>').description('Delete a cron job').action(async (name) => {
  const token = await getUserToken()
  try {
    const list = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/cron')).data.jobs
    const job = list.find((j) => j.name === name)
    if (!job) { console.log(chalk.red('No cron job named "' + name + '".')); return }
    await authClientForJobs().delete('/api/projects/' + linkedProjectId() + '/cron/' + job.id)
    console.log(chalk.green('Deleted ' + name))
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})

// ==========================================================================
// MEDIA CDN — upload a file, get a Cloudflare-backed URL.
//   dkit upload img.png            permanent URL (as long as you keep it)
//   dkit share img.png             temporary link (15m default) for testing
// Listing/cleanup is done against the linked project via the JWT.
// ==========================================================================
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain',
  '.zip': 'application/zip', '.csv': 'text/csv', '.woff2': 'font/woff2', '.woff': 'font/woff',
}
function guessMime(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream'
}
async function uploadFile(file, { ttlSeconds }) {
  const apiKey = getProjectApiKey()
  const buf = fs.readFileSync(file)
  const headers = {
    'x-api-key': apiKey,
    'x-filename': path.basename(file),
    'x-content-type': guessMime(file),
    'content-type': 'application/octet-stream',
  }
  if (ttlSeconds) headers['x-ttl'] = String(ttlSeconds)
  const res = await axios.post(API_BASE + '/api/files', buf, { headers, maxBodyLength: Infinity, maxContentLength: Infinity })
  return res.data
}
function printMedia(f) {
  console.log('  ' + chalk.cyan(f.filename))
  console.log('    URL:     ' + chalk.yellow(f.url))
  console.log('    Key:     ' + chalk.dim(f.key))
  console.log('    Size:    ' + chalk.dim((f.size / 1024).toFixed(1) + ' KB'))
  if (f.expires_at) console.log('    Expires: ' + chalk.dim(f.expires_at) + chalk.dim(' (temporary link)'))
}
function parseTtl(input, fallbackSeconds) {
  if (!input) return fallbackSeconds
  const m = String(input).match(/^(\d+)\s*(s|m|h|d)?$/i)
  if (!m) { console.log(chalk.red('Bad TTL — use seconds ("900") or "15m", "1h", "7d"')); process.exit(1) }
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[(m[2] || 's').toLowerCase()]
  return Number(m[1]) * mult
}
program.command('upload <files...>').description('Upload files to the media CDN; prints permanent URLs').option('--ttl <duration>', 'Optional expiry: 900, 15m, 1h, 7d (0 = never)')
  .action(async (files, options) => {
    const ttl = parseTtl(options.ttl, null)
    if (ttl) { if (ttl < 60 || ttl > 30 * 24 * 3600) { console.log(chalk.red('TTL must be 1 minute to 30 days')); process.exit(1) } }
    for (const file of files) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { console.log(chalk.red('Not a file: ' + file)); continue }
      const spinner = ora('Uploading ' + file + '...').start()
      try {
        const data = await uploadFile(file, { ttlSeconds: ttl })
        spinner.succeed(file)
        printMedia(data)
      } catch (error) { spinner.fail(file + ' failed'); console.log(chalk.red(error.response?.data?.error || error.message)) }
    }
  })
program.command('share <file>').description('Upload with a temporary link (delete-safe way to test/shoot). Default 15m.').option('-t, --ttl <duration>', 'How long the link lives: 5m, 15m, 1h, 24h, 7d', '15m')
  .action(async (file, options) => {
    const ttl = parseTtl(options.ttl, 900)
    if (ttl < 60 || ttl > 30 * 24 * 3600) { console.log(chalk.red('TTL must be 1 minute to 30 days')); process.exit(1) }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { console.log(chalk.red('Not a file: ' + file)); process.exit(1) }
    const spinner = ora('Uploading ' + file + ' (temporary link)...').start()
    try {
      const data = await uploadFile(file, { ttlSeconds: ttl })
      spinner.succeed('Temporary link is live')
      console.log(chalk.bold.cyan('\n  ' + data.url + '\n'))
      console.log('Valid for ' + chalk.yellow(options.ttl) + ' — it self-destructs after that. Nobody can guess the URL.')
    } catch (error) { spinner.fail('Upload failed'); console.log(chalk.red(error.response?.data?.error || error.message)) }
  })
program.command('files:list').description('List the linked project\'s media files').action(async () => {
  const token = await getUserToken()
  try {
    const r = await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/files')
    const files = r.data.files
    if (files.length === 0) { console.log('No files yet. Upload one: dkit upload logo.png'); return }
    console.log(chalk.cyan('\nMedia files (' + files.length + ' total)\n'))
    files.forEach(printMedia)
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('files:url <key>').description('Print the public URL for a file key').action(async (key) => {
  const token = await getUserToken()
  try {
    const files = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/files')).data.files
    const f = files.find((x) => x.key === key)
    if (!f) { console.log(chalk.red('No file with key "' + key + '" in this project.')); return }
    console.log(f.url)
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('files:rm <key>').description('Delete a media file (URL stops working immediately)').action(async (key) => {
  const token = await getUserToken()
  const { sure } = await inquirer.prompt([{ type: 'confirm', name: 'sure', message: 'Delete file ' + key + ' permanently?', default: false }])
  if (!sure) { console.log('Aborted.'); return }
  try {
    await authClientForJobs().delete('/api/projects/' + linkedProjectId() + '/files/' + encodeURIComponent(key))
    console.log(chalk.green('Deleted ' + key))
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})

// ==========================================================================
// UPTIME MONITORS — the API probes your URLs, emails you on down/up.
// ==========================================================================
function printMonitor(m) {
  const dot = m.paused ? chalk.dim('○') : m.status === 'up' ? chalk.green('●') : m.status === 'down' ? chalk.red('●') : chalk.yellow('●')
  console.log(dot + ' ' + chalk.cyan(m.name) + (m.paused ? chalk.dim(' (paused)') : ''))
  console.log('  ' + m.method + ' ' + m.url)
  console.log('  Status: ' + (m.status === 'up' ? chalk.green('up') : m.status === 'down' ? chalk.red('down') : m.paused ? chalk.dim('paused') : chalk.yellow('pending')) + (m.last_latency_ms != null ? chalk.dim(' · ' + m.last_latency_ms + 'ms') : '') + (m.last_checked_at ? chalk.dim(' · checked ' + m.last_checked_at) : ''))
  if (m.last_error) console.log('  Last error: ' + chalk.red(m.last_error))
  console.log('  ID: ' + chalk.dim(m.id))
}
program.command('monitor:add <name> <url>').description('Watch a URL; get emailed when it goes down and when it recovers').option('-i, --interval <seconds>', 'Seconds between checks (30-3600)', '60').option('-e, --email <address>', 'Alert email (defaults to your account email)').option('-m, --method <method>', 'GET, HEAD or POST (default GET)', 'GET').action(async (name, url, options) => {
  const token = await getUserToken()
  const spinner = ora('Creating monitor...').start()
  try {
    const r = await authClientForJobs().post('/api/projects/' + linkedProjectId() + '/monitors', { name, url, interval_seconds: Number(options.interval), email: options.email, method: options.method.toUpperCase() })
    spinner.succeed('Monitor "' + name + '" created — first check within a minute')
    printMonitor(r.data)
  } catch (error) { spinner.fail('Failed to create monitor'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('monitor:list').description('List monitors for the linked project').action(async () => {
  const token = await getUserToken()
  try { const r = await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/monitors'); const list = r.data.monitors; if (list.length === 0) { console.log('No monitors. Add one: dkit monitor:add prod https://myapp.dev/health'); return } list.forEach(printMonitor); console.log() } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('monitor:pause <name>').description('Pause / resume a monitor (toggle, or --resume)').option('--resume', 'Resume a paused monitor').action(async (name, options) => {
  const token = await getUserToken()
  try {
    const list = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/monitors')).data.monitors
    const m = list.find((x) => x.name === name)
    if (!m) { console.log(chalk.red('No monitor named "' + name + '".')); return }
    const r = await authClientForJobs().patch('/api/projects/' + linkedProjectId() + '/monitors/' + m.id, { paused: !options.resume })
    console.log(chalk.green(name + (r.data.paused ? ' paused' : ' resumed')))
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('monitor:rm <name>').description('Delete a monitor').action(async (name) => {
  const token = await getUserToken()
  try {
    const list = (await authClientForJobs().get('/api/projects/' + linkedProjectId() + '/monitors')).data.monitors
    const m = list.find((x) => x.name === name)
    if (!m) { console.log(chalk.red('No monitor named "' + name + '".')); return }
    await authClientForJobs().delete('/api/projects/' + linkedProjectId() + '/monitors/' + m.id)
    console.log(chalk.green('Deleted ' + name))
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})

// ==========================================================================
// LOG DRAIN — ship logs from any app; tail them here.
// ==========================================================================
program.command('logs:ship [message]').description('Ship a log line (or JSON events from stdin) to your project\'s log drain').option('-l, --level <level>', 'debug | info | warn | error', 'info').option('-s, --source <source>', 'Source label, e.g. worker or deploy-script').option('-m, --meta <json>', 'Metadata JSON, e.g. \'{"requestId":"abc"}\'').action(async (message, options) => {
  const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
  let events
  if (!message && !process.stdin.isTTY) {
    // Piped input: one JSON event/object per line — works with shell pipes.
    const raw = fs.readFileSync(0, 'utf8')
    events = raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { try { const parsed = JSON.parse(line); return typeof parsed === 'object' && parsed !== null ? parsed : { message: String(parsed) } } catch { return { message: line } } })
  } else {
    if (!message) { console.log(chalk.red('Nothing to ship. Pass a message or pipe lines in.')); process.exit(1) }
    let meta; try { meta = options.meta ? JSON.parse(options.meta) : undefined } catch { console.log(chalk.red('--meta must be valid JSON')); process.exit(1) }
    events = [{ message, level: options.level, source: options.source, meta }]
  }
  try { const r = await client.post('/api/logs', { events }); console.log(chalk.green('Shipped ' + r.data.inserted + ' log event(s)')) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('logs:tail').description('Show recent logs for the linked project (like tail -f, once)').option('-l, --level <level>', 'Filter: debug | info | warn | error').option('-q, --search <text>', 'Only lines containing this text').option('-n, --lines <n>', 'How many lines', '30').action(async (options) => {
  const apiKey = getProjectApiKey(); const client = getApiClient(apiKey)
  const state = findLinkState()
  const params = {}
  if (options.level) params.level = options.level
  if (options.search) params.search = options.search
  try {
    const projectId = state?.projectId
    if (!projectId) { console.log(chalk.red('This folder is not linked. Run: dkit new <name>')); process.exit(1) }
    // Log reads are session-authed (x-project-id) — the CLI uses the JWT.
    const r = await getAuthClient(loadConfig().token).get('/api/projects/' + projectId + '/logs', { params })
    const logs = r.data.logs
    if (logs.length === 0) { console.log('No logs yet. Ship some: dkit logs:ship "deploy finished"'); return }
    const color = { debug: chalk.dim, info: null, warn: chalk.yellow, error: chalk.red }
    logs.slice(0, Number(options.lines)).reverse().forEach((log) => {
      const src = log.source ? chalk.dim(' [' + log.source + ']') : ''
      const paint = color[log.level] || ((txt) => txt)
      console.log(chalk.dim(log.ts) + ' ' + paint(log.level.padEnd(5)) + src + ' ' + log.message)
    })
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('logs:clear').description('Delete all logs for the linked project').action(async () => {
  const token = await getUserToken()
  const projectId = linkedProjectId()
  const { sure } = await inquirer.prompt([{ type: 'confirm', name: 'sure', message: 'Delete ALL logs for this project?', default: false }])
  if (!sure) { console.log('Aborted.'); return }
  try { await authClientForJobs().delete('/api/projects/' + projectId + '/logs'); console.log(chalk.green('Logs cleared')) } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('verify:send').description('Send email verification code').action(async () => {
const token = await getUserToken(); const spinner = ora('Sending verification code...').start()
try { await getAuthClient(token).post('/api/auth/send-verification'); spinner.succeed('Verification code sent'); console.log('Check your email (and spam folder) for the code.') } catch (error) { spinner.fail('Failed to send verification code'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('verify <code>').description('Verify your email with a code').action(async (code) => {
const token = await getUserToken(); const spinner = ora('Verifying email...').start()
try { await getAuthClient(token).post('/api/auth/verify', { code }); spinner.succeed('Email verified') } catch (error) { spinner.fail('Verification failed'); console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('verify:status').description('Check email verification status').action(async () => {
const token = await getUserToken()
try { const response = await getAuthClient(token).get('/api/auth/verification-status'); if (response.data.verified) { console.log(chalk.green('Email is verified')) } else { console.log(chalk.yellow('Email not verified. Run: dkit verify:send')) } } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)) }
})
program.command('config').description('Show current configuration').option('-s, --show', 'Reveal full API key').action((options) => {
const config = loadConfig(); console.log(chalk.cyan('\nDkit Configuration\n')); console.log('  User: ' + chalk.yellow(config.user?.email || 'Not logged in')); console.log('  Current Project: ' + chalk.yellow(config.currentProject || 'None')); const key = config.apiKeys?.[config.currentProject]; console.log('  API Key: ' + chalk.dim(key ? (options.show ? key : maskKey(key)) : 'None')); console.log()
})
program.command('doctor').description('Check connectivity, auth, project link, key health — and scan this folder for problems').option('-f, --fix', 'Apply the safe fixes automatically (git init, ignore .env, resend verification code)').action(async (options) => {
const config = loadConfig()
const rows = []
const fixes = []
const ok = (label, detail) => rows.push(['ok', label, detail])
const warn = (label, detail, fix) => { rows.push(['warn', label, detail]); if (fix) fixes.push(fix) }
const fail = (label, detail, fix) => { rows.push(['fail', label, detail]); if (fix) fixes.push(fix) }

// 1. API reachability
try {
const started = Date.now()
const health = await axios.get(API_BASE + '/api/health', { timeout: 8000 })
ok('API', (health.data?.version ? 'v' + health.data.version : 'reachable') + ' — ' + API_BASE + ' (' + (Date.now() - started) + 'ms)')
} catch (error) {
fail('API', 'unreachable at ' + API_BASE + ' — ' + (error.response?.data?.error || error.message), 'Check that the Dkit API is running and that DKIT_API_URL points at it.')
}

// 2. Auth + session health (a failed refresh means the user must re-login)
let authClient = null
if (!config.token) {
fail('Auth', 'not logged in — run: dkit login', 'Run: dkit login')
} else {
let token = config.token
if (config.refresh_token && Date.now() > (config.token_expires_at || 0) - 60 * 1000) {
try { token = await refreshSession(); ok('Auth', 'session renewed (was about to expire)') }
catch { fail('Auth', 'session expired — run: dkit login', 'Run: dkit login') }
}
if (token) {
authClient = getAuthClient(token)
try { const me = await authClient.get('/api/auth/session'); ok('Auth', 'logged in as ' + me.data.email) }
catch (error) { fail('Auth', error.response?.status === 401 ? 'token rejected — run: dkit login' : (error.response?.data?.error || error.message), 'Run: dkit login') }
}
}

// 3. Project link (walks up from cwd like every project-scoped command)
const state = findLinkState()
if (!state?.project) {
warn('Project link', 'this folder is not linked — run: dkit new <name> (or check .dkit/state.json)', 'From the project folder, run: dkit new <name> — or re-link with dkit projects:list.')
} else {
ok('Project link', state.project + (state.defaultEnv ? ' (default env: ' + state.defaultEnv + ')' : ''))
}

// 4. API key actually works
if (state?.project && config.apiKeys?.[state.project]) {
try {
await getApiClient(config.apiKeys[state.project]).get('/api/store', { params: { prefix: 'healthcheck-probe' }, timeout: 8000 })
ok('API key', maskKey(config.apiKeys[state.project]) + ' works for ' + state.project)
} catch (error) {
if (error.response?.status === 401) fail('API key', 'rejected — the key was rotated or revoked. Fix: dkit keys:rotate ' + state.project, 'Run: dkit keys:rotate ' + state.project)
else warn('API key', 'could not verify — ' + (error.response?.data?.error || error.message))
}
}

// 5. Email verification (blocks project creation and invites)
if (authClient) {
try {
const v = await authClient.get('/api/auth/verification-status')
if (v.data.verified) {
ok('Email verified', 'yes')
} else {
let detail = 'no — verify to create projects and teams (dkit verify:send)'
if (options.fix) {
try { await authClient.post('/api/auth/send-verification'); detail += ' — code sent, check your inbox' }
catch { /* keep the manual hint */ }
}
warn('Email verified', detail, detail.includes('code sent') ? null : 'Run: dkit verify:send, then enter the code from your email.')
}
} catch { /* auth already reported; don't double-report */ }
}

// 6. Node/npm sanity
const nodeMajor = Number(process.versions.node.split('.')[0])
nodeMajor >= 18 ? ok('Node', 'v' + process.versions.node) : warn('Node', 'v' + process.versions.node + ' is old', 'Upgrade to Node 18+ — templates and tooling assume it.')

// 7. Project folder scan — the stuff that bites later, caught early.
const cwd = process.cwd()
let pkg = null
try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) } catch { /* not a Node project or missing */ }
if (pkg) {
const scripts = pkg.scripts || {}
const missing = ['start', 'dev', 'build'].filter((s) => !scripts[s])
if (missing.length === 0) ok('package.json', Object.keys(scripts).length + ' scripts defined')
else warn('package.json', 'missing script' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', '), 'Add "' + missing.join('", "') + '" to package.json scripts — tooling and teammates expect them.')
} else if (!fs.existsSync(path.join(cwd, 'package-lock.json')) && !fs.existsSync(path.join(cwd, 'node_modules'))) {
warn('package.json', 'not found here', 'Run npm init -y if this should be a Node project.')
}

const envPath = path.join(cwd, '.env')
if (fs.existsSync(envPath)) {
const seen = new Map()
let keys = 0, empty = 0
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
const t = line.trim()
if (!t || t.startsWith('#')) continue
const eq = t.indexOf('=')
if (eq <= 0) continue
const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim()
keys++; seen.set(k, (seen.get(k) || 0) + 1); if (v === '') empty++
}
const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
if (dups.length) warn('.env', 'duplicate keys: ' + dups.join(', '), 'Remove the duplicates in .env — the last one silently wins.')
else ok('.env', keys + ' keys' + (empty ? ' (' + empty + ' empty)' : ''))
if (empty > 0) warn('.env', empty + ' empty value' + (empty > 1 ? 's' : ''), 'Fill in or remove the empty lines in .env — empty values cause confusing runtime errors.')
const giPath = path.join(cwd, '.gitignore')
const gitignore = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : ''
if (!/^\s*\.env\s*$/m.test(gitignore)) {
if (options.fix) {
fs.writeFileSync(giPath, (gitignore.trimEnd() ? gitignore.trimEnd() + '\n' : '') + '.env\nnode_modules/\n')
ok('.gitignore', '.env is now ignored (fixed)')
} else warn('.gitignore', '.env is not ignored', 'Add .env to .gitignore before your first commit — secrets in git history are painful to remove. (or: dkit doctor --fix)')
}
}
let gitRoot = null
for (let cur = cwd, guard = 0; guard < 8; guard++) {
if (fs.existsSync(path.join(cur, '.git'))) { gitRoot = cur; break }
const parent = path.dirname(cur); if (parent === cur) break; cur = parent
}
if (gitRoot) {
ok('Git', 'repository initialized' + (gitRoot !== cwd ? ' (at ' + path.relative(cwd, gitRoot) + path.sep + ')' : ''))
} else if (options.fix) {
try { require('child_process').execSync('git init -q', { cwd, stdio: 'ignore' }); ok('Git', 'repository initialized (fixed)') }
catch { warn('Git', 'could not run git init', 'Install git, then run: git init') }
} else {
warn('Git', 'no repository here', 'Run git init so you have history and clean rollbacks. (or: dkit doctor --fix)')
}

// 8. Syntax check — parse every JS file in the project (node_modules etc skipped).
// vm.Script parses CommonJS-flavored syntax; ESM files (import/export at top
// level) report a recognizable error which we count as "module file, skipped"
// rather than a failure, so valid projects never get false positives.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache'])
const jsFiles = []
;(function walk(dir, depth) {
if (depth > 6 || jsFiles.length >= 300) return
let entries = []
try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
for (const e of entries) {
if (SKIP_DIRS.has(e.name)) continue
const full = path.join(dir, e.name)
if (e.isDirectory()) walk(full, depth + 1)
else if (/\.(js|mjs|cjs)$/.test(e.name)) {
try { if (fs.statSync(full).size <= 512 * 1024) jsFiles.push(full) } catch { /* unreadable — leave it */ }
}
}
})(cwd, 0)
if (jsFiles.length === 0) {
rows.push(['ok', 'Syntax', 'no JS files to check'])
} else {
const vm = require('vm')
const ESM_RE = /cannot use import statement|'import' and 'export'|unexpected token 'export'|unexpected token 'import'|outside a module/i
const bad = []
let modules = 0
for (const f of jsFiles) {
try {
const src = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/^#![^\n]*/, '')
new vm.Script(src, { filename: path.relative(cwd, f) })
} catch (e) {
if (ESM_RE.test(String(e.message))) { modules++; continue }
if (bad.length < 5) bad.push(path.relative(cwd, f) + ' — ' + String(e.message).split('\n')[0])
}
}
if (bad.length === 0) {
ok('Syntax', jsFiles.length + ' file' + (jsFiles.length === 1 ? '' : 's') + ' parse clean' + (modules ? ' (' + modules + ' ESM skipped)' : ''))
} else {
fail('Syntax', bad.length + ' file' + (bad.length === 1 ? '' : 's') + ' fail to parse', 'Fix the parse errors:\n  ' + bad.join('\n  '))
}
}

const mark = { ok: chalk.green('✓'), warn: chalk.yellow('!'), fail: chalk.red('✗') }
console.log(chalk.cyan('\nDkit doctor\n'))
rows.forEach(([kind, label, detail]) => console.log('  ' + mark[kind] + ' ' + label.padEnd(15) + ' ' + detail))
if (fixes.length > 0) {
console.log(chalk.cyan('\nFix these:'))
fixes.forEach((f) => console.log('  - ' + f.replace(/\n/g, '\n    ')))
}
console.log()
if (rows.some(([kind]) => kind === 'fail')) process.exitCode = 1
})
program
.command('new <name>')
.description('Scaffold a new project and link it to a Dkit project')
.option('-t, --template <template>', 'Template name', 'express-pg')
.option('--dir <path>', 'Target folder (defaults to ./<name>)')
.option('--package <name>', 'Override the package.json name')
.option('--project <slug>', 'Use a different Dkit project name than the folder name')
.option('--link <existing>', 'Attach to an existing Dkit project instead of creating one')
.option('--force', 'Render into a non-empty existing folder')
.action(async (name, options) => {
  const token = await getUserToken()
  const kebabName = name.toLowerCase().replace(/[_\s]+/g, '-')
  const nameError = validateNpmName(kebabName)
  if (nameError) { console.log(chalk.red('Invalid project name: ' + nameError)); process.exit(1) }
  const targetDir = path.resolve(options.dir || kebabName)
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 && !options.force) {
    console.log(chalk.red('Folder exists and is not empty: ' + targetDir + '\nUse --force or pick another name.'))
    process.exit(1)
  }
  const projectName = options.project || kebabName
  const auth = getAuthClient(token)
  let project
  try {
    const list = await auth.get('/api/projects')
    if (options.link) {
      project = list.data.projects.find(p => p.name === options.link)
      if (!project) { console.log(chalk.red('No project named "' + options.link + '" on your account.')); process.exit(1) }
    } else {
      const existing = list.data.projects.find(p => p.name === projectName)
      if (existing) {
        const { choice } = await inquirer.prompt([{ type: 'list', name: 'choice', message: 'Project "' + projectName + '" already exists on your account.', choices: ['Link to it', 'Abort (pick another name with --project)'] }])
        if (choice.startsWith('Abort')) process.exit(1)
        project = existing
      } else {
        const created = await auth.post('/api/projects', { name: projectName })
        project = created.data
        console.log(chalk.green('Created Dkit project "' + projectName + '"'))
      }
    }
  } catch (error) {
    console.log(chalk.red(error.response?.data?.error || error.message))
    process.exit(1)
  }
  const config = loadConfig()
  if (!config.apiKeys) config.apiKeys = {}
  config.currentProject = project.name
  saveConfig(config)
  // Projects start keyless — the CLI needs a key for API calls, so issue the
  // first one here unless the user linked an existing project that has one.
  if (!project.api_key && !options.link) {
    try {
      const keyRes = await auth.post('/api/projects/' + project.id + '/api-key')
      project.api_key = keyRes.data.api_key
      console.log(chalk.dim('API key issued for this machine (stored hashed server-side).'))
    } catch (error) {
      console.log(chalk.yellow('Could not issue an API key: ' + (error.response?.data?.error || error.message)))
      console.log(chalk.dim('Issue one later with: dkit keys:rotate ' + project.name))
    }
  }
  config.apiKeys[project.name] = project.api_key
  const templateDir = path.join(__dirname, '..', 'templates', options.template)
  const names = deriveNames(kebabName)
  const spinner = ora('Scaffolding ' + kebabName + ' from ' + options.template + '...').start()
  let manifest = { envHints: [] }
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(templateDir, 'dkit.template.json'), 'utf8'))
    scaffold({ templateDir, targetDir, names })
    if (options.package) {
      const pj = path.join(targetDir, 'package.json')
      const json = JSON.parse(fs.readFileSync(pj, 'utf8'))
      json.name = options.package
      fs.writeFileSync(pj, JSON.stringify(json, null, 2) + '\n')
    }
    const stateDir = path.join(targetDir, '.dkit')
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({ project: project.name, projectId: project.id, defaultEnv: 'production', linkedAt: new Date().toISOString() }, null, 2) + '\n')
    const giPath = path.join(targetDir, '.gitignore')
    const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : ''
    if (!gi.split('\n').includes('.dkit/')) fs.writeFileSync(giPath, gi.trimEnd() + (gi ? '\n' : '') + '.dkit/\n')
    spinner.succeed('Scaffolded ' + kebabName + ' and linked it to project "' + project.name + '"')
  } catch (error) {
    spinner.fail('Scaffold failed')
    console.log(chalk.red(error.message))
    process.exit(1)
  }
  const client = getApiClient(project.api_key)
  for (const hint of manifest.envHints || []) {
    const { value } = await inquirer.prompt([{ type: 'password', name: 'value', message: 'Set ' + hint + ' now? (leave empty to skip):' }])
    if (value) {
      try { await client.post('/api/env', { key: hint, value, environment: 'production' }); console.log(chalk.green('  ' + hint + ' set')) } catch (error) { console.log(chalk.yellow('  Could not set ' + hint + ': ' + (error.response?.data?.error || error.message))) }
    } else {
      console.log(chalk.dim('  skipped - set later with: dkit env:set ' + hint + ' <value>'))
    }
  }
  console.log('Next:')
  console.log('  cd ' + path.relative(process.cwd(), targetDir) + ' && npm install')
  console.log('  npm run dev                        # runs through dkit run')
})
program.command('templates').description('List available scaffolding templates').action(async () => {
  const templatesDir = path.join(__dirname, '..', 'templates')
  let names = []
  try { names = fs.readdirSync(templatesDir).filter((d) => fs.existsSync(path.join(templatesDir, d, 'dkit.template.json'))) } catch {}
  if (names.length === 0) { console.log(chalk.red('No templates found.')); return }
  console.log(chalk.cyan('\nTemplates (dkit new <name> --template <id>)\n'))
  for (const id of names) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(templatesDir, id, 'dkit.template.json'), 'utf8'))
      console.log('  ' + chalk.yellow(id.padEnd(16)) + (manifest.description || ''))
    } catch { console.log('  ' + chalk.yellow(id)) }
  }
  console.log()
})
program.command('keys:rotate [name]').description('Issue or replace a project API key — the old one (if any) stops working immediately').action(async (nameArg) => {
const token = await getUserToken()
const name = nameArg || loadConfig().currentProject
if (!name) { console.log(chalk.red('No project selected. Run: dkit projects:list')); process.exit(1) }
try {
const list = await getAuthClient(token).get('/api/projects')
const project = list.data.projects.find((p) => p.name === name)
if (!project) { console.log(chalk.red('No project named "' + name + '" on your account.')); process.exit(1) }
// Keyless projects get a key issued; keyed ones get a destructive rotation.
if (!project.key_prefix) {
const issued = await getAuthClient(token).post('/api/projects/' + project.id + '/api-key')
const next = loadConfig(); if (!next.apiKeys) next.apiKeys = {}; next.apiKeys[name] = issued.data.api_key; if (!next.currentProject) next.currentProject = name; saveConfig(next)
console.log(chalk.green('API key created (save it now — it is not shown again):'))
console.log('  ' + chalk.yellow(issued.data.api_key))
return
}
const { sure } = await inquirer.prompt([{ type: 'confirm', name: 'sure', message: 'Rotate the key for "' + name + '"? Everything using the old key breaks immediately.', default: false }])
if (!sure) { console.log('Aborted.'); return }
const rotated = await getAuthClient(token).post('/api/projects/' + project.id + '/rotate-key')
const next = loadConfig(); if (!next.apiKeys) next.apiKeys = {}; next.apiKeys[name] = rotated.data.api_key; if (!next.currentProject) next.currentProject = name; saveConfig(next)
console.log(chalk.green('Key rotated. New key (save it now — it is not shown again):'))
console.log('  ' + chalk.yellow(rotated.data.api_key))
} catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)); process.exit(1) }
})
program.command('projects:delete <name>').description('Delete a project and ALL its secrets/store/history').option('--yes', 'Skip the confirmation prompt').action(async (name, options) => {
  const token = await getUserToken()
  if (!options.yes) {
    const { sure } = await inquirer.prompt([{ type: 'confirm', name: 'sure', message: 'Delete project "' + name + '" and ALL its data?', default: false }])
    if (!sure) { console.log('Aborted.'); return }
  }
  const auth = getAuthClient(token)
  try {
    const list = await auth.get('/api/projects')
    const project = list.data.projects.find(p => p.name === name)
    if (!project) { console.log(chalk.red('No project named "' + name + '".')); process.exit(1) }
    await auth.delete('/api/projects/' + project.id)
    const config = loadConfig()
    if (config.apiKeys) delete config.apiKeys[name]
    if (config.currentProject === name) config.currentProject = (Object.keys(config.apiKeys || {})[0] || null)
    saveConfig(config)
    console.log(chalk.green('Deleted project "' + name + '"'))
  } catch (error) { console.log(chalk.red(error.response?.data?.error || error.message)); process.exit(1) }
})
program.parse(process.argv)
