import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuditLog } from '../api';
import { useTeamspace } from '../context/TeamspaceContext';
import './PlanPages.css';

const ENTITY_LABELS = {
  plan: '📋 Plan',
  planLine: '📑 Plan line',
  allocation: '🗓 Allocation',
  timeEntry: '⏱ Time entry',
  period: '📅 Period',
  slice: '🍰 Slice',
};
const ACTION_COLOR = {
  create: 'plan-badge-draft',
  update: 'plan-badge-pending',
  delete: 'plan-badge-rejected',
  submit: 'plan-badge-pending',
  approve: 'plan-badge-approved',
  reject: 'plan-badge-rejected',
  reopen: 'plan-badge-draft',
  admin_override: 'plan-badge-rejected',
};

export default function AuditLogPage() {
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const reload = async () => {
    setLoading(true); setError('');
    try {
      const params = {};
      if (entityType) params.entityType = entityType;
      if (action)     params.action     = action;
      if (from)       params.from       = from;
      if (to)         params.to         = to;
      params.limit = 500;
      const r = await getAuditLog(params);
      setEvents(r.data.events || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [activeTeamspaceId, entityType, action, from, to]);

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(e =>
      (e.actorName || '').toLowerCase().includes(q) ||
      (e.action || '').toLowerCase().includes(q) ||
      (e.reason || '').toLowerCase().includes(q) ||
      (e.entityType || '').toLowerCase().includes(q)
    );
  }, [events, search]);

  const renderDelta = (e) => {
    const before = e.before || {};
    const after  = e.after  || {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const rows = [];
    keys.forEach(k => {
      const a = before[k];
      const b = after[k];
      const changed = JSON.stringify(a) !== JSON.stringify(b);
      if (changed) rows.push({ k, a, b });
    });
    if (!rows.length) return null;
    return (
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          {rows.length} field change{rows.length === 1 ? '' : 's'}
        </summary>
        <table style={{ width: '100%', marginTop: 6, fontSize: '0.72rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Field</th><th style={{ textAlign: 'left' }}>Before</th><th style={{ textAlign: 'left' }}>After</th></tr>
          </thead>
          <tbody>
            {rows.map(({ k, a, b }) => (
              <tr key={k}>
                <td style={{ padding: '2px 6px' }}><code>{k}</code></td>
                <td style={{ padding: '2px 6px', color: 'var(--accent-red)' }}>{a == null ? '—' : JSON.stringify(a)}</td>
                <td style={{ padding: '2px 6px', color: 'var(--accent-green, #00b894)' }}>{b == null ? '—' : JSON.stringify(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    );
  };

  return (
    <div className="plan-page">
      <div className="plan-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard?tab=finance')}>← Dashboard</button>
        <h2 style={{ margin: 0 }}>📜 Audit log</h2>
        <div style={{ flex: 1 }} />
        <select className="input" value={entityType} onChange={e => setEntityType(e.target.value)} style={{ width: 160 }}>
          <option value="">All entities</option>
          <option value="plan">Plans</option>
          <option value="planLine">Plan lines</option>
          <option value="allocation">Allocations</option>
          <option value="timeEntry">Time entries</option>
          <option value="period">Periods</option>
          <option value="slice">Slices</option>
        </select>
        <select className="input" value={action} onChange={e => setAction(e.target.value)} style={{ width: 140 }}>
          <option value="">Any action</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="submit">Submit</option>
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
          <option value="reopen">Reopen</option>
          <option value="admin_override">Admin override</option>
        </select>
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 140 }} title="From" />
        <input className="input" type="date" value={to}   onChange={e => setTo(e.target.value)}   style={{ width: 140 }} title="To" />
        <input className="input" placeholder="Search actor / reason…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
      </div>

      {error && <div className="plan-banner plan-banner-reject">{error}</div>}

      {loading ? (
        <div className="plan-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>📜</div>
          <p>No audit events match these filters.</p>
        </div>
      ) : (
        <div className="plan-table-wrap">
          <table className="plan-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Entity</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Reason / details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e._id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td>
                    {ENTITY_LABELS[e.entityType] || e.entityType}
                    <div className="muted" style={{ fontSize: '0.65rem' }}>{String(e.entityId).slice(-8)}</div>
                  </td>
                  <td>
                    <span className={`plan-badge ${ACTION_COLOR[e.action] || 'plan-badge-draft'}`}>{e.action}</span>
                  </td>
                  <td>
                    {e.actorName || <span className="muted">—</span>}
                    {e.actorRole && <div className="muted" style={{ fontSize: '0.65rem' }}>{e.actorRole}</div>}
                  </td>
                  <td>
                    {e.reason && <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{e.reason}</div>}
                    {renderDelta(e)}
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
