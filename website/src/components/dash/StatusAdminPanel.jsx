import React, { useCallback, useEffect, useState } from 'react';
import { Bell, RefreshCw, Wrench, ArrowUp, Activity, Plus, Check } from 'lucide-react';
import { api } from '../../lib/api';


const MODES = [
  { id: 'auto', label: 'auto', Icon: Activity, hint: 'prober decides' },
  { id: 'manual_up', label: 'force up', Icon: ArrowUp, hint: 'pinned green' },
  { id: 'manual_down', label: 'down / maintenance', Icon: Wrench, hint: 'checks paused' },
];

const IMPACTS = ['maintenance', 'minor', 'major', 'critical'];
const STATES = ['investigating', 'identified', 'monitoring'];

const fmt = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

export default function StatusAdminPanel({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [newInc, setNewInc] = useState({ service_id: '', title: '', message: '', impact: 'minor', state: 'investigating' });
  const [showNewInc, setShowNewInc] = useState(false);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    try { setData(await api.getAdminStatus(token)); setError(''); }
    catch (e) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (key, fn) => {
    setBusy(key); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }, [load]);

  const services = data?.services || [];
  const openIncidents = data?.open_incidents || [];
  const notifications = data?.notifications || [];

  const setDraft = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  return (
    <>
      {error && <p className="auth-error">{error}</p>}

      {}
      <div className="dash-card">
        <div className="status-admin-head">
          <h3><Bell width="15" height="15" /> Incident notifications</h3>
          {(data?.unseen_count || 0) > 0 && (
            <button className="cta-button ghost" disabled={!!busy} onClick={() => run('ack', () => api.ackStatusNotifications(token))}>
              <Check width="14" height="14" /> mark {data.unseen_count} seen
            </button>
          )}
        </div>
        {notifications.length === 0 && <p className="me-total">No automated incidents in the last 7 days.</p>}
        <div className="status-admin-notifs">
          {notifications.map((n) => (
            <div key={n.id} className={'status-admin-notif' + (n.seen_by_admin_at ? '' : ' unseen')}>
              <span className={'status-pill ' + (n.resolved_at ? 'ok' : 'err')} />
              <div className="status-admin-notif-body">
                <p><strong>{n.service_name || 'Platform'}</strong>: {n.title}</p>
                <span>{fmt(n.created_at)} · {n.resolved_at ? 'auto-resolved ' + fmt(n.resolved_at) : 'still open'}</span>
                {(n.updates || [])[0] && <em>{n.updates[0].message}</em>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {}
      <div className="dash-card">
        <div className="status-admin-head">
          <h3>Services</h3>
          <button className="cta-button ghost" onClick={load} disabled={!!busy}>
            <RefreshCw width="14" height="14" /> refresh
          </button>
        </div>
        <div className="status-admin-services">
          {services.map((s) => (
            <div key={s.id} className="status-admin-service">
              <div className="status-admin-service-info">
                <div className="status-admin-service-name">
                  <span className={'status-pill ' + (s.mode === 'manual_down' ? 'warn' : s.mode === 'manual_up' ? 'ok' : (s.status === 'up' ? 'ok' : s.status === 'down' ? 'err' : 'off'))} />
                  <strong>{s.name}</strong>
                  <span className="status-admin-url">{s.url}</span>
                </div>
                <span className="status-admin-meta">
                  probe: {s.last_checked_at ? fmt(s.last_checked_at) : 'never'}
                  {s.last_latency_ms != null && <> · {s.last_latency_ms} ms</>}
                  {s.last_error && <span className="status-admin-err"> · {s.last_error}</span>}
                </span>
              </div>
              <div className="status-admin-actions">
                <div className="status-mode-switch" role="group" aria-label={'Mode for ' + s.name}>
                  {MODES.map(({ id, label, hint }) => (
                    <button
                      key={id}
                      title={hint}
                      className={s.mode === id ? 'active' : ''}
                      disabled={!!busy}
                      onClick={() => run(s.id + id, () => api.setServiceMode(token, s.id, id))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="cta-button ghost"
                  disabled={!!busy}
                  title="Probe right now (runs even in manual modes)"
                  onClick={() => run(s.id + ':check', () => api.forceServiceCheck(token, s.id))}
                >
                  check now
                </button>
              </div>
            </div>
          ))}
          {services.length === 0 && <p className="me-total">No services seeded yet.</p>}
        </div>
      </div>

      {}
      <div className="dash-card">
        <div className="status-admin-head">
          <h3>Open incidents ({openIncidents.length})</h3>
          <button className="cta-button ghost" onClick={() => setShowNewInc((v) => !v)}>
            <Plus width="14" height="14" /> new incident
          </button>
        </div>

        {showNewInc && (
          <form
            className="status-admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              run('newinc', async () => {
                await api.createStatusIncident(token, {
                  service_id: newInc.service_id || null,
                  title: newInc.title,
                  message: newInc.message,
                  impact: newInc.impact,
                  state: newInc.state,
                });
                setNewInc({ service_id: '', title: '', message: '', impact: 'minor', state: 'investigating' });
                setShowNewInc(false);
              });
            }}
          >
            <select value={newInc.service_id} onChange={(e) => setNewInc({ ...newInc, service_id: e.target.value })} aria-label="Service">
              <option value="">Platform-wide (no single service)</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input required placeholder="Title, e.g. elevated API latency" value={newInc.title} onChange={(e) => setNewInc({ ...newInc, title: e.target.value })} />
            <textarea placeholder="What's happening? This posts as the first update." value={newInc.message} onChange={(e) => setNewInc({ ...newInc, message: e.target.value })} />
            <div className="status-admin-form-row">
              <select value={newInc.impact} onChange={(e) => setNewInc({ ...newInc, impact: e.target.value })} aria-label="Impact">
                {IMPACTS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <select value={newInc.state} onChange={(e) => setNewInc({ ...newInc, state: e.target.value })} aria-label="State">
                {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
              <button className="cta-button" type="submit" disabled={!!busy}>{busy === 'newinc' ? 'posting…' : 'post incident'}</button>
            </div>
          </form>
        )}

        <div className="status-admin-incidents">
          {openIncidents.map((inc) => {
            const draft = drafts[inc.id] || { state: 'monitoring', message: '' };
            return (
              <div key={inc.id} className="status-admin-incident">
                <div className="status-admin-incident-head">
                  <span className={'status-chip ' + (inc.state === 'monitoring' ? 'warn' : 'err')}>{inc.state}</span>
                  <strong>{inc.title}</strong>
                  {inc.service_name && <span className="status-inc-svc">{inc.service_name}</span>}
                  <span className="status-chip ghost">{inc.source}{inc.source === 'auto' ? ' (prober)' : ''}</span>
                </div>
                {(inc.updates || []).slice(-2).map((u) => (
                  <p key={u.id} className="status-admin-update"><em>{u.state}</em> {u.message} <time>{fmt(u.created_at)}</time></p>
                ))}
                <div className="status-admin-form status-admin-form-row">
                  <select value={draft.state} onChange={(e) => setDraft(inc.id, { state: e.target.value })} aria-label="Update state">
                    {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                    <option value="resolved">resolved</option>
                  </select>
                  <input
                    placeholder="Post an update…"
                    value={draft.message}
                    onChange={(e) => setDraft(inc.id, { message: e.target.value })}
                  />
                  <button
                    className="cta-button ghost"
                    disabled={!!busy}
                    onClick={() => run(inc.id + ':upd', async () => {
                      await api.addIncidentUpdate(token, inc.id, { state: draft.state, message: draft.message });
                      setDraft(inc.id, { message: '' });
                    })}
                  >
                    {draft.state === 'resolved' ? 'resolve' : 'post'}
                  </button>
                </div>
              </div>
            );
          })}
          {openIncidents.length === 0 && <p className="me-total">Nothing open. Nice.</p>}
        </div>
      </div>
    </>
  );
}
