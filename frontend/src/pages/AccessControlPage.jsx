import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listAllUsers, createUser, updateUser, deleteUserAccount } from '../api';

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

  const fetchUsers = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await listAllUsers();
      setUsers(r.data);
    } catch (e) {
      setErr(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchUsers(); }, []);

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
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

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
    </div>
  );
}
