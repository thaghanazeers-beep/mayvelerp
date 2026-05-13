import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import { getPlans, getProjects, formatINR } from '../api';
import { PageIntro, NextStepHint } from '../components/PageIntro';
import './PlanPages.css';

export default function PlanApprovalsPage() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    (async () => {
      // Show only plans pending the CURRENT user's approval — backend filters
      // to plans whose project.ownerId matches req.user.userId. Anyone who
      // happens to be Admin can land on this page; the list will simply be
      // empty if they don't own any projects.
      const [p, pr] = await Promise.all([
        getPlans({ awaitingMyApproval: 1 }),
        getProjects(activeTeamspaceId),
      ]);
      setPlans(p.data); setProjects(pr.data);
    })();
  }, [activeTeamspaceId]);

  // No role gate: the backend already filters `?awaitingMyApproval=1` to
  // plans whose project.ownerId === req.user.userId (plus SuperAdmin sees all).
  // The old `if (user?.role !== 'Admin')` gate locked out project owners who
  // weren't global Admins, even though those are exactly the people who
  // should see this page.

  const proj = (id) => projects.find(p => p._id === id);

  return (
    <div className="plan-page">
      <PageIntro
        icon="✅"
        title="Plan Approvals"
        actor="Project Owners"
        purpose="Plans submitted by PMs for projects you own are listed here. Open one to review hours, cost, revenue and profit before you approve or reject."
        storageKey="plan-approvals"
        youCanDo={[
          'Click a plan to open the full breakdown (allocations, rates, margin)',
          'Approve the plan to release the budget for execution',
          'Reject with a comment to send it back to the PM for revision',
        ]}
        whatHappensNext={[
          'Approve → plan status becomes Approved, PM is notified, time logging is enabled against this plan',
          'Reject → plan goes back to Draft, PM gets your comment in their notifications',
          'Project P&L starts comparing planned vs. actual the moment a plan is approved',
        ]}
      />

      <div className="plan-toolbar">
        <h2 style={{ margin: 0 }}>Plan Approvals</h2>
        <span className="muted">{plans.length} pending</span>
      </div>

      {plans.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <p>No plans waiting for your approval.</p>
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Only plans submitted for projects you own appear here. When a PM clicks <strong>Submit for approval</strong> on a budget plan, it will show up in this list.
          </p>
        </div>
      ) : (
        <div className="plan-approval-list">
          {plans.map(p => {
            const project = proj(p.projectId);
            return (
              <div key={p._id} className="plan-approval-card" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans/${p._id}`)}>
                <div className="plan-approval-head">
                  <div>
                    <div className="plan-approval-title">{project?.icon} {project?.name} — {p.periodMonth}</div>
                    <div className="muted">{p.title}</div>
                  </div>
                  <div className="plan-approval-meta">
                    <div><span className="muted">Submitted by</span> <strong>{p.submittedBy}</strong></div>
                    <div className="muted">{new Date(p.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </div>
                </div>
                <div className="plan-approval-stats">
                  <div><span className="muted">Hours</span> <strong>{p.totalPlannedHours}</strong> ({p.billablePlannedHours}B / {p.nonBillablePlannedHours}NB)</div>
                  <div><span className="muted">Cost</span> <strong>{formatINR(p.totalCostCents)}</strong></div>
                  <div><span className="muted">Revenue</span> <strong>{formatINR(p.totalRevenueCents)}</strong></div>
                  <div><span className="muted">Profit</span> <strong className={p.plannedProfitCents < 0 ? 'plan-loss' : 'plan-profit'}>{formatINR(p.plannedProfitCents)}</strong></div>
                  <div><span className="muted">Margin</span> <strong>{Math.round((p.plannedMarginPct||0)*100)}%</strong></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <NextStepHint>Click to review, then <strong>Approve</strong> or <strong>Reject</strong> from the plan editor</NextStepHint>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>Open plan →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
