import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listAllUsers, createUser, updateUser, deleteUserAccount,
         listAllMemberships, upsertMembership, updateMembershipRole, removeMembership,
         getTeamspaces } from '../api';

// Reference: what each per-teamspace role can do, at a page-CRUD level.
// Kept in sync with the backend's middleware checks and the sidebar gating.
const ROLE_MATRIX = [
  { area: 'Tasks',                view: ['viewer','member','admin','owner'], create: ['member','admin','owner'],     edit: ['member','admin','owner'],     delete: ['admin','owner'] },
  { area: 'Projects',             view: ['viewer','member','admin','owner'], create: ['admin','owner'],               edit: ['admin','owner'],               delete: ['admin','owner'] },
  { area: 'Sprints',              view: ['viewer','member','admin','owner'], create: ['admin','owner'],               edit: ['admin','owner'],               delete: ['admin','owner'] },
  { area: 'Workflows',            view: ['viewer','member','admin','owner'], create: ['admin','owner'],               edit: ['admin','owner'],               delete: ['admin','owner'] },
  { area: 'My Timesheet',         view: ['member','admin','owner'],          create: ['member','admin','owner'],     edit: ['member','admin','owner'],     delete: ['member','admin','owner'] },
  { area: 'Time Plans (budget)',  view: ['owner'],                            create: ['owner'],                       edit: ['owner'],                       delete: ['owner'] },
  { area: 'Plan Approvals',       view: ['owner'],                            create: [],                              edit: ['owner'],                       delete: [] },
  { area: 'Week Approvals',       view: ['owner'],                            create: [],                              edit: ['owner'],                       delete: [] },
  { area: 'Team / Members',       view: ['owner'],                            create: ['owner'],                       edit: ['owner'],                       delete: ['owner'] },
  { area: 'Teamspace Control',    view: ['owner'],                            create: [],                              edit: ['owner'],                       delete: ['owner'] },
];
const ROLES = ['viewer', 'member', 'admin', 'owner'];
function roleHas(roleList, role) { return roleList.includes(role); }

