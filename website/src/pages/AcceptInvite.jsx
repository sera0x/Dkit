import React, { useEffect, useState } from 'react';
import { Users, Mail } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import AppShell from '../components/app/AppShell';
import {
  getPendingInvite, setPendingInvite, clearPendingInvite, requestDashboardSection,
} from '../lib/pendingInvite';
import './dashboard.css';

export default function AcceptInvite({ onNavigate }) {
  const { user, token } = useAuth();
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('token') || getPendingInvite());
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!inviteToken) { setError('This link is missing its invitation token.'); setLoading(false); return; }
    setPendingInvite(inviteToken);
    if (window.location.search) window.history.replaceState({}, '', '/accept-invite');
    let cancelled = false;
    api.previewTeamInvite(inviteToken)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 404 || err.status === 410) clearPendingInvite();
        setError(err.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [inviteToken]);

  const go = (path) => (onNavigate ? onNavigate(path) : (window.location.href = path));

  const accept = async () => {
    setBusy('accept'); setError('');
    try {
      await api.acceptTeamInvite(token, inviteToken);
      clearPendingInvite();
      requestDashboardSection('teams');
      go('/dashboard');
    } catch (err) { setError(err.message); setBusy(''); }
  };

  const decline = async () => {
    setBusy('decline'); setError('');
    try {
      await api.declineTeamInvite(token, inviteToken);
      clearPendingInvite();
      go('/dashboard');
    } catch (err) { setError(err.message); setBusy(''); }
  };

  const wrongAccount = preview && user && preview.email.toLowerCase() !== String(user.email).toLowerCase();

  return (
    <AppShell active="" onNavigate={onNavigate}>
      <div className="page-header">
        <div className="page-header-icon"><Users width="18" height="18" /></div>
        <div><h1>Team invitation</h1></div>
      </div>

      <div className="dash-card invite-card">
        {loading && <span className="stat-skel row-skel wide" />}

        {!loading && !preview && (
          <>
            <p className="auth-error">{error || 'This invitation could not be loaded.'}</p>
            <div className="invite-actions">
              <button className="cta-button ghost" onClick={() => go(user ? '/dashboard' : '/')}>{user ? 'Open dashboard' : 'Go home'}</button>
            </div>
          </>
        )}

        {!loading && preview && (
          <>
            <p className="invite-lede">
              {preview.invited_by_email ? <strong>{preview.invited_by_email}</strong> : 'Someone'} invited you to join{' '}
              <strong>{preview.team_name}</strong> as {preview.role === 'admin' ? 'an admin' : 'a member'}.
            </p>
            <p className="team-hint"><Mail width="12" height="12" style={{ verticalAlign: '-1px' }} /> Sent to {preview.email}</p>

            {!user && (
              <>
                <p className="team-hint">Log in or create an account with <strong>{preview.email}</strong> to accept.</p>
                <div className="invite-actions">
                  <button className="cta-button primary" onClick={() => go('/login')}>Log in</button>
                  <button className="cta-button ghost" onClick={() => go('/signup')}>Create account</button>
                </div>
              </>
            )}

            {user && wrongAccount && (
              <>
                <p className="auth-error">You’re signed in as {user.email}, but this invitation is for {preview.email}.</p>
                <p className="team-hint">Open the menu, log out, then sign in with {preview.email}.</p>
              </>
            )}

            {user && !wrongAccount && (
              <>
                {error && <p className="auth-error">{error}</p>}
                <div className="invite-actions">
                  <button className="cta-button primary" disabled={!!busy} onClick={accept}>{busy === 'accept' ? 'joining…' : 'Accept invitation'}</button>
                  <button className="cta-button ghost" disabled={!!busy} onClick={decline}>Decline</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
