import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, RefreshCw, Mail, Folder, KeyRound, AlertTriangle, ShieldCheck, Trash2, Search, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import MetricExplorer from './MetricExplorer';
import StatusAdminPanel from './StatusAdminPanel';

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function AdminPanel() {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState(null);
  const [clusters, setClusters] = useState(null);
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [mailSending, setMailSending] = useState(false);
  const [mailResult, setMailResult] = useState(null);
  const [mailConfirm, setMailConfirm] = useState(false);

  const sendBroadcast = async () => {
    setMailSending(true); setMailResult(null);
    try {
      const r = await api.sendBroadcast(token, mailSubject.trim(), mailBody.trim());
      setMailResult(r);
      if (r.failed.length === 0) { setMailSubject(''); setMailBody(''); }
    } catch (e) { setMailResult({ error: e.message, failed: [] }); }
    finally { setMailSending(false); setMailConfirm(false); }
  };

  const load = useCallback(() => {
    api.getAdminStats(token).then(setStats).catch(() => {});
    api.getAdminUsers(token).then(setUsers).catch((e) => setError(e.message));
    api.getAdminIpClusters(token).then(setClusters).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email.toLowerCase().includes(q) || (u.last_ip || '').includes(q));
  }, [users, query]);

  const toggleSuspend = async (u) => {
    setBusyId(u.id); setError('');
    try { await api.setUserSuspended(token, u.id, !u.suspended); load(); }
    catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  };

  const removeUser = async (u) => {
    setBusyId(u.id); setError('');
    try { await api.deleteAdminUser(token, u.id); setConfirmId(null); load(); }
    catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  };

  if (error && !users) return <div className="dash-card"><p className="me-total">{error}</p></div>;
  if (!users) return <div className="dash-card"><p className="me-total">Loading…</p></div>;

  const t = stats?.totals;
  const pills = t ? [
    { Icon: Users, n: t.users, label: 'users' },
    { Icon: Plus, n: t.new_7d, label: 'new · 7d' },
    { Icon: RefreshCw, n: t.active_7d, label: 'active · 7d' },
    { Icon: Mail, n: t.verified, label: 'verified' },
    { Icon: Folder, n: t.projects, label: 'projects' },
    { Icon: KeyRound, n: t.env_vars, label: 'env vars' },
    { Icon: AlertTriangle, n: t.suspended, label: 'suspended' },
    { Icon: ShieldCheck, n: t.flagged_ips, label: 'flagged ips' },
  ] : [];

  const tabBtn = (id, label) => (
    <button role="tab" aria-selected={tab === id} className={'me-tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
      {label}
    </button>
  );

  return (
    <>
      {error && <p className="auth-error">{error}</p>}

      <div className="me-tabs" role="tablist">
      {tabBtn('overview', 'overview')}
      {tabBtn('users', `users (${users.length})`)}
      {tabBtn('ips', `ip clusters${clusters ? ` (${clusters.length})` : ''}`)}
      {tabBtn('status', 'status')}
      {tabBtn('mail', 'mail')}
      </div>

      {tab === 'overview' && (
        <>
          {pills.length > 0 && (
            <div className="dash-stats admin-stats">
              {pills.map(({ Icon, n, label }) => (
                <div className="stat-card" key={label}>
                  <Icon className="stat-icon" width="18" height="18" />
                  <span className="stat-num">{Number(n || 0).toLocaleString()}</span>
                  <span className="stat-label">{label}</span>
                </div>
              ))}
            </div>
          )}
          {stats && <MetricExplorer data={stats} title="Platform activity" defaultActive="signups" />}
        </>
      )}

      {tab === 'users' && (
        <>
          <label className="admin-search">
            <Search width="16" height="16" />
            <input type="search" placeholder="search email or ip" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="admin-user-list">
            {shown.map((u) => (
              <div key={u.id} className={'admin-user-card' + (u.suspended ? ' suspended' : '')}>
                <div className="admin-user-row">
                  <div className="admin-user-avatar">{(u.email[0] || '?').toUpperCase()}</div>
                  <div className="admin-user-info">
                    <div className="admin-user-email">
                      {u.email}
                      {u.is_admin && <span className="admin-badge admin">admin</span>}
                      {u.suspended && <span className="admin-badge suspended">suspended</span>}
                      {u.verified === false && <span className="admin-badge unverified">unverified</span>}
                    </div>
                    <div className="admin-user-meta">
                      {u.projects} project{u.projects === 1 ? '' : 's'}
                      {u.last_ip && <> · {u.last_ip}</>}
                      {' · joined '}{fmtDate(u.created_at)}
                    </div>
                  </div>
                </div>

                {!u.is_admin && (confirmId === u.id ? (
                  <div className="admin-confirm">
                    <p>Permanently delete <strong>{u.email}</strong> and all of their projects, secrets and store data?</p>
                    <div className="admin-actions">
                      <button className="cta-button ghost" onClick={() => setConfirmId(null)}>cancel</button>
                      <button className="cta-button danger" disabled={busyId === u.id} onClick={() => removeUser(u)}>
                        {busyId === u.id ? 'deleting…' : 'delete forever'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="admin-actions">
                    <button className={'cta-button ghost' + (u.suspended ? ' primary' : '')} disabled={busyId === u.id} onClick={() => toggleSuspend(u)}>
                      {u.suspended ? 'reinstate' : 'suspend'}
                    </button>
                    <button className="cta-button ghost danger" onClick={() => setConfirmId(u.id)}>
                      <Trash2 width="14" height="14" /> delete
                    </button>
                  </div>
                ))}
              </div>
            ))}
            {shown.length === 0 && <p className="me-total">No users match.</p>}
          </div>
        </>
      )}

      {tab === 'mail' && (
        <div className="dash-card">
          <h2>Send an email to your users</h2>
          <p className="team-hint">Goes to every verified, non-suspended account. Blank lines separate paragraphs.</p>
          <div className="broadcast-form">
            <input
              type="text"
              placeholder="Subject"
              value={mailSubject}
              maxLength={150}
              onChange={(e) => setMailSubject(e.target.value)}
            />
            <textarea
              rows={8}
              placeholder={'Hey everyone —\n\nNew in Dkit this week: …'}
              value={mailBody}
              maxLength={10000}
              onChange={(e) => setMailBody(e.target.value)}
            />
            {mailConfirm && (
              <div className="admin-confirm">
                <p>Send to all verified users now?</p>
                <div className="admin-actions">
                  <button className="cta-button ghost" onClick={() => setMailConfirm(false)}>cancel</button>
                  <button className="cta-button primary" disabled={mailSending} onClick={sendBroadcast}>
                    <Send width="14" height="14" /> {mailSending ? 'sending…' : 'send it'}
                  </button>
                </div>
              </div>
            )}
            {!mailConfirm && (
              <div className="broadcast-actions">
                <button className="cta-button primary" disabled={!mailSubject.trim() || !mailBody.trim() || mailSending} onClick={() => setMailConfirm(true)}>
                  <Send width="14" height="14" /> review & send
                </button>
                {mailBody.trim().length > 0 && <span className="team-hint">{mailBody.trim().length} chars</span>}
              </div>
            )}
            {mailResult && !mailResult.error && (
              <p className="team-hint">Sent to {mailResult.sent} of {mailResult.total}{mailResult.failed.length > 0 ? ' (failed: ' + mailResult.failed.join(', ') + ')' : ''}.</p>
            )}
            {mailResult?.error && <p className="auth-error">{mailResult.error}</p>}
          </div>
        </div>
      )}

      {tab === 'status' && <StatusAdminPanel token={token} />}

      {tab === 'ips' && (
        <div className="dash-card">
          {clusters && clusters.length === 0 && <p className="me-total">No multi-account IPs in the last 7 days.</p>}
          {clusters?.map((c) => (
            <div key={c.ip} className="ip-cluster">
              <div className="ip-cluster-head">
                <strong>{c.ip}</strong>
                <span>{c.accounts} accounts · latest {fmtDate(c.latest)}</span>
              </div>
              <div className="ip-cluster-emails">{c.emails.join(', ')}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
