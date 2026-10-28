import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Trash2, Pause, Play } from 'lucide-react';
import { api } from '../../lib/api';
import ConfirmBanner from './ConfirmBanner';
import './confirm-banner.css';

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const STATUS_LABEL = { up: 'up', down: 'down', pending: 'pending' };

export default function MonitorsPanel({ token, project, userEmail }) {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [interval, setInterval] = useState('60');
  const [creating, setCreating] = useState(false);

  const [confirmTag, setConfirmTag] = useState('');
  const [confirmFor, setConfirmFor] = useState(null);
  useEffect(() => {
    if (!confirmFor) return;
    const onKey = (e) => { if (e.key === 'Escape') setConfirmFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmFor]);
  const armConfirm = (tag) => {
    setConfirmTag(tag);
    setTimeout(() => setConfirmTag((t) => (t === tag ? '' : t)), 6000);
  };

  const load = useCallback(async () => {
    try { const d = await api.monitorList(token, project.id); setMonitors(d.monitors || []); setError(''); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token, project.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const create = async () => {
    if (!name.trim() || !url.trim()) return;
    setCreating(true); setError('');
    try {
      await api.monitorCreate(token, project.id, {
        name: name.trim(), url: url.trim(), interval_seconds: Number(interval) || 60,
      });
      setName(''); setUrl(''); setInterval('60');
      await load();
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  };

  const togglePause = async (m) => {
    setBusy(m.id); setError('');
    try { await api.monitorUpdate(token, project.id, m.id, { paused: !m.paused }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const remove = async () => {
    if (confirmFor?.kind !== 'mon') return;
    setError('');
    try { await api.monitorDelete(token, project.id, confirmFor.item.id); setConfirmFor(null); await load(); }
    catch (err) { setError(err.message); }
  };

  const pausedCount = monitors.filter((m) => m.paused).length;

  const pauseAll = async () => {
    if (confirmTag !== 'mon-pause-all' && pausedCount !== monitors.length) { armConfirm('mon-pause-all'); return; }
    setConfirmTag('');
    setBusy('mon-pause-all'); setError('');
    try {
      for (const m of monitors.filter((x) => !x.paused)) {
        await api.monitorUpdate(token, project.id, m.id, { paused: true });
      }
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const resumeAll = async () => {
    setBusy('mon-pause-all'); setError('');
    try {
      for (const m of monitors.filter((x) => x.paused)) {
        await api.monitorUpdate(token, project.id, m.id, { paused: false });
      }
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const deleteAll = async () => {
    if (confirmFor?.kind !== 'all') return;
    setConfirmFor(null);
    setBusy('mon-delete-all'); setError('');
    try {
      for (const m of monitors) {
        await api.monitorDelete(token, project.id, m.id);
      }
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const statusDot = (m) => m.paused ? 'off' : m.status === 'up' ? 'ok' : m.status === 'down' ? 'err' : 'warn';

  return (
    <>
      {error && <p className="auth-error">{error}</p>}
      {loading ? (
        <div className="store-table">
          <div className="store-head"><span>monitor</span><span>status</span><span /></div>
          {[0, 1].map((i) => (
            <div className="store-row" key={i}><span className="stat-skel row-skel" /><span className="stat-skel row-skel wide" /><span /></div>
          ))}
        </div>
      ) : monitors.length === 0 ? (
        <div className="empty-state">
          <Activity width="22" height="22" />
          <p>Point one at a health endpoint. One email when it goes down, one when it recovers.</p>
        </div>
      ) : (
        <div className="store-table">
          <div className="store-head"><span>monitor</span><span>status</span><span /></div>
          {monitors.map((m) => (
            <div className="store-row" key={m.id}>
              <span className="store-key">
                <span className={'cron-dot ' + statusDot(m)} />
                {m.name}
                {m.paused && <span className="cron-paused">paused</span>}
              </span>
              <span className="store-meta meta-line">
                <span className={'status-pill ' + statusDot(m)}>{STATUS_LABEL[m.status] || m.status}</span>
                {m.last_latency_ms != null && <span>{m.last_latency_ms}ms</span>}
                <span>{m.last_checked_at ? fmtDate(m.last_checked_at) : 'first check soon'}</span>
                {m.url ? <span className="mon-url">{m.url.replace(/^https?:\/\//, '')}</span> : null}
              </span>
              <span className="secrets-acts">
                <button className="icon-btn" aria-label={m.paused ? 'Resume monitor' : 'Pause monitor'} title={m.paused ? 'Resume' : 'Pause'} disabled={busy === m.id} onClick={() => togglePause(m)}>
                  {m.paused ? <Play width="14" height="14" /> : <Pause width="14" height="14" />}
                </button>
                <button className="icon-btn icon-btn-danger" aria-label="Delete monitor" title="Delete" onClick={() => setConfirmFor({ kind: 'mon', item: m })}>
                  <Trash2 width="14" height="14" />
                </button>
              </span>
              {confirmFor?.kind === 'mon' && confirmFor.item.id === m.id && (
                <ConfirmBanner prompt={'sudo delete ' + m.name} hint="Removes the monitor and its check history. No more alerts from this URL." onConfirm={remove} onCancel={() => setConfirmFor(null)} />
              )}
              {m.last_error && (
                <div className="store-preview mon-error"><p className="auth-error">{m.last_error}</p></div>
              )}
            </div>
          ))}
        </div>
      )}

      <section className="form-section">
        <h2 className="form-title">New monitor</h2>
        <div className="field">
          <label htmlFor="mon-name">Name</label>
          <p className="field-hint">A unique name for this monitor.</p>
          <input id="mon-name" type="text" placeholder="api-prod" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mon-url">URL</label>
          <p className="field-hint">The health endpoint to check. You get one email when it goes down and one when it recovers.</p>
          <input id="mon-url" type="text" inputMode="url" autoCapitalize="none" placeholder="https://your-app.com/health" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mon-interval">Check every</label>
          <p className="field-hint">Seconds between checks, from 30 to 3600.</p>
          <input id="mon-interval" type="number" min="30" max="3600" placeholder="60" value={interval} onChange={(e) => setInterval(e.target.value)} />
        </div>
        <div className="form-actions">
          <button className="cta-button primary" disabled={creating} onClick={create}>{creating ? 'Creating…' : 'Create monitor'}</button>
        </div>
      </section>

      {monitors.length > 0 && (
        <div className="dash-card team-danger">
          <h2>{pausedCount === monitors.length ? 'Resume all monitors' : 'Pause all monitors'}</h2>
          <p className="team-hint">
            {pausedCount === monitors.length
              ? 'Resume every paused monitor in this project. Nothing is deleted.'
              : 'Stops probing every monitor in this project. State is kept, resume any time. Nothing is deleted.'}
          </p>
          <div className="form-actions">
            {pausedCount !== monitors.length && (
              <button
                className={'cta-button danger team-danger-btn' + (confirmTag === 'mon-pause-all' ? ' armed' : '')}
                disabled={busy === 'mon-pause-all'}
                onClick={pauseAll}
              >
                <Pause width="14" height="14" style={{ marginRight: '0.4rem' }} />
                {busy === 'mon-pause-all' ? 'pausing…' : confirmTag === 'mon-pause-all' ? 'click again to pause all ' + monitors.length : 'pause all ' + monitors.length}
              </button>
            )}
            {pausedCount > 0 && (
              <button
                className="cta-button primary"
                disabled={busy === 'mon-pause-all'}
                onClick={resumeAll}
              >
                <Play width="14" height="14" style={{ marginRight: '0.4rem' }} />
                {busy === 'mon-pause-all' ? 'working…' : 'resume all ' + pausedCount}
              </button>
            )}
          </div>
        </div>
      )}

      {monitors.length > 0 && (
        <div className="dash-card team-danger">
          <h2>Delete all monitors</h2>
          <p className="team-hint">Removes every monitor in this project and their check history.</p>
          <button
            className="cta-button danger team-danger-btn"
            disabled={busy === 'mon-delete-all'}
            onClick={() => setConfirmFor({ kind: 'all' })}
          >
            <Trash2 width="14" height="14" style={{ marginRight: '0.4rem' }} />
            {busy === 'mon-delete-all' ? 'deleting…' : 'delete all ' + monitors.length}
          </button>
          {confirmFor?.kind === 'all' && (
            <ConfirmBanner prompt="sudo delete all monitors" hint={'Removes all ' + monitors.length + ' monitors and their check history.'} onConfirm={deleteAll} onCancel={() => setConfirmFor(null)} />
          )}
        </div>
      )}
    </>
  );
}
