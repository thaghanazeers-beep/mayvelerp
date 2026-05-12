import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTasks, createTask, updateTask, deleteTask, getTeam, getProjects, getSprints, getAllocations, signedFileUrl } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import { useToast } from '../context/ToastContext';
import { taskUrl, idFromTaskUrlSegment } from '../utils/slug';
import TaskDetailPage from './TaskDetailPage';
import ViewTabs from '../components/ViewTabs';
import './TasksPage.css';

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];

const STATUS_DOT = {
  'Not Yet Started': 'dot-notstarted',
  'In Progress': 'dot-progress',
  'In Review': 'dot-review',
  'Completed': 'dot-done',
  'Rejected': 'dot-rejected',
};

const STATUS_BADGE = {
  'Not Yet Started': 'badge-notstarted',
  'In Progress': 'badge-progress',
  'In Review': 'badge-review',
  'Completed': 'badge-done',
  'Rejected': 'badge-rejected',
};

export default function TasksPage() {
  const { user } = useAuth();
  const { activeTeamspaceId, setActiveTeamspaceId } = useTeamspace();
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams();
  // Two URL shapes can land here:
  //   /t/:teamspaceId/tasks/:taskId            (legacy / programmatic)
  //   /:projectSlug/:sprintSlug/:taskSlugWithId (pretty Notion-style)
  const urlTsId   = params.teamspaceId;
  const urlTaskId = params.taskId || idFromTaskUrlSegment(params.taskSlugWithId);
  const [tasks, setTasks] = useState([]);
  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('tasks_views');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'board', name: 'Board' },
      { id: 'v2', type: 'table', name: 'Table' }
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'board';

  useEffect(() => {
    localStorage.setItem('tasks_views', JSON.stringify(views));
  }, [views]);
  const [loading, setLoading] = useState(true);
  // selectedTask is derived from the URL — taskId param (from either route shape).
  const selectedTask = urlTaskId
    ? tasks.find(t => String(t.id) === String(urlTaskId) || String(t._id) === String(urlTaskId))
    : null;
  const setSelectedTask = (t) => {
    if (!t) {
      navigate(`/t/${urlTsId || activeTeamspaceId}/tasks`);
    } else {
      navigate(taskUrl(t, projects, sprints));
    }
  };

  // When the pretty URL is hit but our tasks aren't loaded yet, no-op for now.
  useEffect(() => {}, [urlTaskId, selectedTask, urlTsId]);

  const [teamMembers, setTeamMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [selectedTasksIds, setSelectedTasksIds] = useState([]);

  // ─── Allocation-gated task creation ─────────────────────────────────────────
  // ALL active allocations in this teamspace (used by admins/owners to see who can be assigned).
  // For members, we only fetch their own.
  const [allAllocations, setAllAllocations] = useState([]);
  const [showNewTask,   setShowNewTask]   = useState(false);
  const [newTaskTitle,  setNewTaskTitle]  = useState('');
  const [newTaskProjectId, setNewTaskProjectId] = useState('');
  const [newTaskAssignee,  setNewTaskAssignee]  = useState('');     // userId
  const [newTaskHours,     setNewTaskHours]     = useState(1);
  const [newTaskBillable,  setNewTaskBillable]  = useState(true);   // billable vs non-billable budget
  const [creatingTask,  setCreatingTask]  = useState(false);

  const isAdmin = user?.role === 'Admin';

  // Only the *current user's* allocations narrow down what they can do as a non-admin.
  const myAllocations = isAdmin ? allAllocations : allAllocations.filter(a => String(a.userId?._id || a.userId) === String(user?._id));

  // Projects the user (or any allocated employee, for admins) can create tasks in.
  const allocatedProjectIds = new Set((isAdmin ? allAllocations : myAllocations).map(a => String(a.projectId?._id || a.projectId)));
  const projectsForCreate = isAdmin ? projects : projects.filter(p => allocatedProjectIds.has(String(p._id)));

  useEffect(() => {
    if (!activeTeamspaceId) return;
    // Admins see all teamspace allocations; members only their own
    const q = isAdmin ? {} : { userId: user?._id };
    getAllocations(q).then(r => setAllAllocations(r.data)).catch(() => setAllAllocations([]));
  }, [user?._id, activeTeamspaceId, isAdmin]);

  // For the modal: who can be assigned in this project? (limited to the chosen billable type)
  const assigneeOptions = newTaskProjectId
    ? Array.from(new Set(allAllocations
        .filter(a => String(a.projectId?._id || a.projectId) === String(newTaskProjectId)
                  && Boolean(a.billable) === Boolean(newTaskBillable))
        .map(a => String(a.userId?._id || a.userId))))
        .map(uid => teamMembers.find(m => String(m._id) === uid)).filter(Boolean)
    : [];

  // Remaining hours for (assignee × project), optionally narrowed by billable flag.
  const remainingHoursFor = (assigneeId, projectId, billable = null) => allAllocations
    .filter(a => String(a.projectId?._id || a.projectId) === String(projectId)
              && String(a.userId?._id || a.userId)       === String(assigneeId)
              && (billable === null || Boolean(a.billable) === Boolean(billable)))
    .reduce((s, a) => s + (a.remainingHours || 0), 0);
  const remainingForChoice = newTaskAssignee && newTaskProjectId
    ? remainingHoursFor(newTaskAssignee, newTaskProjectId, newTaskBillable)
    : 0;

  const openNewTaskModal = () => {
    setNewTaskTitle('');
    setNewTaskHours(1);
    setNewTaskBillable(true);
    const initialProj = filterProject && projectsForCreate.find(p => p._id === filterProject)
      ? filterProject
      : (projectsForCreate[0]?._id || '');
    setNewTaskProjectId(initialProj);
    // Pre-pick self as assignee only if I have a billable allocation in this project
    const selfBillableAlloc = initialProj && allAllocations.find(a =>
      String(a.projectId?._id || a.projectId) === String(initialProj) &&
      String(a.userId?._id || a.userId) === String(user?._id) &&
      Boolean(a.billable) === true);
    setNewTaskAssignee(selfBillableAlloc ? user?._id : '');
    setShowNewTask(true);
  };
  const submitNewTask = async (e) => {
    e?.preventDefault();
    if (!newTaskProjectId || !newTaskTitle.trim() || !newTaskAssignee) return;
    setCreatingTask(true);
    try {
      const assigneeMember = teamMembers.find(m => String(m._id) === String(newTaskAssignee));
      const r = await createTask({
        id: `task_${Date.now()}`,
        title: newTaskTitle.trim(),
        description: '',
        status: 'Not Yet Started',
        assignee: assigneeMember?.name || '',
        assigneeUserId: newTaskAssignee,                  // backend reads this for the allocation gate
        dueDate: null,
        createdDate: new Date().toISOString(),
        customProperties: [],
        attachments: [],
        parentId: null,
        projectId: newTaskProjectId,
        sprintId: filterSprint || null,
        estimatedHours: Number(newTaskHours) || 0,
        actualHours: 0,
        billable: newTaskBillable,
        teamspaceId: activeTeamspaceId,
      });
      setShowNewTask(false);
      await fetchTasks();
      setSelectedTask(r.data);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setCreatingTask(false); }
  };

  const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
  const PRIORITY_COLOR = { Urgent: '#ff4d4d', High: '#ff9800', Medium: '#6c5ce7', Low: '#00b894' };

  // Filters
  const [openFilter, setOpenFilter] = useState(null); // which filter dropdown is open
  const [filterAssignee, setFilterAssignee] = useState(() => localStorage.getItem('mf_assignee') || '');
  const [filterProject, setFilterProject] = useState(() => localStorage.getItem('mf_project') || '');
  const [filterSprint, setFilterSprint] = useState(() => localStorage.getItem('mf_sprint') || '');
  const [filterStatus, setFilterStatus] = useState(() => localStorage.getItem('mf_status') || '');
  const [filterPriority, setFilterPriority] = useState(() => localStorage.getItem('mf_priority') || '');
  const [filterDateFrom, setFilterDateFrom] = useState(() => localStorage.getItem('mf_dateFrom') || '');
  const [filterDateTo, setFilterDateTo] = useState(() => localStorage.getItem('mf_dateTo') || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('mf_groupBy') || '');
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  useEffect(() => { localStorage.setItem('mf_groupBy', groupBy); }, [groupBy]);
  const toggleGroup = (key) => setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Persist filters
  useEffect(() => {
    localStorage.setItem('mf_assignee', filterAssignee);
    localStorage.setItem('mf_project', filterProject);
    localStorage.setItem('mf_sprint', filterSprint);
    localStorage.setItem('mf_status', filterStatus);
    localStorage.setItem('mf_priority', filterPriority);
    localStorage.setItem('mf_dateFrom', filterDateFrom);
    localStorage.setItem('mf_dateTo', filterDateTo);
  }, [filterAssignee, filterProject, filterSprint, filterStatus, filterPriority, filterDateFrom, filterDateTo]);

  const dragItem = useRef(null);

  useEffect(() => {
    fetchTasks();
    fetchTeam();
    fetchProjects();
    fetchSprints();
  }, [activeTeamspaceId]);

  const fetchTasks = async () => {
    try {
      const res = await getTasks(activeTeamspaceId);
      setTasks(res.data);
      if (window.pendingOpenTaskId) {
        const task = res.data.find(t => t._id === window.pendingOpenTaskId || t.id === window.pendingOpenTaskId);
        if (task) setSelectedTask(task);
        window.pendingOpenTaskId = null;
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchTeam = async () => {
    try { const res = await getTeam(activeTeamspaceId); setTeamMembers(res.data); }
    catch (err) { console.error(err); }
  };

  const fetchProjects = async () => {
    try { const res = await getProjects(activeTeamspaceId); setProjects(res.data); }
    catch (err) { console.error(err); }
  };

  const fetchSprints = async () => {
    try { const res = await getSprints(activeTeamspaceId); setSprints(res.data); }
    catch (err) { console.error(err); }
  };

  const handleCreateNew = async () => {
    try {
      const newTask = {
        id: `task_${Date.now()}`,
        title: 'Untitled',
        description: '',
        status: 'Not Yet Started',
        assignee: '',
        dueDate: null,
        createdDate: new Date().toISOString(),
        customProperties: [],
        attachments: [],
        parentId: null,
        projectId: filterProject || null,
        estimatedHours: 0,
        actualHours: 0,
        teamspaceId: activeTeamspaceId,
      };
      await createTask(newTask);
      await fetchTasks();
      setSelectedTask(newTask);
    } catch (err) {
      console.error(err);
      toast?.error(err.response?.data?.error || err.message || 'Failed to create task');
    }
  };

  const isAdminOrOwner = user?.role === 'Admin' || user?.role === 'Team Owner';
  
  const canEditTask = (task) => {
    if (isAdminOrOwner) return true;
    return task.assignee === user?.name;
  };

  const canChangeStatusTo = (task, newStatus) => {
    if (!canEditTask(task)) return false;
    if (isAdminOrOwner) return true;
    if (newStatus === 'Completed' || newStatus === 'Rejected') return false;
    return true;
  };

  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && !canChangeStatusTo(task, newStatus)) return;
    try { await updateTask(taskId, { status: newStatus }); fetchTasks(); }
    catch (err) {
      console.error(err);
      toast?.error(err.response?.data?.error || err.message || 'Failed to update task');
    }
  };

  const handleDelete = async (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task || !canEditTask(task)) return;
    try { await deleteTask(id); fetchTasks(); }
    catch (err) {
      console.error(err);
      toast?.error(err.response?.data?.error || err.message || 'Failed to delete task');
    }
  };

  // Drag & Drop
  const handleDragStart = (e, task) => {
    if (!canEditTask(task)) {
      e.preventDefault();
      return;
    }
    dragItem.current = task;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
  };
  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging');
    dragItem.current = null;
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
  };
  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    e.currentTarget.closest('.board-column')?.classList.add('drag-over');
  };
  const handleDrop = async (e, status) => {
    e.preventDefault();
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    const task = dragItem.current;
    if (task && task.status !== status) {
      if (!canChangeStatusTo(task, status)) {
        dragItem.current = null;
        return;
      }
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
      try { await updateTask(task.id, { status }); }
      catch { fetchTasks(); }
    }
    dragItem.current = null;
  };

  // Filter logic
  const filteredTasks = tasks.filter(t => {
    if (t.parentId) return false;
    if (filterAssignee && t.assignee !== filterAssignee) return false;
    if (filterProject && t.projectId !== filterProject) return false;
    if (filterSprint && t.sprintId !== filterSprint) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterDateFrom && t.dueDate && new Date(t.dueDate) < new Date(filterDateFrom)) return false;
    if (filterDateTo && t.dueDate && new Date(t.dueDate) > new Date(filterDateTo)) return false;
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const activeFilters = [
    filterAssignee  && { key: 'assignee',  label: 'Assignee',  value: filterAssignee,  clear: () => setFilterAssignee('') },
    filterProject   && { key: 'project',   label: 'Project',   value: projects.find(p => p._id === filterProject)?.name || filterProject, clear: () => setFilterProject('') },
    filterSprint    && { key: 'sprint',    label: 'Sprint',    value: sprints.find(s => s._id === filterSprint)?.name || filterSprint, clear: () => setFilterSprint('') },
    filterStatus    && { key: 'status',    label: 'Status',    value: filterStatus,    clear: () => setFilterStatus('') },
    filterPriority  && { key: 'priority',  label: 'Priority',  value: filterPriority,  clear: () => setFilterPriority('') },
    filterDateFrom  && { key: 'dateFrom',  label: 'From',      value: filterDateFrom,  clear: () => setFilterDateFrom('') },
    filterDateTo    && { key: 'dateTo',    label: 'To',        value: filterDateTo,    clear: () => setFilterDateTo('') },
  ].filter(Boolean);

  const getTasksByStatus = (status) => filteredTasks.filter(t => t.status === status);

  const getProjectName = (projectId) => {
    const p = projects.find(pr => pr._id === projectId);
    return p ? `${p.icon} ${p.name}` : '';
  };

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const renderAvatar = (name) => {
    const member = teamMembers.find(m => m.name === name);
    if (member?.profilePictureUrl) {
      return <img src={signedFileUrl(member.profilePictureUrl)} alt={name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />;
    }
    return name.charAt(0).toUpperCase();
  };

  const handleSaveForEveryone = () => {
    // In a full implementation, this would save the view to the Teamspace/Project document in DB.
    alert("Filters saved as default for all workspace members! (UI Mockup)");
  };

  const clearFilters = () => {
    setFilterAssignee('');
    setFilterProject('');
    setFilterSprint('');
    setFilterStatus('');
    setFilterPriority('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchQuery('');
    setOpenFilter(null);
  };

  if (selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        onBack={() => { setSelectedTask(null); fetchTasks(); }}
        onUpdated={fetchTasks}
      />
    );
  }

  if (loading) {
    return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    const newViews = [...views, { id: newId, type, name: label }];
    setViews(newViews);
    setActiveViewId(newId);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) setSelectedTasksIds(filteredTasks.map(t => t.id || t._id));
    else setSelectedTasksIds([]);
  };

  const handleSelectTask = (e, id) => {
    if (e.target.checked) setSelectedTasksIds([...selectedTasksIds, id]);
    else setSelectedTasksIds(selectedTasksIds.filter(i => i !== id));
  };

  // Sprint quick-pills (Notion style)
  const activeSprint = sprints.find(s => s.status === 'active');
  const completedSprints = sprints
    .filter(s => s.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || b.endDate || 0) - new Date(a.completedAt || a.endDate || 0));
  const lastCompletedSprint = completedSprints[0];
  const otherRecentSprints = sprints
    .filter(s => s._id !== activeSprint?._id && s._id !== lastCompletedSprint?._id)
    .slice(0, 4);

  // Group-by computation (used in table view when groupBy is set)
  const groupedTasks = (() => {
    if (!groupBy) return null;
    const groups = new Map();
    for (const t of filteredTasks) {
      let key, label;
      switch (groupBy) {
        case 'assignee':
          key = t.assignee || '__unassigned__';
          label = t.assignee || 'Unassigned';
          break;
        case 'status':
          key = t.status || 'Not Yet Started';
          label = key;
          break;
        case 'project': {
          const p = projects.find(pr => pr._id === t.projectId);
          key = t.projectId || '__noproject__';
          label = p ? `${p.icon || '📁'} ${p.name}` : 'No Project';
          break;
        }
        case 'priority':
          key = t.priority || '__nopriority__';
          label = t.priority || 'No Priority';
          break;
        case 'sprint': {
          const s = sprints.find(sp => sp._id === t.sprintId);
          key = t.sprintId || '__nosprint__';
          label = s ? s.name : 'No Sprint';
          break;
        }
        default:
          key = '__all__';
          label = 'All';
      }
      if (!groups.has(key)) groups.set(key, { key, label, tasks: [] });
      groups.get(key).tasks.push(t);
    }
    return Array.from(groups.values()).sort((a, b) => b.tasks.length - a.tasks.length);
  })();

  const handleBulkChangeSprint = async (sprintId) => {
    for (const taskId of selectedTasksIds) {
      await updateTask(taskId, { sprintId: sprintId === 'None' ? null : sprintId });
    }
    setSelectedTasksIds([]);
    fetchTasks();
  };

  return (
    <div className="tasks-page">
      <ViewTabs
        views={views}
        activeViewId={activeViewId}
        onChangeView={setActiveViewId}
        onAddView={handleAddView}
      />

      {/* ─── Sprint Pills (Notion-style quick filters) ─── */}
      {sprints.length > 0 && (
        <div className="sprint-pills">
          <button className={`sprint-pill ${!filterSprint ? 'active' : ''}`} onClick={() => setFilterSprint('')}>
            <span className="sprint-pill-icon">🗂</span> All tasks
          </button>
          {activeSprint && (
            <button className={`sprint-pill ${filterSprint === activeSprint._id ? 'active' : ''}`} onClick={() => setFilterSprint(activeSprint._id)} title={activeSprint.name}>
              <span className="sprint-pill-icon">▶</span> Current: {activeSprint.name}
            </button>
          )}
          {lastCompletedSprint && (
            <button className={`sprint-pill ${filterSprint === lastCompletedSprint._id ? 'active' : ''}`} onClick={() => setFilterSprint(lastCompletedSprint._id)} title={lastCompletedSprint.name}>
              <span className="sprint-pill-icon">⏮</span> Last: {lastCompletedSprint.name}
            </button>
          )}
          {otherRecentSprints.map(s => (
            <button key={s._id} className={`sprint-pill ${filterSprint === s._id ? 'active' : ''}`} onClick={() => setFilterSprint(s._id)}>
              <span className="sprint-pill-icon">🏃</span> {s.name}
            </button>
          ))}
        </div>
      )}

      {/* ─── Toolbar ─── */}
      <div className="tasks-toolbar" style={{ paddingTop: 0 }}>
        <div className="tasks-toolbar-left">
          {/* Search */}
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="search-input" placeholder="Search tasks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          {/* Filter trigger */}
          <div className="filter-dropdown-root">
            <button
              className={`btn btn-ghost btn-sm filter-trigger ${openFilter ? 'active-filter' : ''}`}
              onClick={() => setOpenFilter(openFilter ? null : 'assignee')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/></svg>
              Filter
            </button>

            {/* Filter panel */}
            {openFilter && (
              <div className="filter-panel animate-in" onClick={e => e.stopPropagation()}>
                <div className="filter-panel-header">
                  <span>Filter by</span>
                  <button className="btn-icon" onClick={() => setOpenFilter(null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>

                {/* Assignee */}
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Assignee</span>
                  <select className="filter-panel-select" value={filterAssignee} onChange={e => { setFilterAssignee(e.target.value); }}>
                    <option value="">Any assignee</option>
                    {teamMembers.map(m => <option key={m._id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>

                {/* Status */}
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Status</span>
                  <select className="filter-panel-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">Any status</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Priority */}
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Priority</span>
                  <select className="filter-panel-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
                    <option value="">Any priority</option>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                {/* Project */}
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Project</span>
                  <select className="filter-panel-select" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
                    <option value="">Any project</option>
                    {projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
                  </select>
                </div>

                {/* Sprint */}
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Sprint</span>
                  <select className="filter-panel-select" value={filterSprint} onChange={e => setFilterSprint(e.target.value)}>
                    <option value="">Any sprint</option>
                    {sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                  </select>
                </div>

                {/* Due Date range */}
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Due after</span>
                  <input className="filter-panel-date" type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
                </div>
                <div className="filter-panel-row">
                  <span className="filter-panel-label">Due before</span>
                  <input className="filter-panel-date" type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
                </div>

                <div className="filter-panel-footer" style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  {activeFilters.length > 0 && (
                    <button className="filter-clear-all" onClick={clearFilters} style={{ flex: 1 }}>Clear</button>
                  )}
                  <button className="btn btn-sm btn-primary" onClick={handleSaveForEveryone} style={{ flex: 2 }}>Save for everyone</button>
                </div>
              </div>
            )}
          </div>

          {/* Group-by dropdown */}
          <div className="groupby-control">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            <select className="groupby-select" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
              <option value="">No grouping</option>
              <option value="assignee">Group by Assignee</option>
              <option value="status">Group by Status</option>
              <option value="project">Group by Project</option>
              <option value="priority">Group by Priority</option>
              <option value="sprint">Group by Sprint</option>
            </select>
          </div>

          {/* Active filter badges */}
          {activeFilters.map(f => (
            <span key={f.key} className="filter-chip">
              <span className="filter-chip-label">{f.label}:</span>
              <span className="filter-chip-value">{f.value}</span>
              <button className="filter-chip-close" onClick={f.clear} title={`Remove ${f.label} filter`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          ))}

          <span className="tasks-count">{filteredTasks.length} tasks</span>
        </div>

        <div className="tasks-toolbar-right">
          {projectsForCreate.length > 0 ? (
            <button className="btn btn-primary btn-sm" onClick={openNewTaskModal} title="Create a task in a project where you have allocated hours">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Task
            </button>
          ) : (
            <span className="muted" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              🔒 Need an allocation — see <a href={`/t/${activeTeamspaceId}/time/plans`} style={{ color: 'var(--primary-light)' }}>Project Plans</a>
            </span>
          )}
        </div>
      </div>

      {/* Click outside to close filter panel */}
      {openFilter && <div className="filter-overlay" onClick={() => setOpenFilter(null)} />}

      <div className="tasks-content">
        {/* Board View */}
        {viewType === 'board' && (
          <div className="board">
            {STATUSES.map((status) => {
              const statusTasks = getTasksByStatus(status);
              return (
                <div className="board-column" key={status}
                  onDragOver={(e) => handleDragOver(e, status)}
                  onDrop={(e) => handleDrop(e, status)}
                >
                  <div className="board-column-header">
                    <div className="board-column-title">
                      <span className={`board-dot ${STATUS_DOT[status]}`} />
                      <h3>{status}</h3>
                      <span className="board-column-count">{statusTasks.length}</span>
                    </div>
                  </div>
                  <div className="board-column-cards">
                    {statusTasks.map((task, i) => (
                      <div className="task-card animate-in" key={task.id} style={{ animationDelay: `${i * 0.05}s`, opacity: canEditTask(task) ? 1 : 0.8 }}
                        draggable={canEditTask(task)} onDragStart={(e) => handleDragStart(e, task)} onDragEnd={handleDragEnd}
                        onClick={() => setSelectedTask(task)}
                      >
                        {task.projectId && <span className="task-card-project">{getProjectName(task.projectId)}</span>}
                        {task.priority && (
                          <span className="task-priority-badge" style={{ background: PRIORITY_COLOR[task.priority] + '22', color: PRIORITY_COLOR[task.priority], border: `1px solid ${PRIORITY_COLOR[task.priority]}44` }}>
                            {task.priority}
                          </span>
                        )}
                        <h4 className="task-card-title">{task.title}</h4>
                        {task.description && (() => {
                          try {
                            const parsed = JSON.parse(task.description);
                            if (Array.isArray(parsed)) {
                              const txt = parsed.filter(b => b.content).map(b => b.content.replace(/^\[[ x]\]\s*/, '')).join(' ');
                              return txt ? <p className="task-card-desc">{txt}</p> : null;
                            }
                          } catch {}
                          return <p className="task-card-desc">{task.description}</p>;
                        })()}
                        <div className="task-card-footer">
                          <div className="task-card-meta">
                            {task.dueDate && (
                              <span className="task-card-date">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                {formatDate(task.dueDate)}
                              </span>
                            )}
                            {(task.estimatedHours > 0 || task.actualHours > 0) && (
                              <span className="task-card-hours" title={task.billable === false ? 'Non-billable hours' : 'Billable hours'}>
                                {task.billable === false ? '🛠' : '⏱'} {task.actualHours || 0}/{task.estimatedHours || 0}h
                              </span>
                            )}
                            {task.assignee && (
                              <span className="task-card-assignee">
                                <div className="task-card-avatar">{renderAvatar(task.assignee)}</div>
                                {task.assignee}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {statusTasks.length === 0 && <div className="board-empty"><p>Drop tasks here</p></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List View */}
        {viewType === 'list' && (
          <div className="list-view">
            {/* Bulk Action Bar */}
            {selectedTasksIds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 16 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedTasksIds.length} tasks selected</span>
                <div style={{ flex: 1 }} />
                <select 
                  className="input" 
                  style={{ width: 200, padding: '6px 12px', fontSize: '0.8rem' }}
                  onChange={e => handleBulkChangeSprint(e.target.value)}
                  value=""
                >
                  <option value="" disabled>Change Sprint...</option>
                  <option value="None">None</option>
                  {sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedTasksIds([])}>Cancel</button>
              </div>
            )}

            {filteredTasks.length === 0 ? (
              <div className="empty-state"><p>No tasks match your filters.</p></div>
            ) : (
              <>
                {/* Table Header */}
                <div className="list-item" style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-muted)' }}>
                  <div className="list-item-left" style={{ gap: 16 }}>
                    <input type="checkbox" onChange={handleSelectAll} checked={selectedTasksIds.length === filteredTasks.length && filteredTasks.length > 0} />
                    <span className="list-item-title" style={{ color: 'var(--text-muted)' }}>Task Name</span>
                  </div>
                  <div className="list-item-right" style={{ paddingRight: 16 }}>
                    <span style={{ width: 120 }}>Assignee</span>
                    <span style={{ width: 80, textAlign: 'right' }}>Time</span>
                    <span style={{ width: 100, textAlign: 'right' }}>Due Date</span>
                    <span style={{ width: 100, textAlign: 'right' }}>Status</span>
                  </div>
                </div>

                {filteredTasks.map((task, i) => {
                  const taskId = task.id || task._id;
                  return (
                  <div className="list-item animate-in" key={taskId} style={{ animationDelay: `${i * 0.03}s` }} onClick={() => setSelectedTask(task)}>
                    <div className="list-item-left" style={{ gap: 16 }}>
                      <input type="checkbox" onClick={e => e.stopPropagation()} onChange={e => handleSelectTask(e, taskId)} checked={selectedTasksIds.includes(taskId)} />
                      <div className={`list-dot ${STATUS_DOT[task.status] || 'dot-notstarted'}`} style={{ marginLeft: 0 }} />
                      <span className="list-item-title">{task.title}</span>
                      {task.projectId && <span className="list-item-project">{getProjectName(task.projectId)}</span>}
                    </div>
                    <div className="list-item-right">
                      <span className="list-item-assignee" style={{ width: 120 }}>
                        {task.assignee ? (
                          <>
                            <div className="task-card-avatar" style={{width: 20, height: 20, fontSize: 10, marginRight: 6, display: 'inline-flex', verticalAlign: 'middle'}}>{renderAvatar(task.assignee)}</div>
                            {task.assignee}
                          </>
                        ) : 'Unassigned'}
                      </span>
                      <span className="list-item-hours" style={{ width: 80, textAlign: 'right' }}>
                        {(task.estimatedHours > 0 || task.actualHours > 0) ? `⏱ ${task.actualHours || 0}/${task.estimatedHours || 0}h` : ''}
                      </span>
                      <span className="list-item-date" style={{ width: 100, textAlign: 'right' }}>
                        {task.dueDate ? formatDate(task.dueDate) : ''}
                      </span>
                      <span style={{ width: 100, textAlign: 'right' }}>
                        <span className={`badge ${STATUS_BADGE[task.status] || 'badge-notstarted'}`}>{task.status}</span>
                      </span>
                    </div>
                  </div>
                )})}
              </>
            )}
          </div>
        )}

        {/* Table View */}
        {viewType === 'table' && (() => {
          const renderRow = (task, i) => (
            <tr key={task.id || task._id} className="animate-in" style={{ animationDelay: `${i * 0.02}s` }}>
              <td className="table-title" onClick={() => setSelectedTask(task)}>{task.title}</td>
              <td className="table-project">{task.projectId ? getProjectName(task.projectId) : '—'}</td>
              <td>
                <select className="table-status-select" value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value)} disabled={!canEditTask(task)}>
                  {STATUSES.map(s => <option key={s} value={s} disabled={!canChangeStatusTo(task, s)}>{s}</option>)}
                </select>
              </td>
              <td className="table-assignee">{task.assignee || '—'}</td>
              <td className="table-hours">{task.estimatedHours || 0}h</td>
              <td className="table-hours">{task.actualHours || 0}h</td>
              <td className="table-date">{formatDate(task.dueDate) || '—'}</td>
              <td className="table-date">{formatDate(task.createdDate)}</td>
              <td>
                {canEditTask(task) && (
                  <button className="btn-icon" onClick={() => handleDelete(task.id)} title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                )}
              </td>
            </tr>
          );
          const tableHead = (
            <thead>
              <tr><th>Title</th><th>Project</th><th>Status</th><th>Assignee</th><th>Est. Hours</th><th>Actual Hours</th><th>Due Date</th><th>Created</th><th></th></tr>
            </thead>
          );

          if (groupBy && groupedTasks) {
            return (
              <div className="table-wrapper">
                {groupedTasks.map(g => {
                  const collapsed = collapsedGroups.has(g.key);
                  const isAssigneeGroup = groupBy === 'assignee' && g.key !== '__unassigned__';
                  return (
                    <div className="task-group" key={g.key}>
                      <button className="task-group-header" onClick={() => toggleGroup(g.key)}>
                        <svg className="task-group-chevron" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        {isAssigneeGroup && <span className="task-group-avatar">{renderAvatar(g.label)}</span>}
                        <span className="task-group-label">{g.label}</span>
                        <span className="task-group-count">{g.tasks.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="table-responsive">
                          <table className="task-table">
                            {tableHead}
                            <tbody>{g.tasks.map(renderRow)}</tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredTasks.length === 0 && <div className="empty-state" style={{ marginTop: 32 }}><p>No tasks match.</p></div>}
              </div>
            );
          }

          return (
            <div className="table-wrapper table-responsive">
              <table className="task-table">
                {tableHead}
                <tbody>{filteredTasks.map(renderRow)}</tbody>
              </table>
              {filteredTasks.length === 0 && <div className="empty-state" style={{ marginTop: 32 }}><p>No tasks match.</p></div>}
            </div>
          );
        })()}
      </div>

      {showNewTask && (
        <div className="modal-overlay" onClick={() => setShowNewTask(false)}>
          <div className="modal animate-in" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Task</h2>
              <button className="btn-icon" onClick={() => setShowNewTask(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={submitNewTask} className="modal-form">
              <div className="form-field">
                <label className="label">Project</label>
                <select className="input" required value={newTaskProjectId}
                  onChange={(e) => { setNewTaskProjectId(e.target.value); setNewTaskAssignee(''); }}>
                  <option value="">— Pick a project —</option>
                  {projectsForCreate.map(p => (
                    <option key={p._id} value={p._id}>{p.icon} {p.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="label">Hours type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button"
                    className={`btn btn-sm ${newTaskBillable ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => { setNewTaskBillable(true); setNewTaskAssignee(''); }}>
                    💰 Billable
                  </button>
                  <button type="button"
                    className={`btn btn-sm ${!newTaskBillable ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => { setNewTaskBillable(false); setNewTaskAssignee(''); }}>
                    🛠 Non-billable
                  </button>
                </div>
                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 6 }}>
                  {newTaskBillable
                    ? 'Billable hours generate revenue and contribute fully to the assignee\'s score.'
                    : 'Non-billable hours are overhead/internal — no revenue, and counted as "extra hours" that lower the assignee\'s score.'}
                </div>
              </div>
              <div className="form-field">
                <label className="label">Assign to (must have a {newTaskBillable ? 'billable' : 'non-billable'} allocation in this project)</label>
                <select className="input" required value={newTaskAssignee}
                  disabled={!newTaskProjectId}
                  onChange={(e) => setNewTaskAssignee(e.target.value)}>
                  <option value="">— Pick an employee —</option>
                  {assigneeOptions.map(m => {
                    const b = remainingHoursFor(m._id, newTaskProjectId, true);
                    const n = remainingHoursFor(m._id, newTaskProjectId, false);
                    return <option key={m._id} value={m._id}>{m.name} — 💰 {b.toFixed(1)}h B · 🛠 {n.toFixed(1)}h NB</option>;
                  })}
                </select>
                {newTaskProjectId && assigneeOptions.length === 0 && (
                  <div className="muted" style={{ fontSize: '0.72rem', marginTop: 6 }}>
                    No one has a {newTaskBillable ? 'billable' : 'non-billable'} allocation in this project yet — go to Time → Plans first.
                  </div>
                )}
              </div>
              <div className="form-field">
                <label className="label">Title</label>
                <input className="input" required value={newTaskTitle} autoFocus
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="e.g. Write May social media calendar" />
              </div>
              <div className="form-field">
                <label className="label">Estimated hours
                  {newTaskAssignee && newTaskProjectId && (
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.7rem' }}>
                      ({remainingForChoice.toFixed(1)}h {newTaskBillable ? 'billable' : 'non-billable'} remaining for this assignee)
                    </span>
                  )}
                </label>
                <input className="input" type="number" min="0" step="0.25" required
                  value={newTaskHours}
                  onChange={(e) => setNewTaskHours(e.target.value)}
                  placeholder="e.g. 4" />
                {Number(newTaskHours) > remainingForChoice && newTaskAssignee && (
                  <div className="muted" style={{ fontSize: '0.72rem', marginTop: 6, color: 'var(--accent-orange)' }}>
                    ⚠️ Estimate exceeds remaining allocation — task can still be created but the assignee will hit the cap when logging time.
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNewTask(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm"
                  disabled={creatingTask || !newTaskProjectId || !newTaskAssignee || !newTaskTitle.trim() || !(Number(newTaskHours) > 0)}>
                  {creatingTask ? 'Creating…' : 'Create task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
