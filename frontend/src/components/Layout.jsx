import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTeamspace } from '../context/TeamspaceContext';
import NotificationBell from './NotificationBell';
import WelcomeModal from './WelcomeModal';
import CommandPalette from './CommandPalette';
import './AiChat.css';      // for the .ai-chat-launcher button styles
import { getTeamspaces, createTeamspace, createPersonalTeamspace, signedFileUrl, getUnreadByTeamspace, listAllUsers, impersonateUser } from '../api';
import './Layout.css';

export default function Layout({ children, onToast }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive activePage and current teamspace from the URL.
  // /dashboard, /profile, /organization → bare pages.
  // /t/:tsId/<sub> → teamspace-scoped.
  const path = location.pathname;
  let activePage = 'dashboard';
  let urlTeamspaceId = '';
  if (path.startsWith('/t/')) {
    const parts = path.split('/').filter(Boolean); // ['t', ':tsId', 'sub?', 'sub2?']
    urlTeamspaceId = parts[1] || '';
    const sub = parts[2] || 'tasks';
    if (sub === 'control')      activePage = 'teamspace-control';
    else if (sub === 'time') {
      const sub2 = parts[3];                      // undefined | 'plans' | 'approvals' | 'dashboard' | 'projects'
      const sub3 = parts[4];                      // 'plans' | 'weeks' (under approvals)
      if (!sub2)                       activePage = 'time-mine';
      else if (sub2 === 'dashboard')   activePage = 'dashboard';   // legacy URL → highlight Dashboard
      else if (sub2 === 'plans')       activePage = 'time-plans';
      else if (sub2 === 'approvals')   activePage = sub3 === 'weeks' ? 'time-week-approvals' : 'time-approvals';
      else if (sub2 === 'projects')    activePage = 'dashboard';   // P&L drilldowns highlight Dashboard
      else                             activePage = 'time-mine';
    } else {
      activePage = sub;
    }
  } else if (path === '/profile')                activePage = 'profile';
  else if (path === '/organization/members')     activePage = 'org-members';
  else if (path === '/organization')              activePage = 'organization';
  else if (path === '/dashboard')                 activePage = 'dashboard';
  else if (path === '/ai')                        activePage = 'ai';
  else if (path === '/help')                      activePage = 'help';
  else if (path === '/access')                    activePage = 'access';

  const onNavigate = (page) => {
    const tsId = urlTeamspaceId; // when on /t/:tsId/*
    switch (page) {
      case 'dashboard':         navigate('/dashboard'); break;
      case 'profile':           navigate('/profile'); break;
      case 'organization':      navigate('/organization'); break;
      case 'org-members':       navigate('/organization/members'); break;
      case 'ai':                navigate('/ai'); break;
      case 'help':              navigate('/help'); break;
      case 'access':            navigate('/access'); break;
      case 'tasks':             navigate(`/t/${tsId}/tasks`); break;
      case 'projects':          navigate(`/t/${tsId}/projects`); break;
      case 'sprints':           navigate(`/t/${tsId}/sprints`); break;
      case 'workflows':         navigate(`/t/${tsId}/workflows`); break;
      case 'time-mine':         navigate(`/t/${tsId}/time`); break;
      case 'time-plans':        navigate(`/t/${tsId}/time/plans`); break;
      case 'time-approvals':    navigate(`/t/${tsId}/time/approvals/plans`); break;
      case 'time-week-approvals': navigate(`/t/${tsId}/time/approvals/weeks`); break;
      case 'team':              navigate(`/t/${tsId}/team`); break;
      case 'team-settings':     navigate(`/t/${tsId}/team`); break;
      case 'teamspace-control': navigate(`/t/${tsId}/control`); break;
      default: navigate('/dashboard');
    }
  };

  const { user, logout, superAdminMode, setSuperAdminMode, isSuperAdminActive, impersonating, impersonateAs, revertImpersonation } = useAuth();
  // Cached list of every user (only fetched for SuperAdmin) so the switcher
  // dropdown doesn't have to round-trip every render.
  const [allUsersCache, setAllUsersCache] = useState([]);
  const [showSwitcher, setShowSwitcher] = useState(false);
  useEffect(() => {
    if (!user?.isSuperAdmin || impersonating) return;
    listAllUsers().then(r => setAllUsersCache(r.data || [])).catch(() => {});
  }, [user?.isSuperAdmin, impersonating]);
  const handleImpersonate = async (targetId) => {
    try {
      const r = await impersonateUser(targetId);
      impersonateAs(r.data.user, r.data.token);
      setShowSwitcher(false);
      // Force a full reload so every context / cached fetch starts clean as the new user.
      window.location.href = '/';
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };
  const handleRevert = () => {
    revertImpersonation();
    window.location.href = '/';
  };
  const themeCtx = useTheme();
  const theme = themeCtx?.theme || 'dark';
  const toggleTheme = themeCtx?.toggleTheme || (() => {});
  const { activeTeamspaceId, setActiveTeamspaceId, teamspaces, refreshTeamspaces } = useTeamspace();

  const [expandedTs, setExpandedTs] = useState({});  // { tsId: true/false }
  const [tsMenu, setTsMenu] = useState(null);         // tsId for context menu
  const [unreadByTs, setUnreadByTs] = useState({});   // { teamspaceId: unreadCount }

  // Poll per-teamspace unread counts. Same 5s cadence as the global header
  // bell so the numbers stay roughly in sync.
  useEffect(() => {
    if (!user?.name) return;
    let alive = true;
    const fetch = async () => {
      try {
        const r = await getUnreadByTeamspace(user.name);
        if (alive) setUnreadByTs(r.data || {});
      } catch {}
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [user?.name]);
  const menuRef = useRef(null);
  const [showTsModal, setShowTsModal] = useState(false);
  const [tsName, setTsName] = useState('');
  const [tsType, setTsType] = useState('org'); // 'org' or 'personal'
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ── Global keyboard shortcuts ──
  // Cmd/Ctrl+K   open command palette
  // Cmd/Ctrl+/   open user guide
  // Cmd/Ctrl+.   open AI assistant
  // ?            (when not focused on an input) — open user guide
  useEffect(() => {
    const isTypingTarget = (el) => el && (
      el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
    );
    const handler = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(p => !p);
      } else if (meta && e.key === '/') {
        e.preventDefault();
        navigate('/help');
      } else if (meta && e.key === '.') {
        e.preventDefault();
        navigate('/ai');
      } else if (e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigate('/help');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [navigate]);

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setTsMenu(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Global event listener to open Create Teamspace modal
  useEffect(() => {
    const handleOpen = () => setShowTsModal(true);
    window.addEventListener('OPEN_CREATE_TS', handleOpen);
    return () => window.removeEventListener('OPEN_CREATE_TS', handleOpen);
  }, []);

  // Auto-expand active teamspace when teamspaces load
  useEffect(() => {
    if (teamspaces.length > 0) {
      const exp = {};
      teamspaces.forEach(ts => { exp[ts._id] = true; });
      setExpandedTs(prev => ({ ...exp, ...prev }));
    }
  }, [teamspaces.length]);

  const handleCreateTs = async (e) => {
    e.preventDefault();
    try {
      const res = await createTeamspace({ 
        name: tsName, 
        ownerId: user._id,
        isPersonal: tsType === 'personal'
      });
      await refreshTeamspaces();
      setActiveTeamspaceId(res.data._id);
      navigate(`/t/${res.data._id}`);
      setExpandedTs(prev => ({ ...prev, [res.data._id]: true }));
      setShowTsModal(false);
      setTsName('');
      setTsType('org');
      if (onToast) onToast('Teamspace created successfully', 'success');
    } catch (e) {
      if (onToast) onToast('Failed to create teamspace', 'error');
    }
  };

  const toggleExpand = (tsId) => setExpandedTs(prev => ({ ...prev, [tsId]: !prev[tsId] }));

  const selectTsAndNav = (tsId, page) => {
    setActiveTeamspaceId(tsId);
    let sub = page === 'teamspace-control' ? 'control' : page === 'team-settings' ? 'team' : page;
    if (page === 'time-mine')           { navigate(`/t/${tsId}/time`);                       return; }
    if (page === 'time-plans')          { navigate(`/t/${tsId}/time/plans`);                 return; }
    if (page === 'time-approvals')      { navigate(`/t/${tsId}/time/approvals/plans`);       return; }
    if (page === 'time-week-approvals') { navigate(`/t/${tsId}/time/approvals/weeks`);       return; }
    navigate(`/t/${tsId}/${sub}`);
  };

  // Check if a page under a specific teamspace is active
  const isTsChildActive = (tsId, page) => urlTeamspaceId === tsId && activePage === page;

  // Items nested under each teamspace. `ownerOnly: true` means only the
  // teamspace owner (or workspace SuperAdmin) sees it. Members + admins-by-role
  // can't see budget/approval/control screens because those are governance
  // tools that belong to whoever owns the department.
  const tsChildItems = [
    { id: 'sprints',           label: 'Sprints',           icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg> },
    { id: 'projects',          label: 'Projects',          icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> },
    { id: 'tasks',             label: 'Tasks',             icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { id: 'workflows',         label: 'Workflows',         icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8l4 4-4 4M8 12h8"/></svg> },
    { id: 'time-mine',         label: 'My Timesheet',      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
    { id: 'time-plans',        label: 'Time · Plans',      ownerOnly: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
    { id: 'time-approvals',    label: 'Time · Plan Approvals', ownerOnly: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> },
    { id: 'time-week-approvals', label: 'Time · Week Approvals', ownerOnly: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> },
    { id: 'team',              label: 'Team',              ownerOnly: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
    { id: 'teamspace-control', label: 'Teamspace Control', ownerOnly: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> },
  ];

  // Helper: is the current user the owner of the given teamspace?
  // SuperAdmin gets owner privileges everywhere.
  const isOwnerOf = (ts) => {
    if (!ts) return false;
    // SuperAdmin sees owner items in every teamspace ONLY while in super-admin
    // mode. In normal mode, only the actual ownerId match counts.
    if (isSuperAdminActive) return true;
    return String(ts.ownerId) === String(user?._id || user?.id);
  };

  // Personal teamspace only gets basic items (no team mgmt)
  const personalChildItems = [
    tsChildItems[0], // Sprints
    tsChildItems[1], // Projects
    tsChildItems[2], // Tasks
    tsChildItems[3], // Workflows
  ];

  const PERSONAL_TS_ID = '__personal__';
  const isPersonalActive = activeTeamspaceId === '' || activeTeamspaceId === PERSONAL_TS_ID;
  const personalExpanded = expandedTs[PERSONAL_TS_ID] !== false; // default open
  const isPersonalChildActive = (page) => isPersonalActive && activePage === page;

  const pageTitles = {
    dashboard: 'Dashboard', tasks: 'Tasks', projects: 'Projects', sprints: 'Sprints',
    workflows: 'Workflows', team: 'Team', organization: 'Organization',
    'team-settings': 'Team', 'teamspace-control': 'Teamspace Control', profile: 'Profile',
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span className="sidebar-title">Mayvel</span>
        </div>

        <nav className="sidebar-nav">
          {/* ─── Dashboard (always visible) ─── */}
          <button className={`sidebar-link ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => onNavigate('dashboard')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            <span>Dashboard</span>
          </button>

          {/* ═══════════════════════════════════════════════
              TEAMSPACES — collapsible tree, Notion-style
             ═══════════════════════════════════════════════ */}
          <div className="sidebar-section-row">
            <span className="sidebar-section-label">Teamspaces</span>
            <button className="sidebar-section-btn" onClick={() => setShowTsModal(true)} title="New Teamspace">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>

          {/* ─── Personal workspace — opt-in. Button only shows if the user
                doesn't already have one. Clicking creates it on-demand. ─── */}
          {!teamspaces.some(t => t.isPersonal && String(t.ownerId) === String(user?._id || user?.id)) && (
            <button
              className="sidebar-link"
              style={{ fontSize: '0.78rem', opacity: 0.7, justifyContent: 'flex-start', gap: 6, padding: '6px 12px' }}
              title="Create a private workspace for personal tasks. Only you will see it."
              onClick={async () => {
                try {
                  await createPersonalTeamspace();
                  await refreshTeamspaces();
                } catch (e) { alert(e.response?.data?.error || e.message); }
              }}
            >
              <span>🔒</span>
              <span>Create personal space</span>
            </button>
          )}

          {/* ─── User-created Teamspaces ─── */}
          {teamspaces.map(ts => {
            const isOpen = expandedTs[ts._id];
            const isActiveTs = activeTeamspaceId === ts._id;
            return (
              <div key={ts._id} className="ts-tree-group">
                <div className={`ts-tree-header ${isActiveTs ? 'ts-active' : ''}`}>
                  <button className="ts-tree-chevron" onClick={() => toggleExpand(ts._id)} title={isOpen ? 'Collapse' : 'Expand'}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><polyline points="9,6 15,12 9,18"/></svg>
                  </button>
                  <button className="ts-tree-name" onClick={() => { setActiveTeamspaceId(ts._id); setExpandedTs(prev => ({ ...prev, [ts._id]: true })); navigate(`/t/${ts._id}`); }}>
                    <span className="ts-tree-icon">{ts.isPersonal ? '👤' : (ts.icon || '🏢')}</span>
                    <span className="ts-tree-label">{ts.name}</span>
                  </button>
                  {/* Per-teamspace notification bell. Shows a small unread badge
                      when there are unread notifications scoped to this teamspace.
                      Click → jumps to Notifications page (global view for now). */}
                  {(() => {
                    const count = unreadByTs[String(ts._id)] || 0;
                    if (!count) return null;
                    return (
                      <button
                        className="ts-tree-bell"
                        onClick={(e) => { e.stopPropagation(); navigate('/notifications'); }}
                        title={`${count} unread notification${count === 1 ? '' : 's'} in ${ts.name}`}
                        style={{
                          position: 'relative', display: 'flex', alignItems: 'center',
                          background: 'none', border: 'none', padding: '4px',
                          cursor: 'pointer', color: '#fdcb6e',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0" fill="none"/>
                        </svg>
                        <span style={{
                          position: 'absolute', top: -2, right: -2,
                          background: '#e74c3c', color: 'white',
                          fontSize: '9px', fontWeight: 700,
                          minWidth: 14, height: 14, lineHeight: '14px',
                          textAlign: 'center', padding: '0 3px',
                          borderRadius: 7, border: '1px solid var(--bg-elevated)',
                        }}>{count > 9 ? '9+' : count}</span>
                      </button>
                    );
                  })()}
                  <button className="ts-tree-menu-btn" onClick={(e) => { e.stopPropagation(); setTsMenu(tsMenu === ts._id ? null : ts._id); }} title="Teamspace options">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                  </button>

                  {tsMenu === ts._id && (
                    <div className="ts-context-menu" ref={menuRef}>
                      <button onClick={() => { setTsMenu(null); selectTsAndNav(ts._id, 'team'); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
                        Add members
                      </button>
                      <button onClick={() => { setTsMenu(null); selectTsAndNav(ts._id, 'team'); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00-.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                        Team settings
                      </button>
                      <button onClick={() => { setTsMenu(null); selectTsAndNav(ts._id, 'teamspace-control'); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        Teamspace control
                      </button>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="ts-tree-children">
                    {/* Personal workspace: show ONLY Tasks (no projects / sprints / team / etc.).
                        For shared teamspaces: hide owner-only items (time plans, approvals,
                        team mgmt, teamspace control) from non-owners. SuperAdmin always sees all. */}
                    {(() => {
                      const owner = isOwnerOf(ts);
                      let items = tsChildItems;
                      if (ts.isPersonal) items = items.filter(it => it.id === 'tasks');
                      else if (!owner)   items = items.filter(it => !it.ownerOnly);
                      return items;
                    })().map(item => (
                      <button
                        key={item.id}
                        className={`sidebar-link sidebar-link-child ${isTsChildActive(ts._id, item.id) ? 'active' : ''}`}
                        onClick={() => selectTsAndNav(ts._id, item.id)}
                      >
                        {item.icon}<span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* ═══ Company ═══ */}
          <div className="sidebar-section-row" style={{ marginTop: 12 }}>
            <span className="sidebar-section-label">Company</span>
          </div>

          <button className={`sidebar-link ${activePage === 'ai' ? 'active' : ''}`} onClick={() => onNavigate('ai')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z"/><path d="M19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z"/></svg>
            <span>AI Assistant</span>
          </button>

          <button className={`sidebar-link ${activePage === 'organization' ? 'active' : ''}`} onClick={() => onNavigate('organization')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="5" rx="1"/><rect x="1" y="15" width="7" height="5" rx="1"/><rect x="16" y="15" width="7" height="5" rx="1"/><path d="M12 7v4M5.5 15v-1a6.5 6.5 0 0113 0v1"/></svg>
            <span>Organization</span>
          </button>

          <button className={`sidebar-link ${activePage === 'org-members' ? 'active' : ''}`} onClick={() => onNavigate('org-members')} style={{ paddingLeft: 36 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            <span>Members</span>
          </button>

          <button className={`sidebar-link ${activePage === 'profile' ? 'active' : ''}`} onClick={() => onNavigate('profile')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Profile</span>
          </button>

          <button className={`sidebar-link ${activePage === 'help' ? 'active' : ''}`} onClick={() => onNavigate('help')} title="User guide & docs">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Help & Guide</span>
          </button>

          {isSuperAdminActive && (
            <button className={`sidebar-link ${activePage === 'access' ? 'active' : ''}`} onClick={() => onNavigate('access')} title="Manage user access levels (Super Admin only)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>Access control</span>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button className="sidebar-link logout-btn" onClick={logout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="header">
          <div className="header-left">
            <h2 className="page-title">{pageTitles[activePage] || ''}</h2>
          </div>
          <div className="header-right">
            {/* If currently impersonating, show a banner with a "Switch back" button.
                Original SuperAdmin info comes from sessionStorage (set when the
                impersonate call returns). */}
            {impersonating && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', background: '#fdcb6e', color: '#222',
                borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
              }}>
                <span>👁️ Viewing as {user?.name}</span>
                <button
                  onClick={handleRevert}
                  style={{ background: '#222', color: '#fdcb6e', border: 'none', padding: '4px 10px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' }}
                >Switch back to {impersonating.name}</button>
              </div>
            )}

            {/* SuperAdmin-only: user switcher dropdown. Hidden while already
                impersonating (revert first to switch to a different user). */}
            {user?.isSuperAdmin && !impersonating && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowSwitcher(s => !s)}
                  title="View the app as another user"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 8,
                    fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >👁️ View as…</button>
                {showSwitcher && (
                  <div style={{
                    position: 'absolute', top: '110%', right: 0, zIndex: 100,
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: 6, minWidth: 260, maxHeight: 360, overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  }}>
                    <div style={{ fontSize: '0.7rem', padding: '4px 8px', color: 'var(--text-secondary)' }}>Switch to view as…</div>
                    {allUsersCache.filter(u => u._id !== user._id).map(u => (
                      <button key={u._id}
                        onClick={() => handleImpersonate(u._id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                          padding: '8px 10px', border: 'none', background: 'none',
                          textAlign: 'left', cursor: 'pointer', borderRadius: 4,
                          color: 'var(--text)', fontSize: '0.8rem',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <span style={{ flex: 1 }}>{u.name}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{u.email}</span>
                      </button>
                    ))}
                    {allUsersCache.length === 0 && <div className="muted" style={{ padding: 8, fontSize: '0.75rem' }}>Loading…</div>}
                  </div>
                )}
              </div>
            )}

            {/* SuperAdmin-only toggle: lets workspace owner switch between full
                Super Admin view (sees + manages every teamspace) and Normal view
                (behaves like any regular admin — only their own teamspaces +
                respects owner-only gates everywhere). */}
            {user?.isSuperAdmin && (
              <label
                className="superadmin-toggle"
                title={superAdminMode ? 'Click to switch to Normal mode (act as a regular admin)' : 'Click to switch back to Super Admin mode'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  padding: '6px 10px', background: superAdminMode ? 'linear-gradient(90deg,#6c5ce7,#a29bfe)' : 'var(--bg-elevated)',
                  color: superAdminMode ? 'white' : 'var(--text)',
                  borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, userSelect: 'none',
                  border: '1px solid ' + (superAdminMode ? '#6c5ce7' : 'var(--border)'),
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={superAdminMode}
                  onChange={e => setSuperAdminMode(e.target.checked)}
                  style={{ accentColor: superAdminMode ? 'white' : '#6c5ce7' }}
                />
                <span>{superAdminMode ? '👑 Super Admin' : '👤 Normal'}</span>
              </label>
            )}
            <NotificationBell onToast={onToast} />
            <span className="header-user-name">{user?.name}</span>
            <span className={`badge ${user?.role === 'Admin' ? 'badge-admin' : 'badge-member'}`}>{isSuperAdminActive ? 'Super Admin' : user?.role}</span>
            <div className="header-avatar" onClick={() => onNavigate('profile')} style={{ cursor: 'pointer' }}>
              {user?.profilePictureUrl ? <img src={signedFileUrl(user.profilePictureUrl)} alt={user.name} /> : <span>{user?.name?.charAt(0)?.toUpperCase()}</span>}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {/* First-run onboarding (auto-shows once per user) */}
      <WelcomeModal />

      {/* Command palette — Cmd+K */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* AI chat — global launcher; hidden when already on the chat page */}
      {location.pathname !== '/ai' && (
        <button
          className="ai-chat-launcher"
          onClick={() => navigate('/ai')}
          title="Ask AI Assistant"
          aria-label="Open AI Assistant"
        >
          ✨
        </button>
      )}

      {showTsModal && (
        <div className="modal-overlay" onClick={() => setShowTsModal(false)} style={{ zIndex: 9999 }}>
          <div className="modal animate-in" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Teamspace</h2>
              <button className="btn-icon" onClick={() => setShowTsModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreateTs} className="modal-form">
              <div className="form-field">
                <label className="label">Teamspace Name</label>
                <input className="input" placeholder="e.g. Engineering, Marketing..." value={tsName} onChange={e => setTsName(e.target.value)} required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Teamspace Type</label>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <label style={{ flex: 1, cursor: 'pointer' }}>
                    <input type="radio" name="tsType" value="org" checked={tsType === 'org'} onChange={e => setTsType(e.target.value)} style={{ display: 'none' }} />
                    <div className={`type-option ${tsType === 'org' ? 'active' : ''}`} style={{
                      padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center',
                      background: tsType === 'org' ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                      borderColor: tsType === 'org' ? 'var(--primary)' : 'var(--border)'
                    }}>
                      <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>🏢</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Organization</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Visible in Org Chart</div>
                    </div>
                  </label>
                  <label style={{ flex: 1, cursor: 'pointer' }}>
                    <input type="radio" name="tsType" value="personal" checked={tsType === 'personal'} onChange={e => setTsType(e.target.value)} style={{ display: 'none' }} />
                    <div className={`type-option ${tsType === 'personal' ? 'active' : ''}`} style={{
                      padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center',
                      background: tsType === 'personal' ? 'rgba(0, 184, 148, 0.1)' : 'transparent',
                      borderColor: tsType === 'personal' ? 'var(--accent-green)' : 'var(--border)'
                    }}>
                      <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>👤</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Personal</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Private to you</div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: 24 }}>
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={() => setShowTsModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
