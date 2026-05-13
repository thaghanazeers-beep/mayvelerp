import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOrganizationMembers, formatINR, signedFileUrl, getRateBuckets, updateUser } from '../api';
import { useAuth } from '../context/AuthContext';
import { PageIntro } from '../components/PageIntro';
import './OrgMembersPage.css';

const isoMonth = (d = new Date()) => d.toISOString().slice(0, 7);

const renderAvatar = (m, size = 40) => {
  if (m.profilePictureUrl) {
    return <img src={signedFileUrl(m.profilePictureUrl)} alt={m.name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', background: 'var(--bg-hover)' }} />;
  }
  const initial = (m.name || '?').charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--primary)', color: '#fff',
      fontWeight: 700, fontSize: size * 0.42,
    }}>{initial}</div>
  );
};

export default function OrgMembersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Accept any case of 'admin' + the legacy 'Team Owner' role.
  const isAdmin = ['admin', 'team owner'].includes(String(user?.role || '').toLowerCase());
  // Help debug if the dropdown still won't show — open the console to see who's logged in.
  if (typeof window !== 'undefined' && !window._loggedAdminCheck) {
    console.log('[OrgMembersPage] auth user:', user, '· isAdmin:', isAdmin);
    window._loggedAdminCheck = true;
  }
  const [month, setMonth]     = useState(isoMonth());
  const [members, setMembers] = useState([]);
  const [buckets, setBuckets] = useState([]);
  useEffect(() => {
    getRateBuckets().then(r => setBuckets(r.data || [])).catch(() => setBuckets([]));
  }, []);
  const handleBucketChange = async (memberId, newBucketId) => {
    try {
      await updateUser(memberId, { rateBucketId: newBucketId || null });
      // Refresh the affected row's cost rate
      const newBucket = buckets.find(b => String(b._id) === String(newBucketId)) || null;
      setMembers(prev => prev.map(m => String(m._id) === String(memberId)
        ? { ...m, rateBucket: newBucket
            ? { _id: newBucket._id, name: newBucket.name, ratePerHourCents: newBucket.ratePerHourCents, kind: newBucket.kind }
            : null }
        : m));
    } catch (e) {
      alert('Failed to update bucket: ' + (e.response?.data?.error || e.message));
    }
  };
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [department, setDepartment] = useState('');
  const [kindFilter, setKindFilter] = useState('');         // '' | 'user' | 'chart-only'
  const [sortBy, setSortBy]   = useState('name');           // 'name' | 'cost' | 'allocated' | 'role'
  const [view, setView]       = useState('cards');          // 'cards' | 'table'
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    setLoading(true); setError('');
    getOrganizationMembers({ month })
      .then(r => setMembers(r.data.members || []))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [month]);

  const departments = useMemo(() => {
    const set = new Set(members.map(m => m.department).filter(Boolean));
    return [...set].sort();
  }, [members]);

  const filtered = useMemo(() => {
    let list = members;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q) ||
        (m.orgRole || '').toLowerCase().includes(q) ||
        (m.department || '').toLowerCase().includes(q)
      );
    }
    if (department) list = list.filter(m => m.department === department);
    if (kindFilter) list = list.filter(m => m.kind === kindFilter);
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'cost':      return (b.rateBucket?.ratePerHourCents || 0) - (a.rateBucket?.ratePerHourCents || 0);
        case 'allocated': return (b.thisMonth?.allocatedHours || 0) - (a.thisMonth?.allocatedHours || 0);
        case 'role':      return (a.orgRole || 'zzz').localeCompare(b.orgRole || 'zzz');
        default:          return (a.name || '').localeCompare(b.name || '');
      }
    });
  }, [members, search, department, kindFilter, sortBy]);

  // Aggregate stats for the header strip
  const stats = useMemo(() => {
    const withAccount = members.filter(m => m.kind === 'user').length;
    const chartOnly   = members.filter(m => m.kind === 'chart-only').length;
    const inChart     = members.filter(m => m.inOrgChart).length;
    return { total: members.length, withAccount, chartOnly, inChart };
  }, [members]);

  return (
    <div className="orgm-page">
      <PageIntro
        icon="🧑‍💼"
        title="Organisation Members"
        actor="HR & Super Admin"
        purpose="The complete employee directory — including people who have a login and people who only exist on the org chart (e.g. interns, contractors). Set each person\'s cost rate here."
        storageKey="org-members"
        youCanDo={[
          'Search and filter every member across every teamspace',
          'Set or change a member\'s cost rate / rate bucket — feeds every plan and P&L',
          'Promote a chart-only person to a real login by assigning them an email and password',
        ]}
        whatHappensNext={[
          'Changing a cost rate → only affects new plans; existing approved plans keep their snapshot',
          'Adding a login → the person gets credentials and starts seeing the workspace',
          'Cost data here is private — only HR and Super Admin can view, never visible to peers',
        ]}
      />
      <div className="orgm-toolbar">
        <div>
          <h1 className="orgm-title">Organization Members</h1>
          <p className="orgm-sub">
            {stats.total} people · {stats.withAccount} with a login
            {stats.chartOnly > 0 && <> · {stats.chartOnly} chart-only</>}
          </p>
        </div>
        <div className="orgm-toolbar-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/organization')}>
            🗂 View Org Chart
          </button>
          <input
            className="input"
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            style={{ width: 150 }}
            title="Month for allocation/cost stats"
          />
        </div>
      </div>

      {isAdmin && stats.withAccount > 0 && (
        <div style={{ background: 'rgba(110, 86, 207, 0.08)', border: '1px solid rgba(110, 86, 207, 0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          💡 <strong>Admin tip:</strong> on each card with a login, scroll down to the <strong>"Change bucket"</strong> row to update an employee's cost rate. Chart-only members need a User account first (invite via Team page).
        </div>
      )}

      {/* Filter strip */}
      <div className="orgm-filters">
        <input
          className="input"
          placeholder="🔍  Search by name, email, role, department…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select className="input" value={department} onChange={e => setDepartment(e.target.value)} style={{ width: 180 }}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" value={kindFilter} onChange={e => setKindFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">All members</option>
          <option value="user">With login ({stats.withAccount})</option>
          <option value="chart-only">Chart only ({stats.chartOnly})</option>
        </select>
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 160 }}>
          <option value="name">Sort: Name</option>
          <option value="role">Sort: Role</option>
          <option value="cost">Sort: Cost (high→low)</option>
          <option value="allocated">Sort: Allocated hrs</option>
        </select>
        <div className="orgm-view-toggle">
          <button className={`orgm-view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')}>Cards</button>
          <button className={`orgm-view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')}>Table</button>
        </div>
      </div>

      {loading ? (
        <div className="orgm-empty">Loading…</div>
      ) : error ? (
        <div className="orgm-banner orgm-banner-error">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="orgm-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>👥</div>
          <p>No members match these filters.</p>
        </div>
      ) : view === 'cards' ? (
        <div className="orgm-grid">
          {filtered.map(m => (
            <div
              key={m._id}
              className={`orgm-card ${expandedId === m._id ? 'is-expanded' : ''}`}
              onClick={() => setExpandedId(expandedId === m._id ? null : m._id)}
            >
              <div className="orgm-card-head">
                {renderAvatar(m, 48)}
                <div className="orgm-card-id">
                  <h3 className="orgm-card-name">{m.name}</h3>
                  <p className="orgm-card-email">{m.email || <span className="muted">No login account</span>}</p>
                </div>
                {m.role === 'Admin' && <span className="orgm-pill orgm-pill-admin">Admin</span>}
                {m.kind === 'chart-only' && <span className="orgm-pill orgm-pill-chart">Chart only</span>}
              </div>

              <div className="orgm-card-meta">
                <div className="orgm-meta-row">
                  <span className="orgm-meta-k">Role</span>
                  <span className="orgm-meta-v">{m.orgRole || <span className="muted">—</span>}</span>
                </div>
                <div className="orgm-meta-row">
                  <span className="orgm-meta-k">Department</span>
                  <span className="orgm-meta-v">{m.department || <span className="muted">—</span>}</span>
                </div>
                <div className="orgm-meta-row">
                  <span className="orgm-meta-k">Manager</span>
                  <span className="orgm-meta-v">{m.managerName || <span className="muted">—</span>}</span>
                </div>
                <div className="orgm-meta-row">
                  <span className="orgm-meta-k">Cost rate {isAdmin && m.kind === 'user' && <span style={{ fontSize: '0.75rem', color: 'var(--text-accent)' }}>(editable)</span>}</span>
                  <span className="orgm-meta-v orgm-cost">
                    {m.rateBucket
                      ? <>{formatINR(m.rateBucket.ratePerHourCents)} / hr <span className="muted">· {m.rateBucket.name}</span></>
                      : <span className="muted">No bucket assigned</span>}
                  </span>
                </div>
                {isAdmin && m.kind === 'user' && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'rgba(110, 86, 207, 0.07)',
                      border: '1px solid rgba(110, 86, 207, 0.25)',
                      borderRadius: 'var(--radius-sm)',
                      marginTop: 4,
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-accent)', fontWeight: 600 }}>
                      ✏️ Change cost rate
                    </span>
                    <select
                      style={{
                        padding: '5px 10px', fontSize: '0.78rem', height: 30, minWidth: 200,
                        color: 'var(--text)', background: 'var(--bg-app)',
                        border: '1px solid var(--primary)',
                        borderRadius: 'var(--radius-sm)', outline: 'none',
                        fontFamily: 'inherit',
                      }}
                      value={m.rateBucket?._id || ''}
                      onChange={(e) => { e.stopPropagation(); handleBucketChange(m._id, e.target.value); }}
                    >
                      <option value="">— No bucket —</option>
                      {buckets.map(b => (
                        <option key={b._id} value={b._id}>
                          {b.name} · ₹{Math.round(b.ratePerHourCents / 100)}/hr
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Month-scoped workload */}
              <div className="orgm-card-stats">
                <div className="orgm-stat">
                  <span className="orgm-stat-v">{m.thisMonth.allocatedHours.toFixed(0)}h</span>
                  <span className="orgm-stat-l">Allocated</span>
                </div>
                <div className="orgm-stat">
                  <span className="orgm-stat-v">{m.thisMonth.consumedHours.toFixed(0)}h</span>
                  <span className="orgm-stat-l">Consumed</span>
                </div>
                <div className="orgm-stat">
                  <span className="orgm-stat-v">{formatINR(m.thisMonth.actualCostCents)}</span>
                  <span className="orgm-stat-l">Cost MTD</span>
                </div>
                <div className="orgm-stat">
                  <span className="orgm-stat-v">{m.thisMonth.projectsCount}</span>
                  <span className="orgm-stat-l">Projects</span>
                </div>
              </div>

              {expandedId === m._id && (
                <div className="orgm-card-expand">
                  <div className="orgm-meta-row">
                    <span className="orgm-meta-k">Billable hrs (MTD)</span>
                    <span className="orgm-meta-v">💰 {m.thisMonth.billableHours.toFixed(1)}h</span>
                  </div>
                  <div className="orgm-meta-row">
                    <span className="orgm-meta-k">Non-billable hrs (MTD)</span>
                    <span className="orgm-meta-v">🛠 {m.thisMonth.nonBillableHours.toFixed(1)}h</span>
                  </div>
                  {m.thisMonth.projects.length > 0 && (
                    <div className="orgm-meta-row" style={{ alignItems: 'flex-start' }}>
                      <span className="orgm-meta-k">Projects</span>
                      <div className="orgm-proj-list">
                        {m.thisMonth.projects.map(p => (
                          <span key={p._id} className="orgm-proj-chip">{p.icon} {p.name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {!m.inOrgChart && (
                    <div className="orgm-banner orgm-banner-warn">
                      Not on the org chart yet — add them via <a onClick={(e) => { e.stopPropagation(); navigate('/organization'); }}>the Org Chart page</a>.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="orgm-table-wrap">
          <table className="orgm-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Department</th>
                <th>Manager</th>
                <th>Bucket</th>
                <th className="num">Cost / hr</th>
                <th className="num">Allocated</th>
                <th className="num">Consumed</th>
                <th className="num">Cost MTD</th>
                <th className="num">Projects</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m._id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {renderAvatar(m, 28)}
                      <div>
                        <div style={{ fontWeight: 500 }}>{m.name}</div>
                        <div className="muted" style={{ fontSize: '0.7rem' }}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{m.orgRole || <span className="muted">—</span>}</td>
                  <td>{m.department || <span className="muted">—</span>}</td>
                  <td>{m.managerName || <span className="muted">—</span>}</td>
                  <td>{m.rateBucket?.name || <span className="muted">—</span>}</td>
                  <td className="num orgm-cost">{m.rateBucket ? formatINR(m.rateBucket.ratePerHourCents) : <span className="muted">—</span>}</td>
                  <td className="num">{m.thisMonth.allocatedHours.toFixed(0)}h</td>
                  <td className="num">{m.thisMonth.consumedHours.toFixed(0)}h</td>
                  <td className="num">{formatINR(m.thisMonth.actualCostCents)}</td>
                  <td className="num">{m.thisMonth.projectsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
