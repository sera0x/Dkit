import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AppShell from '../components/app/AppShell';
import { SITE_URL } from '../lib/site';
import './docs.css';

const API_BASE = SITE_URL;

const PageHeader = ({ Icon, title, subtitle }) => (
  <div className="page-header">
    <div className="page-header-icon"><Icon width="18" height="18" /></div>
    <div>
      <h1>{title}</h1>
      <p className="page-header-sub">{subtitle}</p>
    </div>
  </div>
);


function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="docs-code">
      <button type="button" className="docs-copy" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
      <pre><code>{children}</code></pre>
    </div>
  );
}

const CLI_COMMANDS = [
  ['dkit login', 'Log in with your email and password, then enter the 6-digit code emailed to you.'],
  ['dkit projects:create <name>', 'Create a project. Prints its API key. Save it, it is shown once.'],
  ['dkit projects:list', 'List all your projects with their API keys.'],
  ['dkit env:set <key> <value>', 'Set an env var. Defaults to development. Add -e production to ship.'],
  ['dkit env:get <key>', 'Read one env var.'],
  ['dkit env:list', 'List env vars, masked server-side (plaintext never leaves the API). -s reveals values.'],
  ['dkit env:unset <key>', 'Delete an env var.'],
  ['dkit env:history <key>', 'Audit trail for one key: every set, update, delete, and rollback.'],
  ['dkit store:set <key> <value>', 'Store a JSON value in the key-value store.'],
  ['dkit store:get <key>', 'Read a stored value.'],
  ['dkit store:list', 'List all stored keys with created/updated times.'],
  ['dkit store:delete <key>', 'Delete a stored key.'],
  ['dkit cron:add <name> <url>', 'Schedule an HTTP call from the API: -s "5m", "daily 09:30", "mon 09:00" (UTC). -m method, -b JSON body, -H header.'],
  ['dkit cron:list', 'List cron jobs for the linked project.'],
  ['dkit cron:runs <name>', 'Recent runs for a job: status, duration, errors.'],
  ['dkit cron:run <name>', 'Run a job right now (schedule unaffected).'],
  ['dkit cron:pause <name>', 'Pause a job (--resume to bring it back).'],
  ['dkit cron:rm <name>', 'Delete a job.'],
  ['dkit monitor:add <name> <url>', 'Watch a URL; email on down + recovery. -i seconds (30-3600), -e alert email.'],
  ['dkit monitor:list', 'List monitors and their live status.'],
  ['dkit monitor:pause <name>', 'Pause a monitor (--resume).'],
  ['dkit monitor:rm <name>', 'Delete a monitor.'],
  ['dkit.name.ng/status', 'Live status of Dkit\u2019s own services: API, Website, Docs. Auto-updates every 30s; incidents post here automatically.'],
  ['dkit logs:ship [msg]', 'Ship a log line (or piped JSON lines) to the drain. -l level, -s source, -m meta JSON.'],
  ['dkit logs:tail', 'Recent logs for the linked project. -l level, -q search, -n lines.'],
  ['dkit logs:clear', 'Delete all logs for the linked project.'],
  ['dkit templates', 'List scaffolding templates.'],
  ['dkit new <name>', 'Scaffold a project. --template node-api | scheduled-job | static-site | express-pg.'],
  ['dkit keys:rotate [name]', 'Reissue a project API key. The old key stops working immediately.'],
  ['dkit doctor', 'Check API reachability, login, project link, API key, and email verification.'],
  ['dkit logout', "Log out and revoke this device's session."],
  ['dkit verify:send', 'Send a new email verification code.'],
  ['dkit verify <code>', 'Verify your email with the code.'],
  ['dkit verify:status', 'Check whether your email is verified.'],
  ['dkit 2fa status', 'Show whether two-factor auth is on.'],
  ['dkit 2fa setup / enable <code>', 'Turn 2FA on; recovery codes print once.'],
  ['dkit 2fa disable', 'Turn 2FA off (password plus current code).'],
  ['dkit config', 'Show the logged-in user, current project, and active API key.'],
];

