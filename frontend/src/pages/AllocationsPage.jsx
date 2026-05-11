import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTeamspace } from '../context/TeamspaceContext';
import { getPlan, getPlanAllocations, updateAllocation, getTeam, getProjects, formatINR } from '../api';
import './PlanPages.css';

const weekKey = (d) => new Date(d).toISOString().slice(0, 10);
const weekLabel = (d) => {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
};

export default function AllocationsPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();

  const [plan, setPlan]       = useState(null);
  const [lines, setLines]     = useState([]);
  const [allocs, setAllocs]   = useState([]);
  const [members, setMembers] = useState([]);
  const [project, setProject] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  const reload = async () => {
    const r = await getPlan(planId);
    setPlan(r.data.plan); setLines(r.data.lines);
    setAllocs((await getPlanAllocations(planId)).data);
    if (r.data.plan?.projectId) {
      const ps = await getProjects(activeTeamspaceId);
      setProject(ps.data.find(p => p._id === r.data.plan.projectId) || null);
    }
  };
  useEffect(() => {
    (async () => {
      const tm = await getTeam(activeTeamspaceId); setMembers(tm.data);
      await reload();
    })();
  }, [planId]);

  // Build the unique sorted week column set across all allocations
  const weekColumns = useMemo(() => {
    const set = new Map();
    for (const a of allocs) {
      const k = weekKey(a.weekStart);
      if (!set.has(k)) set.set(k, { weekStart: a.weekStart, weekEnd: a.weekEnd });
    }
    return [...set.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([_, v]) => v);
  }, [allocs]);

  // Map allocations by lineId×weekStart for fast lookup
  const allocByLineWeek = useMemo(() => {
    const m = new Map();
    for (const a of allocs) m.set(`${a.planLineId}::${weekKey(a.weekStart)}`, a);
    return m;
  }, [allocs]);

  const memberName = (id) => members.find(m => m._id === id)?.name || '—';

  if (!plan) return <div className="plan-page"><div className="plan-empty">Loading…</div></div>;

  const planEditable = plan.status === 'approved';   // owner can re-tweak only after approval

  const handleEdit = async (alloc, value) => {
    const newHours = Number(value);
    if (Number.isNaN(newHours) || newHours < 0) return;
    setError('');
    // Optimistic
    setAllocs(prev => prev.map(a => a._id === alloc._id ? { ...a, allocatedHours: newHours, remainingHours: newHours - a.consumedHours } : a));
    try {
      await updateAllocation(alloc._id, { allocatedHours: newHours });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      reload();
    }
  };

  return (
    <div className="plan-page">
      <div className="plan-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/t/${activeTeamspaceId}/time/plans/${planId}`)}>← Back to plan</button>
        <div style={{ flex: 1 }}>
          <div className="plan-h-title">Allocations · {plan.title}</div>
          <div className="plan-h-sub">{project?.icon} {project?.name} · {plan.periodMonth} · {allocs.length} allocations across {weekColumns.length} weeks</div>
        </div>
        {!planEditable && <span className="plan-badge plan-badge-pending">Plan must be approved to edit</span>}
      </div>

      {error && <div className="plan-banner plan-banner-reject">{error}</div>}

      {weekColumns.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>🗓</div>
          <p>No allocations yet. Open the plan and click <strong>Allocate</strong>.</p>
        </div>
      ) : (
        <div className="plan-grid-wrap">
          <table className="plan-grid alloc-grid">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Line</th>
                <th>Assignee</th>
                <th className="num">Planned</th>
                <th className="num">Allocated</th>
                <th className="num">Consumed</th>
                {weekColumns.map(w => (
                  <th key={weekKey(w.weekStart)} className="num">
                    Week of {weekLabel(w.weekStart)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.filter(l => l.assigneeUserId).map(l => {
                const lineAllocs = allocs.filter(a => String(a.planLineId) === String(l._id));
                const totalAllocated = lineAllocs.reduce((s,a) => s + (a.allocatedHours || 0), 0);
                const totalConsumed  = lineAllocs.reduce((s,a) => s + (a.consumedHours  || 0), 0);
                const drift = +(l.plannedHours - totalAllocated).toFixed(2);
                return (
                  <tr key={l._id}>
                    <td>{l.taskType} <span className="muted">· {l.billable ? 'Billable' : 'Non-Billable'}</span></td>
                    <td>{memberName(l.assigneeUserId)}</td>
                    <td className="num">{l.plannedHours}h</td>
                    <td className={`num ${Math.abs(drift) > 0.01 ? 'plan-amber' : 'plan-profit'}`} title={Math.abs(drift) > 0.01 ? `Off plan by ${drift}h` : 'Matches plan'}>
                      {totalAllocated.toFixed(1)}h
                    </td>
                    <td className="num muted">{totalConsumed.toFixed(1)}h</td>
                    {weekColumns.map(w => {
                      const a = allocByLineWeek.get(`${l._id}::${weekKey(w.weekStart)}`);
                      if (!a) return <td key={weekKey(w.weekStart)} className="num muted">—</td>;
                      const remaining = Math.max(0, a.allocatedHours - a.consumedHours);
                      return (
                        <td key={weekKey(w.weekStart)} className="num">
                          <input
                            type="number" min="0" step="0.25"
                            disabled={!planEditable}
                            defaultValue={a.allocatedHours}
                            onBlur={e => Number(e.target.value) !== a.allocatedHours && handleEdit(a, e.target.value)}
                            title={`consumed: ${a.consumedHours}h · remaining: ${remaining}h`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {lines.filter(l => !l.assigneeUserId).length > 0 && (
                <tr>
                  <td colSpan={5 + weekColumns.length} className="muted" style={{ padding: '12px', fontSize: '0.78rem' }}>
                    {lines.filter(l => !l.assigneeUserId).length} expense line(s) excluded — they don't get weekly allocations.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
