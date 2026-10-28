import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, UserMinus, Mail, Copy, Check, ChevronLeft,
  RefreshCw, Trash2, Plus, X, Send, Folder, KeyRound,
} from 'lucide-react';
import { api, vault } from '../../lib/api';
import ConfirmBanner from './ConfirmBanner';
import './confirm-banner.css';

const initial = (s) => (s || '?').slice(0, 1).toUpperCase();
const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 86400000));

const RoleChip = ({ role }) => <span className={'team-role team-role-' + role}>{role}</span>;

export default function TeamsPanel({ token, user, invites = [], projects = [], onInvitesChange, onOpenProject }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirmTag, setConfirmTag] = useState('');
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);
  useEffect(() => {
    if (!confirmDeleteTeam) return;
    const onKey = (e) => { if (e.key === 'Escape') setConfirmDeleteTeam(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDeleteTeam]);
  const [copied, setCopied] = useState('');
  const [shareId, setShareId] = useState('');
  const [sharing, setSharing] = useState(false);

  const clearMessages = () => { setError(''); setNotice(''); };

  const armConfirm = (tag) => {
    setConfirmTag(tag);
    setTimeout(() => setConfirmTag((t) => (t === tag ? '' : t)), 6000);
  };

  const loadTeams = useCallback(async () => {
    try { setTeams(await api.getTeams(token)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const loadDetail = useCallback(async (id, { quiet = false } = {}) => {
    if (!quiet) setDetailLoading(true);
    try { setDetail(await api.getTeam(token, id)); }
    catch (err) { setError(err.message); setOpenId(null); setDetail(null); }
    finally { setDetailLoading(false); }
  }, [token]);

  const openTeam = (id) => {
    clearMessages();
    setOpenId(id);
    setDetail(null);
    setInviteEmail('');
    setInviteRole('member');
    setShareId('');
    loadDetail(id);
  };

  const backToList = () => {
    setOpenId(null);
    setDetail(null);
    clearMessages();
    loadTeams();
  };

  const run = async (tag, fn) => {
    setBusy(tag);
    clearMessages();
    try { await fn(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const copyText = (text, tag) => {
    navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? '' : c)), 1400);
  };

  const copyLink = (inv) => copyText(inv.link, inv.id);

  const createTeam = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    clearMessages();
    try {
      const team = await api.createTeam(token, newName.trim());
      setNewName('');
      setTeams((prev) => [team, ...prev]);
      openTeam(team.id);
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  };

  const acceptInvite = (inv) => run('accept:' + inv.id, async () => {
    const res = await api.acceptTeamInvite(token, inv.token);
    await Promise.all([loadTeams(), onInvitesChange?.()]);
    openTeam(res.team.id);
    setNotice('You joined ' + inv.team_name + '.');
  });

  const declineInvite = (inv) => run('decline:' + inv.id, async () => {
    await api.declineTeamInvite(token, inv.token);
    await onInvitesChange?.();
  });

  const sendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSending(true);
    clearMessages();
    try {
      const res = await api.inviteToTeam(token, openId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setNotice(res.email_sent
        ? 'Invitation sent to ' + res.invite.email + '.'
        : 'Invitation created for ' + res.invite.email + ', but the email could not be sent. Copy the link below and share it with them.');
      await loadDetail(openId, { quiet: true });
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  };

  const resendInvite = (inv) => run('resend:' + inv.id, async () => {
    const res = await api.resendTeamInvite(token, openId, inv.id);
    setNotice(res.email_sent ? 'Invitation re-sent to ' + inv.email + '.' : 'Could not send the email. Copy the link and share it instead.');
    await loadDetail(openId, { quiet: true });
  });

  const revokeInvite = (inv) => run('revoke:' + inv.id, async () => {
    await api.revokeTeamInvite(token, openId, inv.id);
    await loadDetail(openId, { quiet: true });
  });

  const changeRole = (member, role) => run('role:' + member.user_id, async () => {
    await api.setTeamMemberRole(token, openId, member.user_id, role);
    await loadDetail(openId, { quiet: true });
  });

  const removeMember = (member) => {
    if (confirmTag !== 'rm:' + member.user_id) { armConfirm('rm:' + member.user_id); return; }
    setConfirmTag('');
    run('rm:' + member.user_id, async () => {
      await api.removeTeamMember(token, openId, member.user_id);
      await loadDetail(openId, { quiet: true });
    });
  };

  const leaveTeam = () => {
    if (confirmTag !== 'leave') { armConfirm('leave'); return; }
    setConfirmTag('');
    run('leave', async () => {
      await api.removeTeamMember(token, openId, user.id);
      backToList();
    });
  };

  const deleteTeam = () => {
    setConfirmDeleteTeam(false);
    run('delete', async () => {
      await api.deleteTeam(token, openId);
      backToList();
    });
  };

  const shareProject = async (e) => {
    e.preventDefault();
    if (!shareId) return;
    setSharing(true);
    clearMessages();
    try {
      await api.addProjectToTeam(token, openId, shareId);
      setShareId('');
      await loadDetail(openId, { quiet: true });
    } catch (err) { setError(err.message); }
    finally { setSharing(false); }
  };

  const unshareProject = (p) => {
    if (confirmTag !== 'unshare:' + p.id) { armConfirm('unshare:' + p.id); return; }
    setConfirmTag('');
    run('unshare:' + p.id, async () => {
      await api.removeTeamProject(token, openId, p.id);
      await loadDetail(openId, { quiet: true });
    });
  };

  const copySharedKey = (p) => {
    const key = vault.read()[p.id];
    if (!key) return;
    navigator.clipboard?.writeText(key);
    setCopied('tp:' + p.id);
    setTimeout(() => setCopied((c) => (c === 'tp:' + p.id ? '' : c)), 1400);
  };

  const messages = (
    <>
      {notice && <p className="auth-hint team-msg">{notice}</p>}
      {error && <p className="auth-error team-msg">{error}</p>}
    </>
  );

  if (openId) {
    const role = detail?.role;
    const canManage = role === 'owner' || role === 'admin';
    const teamProjects = detail?.projects || [];
    const shareable = Array.isArray(projects)
      ? projects.filter((p) => !teamProjects.some((tp) => tp.id === p.id))
      : [];
    return (
      <>
        <div className="secrets-toolbar">
          <button className="breadcrumb-back" onClick={backToList}><ChevronLeft width="14" height="14" /> teams</button>
          {detail && <span className="env-chip">{detail.team.name}</span>}
          {role && <RoleChip role={role} />}
        </div>
        {messages}

        {detailLoading && !detail && (
          <>
            <div className="project-row skel-row"><span className="stat-skel row-skel" /></div>
            <div className="project-row skel-row"><span className="stat-skel row-skel" /></div>
          </>
        )}

        {detail && (
          <>
            {canManage && (
              <div className="dash-card">
                <h2>Invite someone</h2>
                <form onSubmit={sendInvite} className="team-invite-form">
                  <input
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                  <div className="env-tabs team-role-pick" role="group" aria-label="Role">
                    <button type="button" className={'env-tab' + (inviteRole === 'member' ? ' active' : '')} onClick={() => setInviteRole('member')}>member</button>
                    {role === 'owner' && (
                      <button type="button" className={'env-tab' + (inviteRole === 'admin' ? ' active' : '')} onClick={() => setInviteRole('admin')}>admin</button>
                    )}
                  </div>
                  <button className="cta-button primary" type="submit" disabled={sending}>
                    <Send width="14" height="14" style={{ marginRight: '0.4rem' }} />{sending ? 'sending…' : 'send invite'}
                  </button>
                </form>
                <p className="team-hint">They accept from the email link, and must use the account with that address. Invites expire after 7 days.</p>
              </div>
            )}

            {canManage && detail.invites.length > 0 && (
              <div className="dash-card">
                <h2>Pending invitations</h2>
                <div className="team-list">
                  {detail.invites.map((inv) => (
                    <div className="team-row" key={inv.id}>
                      <span className="project-avatar" aria-hidden="true"><Mail width="15" height="15" /></span>
                      <div className="team-row-main">
                        <span className="team-row-title">{inv.email}</span>
                        <span className="team-row-sub">
                          {inv.role} · {inv.expired ? 'expired' : 'expires in ' + daysLeft(inv.expires_at) + 'd'}
                        </span>
                      </div>
                      <span className="secrets-acts">
                        {!inv.expired && (
                          <button className="icon-btn" aria-label="Copy invite link" title="Copy invite link" onClick={() => copyLink(inv)}>
                            {copied === inv.id ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                          </button>
                        )}
                        <button className="icon-btn" aria-label="Resend invitation" title="Resend" disabled={busy === 'resend:' + inv.id} onClick={() => resendInvite(inv)}>
                          <RefreshCw width="14" height="14" />
                        </button>
                        <button className="icon-btn icon-btn-danger" aria-label="Revoke invitation" title="Revoke" disabled={busy === 'revoke:' + inv.id} onClick={() => revokeInvite(inv)}>
                          <X width="14" height="14" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="dash-card">
              <h2>Shared projects · {teamProjects.length}</h2>
              {teamProjects.length > 0 && (
                <div className="team-list">
                  {teamProjects.map((p) => {
                    const keyAvailable = !!vault.read()[p.id];
                    const canOpen = typeof onOpenProject === 'function' && (p.owner_email === user?.email || projects.some((q) => q.id === p.id));
                    return (
                      <div
                        key={p.id}
                        className={'team-row' + (canOpen ? ' team-row-open' : '')}
                        role={canOpen ? 'button' : undefined}
                        tabIndex={canOpen ? 0 : undefined}
                        aria-label={canOpen ? 'Open ' + p.name : undefined}
                        onClick={canOpen ? () => onOpenProject(p.id) : undefined}
                        onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProject(p.id); } } : undefined}
                      >
                        <span className="project-avatar" aria-hidden="true"><Folder width="15" height="15" /></span>
                        <div className="team-row-main">
                          <span className="team-row-title">{p.name}{p.owner_email === user?.email && <em className="team-you"> (yours)</em>}</span>
                          <span className="team-row-sub">shared by {p.owner_email}{canOpen && ' · tap to open'}</span>
                        </div>
                        <span className="secrets-acts" onClick={(e) => e.stopPropagation()}>
                          {keyAvailable ? (
                            <button className="icon-btn" aria-label="Copy API key from this browser's vault" title="Copy key (saved in this browser)" onClick={() => copySharedKey(p)}>
                              {copied === 'tp:' + p.id ? <Check width="14" height="14" /> : <Copy width="14" height="14" />}
                            </button>
                          ) : (
                            <span className="key-ghost" title="Key stored hashed: only someone who saved it in their browser can copy it here. Ask the owner to share it directly or rotate it.">
                              <KeyRound width="13" height="13" /> key not in vault
                            </span>
                          )}
                          {canManage && (
                            <button
                              className="icon-btn icon-btn-danger"
                              aria-label="Unshare project"
                              title={confirmTag === 'unshare:' + p.id ? 'Click again to unshare' : 'Unshare'}
                              disabled={busy === 'unshare:' + p.id}
                              onClick={() => unshareProject(p)}
                            >
                              <X width="14" height="14" />
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {canManage && shareable.length > 0 && (
                <form className="team-invite-form" style={{ marginTop: '0.85rem' }} onSubmit={shareProject}>
                  <select className="team-select" value={shareId} onChange={(e) => setShareId(e.target.value)} aria-label="Project to share">
                    <option value="">choose one of your projects…</option>
                    {shareable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="cta-button primary team-mini" type="submit" disabled={!shareId || sharing}>
                    <Plus width="14" height="14" style={{ marginRight: '0.3rem' }} />{sharing ? 'sharing…' : 'share'}
                  </button>
                </form>
              )}
              <p className="team-hint">
                {canManage
                  ? 'Share one of your projects and everyone in the team gets its API key: full access to its env vars and store.'
                  : 'Projects shared into this team. Everyone here can open them under Projects (env vars, store, cron, monitors and logs) using the shared API key.'}
              </p>
            </div>

            <div className="dash-card">
              <h2>Members · {detail.members.length}</h2>
              <div className="team-list">
                {detail.members.map((m) => {
                  const isMe = m.user_id === user?.id;
                  const canChangeRole = role === 'owner' && m.role !== 'owner';
                  const canRemove = !isMe && (role === 'owner' ? m.role !== 'owner' : role === 'admin' && m.role === 'member');
                  return (
                    <div className="team-row" key={m.user_id}>
                      <span className="project-avatar" aria-hidden="true">{initial(m.email)}</span>
                      <div className="team-row-main">
                        <span className="team-row-title">{m.email}{isMe && <em className="team-you"> (you)</em>}</span>
                      </div>
                      <span className="team-row-actions">
                        {canChangeRole ? (
                          <select
                            className="team-select"
                            aria-label={'Role for ' + m.email}
                            value={m.role}
                            disabled={busy === 'role:' + m.user_id}
                            onChange={(e) => changeRole(m, e.target.value)}
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <RoleChip role={m.role} />
                        )}
                        {canRemove && (
                          <button
                            className={'icon-btn' + (confirmTag === 'rm:' + m.user_id ? ' icon-btn-confirm' : ' icon-btn-danger')}
                            aria-label={'Remove ' + m.email}
                            title={confirmTag === 'rm:' + m.user_id ? 'Click again to remove' : 'Remove from team'}
                            onClick={() => removeMember(m)}
                          >
                            <UserMinus width="14" height="14" />
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="dash-card team-danger">
              <h2>{role === 'owner' ? 'Delete team' : 'Leave team'}</h2>
              <p className="team-hint">
                {role === 'owner'
                  ? 'Removes the team, all memberships and pending invitations. There’s no undo after this.'
                  : 'You\u2019ll lose access to this team. An owner or admin can invite you back.'}
              </p>
              {role === 'owner' ? (
                <>
                  <button
                    className="cta-button danger team-danger-btn"
                    onClick={() => setConfirmDeleteTeam(true)}
                  >
                    <Trash2 width="14" height="14" style={{ marginRight: '0.4rem' }} />
                    delete team
                  </button>
                  {confirmDeleteTeam && (
                    <ConfirmBanner
                      prompt={'sudo delete ' + (detail?.team?.name || 'team')}
                      hint="Removes the team, all memberships and pending invitations. There’s no undo after this."
                      onConfirm={deleteTeam}
                      onCancel={() => setConfirmDeleteTeam(false)}
                    />
                  )}
                </>
              ) : (
                <button
                  className={'cta-button danger team-danger-btn' + (confirmTag === 'leave' ? ' armed' : '')}
                  onClick={leaveTeam}
                >
                  <Trash2 width="14" height="14" style={{ marginRight: '0.4rem' }} />
                  {confirmTag === 'leave' ? 'click again to confirm' : 'leave team'}
                </button>
              )}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      {messages}

      {invites.length > 0 && (
        <div className="dash-card team-invited">
          <h2>Invitations for you</h2>
          <div className="team-list">
            {invites.map((inv) => (
              <div className="team-row" key={inv.id}>
                <span className="project-avatar" aria-hidden="true">{initial(inv.team_name)}</span>
                <div className="team-row-main">
                  <span className="team-row-title">{inv.team_name}</span>
                  <span className="team-row-sub">
                    {inv.invited_by_email ? 'from ' + inv.invited_by_email + ' · ' : ''}join as {inv.role}
                  </span>
                </div>
                <span className="team-row-actions">
                  <button className="cta-button primary team-mini" disabled={busy === 'accept:' + inv.id} onClick={() => acceptInvite(inv)}>accept</button>
                  <button className="cta-button ghost team-mini" disabled={busy === 'decline:' + inv.id} onClick={() => declineInvite(inv)}>decline</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dash-card">
        <h2>Create a team</h2>
        <form onSubmit={createTeam} className="new-project-form">
          <input type="text" placeholder="team name" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} required />
          <button className="cta-button primary" type="submit" disabled={creating}>
            <Plus width="14" height="14" style={{ marginRight: '0.3rem' }} />{creating ? 'creating…' : 'create'}
          </button>
        </form>
      </div>

      {loading && (
        <>
          <div className="project-row skel-row"><span className="stat-skel row-skel" /></div>
          <div className="project-row skel-row"><span className="stat-skel row-skel" /></div>
        </>
      )}

      {!loading && teams.length === 0 && (
        <div className="empty-state" style={{ marginTop: '1rem' }}>
          <Users width="22" height="22" />
          <p>You’re not on a team yet. Create one above, then invite people by email.</p>
        </div>
      )}

      {!loading && teams.map((t) => (
        <button key={t.id} className="team-card" onClick={() => openTeam(t.id)}>
          <span className="project-avatar" aria-hidden="true">{initial(t.name)}</span>
          <span className="team-row-main">
            <span className="team-row-title">{t.name}</span>
            <span className="team-row-sub">{t.member_count} {t.member_count === 1 ? 'member' : 'members'}</span>
          </span>
          <RoleChip role={t.role} />
        </button>
      ))}
    </>
  );
}
