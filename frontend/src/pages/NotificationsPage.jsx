import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import './NotificationsPage.css';

const NOTIF_ICONS = {
  task_created:        '📋',
  task_assigned:       '👤',
  task_completed:      '✅',
  task_rejected:       '❌',
  review_requested:    '📝',
  status_changed:      '🔄',
  plan_submitted:      '📤',
  plan_approved:       '✅',
  plan_rejected:       '❌',
  allocation_created:  '🗓',
  time_submitted:      '⏱',
  time_approved:       '✅',
  time_rejected:       '❌',
  time_overdue:        '⚠️',
  budget_overrun:      '💸',
};

const FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'unread',  label: 'Unread' },
  { id: 'tasks',   label: 'Tasks',   match: t => t.startsWith('task_') || t === 'review_requested' || t === 'status_changed' },
  { id: 'time',    label: 'Time',    match: t => t.startsWith('time_') || t === 'allocation_created' },
  { id: 'budget',  label: 'Budget',  match: t => t.startsWith('plan_') || t === 'budget_overrun' },
];

const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60)    return 'just now';
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const { activeTeamspaceId } = useTeamspace();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try { const r = await getNotifications(user?.name); setList(r.data); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (user?.name) reload(); }, [user?.name]);

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.id === filter);
    if (!f) return list;
    if (f.id === 'all')    return list;
    if (f.id === 'unread') return list.filter(n => !n.read);
    return list.filter(n => f.match(n.type));
  }, [list, filter]);

  const unreadCount = list.filter(n => !n.read).length;

  const handleClick = async (n) => {
    if (!n.read) {
      await markNotificationRead(n._id);
      setList(prev => prev.map(x => x._id === n._id ? { ...x, read: true } : x));
    }
    if (n.taskId && activeTeamspaceId) navigate(`/t/${activeTeamspaceId}/tasks/${n.taskId}`);
  };
  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    await markAllNotificationsRead(user?.name);
    setList(prev => prev.map(n => ({ ...n, read: true })));
  };
  const handleDelete = async (id) => {
    await deleteNotification(id);
    setList(prev => prev.filter(n => n._id !== id));
  };

  // Group by day for nicer rendering
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const n of filtered) {
      const d = new Date(n.createdAt);
      const key = d.toDateString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    return [...groups.entries()];
  }, [filtered]);

  return (
    <div className="notif-page">
      <div className="notif-page-header">
        <div>
          <h1>Notifications</h1>
          <p className="muted">{unreadCount > 0 ? `${unreadCount} unread of ${list.length}` : `All caught up · ${list.length} total`}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>Refresh</button>
          <button className="btn btn-ghost btn-sm" onClick={handleMarkAll} disabled={unreadCount === 0}>Mark all read</button>
        </div>
      </div>

      <div className="notif-filter-bar">
        {FILTERS.map(f => {
          const count = f.id === 'all'    ? list.length
                       : f.id === 'unread' ? unreadCount
                       : list.filter(n => f.match(n.type)).length;
          return (
            <button key={f.id} className={`notif-pill ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label} <span className="notif-pill-count">{count}</span>
            </button>
          );
        })}
      </div>

      {loading && list.length === 0 ? (
        <div className="notif-page-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="notif-page-empty">
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
          <p>No notifications match this filter.</p>
        </div>
      ) : (
        <div className="notif-page-list">
          {grouped.map(([dayKey, items]) => (
            <div key={dayKey}>
              <div className="notif-day-header">{new Date(dayKey).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
              {items.map(n => (
                <div key={n._id} className={`notif-page-item ${!n.read ? 'is-unread' : ''}`}>
                  <div className="notif-page-icon">{NOTIF_ICONS[n.type] || '📢'}</div>
                  <div className="notif-page-body" onClick={() => handleClick(n)} style={{ cursor: n.taskId ? 'pointer' : 'default' }}>
                    <div className="notif-page-title">
                      {n.title}
                      <span className="notif-page-type">{n.type.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="notif-page-message">{n.message}</div>
                    <div className="notif-page-meta">
                      {n.actorName && <span>by <strong>{n.actorName}</strong></span>}
                      <span>·</span>
                      <span>{timeAgo(n.createdAt)}</span>
                    </div>
                  </div>
                  <div className="notif-page-actions">
                    {!n.read && <span className="notif-page-dot" title="Unread" />}
                    <button className="btn-icon" title="Delete" onClick={() => handleDelete(n._id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
