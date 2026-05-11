import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeamspace } from '../context/TeamspaceContext';
import { getPlans, createPlan, getProjects, formatINR } from '../api';
import './PlanPages.css';

const STATUS_BADGE = {
  draft:    { label: 'Draft',    className: 'plan-badge plan-badge-draft' },
  pending:  { label: 'Pending',  className: 'plan-badge plan-badge-pending' },
  approved: { label: 'Approved', className: 'plan-badge plan-badge-approved' },
  rejected: { label: 'Rejected', className: 'plan-badge plan-badge-rejected' },
};

export default function PlanListPage() {
  const { activeTeamspaceId } = useTeamspace();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [newProjectId, setNewProjectId] = useState('');
  const [newPeriodMonth, setNewPeriodMonth] = useState(new Date().toISOString().slice(0, 7));
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const monthLabel = (ym) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };
  const defaultTitlePreview = newProjectId
    ? `${projects.find(p => p._id === newProjectId)?.name || 'Project'} ${monthLabel(newPeriodMonth)} Approval`
    : 'e.g. Marketing May 2026 Approval';

  const reload = async () => {
    const [p, pr] = await Promise.all([getPlans(), getProjects(activeTeamspaceId)]);
    setPlans(p.data); setProjects(pr.data);
  };
  useEffect(() => { reload(); }, [activeTeamspaceId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(''); setCreating(true);
    try {
      const payload = { projectId: newProjectId, periodMonth: newPeriodMonth };
      if (newTitle.trim()) payload.title = newTitle.trim();
      const r = await createPlan(payload);
      setShowNew(false); setNewTitle('');
      navigate(`/t/${activeTeamspaceId}/time/plans/${r.data._id}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setCreating(false); }
  };

  const projectName = (id) => projects.find(p => p._id === id)?.name || '—';
  const projectIcon = (id) => projects.find(p => p._id === id)?.icon || '📁';

  return (
    <div className="plan-page">
      <div className="plan-toolbar">
        <h2 style={{ margin: 0 }}>Project Hours Plans</h2>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowNew(true); setError(''); setNewTitle(''); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <p>No plans yet. Create one for any month-project pair.</p>
        </div>
      ) : (
        <div className="plan-table-wrap">
          <table className="plan-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Month</th>
                <th>Title</th>
                <th>Hours (B / NB)</th>
                <th>Cost</th>
                <th>Revenue</th>
                <th>Profit</th>
                <th>Margin</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p._id} className="plan-row" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans/${p._id}`)}>
                  <td>{projectIcon(p.projectId)} {projectName(p.projectId)}</td>
                  <td>{p.periodMonth}</td>
                  <td className="plan-title">{p.title}</td>
                  <td className="num">{p.billablePlannedHours || 0} / {p.nonBillablePlannedHours || 0}</td>
                  <td className="num">{formatINR(p.totalCostCents)}</td>
                  <td className="num">{formatINR(p.totalRevenueCents)}</td>
                  <td className={`num ${p.plannedProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>{formatINR(p.plannedProfitCents)}</td>
                  <td className="num">{Math.round((p.plannedMarginPct || 0) * 100)}%</td>
                  <td><span className={STATUS_BADGE[p.status].className}>{STATUS_BADGE[p.status].label}</span></td>
                  <td className="muted">{new Date(p.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2>New Plan</h2>
              <button className="btn-icon" onClick={() => setShowNew(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-field">
                <label className="label">Project</label>
                <select className="input" required value={newProjectId} onChange={(e) => setNewProjectId(e.target.value)}>
                  <option value="">— Select —</option>
                  {projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="label">Month</label>
                <input className="input" type="month" required value={newPeriodMonth} onChange={(e) => setNewPeriodMonth(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="label">Plan name <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input
                  className="input"
                  type="text"
                  maxLength={120}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={defaultTitlePreview}
                />
                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                  Leave blank to auto-name. Duplicate names within the same month get a "(#N)" suffix.
                </div>
              </div>
              {error && <div className="auth-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>{creating ? 'Creating…' : 'Create draft'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
