import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Trash2, Play, Pause, History, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
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

const SCHEDULE_PLACEHOLDER = 'e.g. 5m, 2h, daily 09:30 (UTC)';

export default function CronPanel({ token, project }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [schedule, setSchedule] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [method, setMethod] = useState('AUTO');
  const [body, setBody] = useState('');
  const [headers, setHeaders] = useState([{ k: '', v: '' }]);
  const [creating, setCreating] = useState(false);

  const [openRuns, setOpenRuns] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);

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
    try { const d = await api.cronList(token, project.id); setJobs(d.jobs || []); setError(''); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token, project.id]);

  useEffect(() => { setLoading(true); setOpenRuns(null); load(); }, [load]);

  const setHeader = (i, patch) => setHeaders((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const addHeader = () => setHeaders((hs) => [...hs, { k: '', v: '' }]);
  const removeHeader = (i) => setHeaders((hs) => (hs.length === 1 ? [{ k: '', v: '' }] : hs.filter((_, j) => j !== i)));
  const headersObject = () => {
    const out = {};
    for (const { k, v } of headers) if (k.trim()) out[k.trim()] = v;
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const autoMethod = body.trim() ? 'POST' : 'GET';
  const effectiveMethod = method === 'AUTO' ? autoMethod : method;

  const create = async () => {
    if (!name.trim() || !url.trim() || !schedule.trim()) return;
    setCreating(true); setError('');
    try {
      await api.cronCreate(token, project.id, {
        name: name.trim(), url: url.trim(), schedule: schedule.trim(), method: effectiveMethod,
        body: body.trim() || undefined,
        headers: headersObject(),
      });
      setName(''); setUrl(''); setSchedule(''); setBody(''); setHeaders([{ k: '', v: '' }]);
      await load();
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  };

  const toggle = async (job) => {
    setBusy(job.id); setError('');
    try { await api.cronUpdate(token, project.id, job.id, { enabled: !job.enabled }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const runNow = async (job) => {
    setBusy('run:' + job.id); setError('');
    try { await api.cronRun(token, project.id, job.id); await load(); if (openRuns === job.id) await loadRuns(job.id); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const remove = async () => {
    if (confirmFor?.kind !== 'job') return;
    setError('');
    try { await api.cronDelete(token, project.id, confirmFor.item.id); setConfirmFor(null); await load(); }
    catch (err) { setError(err.message); }
  };

  const loadRuns = useCallback(async (jobId) => {
    setRunsLoading(true);
    try { const d = await api.cronRuns(token, project.id, jobId); setRuns(d.runs || []); }
    catch { setRuns([]); }
    finally { setRunsLoading(false); }
  }, [token, project.id]);

  const toggleRuns = async (jobId) => {
    if (openRuns === jobId) { setOpenRuns(null); return; }
    setOpenRuns(jobId);
    await loadRuns(jobId);
  };

  const pausedCount = jobs.filter((j) => !j.enabled).length;

  const pauseAll = async () => {
    if (confirmTag !== 'pause-all' && pausedCount !== jobs.length) { armConfirm('pause-all'); return; }
    setConfirmTag('');
    setBusy('pause-all'); setError('');
    try {
      for (const j of jobs.filter((x) => x.enabled)) {
        await api.cronUpdate(token, project.id, j.id, { enabled: false });
      }
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const resumeAll = async () => {
    setBusy('pause-all'); setError('');
    try {
      for (const j of jobs.filter((x) => !x.enabled)) {
        await api.cronUpdate(token, project.id, j.id, { enabled: true });
      }
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const deleteAll = async () => {
    if (confirmFor?.kind !== 'all') return;
    setConfirmFor(null);
    setBusy('delete-all'); setError('');
    try {
      for (const j of jobs) {
        await api.cronDelete(token, project.id, j.id);
      }
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  return (
    <>
      {error && <p className="auth-error">{error}</p>}
      {loading ? (
        <div className="store-table">
          <div className="store-head"><span>job</span><span>schedule</span><span /></div>
          {[0, 1].map((i) => (
            <div className="store-row" key={i}><span className="stat-skel row-skel" /><span className="stat-skel row-skel wide" /><span /></div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <Clock width="22" height="22" />
          <p>Schedule the API to call a URL on a timer, from here or the CLI.</p>
        </div>
      ) : (
        <div className="store-table">
          <div className="store-head"><span>job</span><span>schedule</span><span /></div>
          {jobs.map((job) => (
            <div className="store-row cron-row" key={job.id}>
              <span className="store-key">
                <span className={'cron-dot ' + (job.enabled ? (String(job.last_status || '').startsWith('ok') ? 'ok' : 'err') : 'off')} />
                {job.name}
                {!job.enabled && <span className="cron-paused">paused</span>}
              </span>
              <span className="store-meta meta-line">
                <span>{job.schedule}</span>
                <span>{job.method}</span>
                {job.headers && Object.keys(job.headers).length > 0 && <span>{Object.keys(job.headers).length} header{Object.keys(job.headers).length === 1 ? '' : 's'}</span>}
                {job.next_run_at && <span>next {fmtDate(job.next_run_at)}</span>}
                {job.last_status && (
                  <span className={'status-pill ' + (String(job.last_status).startsWith('ok') ? 'ok' : 'err')}>
                    {job.last_status}
                  </span>
                )}
              </span>
              <span className="secrets-acts">
                <button className="icon-btn" aria-label="Recent runs" title="Recent runs" onClick={() => toggleRuns(job.id)}>
                  {openRuns === job.id ? <ChevronUp width="14" height="14" /> : <History width="14" height="14" />}
                </button>
                <button className="icon-btn" aria-label="Run now" title="Run now" disabled={busy === 'run:' + job.id} onClick={() => runNow(job)}>
                  <Play width="14" height="14" />
                </button>
                <button className="icon-btn" aria-label={job.enabled ? 'Pause job' : 'Resume job'} title={job.enabled ? 'Pause' : 'Resume'} disabled={busy === job.id} onClick={() => toggle(job)}>
                  {job.enabled ? <Pause width="14" height="14" /> : <Play width="14" height="14" />}
                </button>
                <button className="icon-btn icon-btn-danger" aria-label="Delete job" title="Delete" onClick={() => setConfirmFor({ kind: 'job', item: job })}>
                  <Trash2 width="14" height="14" />
                </button>
              </span>
              {confirmFor?.kind === 'job' && confirmFor.item.id === job.id && (
                <ConfirmBanner prompt={'sudo delete ' + job.name} hint="Stops the schedule and deletes the job with its run history." onConfirm={remove} onCancel={() => setConfirmFor(null)} />
              )}
              {openRuns === job.id && (
                <div className="store-preview">
                  <div className="store-preview-head"><span><History width="12" height="12" /> recent runs</span></div>
                  {runsLoading && <span className="stat-skel" style={{ width: '8rem' }} />}
                  {!runsLoading && runs.length === 0 && <p className="page-header-sub">No runs recorded yet.</p>}
                  {!runsLoading && runs.map((r, i) => (
                    <div className="cron-run" key={i}>
                      <span className={'cron-run-status ' + (r.ok ? 'ok' : 'err')}>{r.ok ? 'ok' : 'fail'}</span>
                      <span className="store-meta">{fmtDate(r.started_at)} · {r.duration_ms || 0}ms{r.error ? ' · ' + r.error : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <section className="form-section">
        <div className="cron-form-head">
          <h2 className="form-title">New job</h2>
          <div className="env-tabs cron-mode-pick" role="group" aria-label="Form detail level">
            <button type="button" className={'env-tab' + (!advanced ? ' active' : '')} onClick={() => setAdvanced(false)}>common</button>
            <button type="button" className={'env-tab' + (advanced ? ' active' : '')} onClick={() => setAdvanced(true)}>advanced</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cron-name">Name</label>
          <p className="field-hint">A unique name for this job.</p>
          <input id="cron-name" type="text" placeholder="nightly-rollup" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cron-url">URL</label>
          <p className="field-hint">The endpoint Dkit calls each time the job runs.</p>
          <input id="cron-url" type="text" inputMode="url" autoCapitalize="none" placeholder="https://your-app.com/api/rollup" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cron-schedule">Schedule</label>
          <p className="field-hint">Every 30s, 5m or 2h, or at a time like daily 09:30 or mon 09:00. Times are UTC.</p>
          <input id="cron-schedule" type="text" placeholder="5m" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </div>
        {advanced && (
          <>
            <div className="field">
              <label htmlFor="cron-method">Method <span className="field-opt">auto: GET, or POST once a body is set</span></label>
              <select id="cron-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="AUTO">auto ({autoMethod})</option>
                <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cron-body">Body <span className="field-opt">Optional, sent for POST/PUT/PATCH/DELETE</span></label>
              <p className="field-hint">JSON sent with the request.</p>
              <textarea id="cron-body" rows={3} placeholder={'{"full": true}'} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="field">
              <label>Headers <span className="field-opt">Optional, sent with every run</span></label>
              <p className="field-hint">Custom request headers, like an auth token or a content type.</p>
              {headers.map((h, i) => (
                <div className="cron-header-row" key={i}>
                  <input type="text" placeholder="Header" autoCapitalize="none" value={h.k} onChange={(e) => setHeader(i, { k: e.target.value })} />
                  <input type="text" placeholder="Value" autoCapitalize="none" value={h.v} onChange={(e) => setHeader(i, { v: e.target.value })} />
                  <button type="button" className="icon-btn" aria-label="Remove header" onClick={() => removeHeader(i)}><X width="14" height="14" /></button>
                </div>
              ))}
              <button type="button" className="cta-button ghost btn-sm" onClick={addHeader}><Plus width="13" height="13" /> add header</button>
            </div>
          </>
        )}
        <div className="form-actions">
          <button className="cta-button primary" disabled={creating} onClick={create}>
            {creating ? 'Creating…' : advanced ? 'Create job (' + effectiveMethod + ')' : 'Create job'}
          </button>
        </div>
      </section>

      {jobs.length > 0 && (
        <div className="dash-card team-danger">
          <h2>{pausedCount === jobs.length ? 'Resume all jobs' : 'Pause all jobs'}</h2>
          <p className="team-hint">
            {pausedCount === jobs.length
              ? 'Resume every paused job in this project. Nothing is deleted.'
              : 'Pauses every job in this project. Schedules are kept, resume any time. Nothing is deleted.'}
          </p>
          <div className="form-actions">
            {pausedCount !== jobs.length && (
              <button
                className={'cta-button danger team-danger-btn' + (confirmTag === 'pause-all' ? ' armed' : '')}
                disabled={busy === 'pause-all'}
                onClick={pauseAll}
              >
                <Pause width="14" height="14" style={{ marginRight: '0.4rem' }} />
                {busy === 'pause-all' ? 'pausing…' : confirmTag === 'pause-all' ? 'click again to pause all ' + jobs.length : 'pause all ' + jobs.length}
              </button>
            )}
            {pausedCount > 0 && (
              <button
                className="cta-button primary"
                disabled={busy === 'pause-all'}
                onClick={resumeAll}
              >
                <Play width="14" height="14" style={{ marginRight: '0.4rem' }} />
                {busy === 'pause-all' ? 'working…' : 'resume all ' + pausedCount}
              </button>
            )}
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="dash-card team-danger">
          <h2>Delete all jobs</h2>
          <p className="team-hint">Removes every cron job in this project and their run history.</p>
          <button
            className="cta-button danger team-danger-btn"
            disabled={busy === 'delete-all'}
            onClick={() => setConfirmFor({ kind: 'all' })}
          >
            <Trash2 width="14" height="14" style={{ marginRight: '0.4rem' }} />
            {busy === 'delete-all' ? 'deleting…' : 'delete all ' + jobs.length}
          </button>
          {confirmFor?.kind === 'all' && (
            <ConfirmBanner prompt="sudo delete all jobs" hint={'Deletes all ' + jobs.length + ' jobs and their run history.'} onConfirm={deleteAll} onCancel={() => setConfirmFor(null)} />
          )}
        </div>
      )}
    </>
  );
}
