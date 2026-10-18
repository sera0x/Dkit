import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  LayoutGrid, KeyRound, Folder, Database, ShieldCheck,
  Eye, EyeOff, Copy, Check, ChevronLeft, Trash2, RotateCcw,
  Mail, Search, Plus, RefreshCw, Users, Clock, Activity, ScrollText, Download, Info, Smartphone,
} from 'lucide-react';
import AppShell from '../components/app/AppShell';
import QRCode from 'qrcode';
import MetricExplorer from '../components/dash/MetricExplorer';
import ActivityHeatmap from '../components/dash/ActivityHeatmap';
import AdminPanel from '../components/dash/AdminPanel';
import ConfirmBanner from '../components/dash/ConfirmBanner';
import '../components/dash/confirm-banner.css';
import TeamsPanel from '../components/dash/TeamsPanel';
import CronPanel from '../components/dash/CronPanel';
import MonitorsPanel from '../components/dash/MonitorsPanel';
import LogsPanel from '../components/dash/LogsPanel';
import { vault } from '../lib/api';
import { takeDashboardSection } from '../lib/pendingInvite';
import SuspendedNotice from '../components/ui/SuspendedNotice';
import CodeSlots from '../components/ui/CodeSlots';
import './dashboard.css';

const ENVIRONMENTS = ['production', 'staging', 'development'];

const NAV_ITEMS = [
  { id: 'overview', label: 'overview', Icon: LayoutGrid },
  { id: 'secrets', label: 'secrets', Icon: KeyRound },
  { id: 'cron', label: 'cron', Icon: Clock },
  { id: 'monitors', label: 'monitors', Icon: Activity },
  { id: 'projects', label: 'projects', Icon: Folder },
  { id: 'teams', label: 'teams', Icon: Users },
  { id: 'security', label: 'security', Icon: Smartphone },
  { id: 'admin', label: 'admin', Icon: ShieldCheck },
];

