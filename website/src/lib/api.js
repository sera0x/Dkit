
const EXPIRED_FLAG = 'dkit_session_expired';
export const AUTH_CHANGED_EVENT = 'dkit_auth_changed';

let accessToken = null;
let currentUser = null;

export function setAccessToken(token, user) {
  accessToken = token || null;
  if (token) expiryHandled = false;
  if (user !== undefined) currentUser = user || null;
}

export function getAccessToken() {
  return accessToken;
}

function readCookie(name) {
  try {
    const prefix = name + '=';
    for (const part of document.cookie.split(';')) {
      const value = part.trim();
      if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
    }
  } catch {  }
  return '';
}

function csrfHeader() {
  const token = readCookie('dkit_csrf');
  return token ? { 'x-csrf-token': token } : {};
}

function notifyAuthChanged() {
  try {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {  }
}

let refreshPromise = null;
export function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...csrfHeader() },
        body: '{}',
      });
      if (!res.ok) { accessToken = null; return null; }
      const data = await res.json();
      accessToken = data.token || null;
      currentUser = data.user || currentUser;
      notifyAuthChanged();
      return data;
    } catch {
      accessToken = null;
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function restoreSession() {
  if (!readCookie('dkit_csrf')) return null;
  const data = await refreshSession();
  if (!data?.token) return null;
  accessToken = data.token;
  currentUser = data.user || null;
  return { user: data.user || null, token: data.token };
}

let expiryHandled = false;
function sessionExpired() {
  if (expiryHandled) return;
  expiryHandled = true;
  accessToken = null;
  currentUser = null;
  try { sessionStorage.setItem(EXPIRED_FLAG, '1'); } catch {  }
  notifyAuthChanged();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

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
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(currentUser?.email ? { 'x-dkit-actor': currentUser.email } : {}),
      ...(accessToken && !options.headers?.Authorization ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (res.status === 401 && data?.code === 'token_expired' && !options.__retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(path, { ...options, __retried: true });
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

const projectAuth = (token, projectId) => ({
  Authorization: `Bearer ${token}`,
  'x-project-id': projectId,
});

const VAULT = new Map();
export function readKeyVault() {
  return Object.fromEntries(VAULT);
}
export function saveKeyToVault(projectId, apiKey) {
  if (!projectId || !apiKey) return;
  VAULT.set(projectId, apiKey);
}
export function forgetKeyInVault(projectId) {
  VAULT.delete(projectId);
}
export const vault = { read: readKeyVault, save: saveKeyToVault, forget: forgetKeyInVault };
export const api = {
logout: () =>
request('/auth/logout', { method: 'POST', body: '{}', headers: csrfHeader() }).catch(() => {}),
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
createProjectApiKey: (token, id) =>
request(`/projects/${id}/api-key`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
revokeProjectApiKey: (token, id) =>
request(`/projects/${id}/api-key`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
getSessions: (token) =>
request('/auth/sessions', {
headers: {
Authorization: `Bearer ${token}`,
},
}),
revokeSession: (token, id) =>
request(`/auth/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
revokeOtherSessions: (token) =>
request('/auth/sessions/revoke-others', {
method: 'POST',
headers: {
Authorization: `Bearer ${token}`,
},
}),
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

verifyProjectKey: (token, projectId, key) =>
request(`/projects/${projectId}/verify-key`, {
method: 'POST',
headers: auth(token),
body: JSON.stringify({ key }),
}),
getOverview: (token) => request('/overview', { headers: auth(token) }),

getStatus: () => request('/status'),

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

monitorList: (token, projectId) => request(`/projects/${projectId}/monitors`, { headers: auth(token) }),
monitorCreate: (token, projectId, monitor) =>
request(`/projects/${projectId}/monitors`, { method: 'POST', headers: auth(token), body: JSON.stringify(monitor) }),
monitorUpdate: (token, projectId, monitorId, patch) =>
request(`/projects/${projectId}/monitors/${monitorId}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(patch) }),
monitorDelete: (token, projectId, monitorId) =>
request(`/projects/${projectId}/monitors/${monitorId}`, { method: 'DELETE', headers: auth(token) }),
monitorChecks: (token, projectId, monitorId) =>
request(`/projects/${projectId}/monitors/${monitorId}/checks`, { headers: auth(token) }),

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
