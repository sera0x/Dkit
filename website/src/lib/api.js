// API wrapper with transparent session refresh.
//
// The backend issues a short-lived JWT (15 min) plus a long-lived refresh
// token. When a call fails with code `token_expired`, we silently exchange the
// refresh token for a fresh pair and retry the request once. If the refresh
// itself fails, the session is truly dead: we clear local state, flag the
// login page, and bounce to /login.

const STORAGE_KEY = 'dkit_auth';
const EXPIRED_FLAG = 'dkit_session_expired';
export const AUTH_CHANGED_EVENT = 'dkit_auth_changed';

function readAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch { /* storage unavailable */ }
}

function notifyAuthChanged() {
  try {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch { /* non-browser */ }
}

// One refresh at a time: concurrent 401s share a single in-flight refresh so
// token rotation can't be raced into invalidating itself.
let refreshPromise = null;
function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = readAuth();
    if (!current?.refresh_token) return null;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      writeAuth({
        ...current,
        token: data.token,
        refresh_token: data.refresh_token,
        user: data.user || current.user,
      });
      notifyAuthChanged();
      return data;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// Session is unrecoverable: wipe local state and send the user to /login with
// a "session expired" notice. The guard keeps a burst of failing calls from
// triggering multiple redirects.
let expiryHandled = false;
function sessionExpired() {
  if (expiryHandled) return;
  expiryHandled = true;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { sessionStorage.setItem(EXPIRED_FLAG, '1'); } catch { /* ignore */ }
  notifyAuthChanged();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

// Read-and-clear the "session expired" flag the login page shows a notice for.
export function consumeSessionExpired() {
  try {
    const flagged = sessionStorage.getItem(EXPIRED_FLAG) === '1';
    if (flagged) sessionStorage.removeItem(EXPIRED_FLAG);
    return flagged;
  } catch {
    return false;
  }
}

async function request(path, options = {}) {
  // Tag every browser request with the signed-in email so the server-side
  // audit trail can distinguish dashboard edits from CLI edits.
  const current = readAuth();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(current?.user?.email ? { 'x-dkit-actor': current.user.email } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  // Access token expired mid-session: refresh once and retry with the new one.
  if (res.status === 401 && data?.code === 'token_expired' && !options.__retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(path, {
        ...options,
        __retried: true,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${refreshed.token}`,
        },
      });
    }
    sessionExpired();
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// Project calls from the browser go out with the SESSION (Bearer + x-project-id),
// not an API key. API keys are hashed at rest — the browser never holds one
// unless the user deliberately saves it below — so this is the only way the
// dashboard can touch a project's env/store/logs. The backend resolves the
// project from the session and checks ownership.
// ---------------------------------------------------------------------------
const projectAuth = (token, projectId) => ({
  Authorization: `Bearer ${token}`,
  'x-project-id': projectId,
});

// ---------------------------------------------------------------------------
// Key vault (localStorage). Reveal/copy of a full API key only works for keys
// the user has saved into THIS browser (they're shown once server-side, hashed
// at rest). Anything else shows the masked prefix — honestly.
// ---------------------------------------------------------------------------
const VAULT_KEY = 'dkit_key_vault';
export function readKeyVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY)) || {} } catch { return {} }
}
function writeVault(vault) {
  try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)) } catch { /* storage unavailable */ }
}
export function saveKeyToVault(projectId, apiKey) {
  if (!projectId || !apiKey) return;
  const vault = readKeyVault();
  vault[projectId] = apiKey;
  writeVault(vault);
}
export function forgetKeyInVault(projectId) {
  const vault = readKeyVault();
  delete vault[projectId];
  writeVault(vault);
}
export const vault = { read: readKeyVault, save: saveKeyToVault, forget: forgetKeyInVault };
export const api = {
logout: (refreshToken) =>
request('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => {}),
signup: (email, password) =>
request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
loginInitiate: (email, password) =>
request('/auth/login/initiate', { method: 'POST', body: JSON.stringify({ email, password }) }),
loginVerify: (login_token, code) =>
request('/auth/login/verify', { method: 'POST', body: JSON.stringify({ login_token, code }) }),
twofaStatus: (token) =>
request('/auth/2fa/status', { headers: { Authorization: `Bearer ${token}` } }),
twofaSetup: (token) =>
request('/auth/2fa/setup', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
twofaEnable: (token, code) =>
request('/auth/2fa/enable', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) }),
twofaDisable: (token, password, code) =>
request('/auth/2fa/disable', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ password, code }) }),
forgotPassword: (email) =>
request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
resetPassword: (token, password) =>
request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
oauthProviders: () =>
request('/auth/oauth/providers'),
verificationStatus: (token) =>
request('/auth/verification-status', { headers: { Authorization: `Bearer ${token}` } }),
getSession: (token) =>
request('/auth/session', { headers: { Authorization: `Bearer ${token}` } }),
getAdminSession: (token) =>
request('/admin/session', { headers: { Authorization: `Bearer ${token}` } }),
sendVerification: (token) =>
request('/auth/send-verification', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
verifyEmail: (token, code) =>
request('/auth/verify', {
method: 'POST',
headers: { Authorization: `Bearer ${token}` },
body: JSON.stringify({ code }),
}),
getActivity: (token) =>
request('/stats/activity', { headers: { Authorization: `Bearer ${token}` } }),
getActivityDaily: (token) =>
request('/stats/activity/daily', { headers: { Authorization: `Bearer ${token}` } }),
getAdminStats: (token) =>
request('/admin/stats', { headers: { Authorization: `Bearer ${token}` } }),
deleteAdminUser: (token, id) =>
request(`/admin/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
getAdminUsers: (token) =>
request('/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
getAdminIpClusters: (token) =>
request('/admin/ip-clusters', { headers: { Authorization: `Bearer ${token}` } }),
setUserSuspended: (token, id, suspended) =>
request(`/admin/users/${id}/suspend`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ suspended }) }),
sendBroadcast: (token, subject, body, verifiedOnly = true) =>
request('/admin/broadcast', {
method: 'POST',
headers: { Authorization: `Bearer ${token}` },
body: JSON.stringify({ subject, body, verified_only: verifiedOnly }),
}),
getProjects: (token) =>
request('/projects', { headers: { Authorization: `Bearer ${token}` } }),
getAudit: (token, id) =>
request(`/projects/${id}/audit`, { headers: { Authorization: `Bearer ${token}` } }),
createProject: (token, name) =>
request('/projects', {
method: 'POST',
headers: { Authorization: `Bearer ${token}` },
body: JSON.stringify({ name }),
}),
deleteProject: (token, id) =>
request(`/projects/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
rotateProjectKey: (token, id) =>
request(`/projects/${id}/rotate-key`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
// On-demand API keys: issue (keyless projects only) / revoke (project goes keyless)
createProjectApiKey: (token, id) =>
request(`/projects/${id}/api-key`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
revokeProjectApiKey: (token, id) =>
request(`/projects/${id}/api-key`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
getSessions: (token, refreshToken) =>
request('/auth/sessions', {
headers: {
Authorization: `Bearer ${token}`,
...(refreshToken ? { 'x-session-token': refreshToken } : {}),
},
}),
revokeSession: (token, id) =>
request(`/auth/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
revokeOtherSessions: (token, refreshToken) =>
request('/auth/sessions/revoke-others', {
method: 'POST',
headers: {
Authorization: `Bearer ${token}`,
...(refreshToken ? { 'x-session-token': refreshToken } : {}),
},
}),
// Project-scoped routes (env, store) — session-authenticated.
projectEnv: (token, projectId, environment) =>
request(environment ? `/env?environment=${encodeURIComponent(environment)}` : '/env', {
headers: projectAuth(token, projectId),
}),
projectEnvSet: (token, projectId, key, value, environment) =>
request('/env', {
method: 'POST',
headers: projectAuth(token, projectId),
body: JSON.stringify({ key, value, environment }),
}),
projectEnvDelete: (token, projectId, key, environment) =>
request(`/env/${encodeURIComponent(key)}?environment=${encodeURIComponent(environment)}`, {
method: 'DELETE',
headers: projectAuth(token, projectId),
}),
projectEnvRollback: (token, projectId, key, environment) =>
request('/env/rollback', {
method: 'POST',
headers: projectAuth(token, projectId),
body: JSON.stringify({ key, environment }),
}),
projectStore: (token, projectId) =>
request('/store', { headers: projectAuth(token, projectId) }),
projectStoreGet: (token, projectId, key) =>
request(`/store/${encodeURIComponent(key)}`, { headers: projectAuth(token, projectId) }),
projectStoreSet: (token, projectId, key, value, ttl) =>
request(`/store/${encodeURIComponent(key)}`, {
method: 'POST',
headers: projectAuth(token, projectId),
body: JSON.stringify(ttl ? { value, ttl } : { value }),
}),
projectStoreDelete: (token, projectId, key) =>
request(`/store/${encodeURIComponent(key)}`, {
method: 'DELETE',
headers: projectAuth(token, projectId),
}),
projectStoreIncrement: (token, projectId, key, by) =>
request(`/store/${encodeURIComponent(key)}/increment`, {
method: 'POST',
headers: projectAuth(token, projectId),
body: JSON.stringify({ by }),
}),

projectEnvImport: (token, projectId, vars, environment = 'production') =>
request('/env/import', {
method: 'POST',
headers: projectAuth(token, projectId),
body: JSON.stringify({ vars, environment }),
}),

// Verify a candidate API key for a project (no storage server-side; the key
// lives in the browser's vault only if it matches).
verifyProjectKey: (token, projectId, key) =>
request(`/projects/${projectId}/verify-key`, {
method: 'POST',
headers: auth(token),
body: JSON.stringify({ key }),
}),
getOverview: (token) => request('/overview', { headers: auth(token) }),

// Public status page (no auth)
getStatus: () => request('/status'),

// Admin: status page controls + notification feed
getAdminStatus: (token) => request('/admin/status', { headers: auth(token) }),
setServiceMode: (token, id, mode) =>
  request(`/admin/status/services/${id}/mode`, { method: 'POST', headers: auth(token), body: JSON.stringify({ mode }) }),
forceServiceCheck: (token, id) =>
  request(`/admin/status/services/${id}/check`, { method: 'POST', headers: auth(token) }),
createStatusIncident: (token, incident) =>
  request('/admin/status/incidents', { method: 'POST', headers: auth(token), body: JSON.stringify(incident) }),
addIncidentUpdate: (token, id, update) =>
  request(`/admin/status/incidents/${id}/updates`, { method: 'POST', headers: auth(token), body: JSON.stringify(update) }),
ackStatusNotifications: (token) =>
  request('/admin/status/ack', { method: 'POST', headers: auth(token) }),

// Cron
cronList: (token, projectId) => request(`/projects/${projectId}/cron`, { headers: auth(token) }),
cronCreate: (token, projectId, job) =>
request(`/projects/${projectId}/cron`, { method: 'POST', headers: auth(token), body: JSON.stringify(job) }),
cronUpdate: (token, projectId, jobId, patch) =>
request(`/projects/${projectId}/cron/${jobId}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(patch) }),
cronDelete: (token, projectId, jobId) =>
request(`/projects/${projectId}/cron/${jobId}`, { method: 'DELETE', headers: auth(token) }),
cronRun: (token, projectId, jobId) =>
request(`/projects/${projectId}/cron/${jobId}/run`, { method: 'POST', headers: auth(token) }),
cronRuns: (token, projectId, jobId) => request(`/projects/${projectId}/cron/${jobId}/runs`, { headers: auth(token) }),

// Uptime monitors
monitorList: (token, projectId) => request(`/projects/${projectId}/monitors`, { headers: auth(token) }),
monitorCreate: (token, projectId, monitor) =>
request(`/projects/${projectId}/monitors`, { method: 'POST', headers: auth(token), body: JSON.stringify(monitor) }),
monitorUpdate: (token, projectId, monitorId, patch) =>
request(`/projects/${projectId}/monitors/${monitorId}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(patch) }),
monitorDelete: (token, projectId, monitorId) =>
request(`/projects/${projectId}/monitors/${monitorId}`, { method: 'DELETE', headers: auth(token) }),
monitorChecks: (token, projectId, monitorId) =>
request(`/projects/${projectId}/monitors/${monitorId}/checks`, { headers: auth(token) }),

// Logs
logsList: (token, projectId, { level, search, before } = {}) => {
  const qs = new URLSearchParams();
  if (level) qs.set('level', level);
  if (search) qs.set('search', search);
  if (before) qs.set('before', before);
  const suffix = qs.toString() ? '?' + qs.toString() : '';
  return request(`/projects/${projectId}/logs${suffix}`, { headers: auth(token) });
},
logsShip: (token, projectId, events) =>
request(`/projects/${projectId}/logs`, { method: 'POST', headers: auth(token), body: JSON.stringify({ events }) }),
logsClear: (token, projectId) =>
request(`/projects/${projectId}/logs`, { method: 'DELETE', headers: auth(token) }),
envDownload: async (token, projectId, environment) => {
  const data = await api.projectEnv(token, projectId, environment);
  const lines = Object.entries(data.env || {}).map(([k, v]) => {
    const needsQuotes = /\s|"/.test(String(v));
    const safe = needsQuotes ? '"' + String(v).replace(/"/g, '\\"') + '"' : String(v);
    return `${k}=${safe}`;
  });
  const blob = new Blob([lines.join('\n') + (lines.length ? '\n' : '')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '.env';
  a.click();
  URL.revokeObjectURL(a.href);
},
getTeams: (token) => request('/teams', { headers: auth(token) }),
createTeam: (token, name) => request('/teams', { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) }),
getTeam: (token, teamId) => request(`/teams/${teamId}`, { headers: auth(token) }),
deleteTeam: (token, teamId) => request(`/teams/${teamId}`, { method: 'DELETE', headers: auth(token) }),
inviteToTeam: (token, teamId, email, role) =>
request(`/teams/${teamId}/invites`, { method: 'POST', headers: auth(token), body: JSON.stringify({ email, role }) }),
resendTeamInvite: (token, teamId, inviteId) =>
request(`/teams/${teamId}/invites/${inviteId}/resend`, { method: 'POST', headers: auth(token) }),
revokeTeamInvite: (token, teamId, inviteId) =>
request(`/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE', headers: auth(token) }),
setTeamMemberRole: (token, teamId, userId, role) =>
request(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ role }) }),
removeTeamMember: (token, teamId, userId) =>
request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE', headers: auth(token) }),
addProjectToTeam: (token, teamId, projectId) =>
request(`/teams/${teamId}/projects`, { method: 'POST', headers: auth(token), body: JSON.stringify({ project_id: projectId }) }),
removeTeamProject: (token, teamId, projectId) =>
request(`/teams/${teamId}/projects/${projectId}`, { method: 'DELETE', headers: auth(token) }),
getSharedProjects: (token) => request('/projects/shared', { headers: auth(token) }),
myTeamInvites: (token) => request('/teams/invites/mine', { headers: auth(token) }),
previewTeamInvite: (inviteToken) => request(`/teams/invites/preview?token=${encodeURIComponent(inviteToken)}`),
acceptTeamInvite: (token, inviteToken) =>
request('/teams/invites/accept', { method: 'POST', headers: auth(token), body: JSON.stringify({ token: inviteToken }) }),
declineTeamInvite: (token, inviteToken) =>
request('/teams/invites/decline', { method: 'POST', headers: auth(token), body: JSON.stringify({ token: inviteToken }) }),
};
