import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import {
  getPlan, deletePlan, submitPlan, approvePlan, rejectPlan, reopenPlan, allocatePlan,
  getRateBuckets, getTaskTypes, getTeam, getProjects,
  createPlanLine, updatePlanLine, deletePlanLine, formatINR, exportPlanXlsxUrl,
} from '../api';
import './PlanPages.css';

const STATUSES = ['Yet-To-Start','In-Progress','On-hold','Completed','Cancelled'];
const DISTRIBUTIONS = ['Continuous','Distributed','Open'];

const STATUS_BADGE = {
  draft:    { label: 'Draft',    cls: 'plan-badge-draft' },
  pending:  { label: 'Pending Approval', cls: 'plan-badge-pending' },
  approved: { label: 'Approved', cls: 'plan-badge-approved' },
  rejected: { label: 'Rejected', cls: 'plan-badge-rejected' },
};

export default function PlanEditorPage() {
  const { planId } = useParams();
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const { activeTeamspaceId } = useTeamspace();

  const [plan, setPlan]       = useState(null);
  const [lines, setLines]     = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [types, setTypes]     = useState([]);
  const [members, setMembers] = useState([]);
  const [project, setProject] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const reload = async () => {
    const r = await getPlan(planId);
    setPlan(r.data.plan); setLines(r.data.lines);
    setFinancials(r.data.projectFinancials || null);
    if (r.data.plan?.projectId) {
      const ps = await getProjects(activeTeamspaceId);
      setProject(ps.data.find(p => p._id === r.data.plan.projectId) || null);
    }
  };
  useEffect(() => {
    (async () => {
      const [b, t, tm] = await Promise.all([getRateBuckets(), getTaskTypes(), getTeam(activeTeamspaceId)]);
      setBuckets(b.data); setTypes(t.data); setMembers(tm.data);
      await reload();
    })();
  }, [planId]);

  if (!plan) return <div className="plan-page"><div className="plan-empty">Loading…</div></div>;

  const isAdmin    = user?.role === 'Admin';
  const isOwner    = project && String(project.ownerId) === String(user?._id);
  const editable   = plan.status === 'draft' && (isOwner || isAdmin);
  const canSubmit  = (plan.status === 'draft' || plan.status === 'rejected') && (isOwner || isAdmin);
  const canApprove = plan.status === 'pending' && isAdmin;
  const canReopen  = plan.status === 'rejected' && (isOwner || isAdmin);

  const totals = {
    plannedHrs:    plan.totalPlannedHours || 0,
    billableHrs:   plan.billablePlannedHours || 0,
    nonBillableHrs:plan.nonBillablePlannedHours || 0,
    cost:          plan.totalCostCents || 0,
    billableCost:  plan.billableCostCents || 0,
    nonBillableCost: plan.nonBillableCostCents || 0,
    revenue:       plan.totalRevenueCents || 0,
    profit:        plan.plannedProfitCents || 0,
    margin:        plan.plannedMarginPct || 0,
  };

  // ─── Add a blank row ───
  const handleAddRow = async () => {
    if (!editable) return;
    const defaultBucket = buckets.find(b => b.name === 'Junior') || buckets[0];
    if (!defaultBucket) return alert('No rate buckets exist; ask an admin to set them up.');
    setBusy(true);
    try {
      await createPlanLine(planId, {
        taskType: types[0]?.name || 'Support',
        billable: true,
        assigneeBucketId: defaultBucket._id,
        startDate: plan.periodStart.slice(0, 10),
        targetDate: plan.periodEnd.slice(0, 10),
        plannedHours: 8,
        distributionType: 'Continuous',
        perDayDistribution: 1,
        billRateOverrideCents: project?.defaultBillRateCents || 250000,
      });
      await reload();
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  // ─── Patch a line field ───
  const handleLineChange = async (line, patch) => {
    const merged = { ...line, ...patch };
    // Optimistic local update
    setLines(prev => prev.map(l => l._id === line._id ? merged : l));
    try {
      const r = await updatePlanLine(planId, line._id, patch);
      // Re-fetch plan to refresh totals
      const r2 = await getPlan(planId); setPlan(r2.data.plan); setLines(r2.data.lines);
    } catch (e) {
      alert(e.response?.data?.error || e.message);
      reload();
    }
  };

  const handleDeleteLine = async (line) => {
    if (!editable) return;
    if (!confirm(`Delete line "${line.taskType}"?`)) return;
    await deletePlanLine(planId, line._id);
    await reload();
  };

  // ─── Workflow ───
  const handleSubmit = async () => {
    if (!confirm(`Submit "${plan.title}" for approval? Rates will be frozen.`)) return;
    setBusy(true);
    try { await submitPlan(planId); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const handleApprove = async () => {
    // Forecast-loss check: if the project has a contract value and approving this plan
    // would push committed cost past it (or already has), warn the admin.
    if (financials && financials.contractValueCents > 0) {
      const overBy = financials.committedCostCents - financials.contractValueCents;
      if (overBy > 0) {
        const overRupees = (overBy / 100).toLocaleString('en-IN');
        const contractRupees = (financials.contractValueCents / 100).toLocaleString('en-IN');
        const committedRupees = (financials.committedCostCents / 100).toLocaleString('en-IN');
        const msg = `⚠️ Forecast loss\n\n`
          + `Contract value: ₹${contractRupees}\n`
          + `Committed after approval: ₹${committedRupees}\n`
          + `Overrun: ₹${overRupees}\n\n`
          + `Approving this plan will commit cost beyond what the client has approved. Proceed?`;
        if (!confirm(msg)) return;
      } else if (!confirm('Approve this plan?')) return;
    } else if (!confirm('Approve this plan?')) return;
    setBusy(true);
    try { await approvePlan(planId); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const handleReject = async () => {
    if (rejectReason.trim().length < 10) return alert('Reason must be at least 10 characters');
    setBusy(true);
    try { await rejectPlan(planId, rejectReason); setShowReject(false); setRejectReason(''); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const handleReopen = async () => {
    if (!confirm('Reopen this rejected plan as a draft?')) return;
    setBusy(true);
    try { await reopenPlan(planId); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const handleDeletePlan = async () => {
    if (!confirm(`Delete plan "${plan.title}"? This also removes all its lines.`)) return;
    await deletePlan(planId);
    navigate(`/t/${activeTeamspaceId}/time/plans`);
  };

  const memberName = (id) => members.find(m => m._id === id)?.name || '—';

  return (
    <div className="plan-page">
      <div className="plan-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans`)}>← Back</button>
        <div style={{ flex: 1 }}>
          <div className="plan-h-title">{plan.title}</div>
          <div className="plan-h-sub">
            {project?.icon} {project?.name} · {plan.periodMonth} ·
            <span className={`plan-badge ${STATUS_BADGE[plan.status].cls}`} style={{ marginLeft: 8 }}>
              {STATUS_BADGE[plan.status].label}
            </span>
          </div>
        </div>

        {canSubmit  && <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleSubmit}>📤 Submit for Approval</button>}
        {canApprove && <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleApprove}>✅ Approve</button>}
        {canApprove && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setShowReject(true)}>❌ Reject</button>}
        {canReopen  && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={handleReopen}>🔄 Reopen as Draft</button>}
        <a className="btn btn-ghost btn-sm" href={exportPlanXlsxUrl(planId)} target="_blank" rel="noopener noreferrer" title="Download as Excel" onClick={(e) => {
          // axios includes the JWT via interceptor — but a plain anchor won't.
          // Fetch with the token, get a Blob, trigger download.
          e.preventDefault();
          (async () => {
            const token = localStorage.getItem('token');
            const res = await fetch(exportPlanXlsxUrl(planId), { headers: { Authorization: `Bearer ${token}`, 'x-teamspace-id': activeTeamspaceId } });
            if (!res.ok) { alert('Export failed: ' + res.status); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${(plan.title || 'plan').replace(/[^a-zA-Z0-9._-]+/g, '-')}.xlsx`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
          })();
        }}>📥 Excel</a>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/t/${activeTeamspaceId}/time/projects/${plan.projectId}/pnl?month=${plan.periodMonth}`)} title="Open the project P&L for this plan's month">📊 P&amp;L</button>
        {plan.status === 'draft' && (isOwner || isAdmin) && (
          <button className="btn-icon" title="Delete plan" onClick={handleDeletePlan}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        )}
      </div>

      {financials && financials.contractValueCents > 0 && (() => {
        const contract = financials.contractValueCents;
        const committed = financials.committedCostCents;
        const remaining = contract - committed;
        const pct = Math.min(100, Math.round((committed / contract) * 100));
        const over = committed > contract;
        return (
          <div className={`plan-banner ${over ? 'plan-banner-reject' : pct > 80 ? 'plan-banner-pending' : 'plan-banner-approved'}`}
               style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <strong>{financials.billingType === 'fixed' ? '📜 Fixed-bid contract' : '⏱ T&M contract ceiling'}:</strong>{' '}
              {formatINR(committed)} committed of {formatINR(contract)} ({pct}%)
              {over ? (
                <span style={{ marginLeft: 8 }}>— overrun by <strong>{formatINR(committed - contract)}</strong> (forecast loss)</span>
              ) : (
                <span style={{ marginLeft: 8 }}>— {formatINR(remaining)} remaining</span>
              )}
            </div>
            <div style={{ width: 140, height: 8, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: over ? 'var(--accent-red)' : pct > 80 ? 'var(--accent-orange)' : 'var(--accent-green, #00b894)' }} />
            </div>
          </div>
        );
      })()}

      {plan.status === 'rejected' && plan.rejectionReason && (
        <div className="plan-banner plan-banner-reject">
          <strong>Rejected by {plan.rejectedBy}:</strong> {plan.rejectionReason}
        </div>
      )}
      {plan.status === 'approved' && (
        <div className="plan-banner plan-banner-approved" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <strong>Approved</strong> by {plan.approvedBy} on {new Date(plan.approvedAt).toLocaleDateString('en-IN')} — rates frozen, plan locked.
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
            if (!confirm('Allocate this approved plan? Creates one Task per line and weekly hour allocations for each assignee.')) return;
            setBusy(true);
            try {
              const r = await allocatePlan(planId);
              alert(`Allocated: ${r.data.tasksCreated.length} task(s), ${r.data.allocationsCreated.length} weekly bucket(s), ${r.data.skipped.length} skipped.`);
              navigate(`/t/${activeTeamspaceId}/time/plans/${planId}/allocations`);
            } catch (e) { alert(e.response?.data?.error || e.message); }
            finally { setBusy(false); }
          }}>📅 Allocate hours</button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans/${planId}/allocations`)}>View allocations →</button>
        </div>
      )}
      {plan.status === 'pending' && (
        <div className="plan-banner plan-banner-pending">
          <strong>Pending</strong> admin approval — submitted by {plan.submittedBy} on {new Date(plan.submittedAt).toLocaleDateString('en-IN')}.
        </div>
      )}

      <div className="plan-grid-wrap">
        <table className="plan-grid">
          <thead>
            <tr>
              <th>Task Type</th>
              <th>B/NB</th>
              <th>Assignee</th>
              <th>Bucket</th>
              <th>Start</th>
              <th>Target</th>
              <th>Planned</th>
              <th>Actual</th>
              <th>Distribution</th>
              <th>Per Day</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Revenue</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l._id} className={l.billable ? '' : 'plan-row-nb'}>
                <td>
                  <select disabled={!editable} value={l.taskType} onChange={e => handleLineChange(l, { taskType: e.target.value })}>
                    {types.map(t => <option key={t._id} value={t.name}>{t.name}</option>)}
                  </select>
                </td>
                <td className="center">
                  <select disabled={!editable} value={l.billable ? 'B' : 'NB'} onChange={e => handleLineChange(l, { billable: e.target.value === 'B' })}>
                    <option value="B">B</option><option value="NB">NB</option>
                  </select>
                </td>
                <td>
                  <select disabled={!editable} value={l.assigneeUserId || ''} onChange={e => handleLineChange(l, { assigneeUserId: e.target.value || null })}>
                    <option value="">—</option>
                    {members.map(m => <option key={m._id} value={m._id}>{m.name}</option>)}
                  </select>
                </td>
                <td>
                  <select disabled={!editable} value={l.assigneeBucketId} onChange={e => handleLineChange(l, { assigneeBucketId: e.target.value })}>
                    {buckets.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </td>
                <td><input type="date" disabled={!editable} value={l.startDate?.slice(0,10) || ''} onChange={e => handleLineChange(l, { startDate: e.target.value })} /></td>
                <td><input type="date" disabled={!editable} value={l.targetDate?.slice(0,10) || ''} onChange={e => handleLineChange(l, { targetDate: e.target.value })} /></td>
                <td className="num"><input type="number" min="0" step="1" disabled={!editable} value={l.plannedHours} onChange={e => handleLineChange(l, { plannedHours: Number(e.target.value) })} /></td>
                <td className="num muted">{l.actualHours || 0}</td>
                <td>
                  <select disabled={!editable} value={l.distributionType} onChange={e => handleLineChange(l, { distributionType: e.target.value })}>
                    {DISTRIBUTIONS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </td>
                <td className="num"><input type="number" min="0" step="0.5" disabled={!editable} value={l.perDayDistribution || 0} onChange={e => handleLineChange(l, { perDayDistribution: Number(e.target.value) })} /></td>
                <td>
                  <select disabled={!editable} value={l.status} onChange={e => handleLineChange(l, { status: e.target.value })}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className="num">{formatINR(l.costCents)}</td>
                <td className="num">{l.billable ? formatINR(l.revenueCents) : '—'}</td>
                <td>
                  {editable && (
                    <button className="btn-icon" title="Delete line" onClick={() => handleDeleteLine(l)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {editable && (
            <tfoot>
              <tr><td colSpan={14}><button className="plan-add-row" onClick={handleAddRow} disabled={busy}>+ Add row</button></td></tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ─── Totals card ─── */}
      <div className="plan-totals">
        <div>
          <div className="plan-totals-grid">
            <div></div><div className="plan-th">Billable</div><div className="plan-th">Non-Billable</div><div className="plan-th">Total</div>

            <div className="plan-tl">Planned Hours</div>
            <div className="num">{totals.billableHrs}</div>
            <div className="num">{totals.nonBillableHrs}</div>
            <div className="num strong">{totals.plannedHrs}</div>

            <div className="plan-tl">Cost</div>
            <div className="num">{formatINR(totals.billableCost)}</div>
            <div className="num">{formatINR(totals.nonBillableCost)}</div>
            <div className="num strong">{formatINR(totals.cost)}</div>

            <div className="plan-tl">Revenue</div>
            <div className="num">{formatINR(totals.revenue)}</div>
            <div className="num muted">—</div>
            <div className="num strong">{formatINR(totals.revenue)}</div>
          </div>
          <div className="plan-pl-row">
            <div>
              <div className="plan-pl-label">Planned Profit</div>
              <div className={`plan-pl-value ${totals.profit < 0 ? 'plan-loss' : 'plan-profit'}`}>{formatINR(totals.profit)}</div>
            </div>
            <div>
              <div className="plan-pl-label">Margin</div>
              <div className={`plan-pl-value ${totals.margin < 0.15 ? 'plan-loss' : totals.margin < 0.3 ? 'plan-amber' : 'plan-profit'}`}>{Math.round(totals.margin * 100)}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Reject modal ─── */}
      {showReject && (
        <div className="modal-overlay" onClick={() => setShowReject(false)}>
          <div className="modal animate-in" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reject plan</h2>
              <button className="btn-icon" onClick={() => setShowReject(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-form">
              <p className="muted">Reason will be sent to the project owner. Minimum 10 characters.</p>
              <textarea className="input" rows={4} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="e.g. Hours look too high for the scope; please re-estimate Support hours…" />
              <div className="modal-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setShowReject(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={busy || rejectReason.trim().length < 10} onClick={handleReject}>Reject Plan</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
