import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTeamspace } from '../context/TeamspaceContext';
import { getProjectPnL, formatINR, projectPnlPdfUrl } from '../api';
import './PlanPages.css';

const isoMonth = (d = new Date()) => d.toISOString().slice(0, 7);

export default function ProjectPnLPage() {
  const { projectId } = useParams();
  const [search]       = useSearchParams();
  const month          = search.get('month') || isoMonth();
  const navigate       = useNavigate();
  const { activeTeamspaceId } = useTeamspace();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    getProjectPnL(projectId, month)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message));
  }, [projectId, month]);

  if (error) return <div className="plan-page"><div className="plan-banner plan-banner-reject">{error}</div></div>;
  if (!data) return <div className="plan-page"><div className="plan-empty">Loading…</div></div>;

  const { plan, project, byBucket, projectFinancials } = data;
  const internal = !plan.totalRevenueCents;
  const variance = (plan.totalActualCostCents || 0) - (plan.totalCostCents || 0);

  const contract = projectFinancials?.contractValueCents || 0;
  const billingType = projectFinancials?.billingType || 'tm';
  const committed = projectFinancials?.committedCostCents || 0;
  const spent     = projectFinancials?.actualCostCents || 0;
  const status    = projectFinancials?.status || 'open';
  const STATUS_LABEL = {
    healthy:           { text: 'Healthy', cls: 'plan-badge-approved' },
    forecast_overrun:  { text: 'Forecast overrun', cls: 'plan-badge-pending' },
    realized_loss:     { text: 'Realized loss',    cls: 'plan-badge-rejected' },
    open:              { text: 'No commitments yet', cls: 'plan-badge-draft' },
  };

  return (
    <div className="plan-page">
      <div className="plan-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard?tab=finance')}>← Dashboard</button>
        <div style={{ flex: 1 }}>
          <div className="plan-h-title">{project?.icon} {project?.name} — P&amp;L</div>
          <div className="plan-h-sub">{plan.title} · status: {plan.status} · default bill rate: ₹{Math.round((project?.defaultBillRateCents || 0) / 100)}/hr</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={async () => {
          // The PDF endpoint is JWT-gated; fetch then trigger a save-as so the browser doesn't open a blank tab.
          const token = localStorage.getItem('token');
          const r = await fetch(projectPnlPdfUrl(projectId, month), {
            headers: { Authorization: `Bearer ${token}`, 'x-teamspace-id': activeTeamspaceId },
          });
          if (!r.ok) { alert('PDF export failed: ' + r.status); return; }
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-')}-pnl-${month}.pdf`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        }}>📥 PDF</button>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans/${plan._id}`)}>Open plan →</button>
      </div>

      {internal && (
        <div className="plan-banner plan-banner-pending">
          Internal project — no revenue. Loss equals total actual cost.
        </div>
      )}

      {projectFinancials && (
        <div className="plan-totals" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
              {billingType === 'fixed' ? '📜 Fixed-bid contract' : '⏱ Time & Materials'}
            </h3>
            <span className={`plan-badge ${STATUS_LABEL[status].cls}`}>{STATUS_LABEL[status].text}</span>
          </div>

          {contract > 0 ? (
            <>
              <div className="plan-totals-grid" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
                <div></div>
                <div className="plan-th">Contract value</div>
                <div className="plan-th">Committed (plans)</div>
                <div className="plan-th">Spent (actuals)</div>

                <div className="plan-tl">Amount</div>
                <div className="num strong">{formatINR(contract)}</div>
                <div className={`num strong ${committed > contract ? 'plan-loss' : ''}`}>{formatINR(committed)}</div>
                <div className={`num strong ${spent > contract ? 'plan-loss' : ''}`}>{formatINR(spent)}</div>

                <div className="plan-tl">% of contract</div>
                <div className="num">100%</div>
                <div className={`num ${committed > contract ? 'plan-loss' : committed > contract * 0.8 ? 'plan-amber' : 'plan-profit'}`}>
                  {Math.round((committed / contract) * 100)}%
                </div>
                <div className={`num ${spent > contract ? 'plan-loss' : spent > contract * 0.8 ? 'plan-amber' : 'plan-profit'}`}>
                  {Math.round((spent / contract) * 100)}%
                </div>
              </div>

              <div className="plan-pl-row" style={{ marginTop: 12 }}>
                <div>
                  <div className="plan-pl-label">Forecast profit</div>
                  <div className={`plan-pl-value ${projectFinancials.forecastProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>
                    {formatINR(projectFinancials.forecastProfitCents)}
                  </div>
                </div>
                <div>
                  <div className="plan-pl-label">Actual profit</div>
                  <div className={`plan-pl-value ${projectFinancials.actualProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>
                    {formatINR(projectFinancials.actualProfitCents)}
                  </div>
                </div>
                <div>
                  <div className="plan-pl-label">{committed > contract ? 'Forecast loss (overrun)' : 'Contract remaining'}</div>
                  <div className={`plan-pl-value ${committed > contract ? 'plan-loss' : 'plan-profit'}`}>
                    {formatINR(Math.abs(contract - committed))}
                  </div>
                </div>
                <div>
                  <div className="plan-pl-label">Realized loss</div>
                  <div className={`plan-pl-value ${projectFinancials.actualLossCents > 0 ? 'plan-loss' : 'plan-profit'}`}>
                    {projectFinancials.actualLossCents > 0 ? formatINR(projectFinancials.actualLossCents) : '—'}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              No contract value set on this project. {billingType === 'fixed' ? 'Fixed-bid projects require a contract value — set one in the project settings.' : 'For T&M, loss = cost > revenue (calculated from time entries below).'}
            </div>
          )}
        </div>
      )}

      <div className="plan-totals">
        <div className="plan-totals-grid" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
          <div></div><div className="plan-th">Billable</div><div className="plan-th">Non-Billable</div><div className="plan-th">Total</div>

          <div className="plan-tl">Planned hours</div>
          <div className="num">{plan.billablePlannedHours}</div>
          <div className="num">{plan.nonBillablePlannedHours}</div>
          <div className="num strong">{plan.totalPlannedHours}</div>

          <div className="plan-tl">Actual hours</div>
          <div className="num">{plan.billableActualHours}</div>
          <div className="num">{plan.nonBillableActualHours}</div>
          <div className="num strong">{plan.totalActualHours}</div>

          <div className="plan-tl">Planned cost</div>
          <div className="num">{formatINR(plan.billableCostCents)}</div>
          <div className="num">{formatINR(plan.nonBillableCostCents)}</div>
          <div className="num strong">{formatINR(plan.totalCostCents)}</div>

          <div className="plan-tl">Actual cost</div>
          <div className="num">{formatINR(plan.billableActualCostCents)}</div>
          <div className="num">{formatINR(plan.nonBillableActualCostCents)}</div>
          <div className="num strong">{formatINR(plan.totalActualCostCents)}</div>

          {!internal && (
            <>
              <div className="plan-tl">Planned revenue</div>
              <div className="num">{formatINR(plan.totalRevenueCents)}</div>
              <div className="num muted">—</div>
              <div className="num strong">{formatINR(plan.totalRevenueCents)}</div>

              <div className="plan-tl">Actual revenue</div>
              <div className="num">{formatINR(plan.totalActualRevenueCents)}</div>
              <div className="num muted">—</div>
              <div className="num strong">{formatINR(plan.totalActualRevenueCents)}</div>
            </>
          )}
        </div>

        <div className="plan-pl-row">
          <div>
            <div className="plan-pl-label">Planned profit</div>
            <div className={`plan-pl-value ${plan.plannedProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>{formatINR(plan.plannedProfitCents)}</div>
          </div>
          <div>
            <div className="plan-pl-label">Actual profit</div>
            <div className={`plan-pl-value ${plan.actualProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>{formatINR(plan.actualProfitCents)}</div>
          </div>
          <div>
            <div className="plan-pl-label">Margin (actual)</div>
            <div className={`plan-pl-value ${plan.actualMarginPct < 0.15 ? 'plan-loss' : plan.actualMarginPct < 0.30 ? 'plan-amber' : 'plan-profit'}`}>{Math.round((plan.actualMarginPct || 0) * 100)}%</div>
          </div>
          <div>
            <div className="plan-pl-label">Variance vs plan</div>
            <div className={`plan-pl-value ${variance > 0 ? 'plan-loss' : 'plan-profit'}`}>{variance > 0 ? '+' : ''}{formatINR(variance)}</div>
          </div>
        </div>
      </div>

      <div className="plan-table-wrap">
        <table className="plan-table">
          <thead>
            <tr><th>Bucket</th><th>Kind</th><th className="num">Planned hrs</th><th className="num">Actual hrs</th><th className="num">Planned cost</th><th className="num">Actual cost</th><th className="num">Billable</th><th className="num">Non-Billable</th></tr>
          </thead>
          <tbody>
            {byBucket.map(b => (
              <tr key={b.bucketName}>
                <td>{b.bucketName}</td>
                <td className="muted">{b.kind}</td>
                <td className="num">{b.plannedHours}</td>
                <td className="num">{b.actualHours}</td>
                <td className="num">{formatINR(b.costCents)}</td>
                <td className="num">{formatINR(b.actualCostCents)}</td>
                <td className="num">{formatINR(b.billable)}</td>
                <td className="num">{formatINR(b.nonBillable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
