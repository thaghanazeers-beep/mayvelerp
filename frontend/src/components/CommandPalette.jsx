import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeamspace } from '../context/TeamspaceContext';
import { useAuth } from '../context/AuthContext';
import { getTasks, getProjects, getTeam } from '../api';
import './CommandPalette.css';

// Static shortcuts that are always available
const STATIC_ACTIONS = [
  { id: 'go-tasks',     label: 'Go to Tasks',     icon: '✓',  hint: 'g t',  to: ts => `/t/${ts}/tasks` },
  { id: 'go-projects',  label: 'Go to Projects',  icon: '📁', hint: 'g p',  to: ts => `/t/${ts}/projects` },
  { id: 'go-sprints',   label: 'Go to Sprints',   icon: '🏃', hint: 'g s',  to: ts => `/t/${ts}/sprints` },
  { id: 'go-time',      label: 'Go to My Timesheet', icon: '⏱', hint: 'g m', to: ts => `/t/${ts}/time` },
  { id: 'go-plans',     label: 'Go to Plans',     icon: '📋', hint: 'g l',  to: ts => `/t/${ts}/time/plans` },
  { id: 'go-dashboard', label: 'Go to Dashboard', icon: '📊', hint: 'g d',  to: () => `/dashboard` },
  { id: 'go-finance',   label: 'Go to Finance & Time tab', icon: '💰', hint: 'g f', to: () => `/dashboard?tab=finance` },
  { id: 'go-ai',        label: 'Go to AI Assistant', icon: '✨', hint: 'g a', to: () => `/ai` },
  { id: 'go-help',      label: 'Open User Guide', icon: '📘', hint: '?',    to: () => `/help` },
  { id: 'go-org',       label: 'Open Org Chart',  icon: '🗂', hint: 'g o',  to: () => `/organization` },
  { id: 'go-members',   label: 'Open Members',    icon: '👥', hint: 'g M',  to: () => `/organization/members` },
  { id: 'go-activity',  label: 'Open Activity Feed', icon: '📈', hint: 'g v', to: ts => `/t/${ts}/activity` },
  { id: 'go-audit',     label: 'Open Audit Log',  icon: '📜', hint: 'g u',  to: ts => `/t/${ts}/time/audit` },
  { id: 'go-workflows', label: 'Open Workflows',  icon: '⚡', hint: 'g w',  to: ts => `/t/${ts}/workflows` },
  { id: 'go-notifs',    label: 'Open Notifications', icon: '🔔', hint: 'g n', to: () => `/notifications` },
  { id: 'go-profile',   label: 'Open Profile',    icon: '🙂', hint: 'g r',  to: () => `/profile` },
];

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);

  // Lazy-loaded entity caches (refreshed when palette opens)
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  useEffect(() => {
    if (!open) return;
    setQ(''); setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (!activeTeamspaceId) return;
    Promise.all([
      getTasks(activeTeamspaceId).catch(() => ({ data: [] })),
      getProjects(activeTeamspaceId).catch(() => ({ data: [] })),
      getTeam(activeTeamspaceId).catch(() => ({ data: [] })),
    ]).then(([t, p, m]) => {
      setTasks(t.data || []);
      setProjects(p.data || []);
      setMembers(m.data || []);
    });
  }, [open, activeTeamspaceId]);

  // Close on Esc + arrow nav happens within this hook
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    const query = q.toLowerCase().trim();
    const out = [];

    // 1. Static navigation actions
    for (const a of STATIC_ACTIONS) {
      if (!query || a.label.toLowerCase().includes(query)) {
        out.push({
          group: 'Navigation', icon: a.icon, label: a.label, hint: a.hint,
          run: () => { onClose(); navigate(a.to(activeTeamspaceId)); },
        });
      }
    }

    if (query) {
      // 2. Tasks (match title/id/assignee)
      for (const t of tasks) {
        if (out.length > 30) break;
        const hay = `${t.title} ${t.id} ${t.assignee || ''} ${t.status || ''}`.toLowerCase();
        if (hay.includes(query)) {
          out.push({
            group: 'Tasks', icon: '✓',
            label: t.title,
            hint: `${t.status || 'task'} · ${t.assignee || 'unassigned'}`,
            run: () => { onClose(); navigate(`/t/${activeTeamspaceId}/tasks/${t.id || t._id}`); },
          });
        }
      }

      // 3. Projects
      for (const p of projects) {
        if (out.length > 50) break;
        if (`${p.name} ${p.description || ''}`.toLowerCase().includes(query)) {
          out.push({
            group: 'Projects', icon: p.icon || '📁',
            label: p.name,
            hint: 'Open project P&L',
            run: () => { onClose(); navigate(`/t/${activeTeamspaceId}/time/projects/${p._id}/pnl?month=${new Date().toISOString().slice(0, 7)}`); },
          });
        }
      }

      // 4. Members
      for (const m of members) {
        if (out.length > 70) break;
        if (`${m.name} ${m.email || ''}`.toLowerCase().includes(query)) {
          out.push({
            group: 'Members', icon: '👤',
            label: m.name,
            hint: m.email,
            run: () => { onClose(); navigate('/organization/members'); },
          });
        }
      }
    }

    return out;
  }, [q, tasks, projects, members, activeTeamspaceId, navigate, onClose]);

  // Reset cursor when results change
  useEffect(() => { setCursor(0); }, [q]);

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(items.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[cursor];
      if (it) it.run();
    }
  };

  if (!open) return null;
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk-modal animate-in" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <span className="cmdk-search-icon">🔍</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder={`Search tasks, projects, people, or jump to a page…`}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onInputKey}
          />
          <span className="cmdk-esc">esc</span>
        </div>
        <div className="cmdk-results">
          {items.length === 0 ? (
            <div className="cmdk-empty">No results.</div>
          ) : (() => {
            // Render with group headers
            const out = [];
            let lastGroup = null;
            items.forEach((it, idx) => {
              if (it.group !== lastGroup) {
                lastGroup = it.group;
                out.push(<div className="cmdk-group" key={'g_' + lastGroup + '_' + idx}>{lastGroup}</div>);
              }
              out.push(
                <button
                  key={idx}
                  className={`cmdk-item ${idx === cursor ? 'active' : ''}`}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => it.run()}
                >
                  <span className="cmdk-icon">{it.icon}</span>
                  <span className="cmdk-label">{it.label}</span>
                  {it.hint && <span className="cmdk-hint">{it.hint}</span>}
                </button>
              );
            });
            return out;
          })()}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
