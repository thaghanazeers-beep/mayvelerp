import { useState, useEffect } from 'react';
import { getTeamspaces, createTeamspace, updateTeamspace, deleteTeamspace } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';

const ICONS = ['🏢', '🚀', '🎨', '💻', '📊', '🔬', '📱', '🎯', '⚡', '🌟', '🎮', '📈', '🛠️', '🏗️', '🧪', '📝'];

export default function TeamspaceControlPage() {
  const { user } = useAuth();
  const { activeTeamspaceId, setActiveTeamspaceId, teamspaces, refreshTeamspaces } = useTeamspace();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏢');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const activeTs = teamspaces.find(ts => ts._id === activeTeamspaceId);
    if (activeTs) {
      setName(activeTs.name);
      setIcon(activeTs.icon || '🏢');
      setDescription(activeTs.description || '');
    }
  }, [activeTeamspaceId, teamspaces]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!activeTeamspaceId) return;
    try {
      setLoading(true);
      await updateTeamspace(activeTeamspaceId, { name, icon, description });
      await refreshTeamspaces();
      alert('Teamspace settings updated successfully');
    } catch { 
      alert('Failed to update teamspace'); 
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const activeTs = teamspaces.find(ts => ts._id === activeTeamspaceId);
    if (!activeTs) return;
    if (!confirm(`Delete teamspace "${activeTs.name}"? All data within will be unlinked.`)) return;
    try {
      setLoading(true);
      await deleteTeamspace(activeTeamspaceId);
      setActiveTeamspaceId('');
      await refreshTeamspaces();
    } catch { 
      alert('Failed to delete teamspace'); 
    } finally {
      setLoading(false);
    }
  };

  if (!activeTeamspaceId) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
        <h3 style={{ margin: '0 0 8px' }}>Personal Teamspace</h3>
        <p style={{ margin: 0, marginBottom: 24 }}>The Personal Teamspace does not have specific controls.</p>
        <button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('OPEN_CREATE_TS'))}>
          + Create Organization Teamspace
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="tasks-loading"><div className="spinner" style={{ width: 28, height: 28 }} /></div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0 }}>Configure settings for the current teamspace</p>
      </div>

      <div className="card" style={{ padding: '24px', borderRadius: 12, border: '1px solid var(--border)' }}>
        <form onSubmit={handleUpdate}>
          <div className="form-field" style={{ marginBottom: 20 }}>
            <label className="label" style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Engineering, Marketing..." required />
          </div>
          <div className="form-field" style={{ marginBottom: 20 }}>
            <label className="label" style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Icon</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICONS.map(ic => (
                <button key={ic} type="button" onClick={() => setIcon(ic)} style={{ width: 36, height: 36, borderRadius: 8, border: icon === ic ? '2px solid var(--primary)' : '1px solid var(--border)', background: icon === ic ? 'rgba(108,92,231,0.12)' : 'transparent', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field" style={{ marginBottom: 24 }}>
            <label className="label" style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Description</label>
            <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of this teamspace..." rows={3} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>

      {/* Danger Zone */}
      <div style={{ marginTop: 40 }}>
        <h3 style={{ color: 'var(--color-danger)', fontSize: '1.1rem', marginBottom: 12 }}>Danger Zone</h3>
        <div className="card" style={{ padding: '20px', border: '1px solid rgba(255, 118, 117, 0.3)', borderRadius: 12, background: 'rgba(255, 118, 117, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--text-color)' }}>Delete this teamspace</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Once you delete a teamspace, there is no going back. Please be certain.</p>
            </div>
            <button className="btn btn-ghost" style={{ color: 'var(--color-danger)', border: '1px solid rgba(255, 118, 117, 0.5)' }} onClick={handleDelete}>
              Delete Teamspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