export default function Docs({ onNavigate }) {
  const { user } = useAuth();

  const go = (path) => {
    onNavigate ? onNavigate(path) : (window.location.href = path);
  };

  return (
    <AppShell active="docs" onNavigate={onNavigate}>
      <div className="docs-container">
        <PageHeader
          Icon={BookOpen}
          title="Docs"
          subtitle="Secrets and runtime config, from one CLI or a plain HTTP API."
        />
        <p className="docs-lead">
          Keep secrets per environment, inject them at runtime, and audit what changed.
          Cron, monitors, and logs are there when you need them.
        </p>

        <div className="docs-block">
          <h2>Quickstart</h2>
          <ol>
            <li>Create an account at <a href="/signup" onClick={(e) => { e.preventDefault(); go('/signup'); }}>sign up</a>.</li>
            <li>Verify your email with the 6-digit code we send you.</li>
            <li>Create a project on the dashboard and copy its <code>dk_...</code> API key.</li>
            <li>Install the CLI (checksum-verified, no npm required):</li>
          </ol>
          <CodeBlock>{`curl -fsSL https://dkit.name.ng/install.sh | sh`}</CodeBlock>
          <ol start={5}>
            <li>Log in and start setting secrets:</li>
          </ol>
          <CodeBlock>{`dkit login
dkit env:set STRIPE_KEY sk_live_...
dkit monitor:add prod https://myapp.dev/health
dkit cron:add cleanup https://myapp.dev/cleanup -s "daily 04:00"
dkit logs:ship "it's alive"`}</CodeBlock>
        </div>

        <div className="docs-block">
          <h2>Concepts</h2>
          <ul>
            <li><code>Project</code>: a container for one app. Each project gets its own API key.</li>
            <li><code>Env vars</code>: secret key-value pairs per environment (default <code>production</code>, or e.g. <code>staging</code>). Hidden by default, read at runtime from your code.</li>
            <li><code>Cron</code>: scheduled HTTP calls made by the API: ping endpoints, run rollups, trigger cleanups. No server that stays awake.</li>
            <li><code>Monitors</code>: uptime checks on your URLs, with email alerts on down and recovery.</li>
            <li><code>Logs</code>: a log drain your apps ship to over HTTP; tail it from the CLI or dashboard. 7-day retention.</li>
            <li><code>Store</code>: a JSON key-value store for app data (counters, sessions, anything small).</li>
            <li><code>API key</code>: the <code>dk_...</code> key that authenticates project calls from your code. The dashboard itself uses your login session; keys are hashed at rest and shown once.</li>
            <li><code>Encryption</code>: env values and env history are AES-256-GCM encrypted at rest with <code>DKIT_ENCRYPTION_KEY</code>. Rotating or losing that key makes stored values unreadable unless you re-encrypt them first.</li>
          </ul>
        </div>

        <div className="docs-block">
          <h2 id="security">Security</h2>
          <ul>
            <li><strong>At rest:</strong> env values, env history, and TOTP secrets use AES-256-GCM with a dedicated <code>DKIT_ENCRYPTION_KEY</code>. Back that key up with Postgres; without both, the values cannot be recovered.</li>
            <li><strong>API keys:</strong> project keys and refresh tokens are stored as SHA-256 hashes. The plaintext is returned once when a key is created or rotated.</li>
            <li><strong>Browser sessions:</strong> the refresh token lives in an httpOnly, SameSite=Lax cookie scoped to <code>/api/auth</code>. The access token stays in memory, and refresh and logout require a CSRF token.</li>
            <li><strong>Headers:</strong> the API sends a restrictive Content-Security-Policy, <code>frame-ancestors 'none'</code>, and a same-origin referrer policy. CORS only accepts the configured <code>PUBLIC_URL</code> and local development origins.</li>
            <li><strong>Reporting:</strong> use GitHub private vulnerability reporting. Do not include live credentials in a report.</li>
          </ul>
        </div>

        <div className="docs-block">
          <h2>CLI reference</h2>
          <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr><th>Command</th><th>What it does</th></tr>
            </thead>
            <tbody>
              {CLI_COMMANDS.map(([cmd, desc]) => (
                <tr key={cmd}>
                  <td>{cmd}</td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="docs-note">
            The CLI talks to the API over HTTPS. To point it at a different
            host (e.g. local development), set the <code>DKIT_API_URL</code> environment variable.
          </div>
        </div>

        <div className="docs-block">
          <h2>HTTP API reference</h2>
          <p>
            Base URL: <code>{API_BASE}</code>. Two auth modes:
          </p>
          <ul>
            <li><strong>Project calls</strong> (env + store): send your API key as the <code>x-api-key</code> header.</li>
            <li><strong>Account calls</strong> (signup, projects, verification): send your login JWT as <code>Authorization: Bearer &lt;token&gt;</code>.</li>
          </ul>

          <h3>Env vars</h3>
          <CodeBlock>{`# List all env vars (non-production keys get an "__env" suffix)
curl ${API_BASE}/api/env -H "x-api-key: dk_your_key_here"

# Set one (production by default)
curl -X POST ${API_BASE}/api/env \\\
  -H "x-api-key: dk_your_key_here" \\\
  -H "Content-Type: application/json" \\\
  -d '{"key":"STRIPE_KEY","value":"sk_live_..."}'

# Set one for another environment
curl -X POST ${API_BASE}/api/env \\\
  -H "x-api-key: dk_your_key_here" \\\
  -H "Content-Type: application/json" \\\
  -d '{"key":"API_URL","value":"https://staging.example.com","environment":"staging"}'

# Read one
curl "${API_BASE}/api/env/STRIPE_KEY" -H "x-api-key: dk_your_key_here"

# Delete one
curl -X DELETE "${API_BASE}/api/env/STRIPE_KEY?environment=staging" \\\
  -H "x-api-key: dk_your_key_here"`}</CodeBlock>

          <h3>Key-value store</h3>
          <CodeBlock>{`# Store a JSON value
curl -X POST ${API_BASE}/api/store/user:123 \\\
  -H "x-api-key: dk_your_key_here" \\\
  -H "Content-Type: application/json" \\\
  -d '{"value":{"name":"Jane"}}'

# Read it back (returns the stored JSON directly)
curl ${API_BASE}/api/store/user:123 -H "x-api-key: dk_your_key_here"

# List all keys
curl ${API_BASE}/api/store -H "x-api-key: dk_your_key_here"

# Delete a key
curl -X DELETE ${API_BASE}/api/store/user:123 -H "x-api-key: dk_your_key_here"`}</CodeBlock>

          <h3>Cron jobs</h3>
          <CodeBlock>{`# List jobs (Bearer auth, account-level)
curl ${API_BASE}/api/projects/<project-id>/cron -H "Authorization: Bearer <token>"

# Create one
curl -X POST ${API_BASE}/api/projects/<project-id>/cron \\\
  -H "Authorization: Bearer <token>" \\\
  -H "Content-Type: application/json" \\\
  -d '{"name":"nightly","url":"https://myapp.dev/rollup","schedule":"daily 03:00","method":"POST","body":"{\\"full\\":true}"}'

# Run now / pause / delete
curl -X POST ${API_BASE}/api/projects/<project-id>/cron/<job-id>/run -H "Authorization: Bearer <token>"
curl -X PATCH ${API_BASE}/api/projects/<project-id>/cron/<job-id> -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"enabled":false}'
curl -X DELETE ${API_BASE}/api/projects/<project-id>/cron/<job-id> -H "Authorization: Bearer <token>"`}</CodeBlock>

          <h3>Uptime monitors</h3>
          <CodeBlock>{`# List
curl ${API_BASE}/api/projects/<project-id>/monitors -H "Authorization: Bearer <token>"

# Create (alerts default to your account email)
curl -X POST ${API_BASE}/api/projects/<project-id>/monitors \\\
  -H "Authorization: Bearer <token>" \\\
  -H "Content-Type: application/json" \\\
  -d '{"name":"prod","url":"https://myapp.dev/health","interval_seconds":60}'

# Pause / resume
curl -X PATCH ${API_BASE}/api/projects/<project-id>/monitors/<monitor-id> \\\
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"paused":true}'`}</CodeBlock>

          <h3>Log drain</h3>
          <CodeBlock>{`# Ship logs from your app (x-api-key auth — this is the drain)
curl -X POST ${API_BASE}/api/logs \\\
  -H "x-api-key: dk_your_key_here" \\\
  -H "Content-Type: application/json" \\\
  -d '{"events":[{"level":"info","message":"deploy finished","source":"ci"}]}'

# Read (Bearer auth)
curl "${API_BASE}/api/projects/<project-id>/logs?level=error&search=timeout" \\\
  -H "Authorization: Bearer <token>"`}</CodeBlock>

          <h3>Account &amp; auth</h3>
          <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr><th>Endpoint</th><th>What it does</th></tr>
            </thead>
            <tbody>
              <tr><td>POST /api/auth/signup</td><td>Body: {'{email, password}'}. Creates the account, emails a verification code, returns {'{user, token}'}.</td></tr>
              <tr><td>POST /api/auth/login/initiate</td><td>Body: {'{email, password}'}. Emails a 6-digit login code, returns {'{login_token}'}.</td></tr>
              <tr><td>POST /api/auth/login/verify</td><td>Body: {'{login_token, code}'}. Returns {'{user, token}'}.</td></tr>
              <tr><td>GET /api/auth/verification-status</td><td>Bearer auth. Returns {'{verified: true|false}'}.</td></tr>
              <tr><td>POST /api/auth/send-verification</td><td>Bearer auth. Emails a fresh verification code.</td></tr>
              <tr><td>POST /api/auth/verify</td><td>Bearer auth. Body: {'{code}'}.</td></tr>
              <tr><td>POST /api/projects</td><td>Bearer auth. Body: {'{name}'}. Requires verified email. Returns the project with its API key.</td></tr>
              <tr><td>GET /api/projects</td><td>Bearer auth. Lists your projects.</td></tr>
              <tr><td>DELETE /api/projects/:id</td><td>Bearer auth. Deletes a project and all its data.</td></tr>
            </tbody>
          </table>
          </div>
        </div>

        <div className="docs-block">
          <h2>From your code</h2>
          <h3>Node.js</h3>
          <CodeBlock>{`const res = await fetch('${API_BASE}/api/env/STRIPE_KEY', {
  headers: { 'x-api-key': process.env.DKIT_API_KEY },
});
const { value } = await res.json();

// store
await fetch('${API_BASE}/api/store/user:123', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.DKIT_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ value: { name: 'Jane' } }),
});`}</CodeBlock>
          <h3>Python</h3>
          <CodeBlock>{`import requests, os

headers = {'x-api-key': os.environ['DKIT_API_KEY']}

r = requests.get(f'${API_BASE}/api/env/STRIPE_KEY', headers=headers)
print(r.json()['value'])

requests.post(
    f'${API_BASE}/api/store/user:123',
    headers=headers,
    json={'value': {'name': 'Jane'}},
)`}</CodeBlock>
        </div>

        <div className="docs-block">
          <h2>Troubleshooting</h2>
          <ul>
            <li><strong>Cron job never fires</strong>: schedules are UTC strings like <code>5m</code>, <code>daily 09:30</code>. Check <code>dkit cron:runs &lt;name&gt;</code> for the recorded error; jobs whose URL is unreachable show <code>error: …</code>.</li>
            <li><strong>Monitor says down but the site works</strong>: two consecutive failures mark a monitor down. Check the recorded status code; a 4xx/5xx counts as down.</li>
            <li><strong>Logs missing</strong>: retention is 7 days, and ingest needs the <code>x-api-key</code> header. <code>dkit logs:ship "test"</code> then <code>dkit logs:tail</code> verifies the pipe end-to-end.</li>
            <li><strong>"Email not verified" when creating a project</strong>: verify your email first (banner on the dashboard, or <code>dkit verify:send</code>).</li>
            <li><strong>"Invalid API key"</strong>: the <code>x-api-key</code> header does not match any project. Copy the key again from the dashboard.</li>
            <li><strong>Env var not found</strong>: remember non-production values live under <code>KEY__environment</code> when listing, and reads need <code>?environment=staging</code>.</li>
          </ul>
        </div>

        {!user && (
          <div className="docs-block docs-cta">
            <h2>Ready?</h2>
            <button className="cta-button primary" onClick={() => go('/signup')}>Get started free</button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
