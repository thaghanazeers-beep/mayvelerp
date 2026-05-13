import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActivity } from '../api';
import { useTeamspace } from '../context/TeamspaceContext';
import { PageIntro } from '../components/PageIntro';
import './PlanPages.css';

const SOURCE_ICON = {
  audit:        '📜',
  workflow:     '⚡',
  notification: '🔔',
};
const SOURCE_LABEL = {
  audit:        'Audit',
  workflow:     'Workflow',
  notification: 'Notification',
};

export default function ActivityPage() {
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [days, setDays]     = useState(14);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');

  const reload = async () => {
    setLoading(true); setError('');
    try {
      const r = await getActivity({ days, limit: 300 });
      setEvents(r.data.events || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [days, activeTeamspaceId]);

  const filtered = useMemo(() => {
    let list = events;
    if (source) list = list.filter(e => e.source === source);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.actor || '').toLowerCase().includes(q) ||
        (e.title || '').toLowerCase().includes(q) ||
        (e.summary || '').toLowerCase().includes(q) ||
        (e.kind || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, source, search]);

  // Group by day for nice header rows
  const grouped = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      const key = new Date(e.at).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="plan-page">
      <PageIntro
        icon="📈"
        title="Activity Feed"
        actor="Everyone"
        purpose="A chronological stream of everything that happened in this workspace — tasks created, statuses changed, comments posted, plans approved. Like a newsfeed for work."
        storageKey="activity-feed"
        youCanDo={[
          'Pick a time window (24h, 7d, 30d) to focus the feed',
          'Click an event to jump to the underlying task, plan, or comment',
          'Use this for a daily "what happened yesterday" catch-up',
        ]}
        whatHappensNext={[
          'New events appear in real time — no manual refresh needed',
          'Personal notifications still come via the bell — this is the team-wide view',
          'If you only care about your own work → use the Notifications page instead',
        ]}
      />

      <div className="plan-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>📈 Activity Feed</h2>
        <span className="muted">{filtered.length} events</span>
        <div style={{ flex: 1 }} />
        <select className="input" value={days} onChange={e => setDays(parseInt(e.target.value, 10))} style={{ width: 130 }}>
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select className="input" value={source} onChange={e => setSource(e.target.value)} style={{ width: 160 }}>
          <option value="">All sources</option>
          <option value="audit">📜 Audit</option>
          <option value="workflow">⚡ Workflow</option>
          <option value="notification">🔔 Notification</option>
        </select>
        <input className="input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
      </div>

      {error && <div className="plan-banner plan-banner-reject">{error}</div>}

      {loading ? (
        <div className="plan-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>🌙</div>
          <p>Quiet on this front. Try widening the date range.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grouped.map(([day, items]) => (
            <div key={day}>
              <div style={{
                fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 4px',
              }}>
                {new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((e, i) => (
                  <div key={i} className="plan-approval-card" style={{ cursor: 'default', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
                      }} title={SOURCE_LABEL[e.source]}>
                        {SOURCE_ICON[e.source] || '•'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>
                          <strong>{e.actor || 'System'}</strong> · {e.title || e.kind}
                        </div>
                        {e.summary && <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{e.summary}</div>}
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          {SOURCE_LABEL[e.source]} · {e.kind} · {new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
