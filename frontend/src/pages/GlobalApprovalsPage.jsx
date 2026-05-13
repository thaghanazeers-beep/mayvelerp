import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getPlans, getProjects, getTeamspaces, approvePlan, financeCountersignPlan, rejectPlan, formatINR } from '../api';
import { PageIntro } from '../components/PageIntro';
import './PlanPages.css';

// One-stop approvals center for Super Admin. Lists every pending plan across
// every workspace so the workspace owner doesn't have to flip in and out of
// each teamspace to triage approvals.
//
// Backend routes already grant SuperAdmin access to all pending plans via
// `?awaitingMyApproval=1` so we just reuse that.

export default function GlobalApprovalsPage() {
  const { user, isSuperAdminActive } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teamspaces, setTeamspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTs, setFilterTs] = useState('all');
  const [busy, setBusy] = useState(null);   // plan _id currently being acted on
  const [rejectPlanId, setRejectPlanId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      const [p, pr, ts] = await Promise.all([
        getPlans({ awaitingMyApproval: 1 }),
        getProjects(),
        getTeamspaces(),
      ]);
      setPlans(p.data); setProjects(pr.data); setTeamspaces(ts.data);
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };
  // useEffect must run unconditionally so Rules of Hooks stay satisfied even
  // when the user toggles Super Admin on/off without remounting the page.
  useEffect(() => {
    if (user?.isSuperAdmin && isSuperAdminActive) reload();
  }, [user?.isSuperAdmin, isSuperAdminActive]);

  if (!user?.isSuperAdmin) return <div className="plan-page"><div className="plan-empty">Super Admin only.</div></div>;
  if (!isSuperAdminActive) return (
    <div className="plan-page" style={{ padding: 24 }}>
      <h2>Switch to Super Admin mode</h2>
      <p className="muted">Flip the Super Admin toggle in the header to access the global approvals center.</p>
    </div>
  );

  const projById = Object.fromEntries(projects.map(p => [String(p._id), p]));
  const tsById   = Object.fromEntries(teamspaces.map(t => [String(t._id), t]));
  const filtered = filterTs === 'all' ? plans : plans.filter(p => String(p.teamspaceId) === filterTs);

  const handleApprove = async (plan) => {
    if (!confirm(`Approve "${plan.title}" for ${projById[plan.projectId]?.name || 'project'}?`)) return;
    setBusy(plan._id);
    try {
      await approvePlan(plan._id);
      toast.success(`Approved: ${plan.title}`);
      await reload();
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };
  const handleCountersign = async (plan) => {
    const thresholdRupees = ((plan.financeCountersignThresholdCents || 0)/100).toLocaleString('en-IN');
    if (!confirm(`Counter-sign "${plan.title}"?\n\nThis plan exceeds ₹${thresholdRupees}. Counter-signing releases the budget for allocation and time logging.`)) return;
    setBusy(plan._id);
    try {
      await financeCountersignPlan(plan._id);
      toast.success(`Counter-signed: ${plan.title}`);
      await reload();
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };
  const openReject = (planId) => { setRejectPlanId(planId); setRejectReason(''); };
  const submitReject = async () => {
    if (rejectReason.trim().length < 10) { toast.error('Reason must be at least 10 characters'); return; }
    setBusy(rejectPlanId);
    try {
      await rejectPlan(rejectPlanId, rejectReason.trim());
      toast.success('Plan rejected — owner notified');
      setRejectPlanId(null); setRejectReason('');
      await reload();
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };

  // Group by workspace for clearer scanning
  const grouped = {};
  for (const p of filtered) {
    const key = String(p.teamspaceId);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  }

  return (
    <div className="plan-page">
      <PageIntro
        icon="🌐"
        title="Approvals — all workspaces"
        actor="Super Admin"
        purpose="Bird\'s-eye view of every budget plan waiting on someone\'s approval. Two kinds appear here: regular pending plans (you can approve on an owner\'s behalf) and plans awaiting Finance counter-sign (these are over the org-wide threshold and require your second signature)."
        storageKey="global-approvals"
        youCanDo={[
          'Filter to a specific workspace to see only those plans',
          'Click a plan to open the full editor and review the breakdown',
          'Approve a pending plan inline (Super Admin override of the owner)',
          'Counter-sign a plan that\'s already been owner-approved but is over the ₹5,00,000 finance threshold',
        ]}
        whatHappensNext={[
          'Approve a pending plan → status becomes Approved (or Awaiting Finance if it\'s over threshold)',
          'Counter-sign → plan becomes Approved, allocations and time logging unlock, owner is notified',
          'Reject → plan returns to Draft with your comment, PM is notified to revise',
        ]}
      />

      <div className="plan-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Approvals — all workspaces</h2>
        <span className="muted">{filtered.length} pending</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>Filter</span>
          <select className="input" value={filterTs} onChange={(e) => setFilterTs(e.target.value)} style={{ minWidth: 220 }}>
            <option value="all">All workspaces</option>
            {teamspaces.filter(t => !t.isPersonal).map(t => <option key={t._id} value={t._id}>{t.icon || '🏢'} {t.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="plan-empty"><div className="muted">Loading…</div></div>
      ) : filtered.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <p>Nothing pending. All caught up.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {Object.entries(grouped).map(([tsId, list]) => {
            const ts = tsById[tsId];
            return (
              <div key={tsId} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{ts?.icon || '🏢'}</span>
                  <strong>{ts?.name || '(unknown)'}</strong>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>· {list.length} pending</span>
                </div>
                {list.map(p => {
                  const proj = projById[p.projectId];
                  const isAwaitingFinance = p.status === 'awaiting_finance';
                  return (
                    <div key={p._id} style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ flex: 1 }}>
                          <strong>{proj?.name || 'Project'} — {p.periodMonth}</strong>
                          <span className="muted" style={{ marginLeft: 8 }}>{p.title}</span>
                          {isAwaitingFinance && (
                            <span className="plan-badge plan-badge-pending" style={{ marginLeft: 8, borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}>🏦 Awaiting Finance</span>
                          )}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/t/${tsId}/time/plans/${p._id}`)} title="Open editor">Open →</button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: '0.82rem', marginBottom: 8 }}>
                        <span><span className="muted">By</span> <strong>{p.submittedBy}</strong></span>
                        <span><span className="muted">Hours</span> <strong>{p.totalPlannedHours}</strong></span>
                        <span><span className="muted">Cost</span> <strong>{formatINR(p.totalCostCents)}</strong></span>
                        <span><span className="muted">Revenue</span> <strong>{formatINR(p.totalRevenueCents)}</strong></span>
                        <span><span className="muted">Profit</span> <strong className={p.plannedProfitCents < 0 ? 'plan-loss' : 'plan-profit'}>{formatINR(p.plannedProfitCents)}</strong></span>
                        <span><span className="muted">{isAwaitingFinance ? 'Owner approved' : 'Submitted'}</span> <strong>{new Date(isAwaitingFinance ? p.ownerApprovedAt : p.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</strong></span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {isAwaitingFinance ? (
                          <button className="btn btn-primary btn-sm" disabled={busy === p._id} onClick={() => handleCountersign(p)}>🏦 Counter-sign</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" disabled={busy === p._id} onClick={() => handleApprove(p)}>✅ Approve</button>
                        )}
                        <button className="btn btn-ghost btn-sm" disabled={busy === p._id} style={{ color: '#e74c3c' }} onClick={() => openReject(p._id)}>❌ Reject</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {rejectPlanId && (
        <div className="modal-overlay" onClick={() => setRejectPlanId(null)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h2>Reject plan</h2>
              <button className="btn-icon" onClick={() => setRejectPlanId(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-form">
              <div className="form-field">
                <label className="label">Reason <span className="muted" style={{ fontWeight: 400 }}>(min 10 chars, shown to plan owner)</span></label>
                <textarea className="input" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Bill rate too low for Lead role — revise to ₹4500/hr" />
              </div>
              <div className="modal-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setRejectPlanId(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" style={{ background: '#e74c3c' }} disabled={busy === rejectPlanId} onClick={submitReject}>Reject &amp; notify owner</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
