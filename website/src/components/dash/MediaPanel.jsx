import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Trash2, RefreshCw, Copy, Check, Loader2, File as FileIcon } from 'lucide-react';
import { api } from '../../lib/api';
import ConfirmBanner from './ConfirmBanner';
import './confirm-banner.css';

const MAX_BYTES = 15 * 1024 * 1024; // server-side cap (MEDIA_MAX_BYTES)
const TTL_OPTIONS = [
  { value: '', label: 'forever' },
  { value: '900', label: '15m' },
  { value: '3600', label: '1h' },
  { value: '86400', label: '24h' },
  { value: '604800', label: '7d' },
];
const fmtSize = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
const isImage = (ct) => /^image\//.test(ct || '');

// Media CDN tab: upload screenshots/designs, get a Cloudflare-backed URL, or
// drop a temporary link (self-destructs) for testing. Files live in R2 —
// this panel is metadata only.
export default function MediaPanel({ token, project }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyNames, setBusyNames] = useState([]); // filenames mid-upload
  const [ttl, setTtl] = useState('');
  const [copied, setCopied] = useState(null);
  const [confirmKey, setConfirmKey] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => {
    if (!confirmKey) return;
    const onKey = (e) => { if (e.key === 'Escape') setConfirmKey(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmKey]);

  const load = useCallback(async () => {
    try {
      const d = await api.mediaList(token, project.id);
      setFiles(d.files || []);
      setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token, project.id]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const upload = async (inputFiles) => {
    if (!inputFiles || inputFiles.length === 0) return;
    const tooBig = inputFiles.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length === inputFiles.length) {
      setError(tooBig[0].name + ' is over 15 MB — split it or use a smaller file');
      return;
    }
    setBusyNames(inputFiles.map((f) => f.name));
    setError('');
    for (const f of inputFiles) {
      // Browser file.type is trusted only as a hint; a wrong one still uploads
      // as octet-stream, and the server re-validates the format anyway.
      if (f.size > MAX_BYTES) { setBusyNames((b) => b.filter((n) => n !== f.name)); setError(f.name + ' is over 15 MB'); continue; }
      try {
        await api.mediaUpload(token, project.id, f, ttl ? Number(ttl) : null);
      } catch (err) { setError(f.name + ': ' + err.message); }
      finally { setBusyNames((b) => b.filter((n) => n !== f.name)); }
    }
    if (inputRef.current) inputRef.current.value = '';
    await load();
  };

  const remove = async () => {
    const key = confirmKey;
    setConfirmKey(null);
    try {
      await api.mediaDelete(token, project.id, key);
      setFiles((prev) => prev.filter((f) => f.key !== key));
    } catch (err) { setError(err.message); }
  };

  const copy = (file) => {
    const url = window.location.origin + '/f/' + file.key;
    navigator.clipboard?.writeText(url);
    setCopied(file.key);
    setTimeout(() => setCopied((c) => (c === file.key ? null : c)), 1500);
  };

  return (
    <>
      <div className="logs-toolbar">
        <span className="env-chip" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ImageIcon width="12" height="12" /> files live in R2 storage, not this server
        </span>
        {busyNames.length > 0 && (
          <span className="media-busy"><Loader2 width="12" height="12" className="media-spin" /> uploading {busyNames[0]}</span>
        )}
        <span className="secrets-acts">
          <select className="ttl-input" value={ttl} onChange={(e) => setTtl(e.target.value)} aria-label="Default expiry for new uploads">
            {TTL_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="cta-button primary btn-sm" onClick={() => inputRef.current?.click()}>
            <Plus16 /> upload
          </button>
          <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={load}><RefreshCw width="14" height="14" /></button>
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
        aria-label="Choose files to upload"
      />
      {error && <p className="auth-error">{error}</p>}
      {confirmKey && (
        <ConfirmBanner
          prompt={'sudo rm ' + confirmKey}
          hint="Deletes the stored bytes — any link to this file stops working immediately."
          onConfirm={remove}
          onCancel={() => setConfirmKey(null)}
        />
      )}
      {loading && files.length === 0 ? (
        <div className="media-grid">
          {[0, 1, 2, 3].map((i) => <div className="media-card skel" key={i}><span className="stat-skel row-skel wide" /></div>)}
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <ImageIcon width="22" height="22" />
          <p>No files yet. Upload screenshots, images or anything you want a link for — or drop one over the CLI:</p>
          <code>dkit upload logo.png</code>
        </div>
      ) : (
        <div className="media-grid">
          {files.map((f) => (
            <div className="media-card" key={f.key}>
              <a className="media-thumb" href={'/f/' + f.key} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
                {isImage(f.content_type)
                  ? <img src={'/f/' + f.key} alt={f.filename} loading="lazy" decoding="async" />
                  : <span className="media-ext"><FileIcon width="22" height="22" />{(f.filename.split('.').pop() || 'file').toUpperCase()}</span>}
                {f.expires_at && <span className="media-ttl-chip">{new Date(f.expires_at) < new Date() ? 'expired' : 'temporary'}</span>}
              </a>
              <div className="media-meta">
                <span className="media-name" title={f.filename}>{f.filename}</span>
                <span className="media-sub">{fmtSize(f.byte_size)} · {f.hits} view{f.hits === 1 ? '' : 's'}</span>
              </div>
              <div className="media-acts">
                <button className="icon-btn" aria-label="Copy link" title="Copy link" onClick={() => copy(f)}>
                  {copied === f.key ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                </button>
                <button className="icon-btn icon-btn-danger" aria-label="Delete file" title="Delete" onClick={() => setConfirmKey(f.key)}>
                  <Trash2 width="14" height="14" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="media-hint">
        Ship files from the terminal too: <code>dkit upload img.png</code> keeps it, <code>dkit share img.png --ttl 15m</code> makes a self-destructing test link.
      </p>
    </>
  );
}
function Plus16() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}
