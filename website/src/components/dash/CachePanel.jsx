import React, { useCallback, useEffect, useState } from 'react';
import { Zap, Trash2, RefreshCw, Copy, Check, Eye } from 'lucide-react';
import { api } from '../../lib/api';
import ConfirmBanner from './ConfirmBanner';
import './confirm-banner.css';

const TTL_OPTIONS = [
  { value: '', label: 'forever' },
  { value: '60', label: '1m' },
  { value: '300', label: '5m' },
  { value: '3600', label: '1h' },
  { value: '86400', label: '24h' },
  { value: '604800', label: '7d' },
];

function fmtTtl(ttl) {
  if (ttl === null || ttl === undefined) return 'no expiry';
  if (ttl < 60) return ttl + 's left';
  if (ttl < 3600) return Math.round(ttl / 60) + 'm left';
  if (ttl < 86400) return Math.round(ttl / 3600) + 'h left';
  return Math.round(ttl / 86400) + 'd left';
}

// Cache tab: the Redis-backed KV. Deliberately separate from the durable
// Postgres `store` — values here are plain strings, TTL-first and evictable.
export default function CachePanel({ token, project }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [prefix, setPrefix] = useState('');
  const [draft, setDraft] = useState({ key: '', value: '', ttl: '' });
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState(null); // { key, loading, value, ttl }
  const [copiedTag, setCopiedTag] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'key', key } | { kind: 'flush' }
  const [flushing, setFlushing] = useState(false);

  const load = useCallback(async (withPrefix = '') => {
    try {
      const data = await api.projectKvList(token, project.id, { prefix: withPrefix, limit: 500 });
      setKeys(data.keys || []);
      setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token, project.id]);

  useEffect(() => { setLoading(true); load(''); }, [load]);

  const save = async () => {
    const key = draft.key.trim();
    if (!key) { setError('Give the key a name first'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await api.projectKvSet(token, project.id, key, draft.value, draft.ttl ? Number(draft.ttl) : null);
      setDraft({ key: '', value: '', ttl: '' });
      await load(prefix);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const open = async (key) => {
    if (view?.key === key && !view.loading) { setView(null); return; }
    setView({ key, loading: true });
    try {
      const data = await api.projectKvGet(token, project.id, key);
      setView({ key, value: data.value, ttl: data.ttl, loading: false });
    } catch (err) { setView(null); setError(err.message); }
  };

  const copy = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTag(tag);
      setTimeout(() => setCopiedTag(''), 1200);
    } catch { /* clipboard unavailable */ }
  };

  const remove = async () => {
    if (!confirm?.key) return;
    try {
      await api.projectKvDelete(token, project.id, confirm.key);
      if (view?.key === confirm.key) setView(null);
      setConfirm(null);
      await load(prefix);
    } catch (err) { setError(err.message); }
  };

  const flush = async () => {
    setFlushing(true);
    try {
      const data = await api.projectKvFlush(token, project.id);
      setConfirm(null); setView(null);
      await load(prefix);
      setNotice('Flushed ' + data.deleted + ' key(s).');
    } catch (err) { setError(err.message); }
    finally { setFlushing(false); }
  };

  return (
    <div>
      <div className="secrets-toolbar">
        <input
          type="text"
          value={prefix}
          placeholder="filter by prefix…"
          aria-label="Filter cache keys by prefix"
          style={{ maxWidth: '15rem' }}
          onChange={(e) => setPrefix(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(prefix); }}
        />
        <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => load(prefix)}>
          <RefreshCw width="14" height="14" />
        </button>
        <span style={{ flex: 1 }} />
        <button className="cta-button ghost btn-sm" onClick={() => setConfirm({ kind: 'flush' })}>
          <Zap width="14" height="14" /> flush all
        </button>
      </div>

      <p className="page-header-sub" style={{ margin: '-0.25rem 0 0.9rem' }}>
        Redis-backed · plain strings, atomic counters, TTLs. Entries are <strong>evictable</strong> — keep the only copy of anything in <strong>store</strong>, not here.
      </p>

      <div className="kv-add-row store-add">
        <input
          type="text"
          placeholder="key (e.g. session:abc)"
          aria-label="Cache key"
          value={draft.key}
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
        />
        <textarea
          placeholder="value (text or JSON)"
          aria-label="Cache value"
          rows={1}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
        <span className="kv-add-actions">
          <select value={draft.ttl} onChange={(e) => setDraft({ ...draft, ttl: e.target.value })} aria-label="Time to live">
            {TTL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="cta-button primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'saving…' : 'cache'}
          </button>
        </span>
      </div>

      {error && <p className="auth-error">{error}</p>}
      {notice && <p className="page-header-sub">{notice}</p>}

      {loading && (
        <div className="store-table">
          <div className="store-head"><span>key</span><span>ttl</span><span /></div>
          {[0, 1, 2].map((i) => (
            <div className="store-row" key={i}><span className="stat-skel row-skel" /><span className="stat-skel row-skel wide" /><span /></div>
          ))}
        </div>
      )}

      {!loading && keys.length === 0 && (
        <div className="empty-state">
          <Zap width="22" height="22" />
          <p>No cache keys{prefix ? ' for this prefix' : ''}. Add one above — sessions, counters, flags, rendered fragments.</p>
        </div>
      )}

      {!loading && keys.length > 0 && (
        <div className="store-table">
          <div className="store-head"><span>key</span><span>ttl</span><span /></div>
          {keys.map((item) => (
            <div className="store-row" key={item.key}>
              <span className="store-key">{item.key}</span>
              <span className="store-meta">{fmtTtl(item.ttl)}</span>
              <span className="secrets-acts">
                <button className="icon-btn" aria-label="View value" title="View value" onClick={() => open(item.key)}>
                  <Eye width="14" height="14" />
                </button>
                <button className="icon-btn" aria-label="Copy key" title="Copy key" onClick={() => copy(item.key, 'kv-copy:' + item.key)}>
                  {copiedTag === 'kv-copy:' + item.key ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                </button>
                <button className="icon-btn icon-btn-danger" aria-label="Delete key" title="Delete" onClick={() => setConfirm({ kind: 'key', key: item.key })}>
                  <Trash2 width="14" height="14" />
                </button>
              </span>
              {view?.key === item.key && (
                <div className="store-preview">
                  <div className="store-preview-head">
                    <span><Eye width="12" height="12" /> value · {fmtTtl(view.ttl)}</span>
                    {!view.loading && (
                      <button className="icon-btn" title="Copy value" onClick={() => copy(view.value, 'kv-val:' + item.key)}>
                        {copiedTag === 'kv-val:' + item.key ? <Check width="13" height="13" /> : <Copy width="13" height="13" />}
                      </button>
                    )}
                  </div>
                  {view.loading ? <span className="stat-skel" style={{ width: '8rem' }} /> : <pre>{view.value}</pre>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirm?.kind === 'key' && (
        <ConfirmBanner
          prompt={'sudo rm ' + confirm.key}
          hint="Removes this cache entry. The durable store and every other key are untouched."
          onConfirm={remove}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === 'flush' && (
        <ConfirmBanner
          prompt={'sudo flush ' + project.name}
          hint={'Deletes all ' + keys.length + ' cache key(s) in this project. The durable store is untouched.'}
          onConfirm={flush}
          onCancel={() => setConfirm(null)}
        />
      )}
      {flushing && <p className="page-header-sub">Flushing…</p>}
    </div>
  );
}
