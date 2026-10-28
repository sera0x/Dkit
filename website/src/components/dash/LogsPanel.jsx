import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollText, Trash2, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import ConfirmBanner from './ConfirmBanner';
import './confirm-banner.css';

const fmtTime = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch { return ''; }
};

export default function LogsPanel({ token, project }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [line, setLine] = useState('');
  const [lineLevel, setLineLevel] = useState('info');
  const [sending, setSending] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const onKey = (e) => { if (e.key === 'Escape') setConfirmClear(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmClear]);
  const topRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.logsList(token, project.id, { level: level || undefined, search: search || undefined });
      setLogs(d.logs || []);
      setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token, project.id, level, search]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const ship = async () => {
    if (!line.trim()) return;
    setSending(true);
    try {
      let meta;
      const trimmed = line.trim();
      try { meta = trimmed.startsWith('{') ? JSON.parse(trimmed) : undefined; } catch { meta = undefined; }
      const events = [meta ? { message: trimmed, level: lineLevel, meta } : { message: trimmed, level: lineLevel, source: 'dashboard' }];
      await api.logsShip(token, project.id, events);
      setLine('');
      await load();
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    setClearing(true);
    try { await api.logsClear(token, project.id); await load(); }
    catch (err) { setError(err.message); }
    finally { setClearing(false); }
  };

  return (
    <>
      <div className="logs-toolbar">
        <div className="dash-filter">
          <Search className="filter-icon" width="14" height="14" />
          <input type="text" placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="logs-levels">
          {['', 'debug', 'info', 'warn', 'error'].map((lv) => (
            <button key={lv || 'all'} className={'env-tab' + (level === lv ? ' active' : '')} onClick={() => setLevel(lv)}>{lv || 'all'}</button>
          ))}
        </div>
        <span className="secrets-acts">
          <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={load}><RefreshCw width="14" height="14" /></button>
          <button className="icon-btn icon-btn-danger" aria-label="Clear all logs" title="Clear all" disabled={clearing} onClick={() => setConfirmClear(true)}>
            <Trash2 width="14" height="14" />
          </button>
        </span>
      </div>
      {confirmClear && (
        <ConfirmBanner prompt="sudo clear logs" hint="Deletes every entry in this project's drain. Retention won't bring them back." onConfirm={clearAll} onCancel={() => setConfirmClear(false)} />
      )}

      {error && <p className="auth-error">{error}</p>}
      {loading && logs.length === 0 ? (
        <div className="logs-stream">
          {[0, 1, 2].map((i) => <div className="logs-line skel" key={i}><span className="stat-skel row-skel wide" /></div>)}
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <ScrollText width="22" height="22" />
          <p>No logs{level || search ? ' matching the filter' : ''}. Ship events from your app, then tail them here:</p>
          <code>dkit logs:ship "deploy finished"</code>
        </div>
      ) : (
        <div className="logs-stream">
          {logs.map((log) => (
            <div className={'logs-line lvl-' + log.level} key={log.id}>
              <span className="logs-ts">{fmtTime(log.ts)}</span>
              <span className="logs-lvl">{log.level}</span>
              {log.source && <span className="logs-src">{log.source}</span>}
              <span className="logs-msg">{log.message}</span>
              {log.meta && <span className="logs-meta">{JSON.stringify(log.meta)}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="kv-add-row logs-add">
        <select className="ttl-input" value={lineLevel} onChange={(e) => setLineLevel(e.target.value)} aria-label="Log level">
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input type="text" placeholder="log a line from here (handy for testing)…" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ship(); }} />
        <button className="cta-button primary btn-sm" disabled={sending} onClick={ship}>{sending ? 'shipping…' : 'ship'}</button>
      </div>
    </>
  );
}
