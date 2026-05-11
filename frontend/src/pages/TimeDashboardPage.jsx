import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeamspace } from '../context/TeamspaceContext';
import {
  getTimeDashboardTotals, getTimeDashboardPipeline,
  getProjectsReport, getCostByBucket, getMonthlyTrend,
  getProjects, formatINR, exportEntriesUrl, exportPlansUrl,
} from '../api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import './PlanPages.css';

const COLORS = ['#6c5ce7','#74b9ff','#3fb950','#d29922','#f85149','#bc8cff','#39d2c0','#ff9800','#a29bfe','#fd79a8'];

const isoMonth = (d = new Date()) => d.toISOString().slice(0, 7);
const monthLabel = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

function Kpi({ label, value, sublabel, color }) {
  return (
    <div className="kpi-card" style={{ borderLeft: `3px solid ${color || 'var(--primary)'}` }}>
      <div className="kpi-info">
        <h3 style={{ color: color || 'var(--text)' }}>{value}</h3>
        <span>{label}</span>
        {sublabel && <span style={{ display: 'block', fontSize: '0.7rem', marginTop: 2 }}>{sublabel}</span>}
      </div>
    </div>
  );
}

export default function TimeDashboardPage() {
  const { activeTeamspaceId } = useTeamspace();
  const navigate = useNavigate();
  const [month, setMonth]       = useState(isoMonth());
  const [projectFilter, setProjectFilter] = useState('');     // '' = all
  const [statusFilter,  setStatusFilter]  = useState('approved');
  const [totals, setTotals]     = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [projects, setProjects] = useState([]);
  const [buckets, setBuckets]   = useState([]);
  const [trend, setTrend]       = useState([]);
  const [allProjects, setAllProjects] = useState([]);    // for the project picker

  // Load list of projects once
  useEffect(() => {
    (async () => {
      const r = await getProjects(activeTeamspaceId);
      setAllProjects(r.data);
    })();
  }, [activeTeamspaceId]);

  useEffect(() => {
    (async () => {
      const baseParams = { month };
      if (projectFilter) baseParams.projectId = projectFilter;
      if (statusFilter)  baseParams.status    = statusFilter;
      const [t, p, pr, cb, tr] = await Promise.all([
        getTimeDashboardTotals(baseParams),
        getTimeDashboardPipeline(),
        getProjectsReport(baseParams),
        getCostByBucket({ month, ...(projectFilter ? { projectId: projectFilter } : {}) }),
        getMonthlyTrend({ months: 6, ...(projectFilter ? { projectId: projectFilter } : {}) }),
      ]);
      setTotals(t.data); setPipeline(p.data);
      setProjects(pr.data); setBuckets(cb.data); setTrend(tr.data);
    })();
  }, [month, projectFilter, statusFilter, activeTeamspaceId]);

  if (!totals) return <div className="plan-page"><div className="plan-empty">Loading…</div></div>;

  const profitColor = (cents) => cents < 0 ? 'var(--accent-red)' : 'var(--accent-green)';
  const marginColor = (pct)   => pct < 0.15 ? 'var(--accent-red)' : pct < 0.30 ? 'var(--accent-orange)' : 'var(--accent-green)';

  // Chart data
  const projectChartData = projects.slice(0, 10).map(p => ({
    name: p.projectName.slice(0, 18),
    Planned: Math.round((p.plannedCostCents || 0) / 100),
    Actual:  Math.round((p.actualCostCents  || 0) / 100),
    Revenue: Math.round((p.plannedRevenueCents || 0) / 100),
  }));
  const stackedData = projects.slice(0, 10).map(p => ({
    name: p.projectName.slice(0, 18),
    Billable:    Math.round(((p.plannedCostCents || 0) - (p.plannedRevenueCents ? 0 : 0)) / 100), // proxy
    NonBillable: Math.round(((p.nonBillableHours || 0) * (p.actualCostCents / Math.max(1, p.plannedHours)) || 0) / 100),
  }));
  const trendChartData = trend.map(t => ({
    name: monthLabel(t.month),
    Revenue: Math.round((t.actualRevenueCents || 0) / 100),
    Cost:    Math.round((t.actualCostCents    || 0) / 100),
    Profit:  Math.round((t.actualProfitCents  || 0) / 100),
  }));
  const bucketChartData = buckets.map(b => ({
    name: b.bucketName,
    value: Math.round((b.costCents || 0) / 100),
  }));
  const topProfit = [...projects].sort((a, b) => (b.actualProfitCents || 0) - (a.actualProfitCents || 0)).slice(0, 5);
  const topLoss   = [...projects].filter(p => (p.actualCostCents || 0) > (p.plannedCostCents || 0)).sort((a, b) => (b.actualCostCents - b.plannedCostCents) - (a.actualCostCents - a.plannedCostCents)).slice(0, 5);

  return (
    <div className="plan-page">
      <div className="plan-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Time · Dashboard</h2>
        <div style={{ flex: 1 }} />
        <label className="muted" style={{ fontSize: '0.78rem' }}>Month
          <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} style={{ width: 160, marginLeft: 8 }} />
        </label>
        <label className="muted" style={{ fontSize: '0.78rem' }}>Project
          <select className="input" value={projectFilter} onChange={e => setProjectFilter(e.target.value)} style={{ width: 200, marginLeft: 8 }}>
            <option value="">All projects</option>
            {allProjects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
          </select>
        </label>
        <label className="muted" style={{ fontSize: '0.78rem' }}>Status
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 140, marginLeft: 8 }}>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="draft">Draft</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        {(projectFilter || statusFilter !== 'approved') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setProjectFilter(''); setStatusFilter('approved'); }}>Clear</button>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" title="Download all time entries for this month as CSV" onClick={async () => {
            const start = month + '-01';
            const end   = month + '-31';
            const url = exportEntriesUrl(start, end, 'csv');
            const token = localStorage.getItem('token');
            const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-teamspace-id': activeTeamspaceId } });
            if (!r.ok) { alert('Export failed: ' + r.status); return; }
            const blob = await r.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `time-entries-${month}.csv`;
            document.body.appendChild(link); link.click(); link.remove();
            URL.revokeObjectURL(link.href);
          }}>📊 Entries CSV</button>
          <button className="btn btn-ghost btn-sm" title="Download all plans for this month as CSV" onClick={async () => {
            const url = exportPlansUrl(month, 'csv');
            const token = localStorage.getItem('token');
            const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-teamspace-id': activeTeamspaceId } });
            if (!r.ok) { alert('Export failed: ' + r.status); return; }
            const blob = await r.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `plans-${month}.csv`;
            document.body.appendChild(link); link.click(); link.remove();
            URL.revokeObjectURL(link.href);
          }}>📋 Plans CSV</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <Kpi label="Plans approved this month" value={totals.plansCount} sublabel={`${pipeline?.draftPlans || 0} draft · ${pipeline?.pendingPlans || 0} pending`} color="#74b9ff" />
        <Kpi label="Planned Revenue" value={formatINR(totals.plannedRevenueCents)} sublabel={`Billable hrs: ${totals.billableActualHours}h`} color="#6c5ce7" />
        <Kpi label="Planned Cost"    value={formatINR(totals.plannedCostCents)}    sublabel={`B: ${formatINR(totals.billableCostCents)} · NB: ${formatINR(totals.nonBillableCostCents)}`} />
        <Kpi label="Planned Profit"  value={formatINR(totals.plannedProfitCents)}  sublabel={`Margin ${Math.round((totals.plannedMarginPct||0)*100)}%`} color={profitColor(totals.plannedProfitCents)} />
        <Kpi label="Actual Revenue (MTD)" value={formatINR(totals.actualRevenueCents)} color="#bc8cff" />
        <Kpi label="Actual Cost (MTD)"    value={formatINR(totals.actualCostCents)}    sublabel={`Hours: ${totals.actualHours}h`} />
        <Kpi label="Actual Profit"        value={formatINR(totals.actualProfitCents)} sublabel={`Margin ${Math.round((totals.actualMarginPct||0)*100)}%`} color={marginColor(totals.actualMarginPct)} />
        <Kpi
          label="Non-billable overhead"
          value={formatINR(totals.nonBillableCostCents)}
          sublabel={(() => {
            const nb = totals.nonBillableCostCents || 0;
            const rev = totals.plannedRevenueCents || 0;
            if (nb === 0) return 'No NB hours planned';
            const pct = rev > 0 ? Math.round((nb / rev) * 100) : 0;
            return rev > 0
              ? `${pct}% of billable revenue absorbed as overhead`
              : 'Pure cost — no offsetting revenue';
          })()}
          color="#ff9800"
        />
        <Kpi
          label="Loss this month"
          value={formatINR(totals.lossCents)}
          sublabel={(() => {
            if (totals.lossCents <= 0) {
              const buffer = totals.plannedProfitCents || 0;
              const nb = totals.nonBillableCostCents || 0;
              if (buffer > 0 && nb > 0) return `Buffer: ${formatINR(buffer)} after ${formatINR(nb)} NB overhead`;
              if (buffer > 0) return `Buffer: ${formatINR(buffer)} planned profit`;
              return 'No revenue planned yet';
            }
            const b = totals.lossBreakdown || {};
            const parts = [];
            if (b.actualDeficitCents   > 0) parts.push(`realized ${formatINR(b.actualDeficitCents)}`);
            if (b.overrunCents         > 0) parts.push(`overrun ${formatINR(b.overrunCents)}`);
            if (b.plannedDeficitCents  > 0) parts.push(`forecast ${formatINR(b.plannedDeficitCents)}`);
            if (b.contractOverrunCents > 0) parts.push(`contract +${formatINR(b.contractOverrunCents)}`);
            return parts.length ? '⚠ ' + parts.join(' · ') : '⚠ overrun';
          })()}
          color={totals.lossCents > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}
        />
      </div>

      {/* Pipeline strip */}
      <div className="plan-totals" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Approval pipeline</strong>
        <span><strong>{pipeline?.pendingPlans || 0}</strong> <span className="muted">plans pending admin</span></span>
        <span><strong>{pipeline?.submittedSlices || 0}</strong> <span className="muted">weekly slices awaiting owners</span></span>
        <span><strong>{pipeline?.openPeriods || 0}</strong> <span className="muted">open periods (members drafting)</span></span>
      </div>

      {/* Charts grid */}
      <div className="charts-grid">
        {/* Project P&L bar */}
        <div className="chart-card">
          <h3>Project Cost — Planned vs Actual ({monthLabel(month)})</h3>
          <div className="chart-container" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={projectChartData} margin={{ top: 10, right: 16, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} />
                <YAxis stroke="var(--text-muted)" fontSize={11} />
                <RTip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Planned" fill="#74b9ff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Actual"  fill="#f85149" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Revenue" fill="#3fb950" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost-by-bucket pie */}
        <div className="chart-card">
          <h3>Cost by Resource Bucket ({monthLabel(month)})</h3>
          <div className="chart-container" style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {bucketChartData.length === 0 ? <span className="muted">No actuals yet</span> :
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bucketChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" nameKey="name" paddingAngle={3}>
                    {bucketChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <RTip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            }
          </div>
        </div>

        {/* Monthly trend */}
        <div className="chart-card" style={{ gridColumn: 'span 2' }}>
          <h3>Monthly P&L trend (last 6 months)</h3>
          <div className="chart-container" style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trendChartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} />
                <YAxis stroke="var(--text-muted)" fontSize={11} />
                <RTip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Revenue" stroke="#3fb950" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="Cost"    stroke="#f85149" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="Profit"  stroke="#6c5ce7" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top tables */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Top 5 Most Profitable</h3>
          {topProfit.length === 0 ? <p className="muted">No profitable projects yet for {monthLabel(month)}</p> :
            <table className="plan-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Project</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {topProfit.map(p => (
                  <tr key={p.projectId} className="plan-row" onClick={() => navigate(`/t/${activeTeamspaceId}/time/projects/${p.projectId}/pnl?month=${month}`)}>
                    <td>{p.projectIcon} {p.projectName}</td>
                    <td className={`num ${p.actualProfitCents < 0 ? 'plan-loss' : 'plan-profit'}`}>{formatINR(p.actualProfitCents)}</td>
                    <td className="num">{Math.round((p.actualMarginPct||0)*100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        </div>

        <div className="chart-card">
          <h3>Top 5 Loss-Making (overrun)</h3>
          {topLoss.length === 0 ? <p className="muted">No overruns this month 🎉</p> :
            <table className="plan-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Project</th><th className="num">Plan</th><th className="num">Actual</th><th className="num">Overrun</th></tr></thead>
              <tbody>
                {topLoss.map(p => (
                  <tr key={p.projectId} className="plan-row" onClick={() => navigate(`/t/${activeTeamspaceId}/time/projects/${p.projectId}/pnl?month=${month}`)}>
                    <td>{p.projectIcon} {p.projectName}</td>
                    <td className="num muted">{formatINR(p.plannedCostCents)}</td>
                    <td className="num">{formatINR(p.actualCostCents)}</td>
                    <td className="num plan-loss">+{formatINR(p.varianceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        </div>
      </div>
    </div>
  );
}