// Super Admin–only screen: see every user across all teamspaces and change
// their access level. The backend re-checks isSuperAdmin on every endpoint,
// so a non-SuperAdmin who somehow reaches this page won't be able to mutate.
export default function AccessControlPage() {
  const { user, loginUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'Member' });
  const [creating, setCreating] = useState(false);

  // Per-teamspace memberships
  const [teamspaces, setTeamspaces] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [newMembership, setNewMembership] = useState({ userId: '', teamspaceId: '', role: 'member' });

  const fetchAll = async () => {
    setLoading(true);
    setErr('');
    try {
      const [u, m, ts] = await Promise.all([listAllUsers(), listAllMemberships(), getTeamspaces()]);
      setUsers(u.data);
      setMemberships(m.data);
      setTeamspaces(ts.data);
    } catch (e) {
      setErr(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);
  const fetchUsers = fetchAll;  // alias for backward compat below

  if (!user?.isSuperAdmin) {
    return (
      <div className="p-3">
        <h2>Access denied</h2>
        <p className="muted">Only the Super Admin can manage user access levels.</p>
      </div>
    );
  }

  const handleRoleChange = async (u, role) => {
    try {
      const r = await updateUser(u._id, { role });
      setUsers(prev => prev.map(x => x._id === u._id ? { ...x, ...r.data } : x));
      if (u._id === user._id) loginUser({ ...user, ...r.data });
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email || !newUser.password) return;
    setCreating(true);
    try {
      await createUser(newUser);
      setNewUser({ name: '', email: '', password: '', role: 'Member' });
      await fetchUsers();
    } catch (er) {
      alert(er.response?.data?.message || er.message);
    } finally { setCreating(false); }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This cannot be undone.`)) return;
    try {
      await deleteUserAccount(u._id);
      setUsers(prev => prev.filter(x => x._id !== u._id));
      setMemberships(prev => prev.filter(m => String(m.userId?._id || m.userId) !== String(u._id)));
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

  const handleMembershipRole = async (m, role) => {
    try {
      const r = await updateMembershipRole(m._id, role);
      setMemberships(prev => prev.map(x => x._id === m._id ? { ...x, role: r.data.role } : x));
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };
  const handleMembershipRemove = async (m) => {
    if (!window.confirm('Remove this user from the teamspace?')) return;
    try {
      await removeMembership(m._id);
      setMemberships(prev => prev.filter(x => x._id !== m._id));
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };
  const handleAddMembership = async (e) => {
    e.preventDefault();
    if (!newMembership.userId || !newMembership.teamspaceId) return;
    try {
      await upsertMembership(newMembership);
      setNewMembership({ userId: '', teamspaceId: '', role: 'member' });
      await fetchAll();
    } catch (er) { alert(er.response?.data?.error || er.message); }
  };

  // Group memberships by teamspace for the matrix
  const byTs = {};
  for (const m of memberships) {
    const tsId = String(m.teamspaceId?._id || m.teamspaceId || '');
    if (!byTs[tsId]) byTs[tsId] = [];
    byTs[tsId].push(m);
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>Access control</h2>
      <p className="muted" style={{ marginBottom: 24, fontSize: '0.85rem' }}>
        Add, remove, and change the access level of every user in the workspace. Only you (Super Admin) can see this page.
      </p>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Add new user</h3>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr) auto auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label className="label">Full name</label>
            <input className="input" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} required />
          </div>
          <div>
            <label className="label">Temp password</label>
            <input className="input" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} required minLength={6} />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="Member">Member</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={creating}>
              {creating ? 'Creating…' : '+ Create user'}
            </button>
          </div>
        </form>
      </div>

      <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>All users ({users.length})</h3>
      {err && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{err}</div>}
      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Role</th>
                <th style={{ textAlign: 'right', padding: '10px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    {u.name}{' '}
                    {u.isSuperAdmin && <span style={{ marginLeft: 6, padding: '2px 6px', background: '#6c5ce7', color: 'white', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600 }}>SUPER ADMIN</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{u.email}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {u.isSuperAdmin ? (
                      <span className="muted">Super Admin</span>
                    ) : (
                      <select className="input" style={{ padding: '4px 8px' }} value={u.role || 'Member'} onChange={e => handleRoleChange(u, e.target.value)}>
                        <option value="Member">Member</option>
                        <option value="Admin">Admin</option>
                      </select>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {u.isSuperAdmin || u._id === user._id ? (
                      <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(u)} style={{ color: '#ff6b6b' }}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ──────────────── Per-teamspace memberships ──────────────── */}
      <h3 style={{ fontSize: '1rem', marginTop: 32, marginBottom: 8 }}>Per-teamspace roles</h3>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 16 }}>
        A user can have a different role in each teamspace. Owner is set on the teamspace itself
        (in Teamspace Control) — change it there. Use the row below to add or change membership roles.
      </p>

      {/* Add new membership row */}
      <form onSubmit={handleAddMembership} style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 16, background: 'var(--bg-surface)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <label className="label">User</label>
          <select className="input" value={newMembership.userId} onChange={e => setNewMembership(p => ({ ...p, userId: e.target.value }))} required>
            <option value="">— Pick user —</option>
            {users.map(u => <option key={u._id} value={u._id}>{u.name} ({u.email})</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Teamspace</label>
          <select className="input" value={newMembership.teamspaceId} onChange={e => setNewMembership(p => ({ ...p, teamspaceId: e.target.value }))} required>
            <option value="">— Pick teamspace —</option>
            {teamspaces.filter(t => !t.isPersonal).map(t => <option key={t._id} value={t._id}>{t.icon || '🏢'} {t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={newMembership.role} onChange={e => setNewMembership(p => ({ ...p, role: e.target.value }))}>
            <option value="viewer">Viewer</option>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" type="submit">+ Add / Update</button>
      </form>

      {/* Matrix grouped by teamspace */}
      <div style={{ display: 'grid', gap: 12 }}>
        {teamspaces.filter(t => !t.isPersonal).map(ts => {
          const rows = byTs[String(ts._id)] || [];
          const ownerId = String(ts.ownerId || '');
          return (
            <div key={ts._id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '1.1rem' }}>{ts.icon || '🏢'}</span>
                <strong>{ts.name}</strong>
                <span className="muted" style={{ fontSize: '0.75rem' }}>({rows.length} member{rows.length === 1 ? '' : 's'})</span>
              </div>
              {rows.length === 0 ? (
                <div className="muted" style={{ padding: 12, fontSize: '0.8rem' }}>No members yet. Add one above.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <tbody>
                    {rows.map(m => {
                      const isOwner = String(m.userId?._id || m.userId) === ownerId;
                      return (
                        <tr key={m._id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 12px' }}>
                            {m.userId?.name || '(unknown)'} <span className="muted" style={{ fontSize: '0.72rem' }}>{m.userId?.email}</span>
                            {isOwner && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#ffeaa7', color: '#5e4a00', borderRadius: 3, fontSize: '0.68rem', fontWeight: 600 }}>OWNER</span>}
                          </td>
                          <td style={{ padding: '8px 12px', width: 140 }}>
                            <select className="input" style={{ padding: '4px 8px', fontSize: '0.78rem' }} value={m.role} onChange={e => handleMembershipRole(m, e.target.value)} disabled={isOwner}>
                              <option value="viewer">Viewer</option>
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', width: 90 }}>
                            {isOwner ? <span className="muted" style={{ fontSize: '0.72rem' }}>(owner)</span> : (
                              <button className="btn btn-ghost btn-sm" onClick={() => handleMembershipRemove(m)} style={{ color: '#ff6b6b', fontSize: '0.75rem' }}>Remove</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* ──────────────── Role permission reference ──────────────── */}
      <h3 style={{ fontSize: '1rem', marginTop: 32, marginBottom: 8 }}>What each role can do</h3>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 12 }}>
        Per-page CRUD matrix. Used by the sidebar gate and backend middleware. SuperAdmin overrides all and sees every page.
      </p>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead style={{ background: 'var(--bg-elevated)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Page / Resource</th>
              {['View', 'Create', 'Edit', 'Delete'].map(c => (
                <th key={c} style={{ padding: '10px 12px', textAlign: 'left', width: 180 }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map(row => (
              <tr key={row.area} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{row.area}</td>
                {['view','create','edit','delete'].map(action => (
                  <td key={action} style={{ padding: '8px 12px' }}>
                    {row[action].length === 0 ? <span className="muted" style={{ fontSize: '0.72rem' }}>nobody</span> : (
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {ROLES.map(r => roleHas(row[action], r) && (
                          <span key={r} style={{ padding: '1px 6px', borderRadius: 3, fontSize: '0.7rem', fontWeight: 600,
                            background: r === 'owner' ? '#ffeaa7' : r === 'admin' ? '#a29bfe' : r === 'member' ? '#74b9ff' : '#dfe6e9',
                            color: r === 'owner' ? '#5e4a00' : '#000',
                          }}>{r}</span>
                        ))}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '0.72rem', marginTop: 8 }}>
        🟡 owner = teamspace's <code>ownerId</code> · 🟣 admin = membership.role=admin · 🔵 member · ⚪ viewer
      </p>
    </div>
  );
}
