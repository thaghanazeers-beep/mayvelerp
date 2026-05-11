import { useState, useEffect, useRef } from 'react';
import { getTeam, inviteUser, removeUser, updateUser, uploadAvatar, signedFileUrl } from '../api';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import ViewTabs from '../components/ViewTabs';
import './TeamPage.css';

import { useTeamspace } from '../context/TeamspaceContext';

const ROLES = ['Member', 'Admin', 'Team Owner'];

export default function TeamPage() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const { isManagement, getOrgRole, getManagerChain } = useOrg();
  const isAdmin = user?.role === 'Admin' || user?.role === 'Team Owner';

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('team_views');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'grid', name: 'Cards' },
      { id: 'v2', type: 'list', name: 'List' },
      { id: 'v3', type: 'table', name: 'Table' },
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'grid';

  useEffect(() => {
    localStorage.setItem('team_views', JSON.stringify(views));
  }, [views]);

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    const newViews = [...views, { id: newId, type, name: label }];
    setViews(newViews);
    setActiveViewId(newId);
  };

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  // Edit modal
  const [editMember, setEditMember] = useState(null); // member object being edited
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const avatarInputRef = useRef(null);

  useEffect(() => { fetchTeam(); }, [activeTeamspaceId]);

  const fetchTeam = async () => {
    try {
      const res = await getTeam(activeTeamspaceId);
      setMembers(res.data);
    } catch (err) {
      console.error('Failed to load team:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Filtered members ──────────────────────────────────
  const filtered = members.filter(m =>
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.email?.toLowerCase().includes(search.toLowerCase()) ||
    (m.role || '').toLowerCase().includes(search.toLowerCase())
  );

  // ── Invite ──────────────────────────────────────────────
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await inviteUser(activeTeamspaceId, email, role, user?.name);
      setInviteResult({ success: true, message: res.data.message, tempPassword: res.data.tempPassword, emailSent: res.data.emailSent });
      setEmail('');
      setRole('Member');
      fetchTeam();
    } catch (err) {
      setInviteResult({ success: false, message: err.response?.data?.message || 'Failed to invite user' });
    } finally {
      setInviting(false);
    }
  };

  // ── Remove ──────────────────────────────────────────────
  const handleRemove = async (id, name) => {
    if (!confirm(`Remove ${name || 'this member'} from the workspace?`)) return;
    try {
      await removeUser(id);
      fetchTeam();
    } catch (err) {
      console.error('Failed to remove:', err);
    }
  };

  // ── Open Edit Modal ─────────────────────────────────────
  const openEdit = (member) => {
    setEditMember(member);
    setEditName(member.name || '');
    setEditEmail(member.email || '');
    setEditRole(member.role || 'Member');
    setEditPassword('');
    setEditError('');
    setEditSuccess('');
  };

  // ── Save Profile Changes ────────────────────────────────
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editName.trim() || !editEmail.trim()) return;
    setEditSaving(true);
    setEditError('');
    setEditSuccess('');
    try {
      const payload = { name: editName.trim(), email: editEmail.trim(), role: editRole };
      if (editPassword.trim()) payload.password = editPassword.trim();
      await updateUser(editMember._id, payload);
      await fetchTeam();
      setEditMember(null); // Close modal on success
    } catch (err) {
      setEditError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Avatar Upload ────────────────────────────────────────
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditError('');
    try {
      const res = await uploadAvatar(editMember._id, file);
      setEditMember(prev => ({ ...prev, profilePictureUrl: res.data.profilePictureUrl }));
      setEditSuccess('Profile picture updated!');
      fetchTeam();
    } catch (err) {
      setEditError('Failed to upload avatar');
    }
  };

  if (loading) {
    return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  return (
    <div className="team-page">
      <ViewTabs 
        views={views} 
        activeViewId={activeViewId} 
        onChangeView={setActiveViewId} 
        onAddView={handleAddView} 
      />

      <div className="team-toolbar" style={{ paddingTop: 0, gap: 12 }}>
        <input className="input" placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 260, padding: '6px 14px', fontSize: '0.85rem' }} />
        <span className="tasks-count">{filtered.length} members</span>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => { setShowInvite(true); setInviteResult(null); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Invite User
          </button>
        )}
      </div>

      {/* Grid (Cards) View */}
      {viewType === 'grid' && (
        <div className="team-grid">
          {filtered.map((member, i) => {
            const orgRole = getOrgRole(member._id);
            const chain = getManagerChain(member._id);
            const reportsTo = chain.length > 0 ? chain[0] : null;
            return (
              <div className="team-card animate-in" key={member._id} style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="team-card-top">
                  <div className="team-avatar">
                    {member.profilePictureUrl ? (
                      <img src={signedFileUrl(member.profilePictureUrl)} alt={member.name} />
                    ) : (
                      <span>{member.name?.charAt(0)?.toUpperCase()}</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="team-card-actions">
                      <button className="btn-icon team-edit" onClick={() => openEdit(member)} title="Edit member">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {member._id !== user?.id && (
                        <button className="btn-icon team-remove" onClick={() => handleRemove(member._id, member.name)} title="Remove member">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <h3 className="team-name">{member.name}</h3>
                <p className="team-email">{member.email}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <span className={`badge ${member.role === 'Admin' ? 'badge-admin' : member.role === 'Team Owner' ? 'badge-owner' : 'badge-member'}`}>
                    {member.role}
                  </span>
                  {orgRole && (
                    <span style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary-light, #a78bfa)', padding: '2px 10px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600 }}>{orgRole}</span>
                  )}
                </div>
                {reportsTo && (
                  <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Reports to: {reportsTo.name}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewType === 'list' && (
        <div className="list-view">
          {filtered.map((member, i) => {
            const orgRole = getOrgRole(member._id);
            const chain = getManagerChain(member._id);
            const reportsTo = chain.length > 0 ? chain[0] : null;
            return (
              <div className="list-item animate-in" key={member._id} style={{ animationDelay: `${i * 0.03}s` }}>
                <div className="list-item-left" style={{ gap: 12 }}>
                  <div className="team-avatar" style={{ width: 32, height: 32, fontSize: 13, flexShrink: 0 }}>
                    {member.profilePictureUrl ? <img src={signedFileUrl(member.profilePictureUrl)} alt={member.name} /> : <span>{member.name?.charAt(0)?.toUpperCase()}</span>}
                  </div>
                  <span className="list-item-title">{member.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{member.email}</span>
                </div>
                <div className="list-item-right" style={{ gap: 8 }}>
                  {orgRole && (
                    <span style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary-light, #a78bfa)', padding: '2px 10px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600 }}>{orgRole}</span>
                  )}
                  {reportsTo && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>→ {reportsTo.name}</span>
                  )}
                  <span className={`badge ${member.role === 'Admin' ? 'badge-admin' : member.role === 'Team Owner' ? 'badge-owner' : 'badge-member'}`}>{member.role}</span>
                  {isAdmin && (
                    <div className="team-card-actions" style={{ marginLeft: 8 }}>
                      <button className="btn-icon team-edit" onClick={() => openEdit(member)} title="Edit" style={{ width: 28, height: 28 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View — merged with Team Settings data */}
      {viewType === 'table' && (
        <div className="table-wrapper">
          <table className="task-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>System Role</th>
                <th>Org Title</th>
                <th>Reports To</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((member, i) => {
                const orgRole = getOrgRole(member._id);
                const chain = getManagerChain(member._id);
                const reportsTo = chain.length > 0 ? chain[0] : null;
                return (
                  <tr key={member._id} className="animate-in" style={{ animationDelay: `${i * 0.03}s` }}>
                    <td style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="team-avatar" style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>
                        {member.profilePictureUrl ? <img src={signedFileUrl(member.profilePictureUrl)} alt={member.name} /> : <span>{member.name?.charAt(0)?.toUpperCase()}</span>}
                      </div>
                      {member.name}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{member.email}</td>
                    <td>
                      <span className={`badge ${member.role === 'Admin' ? 'badge-admin' : member.role === 'Team Owner' ? 'badge-owner' : 'badge-member'}`}>{member.role}</span>
                    </td>
                    <td>
                      {orgRole ? (
                        <span style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary-light, #a78bfa)', padding: '2px 10px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600 }}>{orgRole}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {reportsTo ? `${reportsTo.name} (${reportsTo.orgRole})` : '—'}
                    </td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-icon team-edit" onClick={() => openEdit(member)} title="Edit" style={{ width: 28, height: 28 }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          {member._id !== user?._id && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)', fontSize: '0.78rem' }} onClick={() => handleRemove(member._id, member.name)}>Remove</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No members found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {/* ─── Edit Member Modal ─── */}
      {editMember && (
        <div className="modal-overlay" onClick={() => setEditMember(null)}>
          <div className="modal modal-wide animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Member Profile</h2>
              <button className="btn-icon" onClick={() => setEditMember(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="edit-member-body">
              {/* Avatar section */}
              <div className="edit-avatar-section">
                <div className="edit-avatar-preview">
                  {editMember.profilePictureUrl ? (
                    <img src={signedFileUrl(editMember.profilePictureUrl)} alt={editMember.name} />
                  ) : (
                    <span>{editMember.name?.charAt(0)?.toUpperCase()}</span>
                  )}
                </div>
                <div className="edit-avatar-actions">
                  <p className="edit-avatar-name">{editMember.name}</p>
                  <p className="edit-avatar-email">{editMember.email}</p>
                  <button className="btn btn-ghost btn-sm" onClick={() => avatarInputRef.current?.click()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Change Photo
                  </button>
                  <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveEdit} className="edit-member-form">
                <div className="edit-form-row">
                  <div className="form-field">
                    <label className="label">Full Name</label>
                    <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Full name" required />
                  </div>
                  <div className="form-field">
                    <label className="label">Email Address</label>
                    <input className="input" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@mayvel.ai" required />
                  </div>
                </div>
                <div className="edit-form-row">
                  <div className="form-field">
                    <label className="label">Role</label>
                    <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="label">New Password <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(leave blank to keep current)</span></label>
                    <input className="input" type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                  </div>
                </div>

                {editError && <div className="invite-result invite-error"><p>{editError}</p></div>}
                {editSuccess && <div className="invite-result invite-success"><p>✓ {editSuccess}</p></div>}

                <div className="modal-actions">
                  <div style={{ flex: 1 }} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditMember(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={editSaving}>
                    {editSaving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─── Invite Modal ─── */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Invite User</h2>
              <button className="btn-icon" onClick={() => setShowInvite(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleInvite} className="modal-form">
              <div className="form-field">
                <label className="label">Email Address</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Role</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {inviteResult && (
                <div className={`invite-result ${inviteResult.success ? 'invite-success' : 'invite-error'}`}>
                  <p>{inviteResult.message}</p>
                  {inviteResult.success && inviteResult.tempPassword && (
                    <div className="invite-credentials">
                      <p><strong>Temporary Password:</strong></p>
                      <code className="invite-password">{inviteResult.tempPassword}</code>
                      <p className="invite-hint">
                        {inviteResult.emailSent ? '✓ Credentials sent via email' : '⚠ Email not configured. Share the password manually.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowInvite(false)}>Close</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={inviting}>
                  {inviting ? <span className="spinner" /> : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
