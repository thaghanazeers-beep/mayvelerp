import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeamspace } from '../context/TeamspaceContext';
import { useToast } from '../context/ToastContext';
import { getPlans, createPlan, getProjects, formatINR } from '../api';
import './PlanPages.css';

// Time → Plans page. Project-first flow:
//   1. User picks a project from the top.
//   2. Page shows that project's plan + approval history filtered to the
//      current user as creator (so each plan owner sees only their own plans).
//   3. "+ New plan" button creates a draft plan for the chosen project/month.

const STATUS_BADGE = {
  draft:    { label: 'Draft',    className: 'plan-badge plan-badge-draft' },
  pending:  { label: 'Pending',  className: 'plan-badge plan-badge-pending' },
  approved: { label: 'Approved', className: 'plan-badge plan-badge-approved' },
  rejected: { label: 'Rejected', className: 'plan-badge plan-badge-rejected' },
};

export default function PlanListPage() {
  const { activeTeamspaceId } = useTeamspace();
  const navigate = useNavigate();
  const toast = useToast();
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newPeriodMonth, setNewPeriodMonth] = useState(new Date().toISOString().slice(0, 7));
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Project list — projects are org-wide so the activeTeamspaceId is just a
  // back-compat hint, the API returns the full org-wide set.
  useEffect(() => {
    getProjects(activeTeamspaceId).then(r => setProjects(r.data)).catch(() => {});
  }, [activeTeamspaceId]);

  // Whenever the selected project changes, reload plans (current user, this project).
  useEffect(() => {
    if (!selectedProjectId) { setPlans([]); return; }
    setLoading(true);
    getPlans({ projectId: selectedProjectId, mine: 1 })
      .then(r => setPlans(r.data))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find(p => p._id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const monthLabel = (ym) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };
  const defaultTitlePreview = selectedProject
    ? `${selectedProject.name} ${monthLabel(newPeriodMonth)} Approval`
    : 'e.g. Marketing May 2026 Approval';

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(''); setCreating(true);
    try {
      const payload = { projectId: selectedProjectId, periodMonth: newPeriodMonth };
      if (newTitle.trim()) payload.title = newTitle.trim();
      const r = await createPlan(payload);
      setShowNew(false); setNewTitle('');
      toast.success('Draft plan created — add rows and submit when ready');
      navigate(`/t/${activeTeamspaceId}/time/plans/${r.data._id}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      toast.error(err.response?.data?.error || err.message);
    } finally { setCreating(false); }
  };

  return (
    <div className="plan-page">
      {/* Step 1: choose project */}
      <div className="plan-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Time · Plans</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 280 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>Project</span>
          <select
            className="input"
            style={{ minWidth: 260 }}
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
          >
            <option value="">— Select a project —</option>
            {projects.map(p => <option key={p._id} value={p._id}>{p.icon || '📁'} {p.name}</option>)}
          </select>
        </div>
        <button
          className="btn btn-primary btn-sm"
          disabled={!selectedProjectId}
          title={selectedProjectId ? 'Create a new plan for this project' : 'Pick a project first'}
          onClick={() => { setShowNew(true); setError(''); setNewTitle(''); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Plan
        </button>
      </div>

      {/* Step 2: plan history for the chosen project (current user) */}
      {!selectedProjectId ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <p>Pick a project above to see your plans and approval history.</p>
        </div>
      ) : loading ? (
        <div className="plan-empty"><div className="muted">Loading…</div></div>
      ) : plans.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <p>No plans yet for <strong>{selectedProject?.name}</strong>. Click <strong>+ New Plan</strong> to add one.</p>
        </div>
      ) : (
        <div className="plan-table-wrap">
          <div style={{ padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, marginBottom: 12, fontSize: '0.85rem' }}>
            Showing your plans for <strong>{selectedProject?.name}</strong> — {plans.length} plan{plans.length === 1 ? '' : 's'}
          </div>
          <table className="plan-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Title</th>
                <th>Hours (B / NB)</th>
                <th>Cost</th>
                <th>Revenue</th>
                <th>Profit</th>
                <th>Margin</th>
                <th>Status</th>
                <th>Approval</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p._id} className="plan-row" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans/${p._id}`)}>
                  <td>{p.periodMonth}</td>
                  <td className="plan-title">{p.title}</td>
                  <td className="num">{p.billablePlannedHours || 0} / {p.nonBillablePlannedHours || 0}</td>
                  <td className="num">{formatINR(p.totalCostCents)}</td>
                  <td className="num">{formatINR(p.totalRevenueCents)}</td>
                  <td className={`num ${p.plannedProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>{formatINR(p.plannedProfitCents)}</td>
                  <td className="num">{Math.round((p.plannedMarginPct || 0) * 100)}%</td>
                  <td><span className={STATUS_BADGE[p.status].className}>{STATUS_BADGE[p.status].label}</span></td>
                  <td className="muted" style={{ fontSize: '0.78rem' }}>
                    {p.status === 'approved' && p.approvedAt ? `✅ ${new Date(p.approvedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` :
                     p.status === 'rejected' && p.rejectedAt ? `❌ ${new Date(p.rejectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` :
                     p.status === 'pending'  && p.submittedAt? `⏳ submitted ${new Date(p.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` :
                     '—'}
                  </td>
                  <td className="muted">{new Date(p.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Step 3: add new plan modal */}
      {showNew && selectedProject && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2>New Plan — {selectedProject.name}</h2>
              <button className="btn-icon" onClick={() => setShowNew(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-field">
                <label className="label">Month</label>
                <input className="input" type="month" required value={newPeriodMonth} onChange={(e) => setNewPeriodMonth(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="label">Plan name <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input className="input" type="text" maxLength={120} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={defaultTitlePreview} />
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