// Two-factor (TOTP) management: link QR, live-code confirmation, recovery
// codes shown once, and a disable path that demands the password plus a
// current code (a stolen browser session alone can't turn 2FA off).
function SecuritySection({ token }) {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null); // { secret, otpauth_url, qr }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api.twofaStatus(token).then(setStatus).catch((e) => setError(e.message || 'Could not load 2FA status'));
  }, [token]);
  useEffect(load, [load]);

  const startSetup = async () => {
    setBusy(true); setError('');
    try {
      const s = await api.twofaSetup(token);
      // Rendered locally on purpose: the otpauth URL embeds the TOTP secret,
      // and it never leaves the machine for a third-party QR service.
      const qr = await QRCode.toDataURL(s.otpauth_url, { margin: 1, width: 180 });
      setSetup({ ...s, qr });
    } catch (e) { setError(e.message || 'Setup failed'); } finally { setBusy(false); }
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.twofaEnable(token, code.trim());
      setStatus({ enabled: true });
      setRecoveryCodes(r.recovery_codes);
      setSetup(null); setCode('');
    } catch (e) { setError(e.message || 'Could not enable 2FA'); } finally { setBusy(false); }
  };

  const confirmDisable = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.twofaDisable(token, password, code.trim());
      setStatus({ enabled: false, unused_recovery_codes: 0 });
      setPassword(''); setCode(''); setNote('Two-factor disabled.');
    } catch (e) { setError(e.message || 'Could not disable 2FA'); } finally { setBusy(false); }
  };

  if (!status) return <p className="page-header-sub">Loading…</p>;

  return (
    <>
      <div className="form-section first">
        <h3 className="form-title">Two-factor authentication</h3>
        <p className="field-hint">
          A rotating 6-digit code from an authenticator app (Aegis, 1Password,
          Google Authenticator) on top of your password. Recovery codes let you
          back in if you lose the device.
        </p>
        {error && <p className="auth-error" style={{ margin: 0 }}>{error}</p>}
        {note && <p className="field-hint" style={{ color: 'var(--accent)' }}>{note}</p>}

        {status.enabled && (
          <p className="field-hint" style={{ margin: 0 }}>
            Enabled. {status.unused_recovery_codes} unused recovery code{status.unused_recovery_codes === 1 ? '' : 's'} left.
          </p>
        )}

        {!status.enabled && !setup && (
          <div className="form-actions">
            <button className="cta-button primary" disabled={busy} onClick={startSetup}>Set up 2FA</button>
          </div>
        )}

        {!status.enabled && setup && (
          <div style={{ display: 'grid', gap: '0.8rem', justifyItems: 'start' }}>
            <p className="field-hint" style={{ margin: 0 }}>Scan with your authenticator app, or paste the key:</p>
            <img src={setup.qr} alt="QR code with the Dkit two-factor secret" width="180" height="180"
              style={{ borderRadius: 8, background: '#fff', padding: 6 }} />
            <code style={{ fontSize: '0.8rem' }}>{setup.secret}</code>
            <form onSubmit={confirmEnable} style={{ display: 'grid', gap: '0.6rem', justifyItems: 'start' }}>
              <label className="field" style={{ gap: '0.3rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Enter the current 6-digit code</span>
                <input type="text" inputMode="numeric" autoComplete="one-time-code"
                  style={{ width: '10rem' }} value={code} maxLength={6}
                  onChange={(e) => setCode(e.target.value)} required />
              </label>
              <div className="form-actions">
                <button className="cta-button primary" type="submit" disabled={busy || code.trim().length !== 6}>Enable 2FA</button>
                <button className="cta-button ghost" type="button" onClick={() => { setSetup(null); setCode(''); setError(''); }}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {status.enabled && (
          <form onSubmit={confirmDisable} style={{ display: 'grid', gap: '0.6rem', justifyItems: 'start' }}>
            <label className="field" style={{ gap: '0.3rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Password</span>
              <input type="password" autoComplete="current-password" style={{ width: '14rem' }}
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <label className="field" style={{ gap: '0.3rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Current authenticator code</span>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                style={{ width: '10rem' }} value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <div className="form-actions">
              <button className="cta-button danger" type="submit" disabled={busy}>Turn off 2FA</button>
            </div>
          </form>
        )}
      </div>

      {recoveryCodes && (
        <div className="form-section">
          <h3 className="form-title">Recovery codes</h3>
          <p className="field-hint">Shown once. Each works once, in place of the authenticator code.</p>
          <div className="recovery-codes">
            {recoveryCodes.map((c) => <code key={c}>{c}</code>)}
          </div>
        </div>
      )}
    </>
  );
}

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const deviceLabel = (ua) => {
  if (!ua) return 'Unknown device';
  const osMatch = ua.match(/iPhone|iPad|Android|Windows|Mac OS X|Linux/i);
  const os = osMatch ? osMatch[0].replace('Mac OS X', 'macOS') : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return [browser, os].filter(Boolean).join(' on ');
};

const PageHeader = ({ Icon, title }) => (
  <div className="page-header">
    <div className="page-header-icon"><Icon width="18" height="18" /></div>
    <div>
      <h1>{title}</h1>
    </div>
  </div>
);

const maskKey = (key) => {
  if (!key) return '';
  if (key.length <= 10) return '••••••••';
  return key.slice(0, 6) + '…' + key.slice(-4);
};

const bullets = (v) => '•'.repeat(Math.max(4, Math.min(String(v ?? '').length, 16)));

export default function Dashboard({ onNavigate }) {
  const { user, token, refreshToken, logout } = useAuth();
  // Landing from elsewhere (e.g. right after accepting a team invite) can ask for a specific tab
  const [section, setSection] = useState(() => {
    const wanted = takeDashboardSection();
    return NAV_ITEMS.some((n) => n.id === wanted && n.id !== 'admin') ? wanted : 'overview';
  });
  const [teamInvites, setTeamInvites] = useState([]);
  const [suspended, setSuspended] = useState(false);
  const [isAdmin, setIsAdmin] = useState(!!user?.is_admin);
  // Admin notification feed for the status page: when automated probes open an
  // incident, the admin tab grows a dot and a banner appears here until seen.
  const [statusPing, setStatusPing] = useState(null); // { unseen_count } | null
  const [confirmTag, setConfirmTag] = useState('');
  const [confirmFor, setConfirmFor] = useState(null); // type-to-confirm banner target (deletions)
  const [copiedTag, setCopiedTag] = useState('');

  // account + projects
  const [verified, setVerified] = useState(true);
  const [checkingVerify, setCheckingVerify] = useState(true);
  const [codeStatus, setCodeStatus] = useState('idle');
  const verifyingRef = useRef(false);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [totals, setTotals] = useState(null);

  // Key vault: API keys are hashed server-side, so the browser only has what
  // the user deliberately saved here (shown once at create/rotate/paste).
  // Reveal + copy read from the vault; anything else honestly shows the prefix.
  const [keyVault, setKeyVault] = useState(() => vault.read());
  const [revealedApiKeys, setRevealedApiKeys] = useState(() => new Set());
  const [pasteFor, setPasteFor] = useState(null);   // project id awaiting a pasted key
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [rotatedKey, setRotatedKey] = useState(null); // { name, api_key } — shown once
  const [copyHint, setCopyHint] = useState('');       // project id whose copy needs a hint
  const [busyKeyOp, setBusyKeyOp] = useState(null);   // project id while issuing a key

  // selection + env vars
  const [selectedId, setSelectedId] = useState(null);
  const [environment, setEnvironment] = useState('production');
  const [envVars, setEnvVars] = useState({});
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState('');
  const [audit, setAudit] = useState([]);
  const [filter, setFilter] = useState('');
  const [revealedKeys, setRevealedKeys] = useState(() => new Set());
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [savingEnv, setSavingEnv] = useState(false);
  const [envImport, setEnvImport] = useState(null);   // { text, project, env, busy, status, error }

  // store
  const [storeItems, setStoreItems] = useState([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [newStoreKey, setNewStoreKey] = useState('');
  const [newStoreValue, setNewStoreValue] = useState('');
  const [newStoreTtl, setNewStoreTtl] = useState('');
  const [savingStore, setSavingStore] = useState(false);
  const [previewKey, setPreviewKey] = useState(null);
  const [previewValue, setPreviewValue] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // api keys
  // (revealedApiKeys moved up next to the vault state)

  // devices / sessions
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const selected = projects.find((p) => p.id === selectedId) || null;

  const flash = useCallback((tag) => {
    setCopiedTag(''); // clear so same tag re-triggers
    requestAnimationFrame(() => setCopiedTag(tag));
    setTimeout(() => setCopiedTag((t) => (t === tag ? '' : t)), 1400);
  }, []);

  const copyKey = (key, tag) => {
    navigator.clipboard?.writeText(key);
    if (tag) flash(tag);
  };

  const armConfirm = (tag) => {
    setConfirmTag(tag);
    setTimeout(() => setConfirmTag((t) => (t === tag ? '' : t)), 6000);
  };

  const loadVerification = useCallback(async () => {
    try { const data = await api.verificationStatus(token); setVerified(data.verified); }
    catch { setVerified(true); }
    finally { setCheckingVerify(false); }
  }, [token]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const data = await api.getProjects(token);
      const own = data.projects || [];
      // Projects shared into teams the user belongs to appear in the same
      // lists as their own — membership is the grant (env, store, cron,
      // monitors, logs all accept team members). Tagged for the UI.
      const shared = (data.shared_projects || [])
        .filter((sp) => !own.some((p) => p.id === sp.id))
        .map((sp) => ({ ...sp, is_shared: true }));
      setProjects([...own, ...shared]);
    }
    catch { setProjects([]); }
    finally { setLoadingProjects(false); }
  }, [token]);

  const loadTeamInvites = useCallback(async () => {
    try { setTeamInvites(await api.myTeamInvites(token)); }
    catch { setTeamInvites([]); }
  }, [token]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await api.getSessions(token, refreshToken)); }
    catch { setSessions([]); }
    finally { setSessionsLoading(false); }
  }, [token, refreshToken]);

  useEffect(() => { loadVerification(); loadProjects(); loadTeamInvites(); loadSessions(); }, [loadVerification, loadProjects, loadTeamInvites, loadSessions]);
  // Esc dismisses the type-to-confirm banner; navigating unmounts it (keyed section).
  useEffect(() => {
    if (!confirmFor) return;
    const onKey = (e) => { if (e.key === 'Escape') setConfirmFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmFor]);

  // Overview totals: one round-trip replaces the old per-project fanout
  // (which also silently under-counted: it used each project's api_key, which
  // the browser no longer has for hashed keys).
  useEffect(() => {
    let cancelled = false;
    api.getOverview(token)
      .then((d) => { if (!cancelled) setTotals(d.totals || null); })
      .catch(() => { if (!cancelled) setTotals(null); });
    return () => { cancelled = true; };
  }, [token, projects]);
  // Slow poll keeps "last active" fresh; sessions change rarely.
  useEffect(() => {
    const t = setInterval(loadSessions, 60000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Keep the session fresh without advertising admin status:
  // - /auth/me only tells us if the account is suspended (403)
  // - /admin/session tells us (privately) whether the admin tab should appear
  useEffect(() => {
    let cancelled = false;
    api.getSession(token)
      .catch((err) => { if (!cancelled && err.status === 403) setSuspended(true); });
    api.getAdminSession(token)
      .then(() => {
        if (cancelled) return;
        setIsAdmin(true);
        // Status notifications piggyback on the admin probe — regular users
        // never learn this endpoint exists.
        api.getAdminStatus(token)
          .then((d) => { if (!cancelled) setStatusPing(d?.unseen_count ? { unseen_count: d.unseen_count } : null); })
          .catch(() => { if (!cancelled) setStatusPing(null); });
      })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [token]);

  // (old per-project count fanout removed — /api/overview handles it)

  const toggleApiKeyReveal = (p) => {
    const saved = keyVault[p.id];
    if (!saved) { setPasteFor(p.id); setPasteValue(''); setPasteError(''); return; } // no key saved → offer paste
    setRevealedApiKeys((prev) => {
      const next = new Set(prev);
      next.has(p.id) ? next.delete(p.id) : next.add(p.id);
      return next;
    });
  };

  const savePastedKey = async (p) => {
    setPasteError('');
    const key = pasteValue.trim();
    if (!key) return;
    try {
      const res = await api.verifyProjectKey(token, p.id, key);
      if (!res.matches) { setPasteError('That key does not match this project.'); return; }
      vault.save(p.id, key);
      setKeyVault(vault.read());
      setPasteFor(null); setPasteValue('');
    } catch (err) { setPasteError(err.message); }
  };

  const copyProjectKey = (p) => {
    const saved = keyVault[p.id];
    if (!saved) { setCopyHint(p.id); setTimeout(() => setCopyHint((t) => (t === p.id ? '' : t)), 2600); return; }
    navigator.clipboard?.writeText(saved);
    flash('api:' + p.id);
  };

  const resendCode = async () => {
    setVerifyMsg(''); setVerifyError('');
    try { await api.sendVerification(token); setVerifyMsg('New code sent.'); }
    catch (err) { setVerifyError(err.message); }
  };

  // Auto-submitted by CodeSlots onComplete with the just-completed code, or by
  // the button as a manual fallback. verifyingRef guards double submits.
  const submitVerify = async (value) => {
    if (verifyingRef.current || !/^\d{6}$/.test(value)) return;
    verifyingRef.current = true;
    setVerifyMsg(''); setVerifyError('');
    try {
      await api.verifyEmail(token, value);
      setVerified(true); setVerifyMsg('Email verified.'); loadTeamInvites();
    } catch (err) {
      verifyingRef.current = false;
      setVerifyError(err.message);
      setCodeStatus('error'); // CodeSlots drains the digits and clears itself
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault(); setCreateError(''); setCreating(true);
    try {
      const project = await api.createProject(token, newName);
      setProjects((prev) => [project, ...prev]);
      setNewName('');
      if (project.api_key) {
        // The plaintext key exists exactly once. Save it to this browser's vault
        // (so reveal/copy work here) and show it with a copy button — after this,
        // only a hash lives server-side.
        vault.save(project.id, project.api_key);
        setKeyVault(vault.read());
        setRotatedKey({ name: project.name, api_key: project.api_key });
      }
      // Land straight in the new project's secrets — that's the usual next step.
      setSection('secrets');
      setSelectedId(project.id);
      loadEnvVars(project, environment);
    }
    catch (err) { setCreateError(err.message); }
    finally { setCreating(false); }
  };

  const deleteProject = async () => {
    if (!confirmFor) return;
    setCreateError('');
    try {
      await api.deleteProject(token, confirmFor.project.id);
      setProjects((prev) => prev.filter((x) => x.id !== confirmFor.project.id));
      if (selectedId === confirmFor.project.id) setSelectedId(null);
      setConfirmFor(null);
    } catch (err) { setCreateError(err.message); }
  };

  const createApiKey = async (p) => {
    setBusyKeyOp(p.id);
    setCreateError('');
    try {
      const res = await api.createProjectApiKey(token, p.id);
      setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, key_prefix: res.key_prefix, key_rotated_at: res.key_rotated_at } : x)));
      // Same one-time contract as create/rotate: vault it so reveal/copy work
      // in this browser, and show it once on the banner.
      vault.save(p.id, res.api_key);
      setKeyVault(vault.read());
      setRotatedKey({ name: res.name || p.name, api_key: res.api_key });
    } catch (err) { setCreateError(err.message); }
    finally { setBusyKeyOp(null); }
  };

  // Single-tap revoke: no confirm step, the key dies immediately.
  // Recovery is one click (create key) since the project just goes keyless.
  const revokeApiKey = async (p) => {
    setCreateError('');
    try {
      await api.revokeProjectApiKey(token, p.id);
      setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, key_prefix: null, key_rotated_at: new Date().toISOString() } : x)));
      vault.forget(p.id); // the old key is dead — drop it from this browser too
      setKeyVault(vault.read());
      setRevealedApiKeys((prev) => { const next = new Set(prev); next.delete(p.id); return next; });
    } catch (err) { setCreateError(err.message); }
  };

  const revokeSession = async (s) => {
    if (confirmTag !== 'session:' + s.id) { armConfirm('session:' + s.id); return; }
    try {
      await api.revokeSession(token, s.id);
      if (s.current) { logout(); onNavigate('/'); } // revoked THIS device
      else { setConfirmTag(''); loadSessions(); }
    } catch (err) { setCreateError(err.message); }
  };

  const revokeOthers = async () => {
    try { await api.revokeOtherSessions(token, refreshToken); loadSessions(); }
    catch (err) { setCreateError(err.message); }
  };

  // Project-scoped calls go out with the session (Bearer + x-project-id).
  // The old code passed project.api_key — undefined for hashed keys — which is
  // why secrets/store silently broke for every new project.
  const loadEnvVars = useCallback(async (project, env) => {
    setEnvLoading(true); setEnvError('');
    try { const data = await api.projectEnv(token, project.id, env); setEnvVars(data.env || {}); }
    catch (err) { setEnvVars({}); setEnvError(err.message); }
    finally { setEnvLoading(false); }
    // Audit feed rides along so it stays fresh after add/delete/rollback
    try { const a = await api.getAudit(token, project.id); setAudit(a.events || []); }
    catch { setAudit([]); }
  }, [token]);

  const loadStore = useCallback(async (project) => {
    setStoreLoading(true); setStoreError(''); setPreviewKey(null); setPreviewValue(null);
    try { const data = await api.projectStore(token, project.id); setStoreItems(data.keys || []); }
    catch (err) { setStoreItems([]); setStoreError(err.message); }
    finally { setStoreLoading(false); }
  }, [token]);

  // Projects shared into a team render under that team's name (the container
  // they belong to); personal projects sit below under "Your projects". A
  // project shared into several teams shows once, under its first team.
  const projectGroups = useMemo(() => {
    const groups = [];
    const byTeam = new Map();
    const seen = new Set();
    for (const p of projects) {
      if (!p.is_shared || seen.has(p.id)) continue;
      seen.add(p.id);
      const team = String(p.team_names || 'Shared').split(', ')[0];
      if (!byTeam.has(team)) {
        const g = { name: team, items: [] };
        byTeam.set(team, g);
        groups.push(g);
      }
      byTeam.get(team).items.push(p);
    }
    const personal = projects.filter((p) => !p.is_shared);
    if (personal.length > 0) groups.push({ name: null, items: personal });
    return groups;
  }, [projects]);

  const renderProjectRow = (p) => {
    const saved = keyVault[p.id];
    const revealed = revealedApiKeys.has(p.id) && saved;
    return (
      <div key={p.id} className="project-row">
        <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
        <span className="project-name">{p.name}</span>
        {p.is_shared && (
          <span className="shared-chip" title={'Shared by ' + (p.owner_email || 'a teammate') + (p.team_names ? ' (via ' + p.team_names + ')' : '')}>
            shared
          </span>
        )}
        <code className="project-key" title={p.key_prefix ? (saved ? 'Saved in this browser\'s key vault' : 'Key not saved in this browser: tap the eye to add it') : 'No API key yet. Dashboard access works without one; create a key for CLI/API use'}>
          {p.key_prefix ? (revealed ? saved : p.key_prefix + '…') : 'no api key'}
        </code>
        <span className="secrets-acts">
          {!p.key_prefix && (
            <button className="cta-button ghost btn-sm" aria-label="Create API key" title="Create an API key (shown once, stored hashed)" disabled={busyKeyOp === p.id} onClick={() => createApiKey(p)}>
              <KeyRound width="13" height="13" /> create key
            </button>
          )}
          {!!p.key_prefix && (
            <button className="icon-btn" aria-label={revealed ? 'Hide API key' : 'Show API key'} title={revealed ? 'Hide' : saved ? 'Show' : 'Key not saved here — click to paste it once'} onClick={() => toggleApiKeyReveal(p)}>
              {revealed ? <EyeOff width="14" height="14" /> : <Eye width="14" height="14" />}
            </button>
          )}
          {!!p.key_prefix && (
            <button className="icon-btn" aria-label="Copy API key" title={saved ? 'Copy key' : 'Key not saved in this browser: click the eye to paste it once'} onClick={() => copyProjectKey(p)}>
              {copiedTag === 'api:' + p.id ? <Check width="14" height="14" /> : copyHint === p.id ? <Info width="14" height="14" /> : <Copy width="14" height="14" />}
            </button>
          )}
          {!p.is_shared && !!p.key_prefix && (
            <button className="icon-btn icon-btn-danger" aria-label="Revoke API key" title="Revoke key: CLI/API access is cut off until a new key is created" onClick={() => revokeApiKey(p)}>
              <RotateCcw width="14" height="14" />
            </button>
          )}
          {!p.is_shared && (
            <button className="icon-btn icon-btn-danger" aria-label="Delete project" title="Delete" onClick={() => setConfirmFor({ kind: 'project', project: p })}>
              <Trash2 width="14" height="14" />
            </button>
          )}
        </span>
        {confirmFor?.kind === 'project' && confirmFor.project.id === p.id && (
          <ConfirmBanner
            prompt={'sudo delete ' + p.name}
            hint={'Deletes ' + p.name + ' and every secret, store key, cron job, monitor and log in it. There’s no undo.'}
            onConfirm={deleteProject}
            onCancel={() => setConfirmFor(null)}
          />
        )}
        {pasteFor === p.id && (
          <div className="paste-key-row">
            <p className="paste-key-hint">
              {p.is_shared
                ? 'Keys are stored hashed, so Dkit can never show one, not even to the owner. Paste the key shared with you once; it stays in this browser only.'
                : 'Keys are stored hashed, so Dkit can never show one, not even yours. Paste the key from when you created it, or rotate to get a new one.'}
            </p>
            <input
              type="text"
              placeholder="dk_…"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') savePastedKey(p); }}
              autoFocus
            />
            <button className="cta-button primary btn-sm" onClick={() => savePastedKey(p)}>save to vault</button>
            <button className="breadcrumb-back" onClick={() => { setPasteFor(null); setPasteValue(''); setPasteError(''); }}>cancel</button>
          </div>
        )}
        {pasteFor === p.id && pasteError && <p className="auth-error" style={{ width: '100%' }}>{pasteError}</p>}
        {copyHint === p.id && (
          <p className="page-header-sub" style={{ width: '100%' }}>
            {p.is_shared
              ? 'No key saved in this browser. Click the eye to paste the one that was shared with you.'
              : 'Key not saved in this browser. Click the eye to paste it once, or rotate to get a new key.'}
          </p>
        )}
      </div>
    );
  };

  const pickProject = (p) => {
    setSelectedId(p.id);
    setRevealedKeys(new Set());
    setFilter('');
    setRotatedKey(null); // the one-time key banner belongs to the project it came from
    loadEnvVars(p, environment);
    loadStore(p);
  };

  // Open a project by id (own or team-shared) — used by the Teams tab's
  // tappable shared-project rows.
  const openProjectById = (id) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    pickProject(p);
    setSection('secrets');
  };

  const changeEnvironment = (project, env) => {
    setEnvironment(env);
    setRevealedKeys(new Set());
    loadEnvVars(project, env);
  };

  const toggleReveal = (key) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const addEnvVar = async (project) => {
    if (!newEnvKey.trim()) return;
    setSavingEnv(true); setEnvError('');
    try {
      await api.projectEnvSet(token, project.id, newEnvKey.trim(), newEnvValue, environment);
      setNewEnvKey(''); setNewEnvValue('');
      await loadEnvVars(project, environment);
    } catch (err) { setEnvError(err.message); }
    finally { setSavingEnv(false); }
  };

  // Paste a .env file (or any KEY=value lines) straight into the project.
  const importEnvFile = async (project) => {
    const text = (envImport?.text || '').trim();
    if (!text) return;
    const pairs = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (key) pairs.push({ key, value });
    }
    if (pairs.length === 0) { setEnvImport((s) => ({ ...s, error: 'No KEY=value lines found.' })); return; }
    setEnvImport((s) => ({ ...s, busy: true, error: '', status: null }));
    try {
      const r = await api.projectEnvImport(token, project.id, pairs, envImport.env);
      setEnvImport((s) => ({ ...s, busy: false, text: '', status: 'Imported ' + r.imported + ' variable' + (r.imported === 1 ? '' : 's') + '.' }));
      await loadEnvVars(project, envImport.env);
    } catch (err) {
      setEnvImport((s) => ({ ...s, busy: false, error: err.message }));
    }
  };

  const deleteEnvVar = async () => {
    if (!confirmFor) return;
    setEnvError('');
    try {
      await api.projectEnvDelete(token, confirmFor.project.id, confirmFor.key, environment);
      setConfirmFor(null); setRevealedKeys((prev) => { const next = new Set(prev); next.delete(confirmFor.key); return next; });
      await loadEnvVars(confirmFor.project, environment);
    } catch (err) { setEnvError(err.message); }
  };

  const rollbackEnvVar = async (project, key) => {
    setEnvError('');
    try { await api.projectEnvRollback(token, project.id, key, environment); await loadEnvVars(project, environment); }
    catch (err) { setEnvError(err.message); }
  };

  const downloadEnv = async (project) => {
    setEnvError('');
    try { await api.envDownload(token, project.id, environment); }
    catch (err) { setEnvError(err.message); }
  };

  const addStoreItem = async (project) => {
    if (!newStoreKey.trim()) return;
    setSavingStore(true); setStoreError('');
    let value = newStoreValue;
    try { value = JSON.parse(newStoreValue); } catch { value = newStoreValue; }
    const ttl = newStoreTtl.trim() === '' ? undefined : Number(newStoreTtl);
    try {
      await api.projectStoreSet(token, project.id, newStoreKey.trim(), value, ttl);
      setNewStoreKey(''); setNewStoreValue(''); setNewStoreTtl('');
      await loadStore(project);
    } catch (err) { setStoreError(err.message); }
    finally { setSavingStore(false); }
  };

  const deleteStoreItem = async () => {
    if (!confirmFor) return;
    setStoreError('');
    try {
      await api.projectStoreDelete(token, confirmFor.project.id, confirmFor.key);
      setConfirmFor(null);
      if (previewKey === confirmFor.key) { setPreviewKey(null); setPreviewValue(null); }
      await loadStore(confirmFor.project);
    } catch (err) { setStoreError(err.message); }
  };

  const togglePreview = async (project, key) => {
    if (previewKey === key) { setPreviewKey(null); setPreviewValue(null); setPreviewError(''); return; }
    setPreviewKey(key); setPreviewValue(null); setPreviewError(''); setPreviewLoading(true);
    try {
      const value = await api.projectStoreGet(token, project.id, key);
      setPreviewValue(value);
    } catch (err) { setPreviewError(err.message); }
    finally { setPreviewLoading(false); }
  };

  const incrementStore = async (project, key) => {
    try {
      const res = await api.projectStoreIncrement(token, project.id, key, 1);
      if (previewKey === key) setPreviewValue(res.value);
    } catch (err) { setPreviewError(err.message); }
  };

  const visibleEnv = Object.entries(envVars).filter(([k]) => k.toLowerCase().includes(filter.toLowerCase()));
  const isNumeric = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));

  const navButtons = () => (
    <>
      {NAV_ITEMS.filter(({ id }) => id !== 'admin' || isAdmin).map(({ id, label, Icon }) => (
        <button key={id} className={'dash-nav-item' + (section === id ? ' active' : '')} onClick={() => setSection(id)}>
          <Icon width="16" height="16" /> {label}
          {id === 'teams' && teamInvites.length > 0 && <span className="nav-badge" aria-label={teamInvites.length + ' pending invitations'}>{teamInvites.length}</span>}
          {id === 'admin' && statusPing && <span className="nav-badge alert" aria-label={statusPing.unseen_count + ' unseen incident notifications'} />}
        </button>
      ))}
      {/* Pick the project once, here — every section follows. No more
          re-picking inside Secrets, Cron, Monitors, Logs, Store. */}
      {projects.length > 0 && (
        <div className="project-picker-side">
          <span className="project-picker-title">Projects</span>
          {projects.slice(0, 8).map((p) => (
            <button
              key={p.id}
              className={'dash-nav-item project-side-item' + (selectedId === p.id ? ' active' : '')}
              title={p.is_shared ? 'shared by ' + (p.owner_email || 'a teammate') : p.name}
              onClick={() => { pickProject(p); setSection('secrets'); }}
            >
              <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
              <span className="project-side-name">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  if (suspended) return <SuspendedNotice onNavigate={onNavigate} />;

  return (
    <AppShell active="dashboard" onNavigate={onNavigate} primaryNav={navButtons()}>
      {/* key={section} remounts on section change so the enter transition plays */}
      <div className="dash-section" key={section} onKeyDown={(e) => { if (e.key === 'Escape') setConfirmFor(null); }}>
      {statusPing && (
        <button className="status-alert-banner" role="alert" onClick={() => { setSection('admin'); setStatusPing(null); }}>
          <strong>{statusPing.unseen_count} service issue{statusPing.unseen_count === 1 ? '' : 's'} detected</strong>
          <span>open the admin tab to review, or view the public status page.</span>
        </button>
      )}
      {rotatedKey && (
        <div className="rotated-key-banner" role="alert">
          <div className="rotated-key-head">
            <Info width="15" height="15" />
            <span><strong>{rotatedKey.name}</strong>: save this API key now, it won't be shown again.</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setRotatedKey(null)}><Trash2 width="14" height="14" /></button>
          </div>
          <div className="run-strip rotated-strip">
            <code>{rotatedKey.api_key}</code>
            <button className="icon-btn" aria-label="Copy API key" onClick={() => { navigator.clipboard?.writeText(rotatedKey.api_key); flash('rotated-banner'); }}>
              {copiedTag === 'rotated-banner' ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
            </button>
          </div>
        </div>
      )}
      {!checkingVerify && !verified && (
            <div className="verify-banner">
              <Mail className="verify-banner-icon" width="18" height="18" />
              <div className="verify-banner-body">
                <p>Verify your email to create projects.</p>
                <div className="verify-form">
                  <CodeSlots
                    length={6}
                    autoFocus
                    onComplete={submitVerify}
                    status={codeStatus}
                    ariaLabel="Verification code"
                    accentColor="#39ff88"
                    inkColor="#39ff88"
                    slotColor="#10130f"
                    digitColor="#04130a"
                    dangerColor="#ff3b30"
                    slotSize={40}
                  />
                  <button type="button" className="auth-link-button" onClick={resendCode}>resend code</button>
                </div>
                {verifyMsg && <p className="auth-hint">{verifyMsg}</p>}
                {verifyError && <p className="auth-error">{verifyError}</p>}
              </div>
            </div>
          )}

          {section === 'overview' && (
            <div className="legacy-ui">
              <PageHeader Icon={LayoutGrid} title="Overview" />
              <div className="dash-stats">
                <div className="stat-card">
                  <Folder className="stat-icon" width="18" height="18" />
                  {loadingProjects ? <span className="stat-skel" /> : <span className="stat-num">{projects.length}</span>}
                  <span className="stat-label">projects</span>
                </div>
                <div className="stat-card">
                  <KeyRound className="stat-icon" width="18" height="18" />
                  {totals === null ? <span className="stat-skel" /> : <span className="stat-num">{totals.env}</span>}
                  <span className="stat-label">env vars</span>
                </div>
                <div className="stat-card">
                  <Database className="stat-icon" width="18" height="18" />
                  {totals === null ? <span className="stat-skel" /> : <span className="stat-num">{totals.store}</span>}
                  <span className="stat-label">store keys</span>
                </div>
                <div className="stat-card">
                  <Clock className="stat-icon" width="18" height="18" />
                  {totals === null ? <span className="stat-skel" /> : <span className="stat-num">{totals.cron}</span>}
                  <span className="stat-label">cron jobs</span>
                </div>
                <div className="stat-card">
                  <Activity className="stat-icon" width="18" height="18" />
                  {totals === null ? <span className="stat-skel" /> : <span className="stat-num">{totals.monitors}</span>}
                  <span className="stat-label">monitors</span>
                </div>
              </div>
              <MetricExplorer />
              <ActivityHeatmap />
              <div className="dash-card">
                <h2>Run it</h2>
                <div className="run-strip">
                  <code>dkit run -- npm start</code>
                  <button className="icon-btn" aria-label="Copy command" onClick={() => copyKey('dkit run -- npm start', 'run')}>
                    {copiedTag === 'run' ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                  </button>
                </div>
                <div className="run-strip">
                  <code>dkit new my-app --template express-pg</code>
                  <button className="icon-btn" aria-label="Copy command" onClick={() => copyKey('dkit new my-app --template express-pg', 'new')}>
                    {copiedTag === 'new' ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                  </button>
                </div>
              </div>
              {projects.length > 0 && (
                <div className="dash-card" style={{ marginTop: '1rem' }}>
                  <h2>Quick access</h2>
                  <div className="project-picker">
                    {projects.map((p) => (
                      <button key={p.id} className="project-pick" onClick={() => { setSection('secrets'); pickProject(p); }}>{p.name}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="dash-card" style={{ marginTop: '1rem' }}>
                <h2>Devices</h2>
                <p className="page-header-sub">Everywhere this account is signed in. Revoking signs that device out.</p>
                {sessionsLoading ? (
                  <div className="project-row skel-row"><span className="stat-skel row-skel wide" /></div>
                ) : (
                  <>
                    {sessions.map((s) => (
                      <div key={s.id} className="session-row">
                        <span className="session-name">{deviceLabel(s.user_agent)}{s.current ? ' (this device)' : ''}</span>
                        <span className="store-meta">{s.last_ip || '—'} · active {fmtDate(s.last_used_at)}</span>
                        <span className="secrets-acts">
                          <button
                            className={'icon-btn' + (confirmTag === 'session:' + s.id ? ' icon-btn-confirm' : ' icon-btn-danger')}
                            aria-label="Revoke device"
                            title={confirmTag === 'session:' + s.id ? 'Click again to revoke' : 'Revoke'}
                            onClick={() => revokeSession(s)}
                          >
                            <Trash2 width="14" height="14" />
                          </button>
                        </span>
                      </div>
                    ))}
                    {sessions.length > 1 && (
                      <div className="project-row" style={{ border: '1px dashed var(--border)', justifyContent: 'center', gridTemplateColumns: 'auto auto', background: 'transparent' }}>
                        <RefreshCw width="14" height="14" style={{ color: 'var(--text-muted)' }} />
                        <button className="breadcrumb-back" onClick={revokeOthers}>revoke other devices</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {section === 'secrets' && (
            <>
              <PageHeader Icon={KeyRound} title="Secrets" />
              {!selected ? (
                projects.length === 0 ? (
                  <div className="empty-state">
                    <KeyRound width="22" height="22" />
                    <p>Create a project, then add its environment variables here.</p>
                    <button className="cta-button ghost" onClick={() => setSection('projects')}>Create a project</button>
                  </div>
                ) : (
                  <>
                    <p className="page-header-sub" style={{ marginBottom: '1rem' }}>Pick a project, or select it once in the sidebar and it follows you everywhere.</p>
                    <div className="project-picker">
                      {projects.map((p) => (
                        <button key={p.id} className="project-pick" onClick={() => pickProject(p)}>
                          <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <>
                  <div className="secrets-toolbar">
                    <button className="breadcrumb-back" onClick={() => setSelectedId(null)}><ChevronLeft width="14" height="14" /> projects</button>
                    <span className="env-chip">{selected.name}</span>
                    <div className="env-tabs">
                      {ENVIRONMENTS.map((env) => (
                        <button key={env} className={'env-tab' + (environment === env ? ' active' : '')} onClick={() => changeEnvironment(selected, env)}>{env}</button>
                      ))}
                    </div>
                    <button className="cta-button ghost btn-sm" onClick={() => setEnvImport({ text: '', project: selected, env: environment, status: null })}>import .env</button>
                  </div>
                  {envImport && envImport.project?.id === selected.id && (
                    <div className="env-import">
                      <textarea
                        rows={6}
                        placeholder={'KEY=value, one per line\n# comments and quotes are handled'}
                        value={envImport.text}
                        onChange={(e) => setEnvImport({ ...envImport, text: e.target.value })}
                      />
                      {envImport.status && <p className="team-hint">{envImport.status}</p>}
                      {envImport.error && <p className="auth-error">{envImport.error}</p>}
                      <div className="env-import-actions">
                        <button className="cta-button primary" disabled={!envImport.text.trim() || envImport.busy} onClick={() => importEnvFile(selected)}>
                          {envImport.busy ? 'importing…' : 'import ' + envImport.env}
                        </button>
                        <label className="cta-button ghost">
                          load .env file
                          <input
                            type="file"
                            accept=".env,.txt,text/plain"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const f = e.target.files && e.target.files[0];
                              if (f) f.text().then((t) => setEnvImport((s) => ({ ...s, text: t })));
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <button className="breadcrumb-back" onClick={() => setEnvImport(null)}>cancel</button>
                      </div>
                    </div>
                  )}
                  <div className="dash-filter">
                    <Search className="filter-icon" width="14" height="14" />
                    <input type="text" placeholder="Filter keys…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  </div>
                  {envLoading && (
                    <div className="secrets-table">
                      <div className="secrets-head"><span>key</span><span>value</span><span /></div>
                      {[0, 1, 2].map((i) => (
                        <div className="secrets-row" key={i}><span className="stat-skel row-skel" /><span className="stat-skel row-skel wide" /><span /></div>
                      ))}
                    </div>
                  )}
                  {envError && <p className="auth-error">{envError}</p>}
                  {!envLoading && visibleEnv.length === 0 && (
                    <div className="empty-state">
                      <Search width="22" height="22" />
                      <p>{filter ? 'No keys match "' + filter + '".' : 'No secrets set for ' + environment + '. Add one below.'}</p>
                    </div>
                  )}
                  {!envLoading && visibleEnv.length > 0 && (
                    <div className="secrets-table">
                      <div className="secrets-head"><span>key</span><span>value</span><span /></div>
                      {visibleEnv.map(([key, value]) => (
                        <div className="secrets-row" key={key}>
                          <span className="kv-key">{key}</span>
                          <span className={'kv-value' + (revealedKeys.has(key) ? ' revealed' : '')}>{revealedKeys.has(key) ? value : bullets(value)}</span>
                          <span className="secrets-acts">
                            {/* Copy while still masked: the value is already in browser memory, so copying it is
                                no worse than the eye — and it kills the “paste it to me on WhatsApp” dance. */}
                            <button className="icon-btn" aria-label={'Copy value of ' + key} title="Copy value" onClick={() => { navigator.clipboard?.writeText(String(value)); flash('env:' + key); }}>
                              {copiedTag === 'env:' + key ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                            </button>
                            <button className="icon-btn" aria-label={revealedKeys.has(key) ? 'Hide value' : 'Show value'} title={revealedKeys.has(key) ? 'Hide' : 'Show'} onClick={() => toggleReveal(key)}>
                              {revealedKeys.has(key) ? <EyeOff width="14" height="14" /> : <Eye width="14" height="14" />}
                            </button>
                            <button className="icon-btn" aria-label="Roll back to previous value" title="Rollback" onClick={() => rollbackEnvVar(selected, key)}>
                              <RotateCcw width="14" height="14" />
                            </button>
                            <button className="icon-btn icon-btn-danger" aria-label="Delete key" title="Delete" onClick={() => setConfirmFor({ kind: 'env', project: selected, key })}>
                              <Trash2 width="14" height="14" />
                            </button>
                          </span>
                          {confirmFor?.kind === 'env' && confirmFor.key === key && (
                            <ConfirmBanner prompt={'sudo delete ' + key} hint={'The value is gone from ' + environment + ' immediately. History keeps the audit entry, not the value.'} onConfirm={deleteEnvVar} onCancel={() => setConfirmFor(null)} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <section className="form-section">
                    <h2 className="form-title">Add a secret</h2>
                    <div className="field">
                      <label htmlFor="new-key">Key</label>
                      <p className="field-hint">The name your app reads, like DATABASE_URL.</p>
                      <input id="new-key" className="mono-field" type="text" autoCapitalize="characters" autoCorrect="off" spellCheck="false" placeholder="DATABASE_URL" value={newEnvKey} onChange={(e) => setNewEnvKey(e.target.value.toUpperCase())} />
                    </div>
                    <div className="field">
                      <label htmlFor="new-value">Value</label>
                      <p className="field-hint">Saved to {environment}. Hidden in the list until you tap the eye.</p>
                      <input id="new-value" className="mono-field" type="text" autoCapitalize="none" autoCorrect="off" spellCheck="false" placeholder="postgres://…" value={newEnvValue} onChange={(e) => setNewEnvValue(e.target.value)} />
                    </div>
                    <div className="form-actions">
                      <button className="cta-button primary" disabled={savingEnv} onClick={() => addEnvVar(selected)}>{savingEnv ? 'Saving…' : 'Add secret'}</button>
                      <button className="cta-button ghost" onClick={() => downloadEnv(selected)}>Download .env</button>
                    </div>
                  </section>
                  {audit.length > 0 && (
                    <div className="dash-card" style={{ marginTop: '1rem' }}>
                      <h2>Recent changes</h2>
                      {audit.slice(0, 8).map((ev, i) => (
                        <div key={i} className="session-row">
                          <span className="session-name"><code>{ev.key}</code> <span className="muted">{ev.environment}</span></span>
                          <span className="store-meta meta-line">
                            <span>{ev.action} by {ev.actor ? ev.actor.split('@')[0] : 'api'}</span>
                            <span>{fmtDate(ev.created_at)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {section === 'store' && (
            <>
              <PageHeader Icon={Database} title="Store" />
              {!selected ? (
                projects.length === 0 ? (
                  <div className="empty-state">
                    <Database width="22" height="22" />
                    <p>Create a project to store counters, flags and JSON.</p>
                    <button className="cta-button ghost" onClick={() => setSection('projects')}>Create a project</button>
                  </div>
                ) : (
                  <>
                    <p className="page-header-sub" style={{ marginBottom: '1rem' }}>Pick a project to manage its key-value store.</p>
                    <div className="project-picker">
                      {projects.map((p) => (
                        <button key={p.id} className="project-pick" onClick={() => pickProject(p)}>
                          <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <>
                  <div className="secrets-toolbar">
                    <button className="breadcrumb-back" onClick={() => setSelectedId(null)}><ChevronLeft width="14" height="14" /> projects</button>
                    <span className="env-chip">{selected.name}</span>
                  </div>
                  {storeLoading && (
                    <div className="store-table">
                      <div className="store-head"><span>key</span><span>updated</span><span /></div>
                      {[0, 1, 2].map((i) => (
                        <div className="store-row" key={i}><span className="stat-skel row-skel" /><span className="stat-skel row-skel wide" /><span /></div>
                      ))}
                    </div>
                  )}
                  {storeError && <p className="auth-error">{storeError}</p>}
                  {!storeLoading && storeItems.length === 0 && (
                    <div className="empty-state">
                      <Database width="22" height="22" />
                      <p>Store keys hold JSON, counters or flags. Add your first one below.</p>
                    </div>
                  )}
                  {!storeLoading && storeItems.length > 0 && (
                    <div className="store-table">
                      <div className="store-head"><span>key</span><span>updated</span><span /></div>
                      {storeItems.map((item) => (
                        <div className="store-row" key={item.key}>
                          <span className="store-key">{item.key}</span>
                          <span className="store-meta">
                            {fmtDate(item.updated_at || item.created_at)}
                            {item.expires_at ? ' · TTL' : ''}
                          </span>
                          <span className="secrets-acts">
                            <button className="icon-btn" aria-label="View value" title="View value" onClick={() => togglePreview(selected, item.key)}>
                              <Eye width="14" height="14" />
                            </button>
                            <button className="icon-btn" aria-label="Copy key" title="Copy key" onClick={() => copyKey(item.key, 'store-copy:' + item.key)}>
                              {copiedTag === 'store-copy:' + item.key ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                            </button>
                            <button className="icon-btn icon-btn-danger" aria-label="Delete key" title="Delete" onClick={() => setConfirmFor({ kind: 'store', project: selected, key: item.key })}>
                              <Trash2 width="14" height="14" />
                            </button>
                          </span>
                          {confirmFor?.kind === 'store' && confirmFor.key === item.key && (
                            <ConfirmBanner prompt={'sudo delete ' + item.key} hint="The key and its value are removed for every environment. Counters and TTLs go with it." onConfirm={deleteStoreItem} onCancel={() => setConfirmFor(null)} />
                          )}
                          {previewKey === item.key && (
                            <div className="store-preview">
                              <div className="store-preview-head">
                                <span>
                                  <Eye width="12" height="12" /> value
                                </span>
                                <span style={{ display: 'inline-flex', gap: '0.25rem' }}>
                                  {previewValue !== null && isNumeric(previewValue) && (
                                    <button className="icon-btn" title="Increment by 1" onClick={() => incrementStore(selected, item.key)}>
                                      <Plus width="13" height="13" />
                                    </button>
                                  )}
                                  {previewValue !== null && (
                                    <button className="icon-btn" title="Copy value" onClick={() => copyKey(typeof previewValue === 'string' ? previewValue : JSON.stringify(previewValue), 'store-val:' + item.key)}>
                                      {copiedTag === 'store-val:' + item.key ? <Check width="13" height="13" /> : <Copy width="13" height="13" />}
                                    </button>
                                  )}
                                </span>
                              </div>
                              {previewLoading && <span className="stat-skel" style={{ width: '8rem' }} />}
                              {previewError && <p className="auth-error">{previewError}</p>}
                              {!previewLoading && previewValue !== null && (
                                <pre>{typeof previewValue === 'string' ? previewValue : JSON.stringify(previewValue, null, 2)}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="kv-add-row store-add">
                    <input type="text" placeholder="key (e.g. user:123)" value={newStoreKey} onChange={(e) => setNewStoreKey(e.target.value)} />
                    <textarea placeholder={'value: JSON or plain text\n{"name":"Jane"} '} value={newStoreValue} onChange={(e) => setNewStoreValue(e.target.value)} />
                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                      <input className="ttl-input" type="number" min="1" placeholder="TTL sec" value={newStoreTtl} onChange={(e) => setNewStoreTtl(e.target.value)} />
                      <button className="cta-button ghost" disabled={savingStore} onClick={() => addStoreItem(selected)}>
                        <Plus width="14" height="14" style={{ marginRight: '0.4rem' }} />{savingStore ? 'saving…' : 'set'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {section === 'projects' && (
            <>
              <PageHeader Icon={Folder} title="Projects" />
              <form onSubmit={submitCreate} className="form-section first">
                <h2 className="form-title">New project</h2>
                <div className="field">
                  <label htmlFor="new-project">Name</label>
                  <p className="field-hint">A unique name for your project. It holds your environments and secrets. No API key is created until you need one.</p>
                  <input id="new-project" type="text" autoCapitalize="none" placeholder="my-app" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                </div>
                {createError && <p className="auth-error">{createError}</p>}
                <div className="form-actions">
                  <button className="cta-button primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create project'}</button>
                </div>
              </form>
              {loadingProjects && (
                <>
                  <div className="project-row skel-row"><span className="stat-skel row-skel" /></div>
                  <div className="project-row skel-row"><span className="stat-skel row-skel" /></div>
                </>
              )}
              {!loadingProjects && projects.length === 0 && (
                <div className="empty-state" style={{ marginTop: '1rem' }}>
                  <Folder width="22" height="22" />
                  <p>Create your first project above.</p>
                </div>
              )}
              {!loadingProjects && projectGroups.map((group) => (
                group.name ? (
                  <div key={'team:' + group.name} className="project-group">
                    <div className="project-group-head">
                      <Users width="14" height="14" />
                      <span className="project-group-name">{group.name}</span>
                      <span className="project-group-count">{group.items.length}</span>
                    </div>
                    {group.items.map(renderProjectRow)}
                  </div>
                ) : (
                  <div key="personal" className="project-group">
                    <div className="project-group-head">
                      <Folder width="14" height="14" />
                      <span className="project-group-name">Your projects</span>
                      <span className="project-group-count">{group.items.length}</span>
                    </div>
                    {group.items.map(renderProjectRow)}
                  </div>
                )
              ))}
              {!loadingProjects && projects.length > 0 && (
                <div className="project-row" style={{ border: '1px dashed var(--border)', justifyContent: 'center', gridTemplateColumns: 'auto auto', background: 'transparent' }}>
                  <RefreshCw width="14" height="14" style={{ color: 'var(--text-muted)' }} />
                  <button className="breadcrumb-back" onClick={() => loadProjects()}>refresh projects</button>
                </div>
              )}
            </>
          )}

          {section === 'cron' && (
            <>
              <PageHeader Icon={Clock} title="Cron" />
              {!selected ? (
                projects.length === 0 ? (
                  <div className="empty-state">
                    <Clock width="22" height="22" />
                    <p>Schedule the API to call a URL on a timer, with run history and run-now.</p>
                    <button className="cta-button ghost" onClick={() => setSection('projects')}>Create a project</button>
                  </div>
                ) : (
                  <>
                    <p className="page-header-sub" style={{ marginBottom: '1rem' }}>Pick a project to manage its scheduled jobs.</p>
                    <div className="project-picker">
                      {projects.map((p) => (
                        <button key={p.id} className="project-pick" onClick={() => pickProject(p)}>
                          <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <>
                  <div className="secrets-toolbar">
                    <button className="breadcrumb-back" onClick={() => setSelectedId(null)}><ChevronLeft width="14" height="14" /> projects</button>
                    <span className="env-chip">{selected.name}</span>
                  </div>
                  <CronPanel token={token} project={selected} />
                </>
              )}
            </>
          )}

          {section === 'monitors' && (
            <>
              <PageHeader Icon={Activity} title="Monitors" />
              {!selected ? (
                projects.length === 0 ? (
                  <div className="empty-state">
                    <Activity width="22" height="22" />
                    <p>Watch a URL: one email when it goes down, one when it recovers.</p>
                    <button className="cta-button ghost" onClick={() => setSection('projects')}>Create a project</button>
                  </div>
                ) : (
                  <>
                    <p className="page-header-sub" style={{ marginBottom: '1rem' }}>Pick a project to manage its uptime monitors.</p>
                    <div className="project-picker">
                      {projects.map((p) => (
                        <button key={p.id} className="project-pick" onClick={() => pickProject(p)}>
                          <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <>
                  <div className="secrets-toolbar">
                    <button className="breadcrumb-back" onClick={() => setSelectedId(null)}><ChevronLeft width="14" height="14" /> projects</button>
                    <span className="env-chip">{selected.name}</span>
                  </div>
                  <MonitorsPanel token={token} project={selected} userEmail={user?.email} />
                </>
              )}
            </>
          )}

          {section === 'logs' && (
            <>
              <PageHeader Icon={ScrollText} title="Logs" />
              {!selected ? (
                projects.length === 0 ? (
                  <div className="empty-state">
                    <ScrollText width="22" height="22" />
                    <p>Your app's log drain. Ship events from the CLI, API or a template, then tail them here.</p>
                    <button className="cta-button ghost" onClick={() => setSection('projects')}>Create a project</button>
                  </div>
                ) : (
                  <>
                    <p className="page-header-sub" style={{ marginBottom: '1rem' }}>Pick a project to tail its logs.</p>
                    <div className="project-picker">
                      {projects.map((p) => (
                        <button key={p.id} className="project-pick" onClick={() => pickProject(p)}>
                          <span className="project-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <>
                  <div className="secrets-toolbar">
                    <button className="breadcrumb-back" onClick={() => setSelectedId(null)}><ChevronLeft width="14" height="14" /> projects</button>
                    <span className="env-chip">{selected.name}</span>
                  </div>
                  <LogsPanel token={token} project={selected} />
                </>
              )}
            </>
          )}

          {section === 'security' && <SecuritySection token={token} />}
          {section === 'teams' && (
            <>
              <PageHeader Icon={Users} title="Teams" />
              <TeamsPanel token={token} user={user} invites={teamInvites} projects={projects} onInvitesChange={loadTeamInvites} onOpenProject={openProjectById} />
            </>
          )}

          {section === 'admin' && isAdmin && (
            <>
              <PageHeader Icon={ShieldCheck} title="Admin" />
              <AdminPanel />
            </>
          )}
      </div>
    </AppShell>
  );
}