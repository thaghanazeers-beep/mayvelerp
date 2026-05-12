import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjects, createProject, deleteProject, updateProject, getTasks, createTask, updateTask, deleteTask, getTeam, getAllocations } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import TaskDetailPage from './TaskDetailPage';
import ViewTabs from '../components/ViewTabs';
import './ProjectsPage.css';

const PROJECT_ICONS = ['📁', '🚀', '💼', '🎯', '📊', '🛠️', '🎨', '📝', '🔬', '🌐', '📱', '🏗️'];
const PROJECT_COLORS = ['#6c5ce7', '#00cec9', '#fd79a8', '#fdcb6e', '#74b9ff', '#ff6b6b', '#55efc4', '#fab1a0', '#81ecec', '#a29bfe'];
const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];
const PROJECT_STATUSES = ['Active', 'On Hold', 'Completed'];

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

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);  // null => create mode
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#6c5ce7');
  const [billingType, setBillingType] = useState('tm');         // 'tm' or 'fixed'
  const [contractValue, setContractValue] = useState('');       // INR (rupees, not paise)
  const [scope, setScope] = useState('teamspace');              // 'teamspace' or 'org' — org makes the project visible to every team

  const openCreateModal = () => {
    setEditingProjectId(null);
    setName(''); setDescription(''); setIcon('📁'); setColor('#6c5ce7');
    setBillingType('tm'); setContractValue('');
    setShowCreate(true);
  };
  const openEditModal = (p) => {
    setEditingProjectId(p._id);
    setName(p.name || '');
    setDescription(p.description || '');
    setIcon(p.icon || '📁');
    setColor(p.color || '#6c5ce7');
    setBillingType(p.billingType || 'tm');
    setContractValue(p.contractValueCents ? String(Math.round(p.contractValueCents / 100)) : '');
    setScope(p.scope || 'teamspace');
    setShowCreate(true);
  };

  // Active project view
  const [activeProject, setActiveProject] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  // ─── Allocation gate (Phase 5b) — derive which projects the current user can create tasks in ───
  const { user } = useAuth();
  const [myAllocations, setMyAllocations] = useState([]);
  useEffect(() => {
    if (!user?._id) return;
    getAllocations({ userId: user._id }).then(r => setMyAllocations(r.data)).catch(() => setMyAllocations([]));
  }, [user?._id, activeTeamspaceId]);
  const isAdmin = user?.role === 'Admin';
  const canCreateTaskHere = activeProject && (isAdmin || myAllocations.some(a => String(a.projectId?._id || a.projectId) === String(activeProject._id)));

  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('projects_views_v2');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'list', name: 'List' },
      { id: 'v2', type: 'cards', name: 'Cards' },
      { id: 'v3', type: 'board', name: 'Board' }
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'cards';
  
  // Sub-view for tasks inside a project
  const [projectTaskViews, setProjectTaskViews] = useState(() => {
    const saved = localStorage.getItem('project_task_views');
    return saved ? JSON.parse(saved) : [
      { id: 'pv1', type: 'board', name: 'Board' },
      { id: 'pv2', type: 'table', name: 'Table' },
      { id: 'pv3', type: 'list', name: 'List' }
    ];
  });
  const [activeProjectTaskViewId, setActiveProjectTaskViewId] = useState(projectTaskViews[0]?.id || 'pv1');
  const projectTaskViewType = projectTaskViews.find(v => v.id === activeProjectTaskViewId)?.type || 'board';

  useEffect(() => {
    localStorage.setItem('projects_views_v2', JSON.stringify(views));
  }, [views]);

  useEffect(() => {
    localStorage.setItem('project_task_views', JSON.stringify(projectTaskViews));
  }, [projectTaskViews]);

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    setViews(prev => [...prev, { id: newId, type, name: label }]);
    setActiveViewId(newId);
  };

  const handleAddProjectTaskView = (type, label) => {
    const newId = `pv${Date.now()}`;
    setProjectTaskViews(prev => [...prev, { id: newId, type, name: label }]);
    setActiveProjectTaskViewId(newId);
  };

  const dragItem = useRef(null);

  useEffect(() => { fetchAll(); }, [activeTeamspaceId]);

  const fetchAll = async () => {
    try {
      const [pRes, tRes, tmRes] = await Promise.all([getProjects(activeTeamspaceId), getTasks(activeTeamspaceId), getTeam(activeTeamspaceId)]);
      setProjects(pRes.data);
      setTasks(tRes.data);
      setTeamMembers(tmRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const contractValueCents = Math.max(0, Math.round(Number(contractValue || 0) * 100));
      const payload = { name, description, icon, color, billingType, contractValueCents, scope };
      if (editingProjectId) {
        await updateProject(editingProjectId, payload);
      } else {
        await createProject({ ...payload, teamspaceId: activeTeamspaceId });
      }
      setShowCreate(false);
      setEditingProjectId(null);
      setName(''); setDescription(''); setIcon('📁'); setColor('#6c5ce7');
      setBillingType('tm'); setContractValue(''); setScope('teamspace');
      fetchAll();
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this project and unlink its tasks?')) return;
    try { await deleteProject(id); fetchAll(); } catch (err) { console.error(err); }
  };

  const handleCreateTask = async () => {
    if (!activeProject) return;
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
        projectId: activeProject._id,
        estimatedHours: 0,
        actualHours: 0,
        teamspaceId: activeTeamspaceId,
      };
      await createTask(newTask);
      fetchAll();
      setSelectedTask(newTask);
    } catch (err) { console.error(err); }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try { await updateTask(taskId, { status: newStatus }); fetchAll(); }
    catch (err) { console.error(err); }
  };

  const handleProjectStatusChange = async (projectId, newStatus) => {
    try { 
      await updateProject(projectId, { status: newStatus }); 
      fetchAll(); 
    }
    catch (err) { console.error(err); }
  };

  const handleDeleteTask = async (id) => {
    try { await deleteTask(id); fetchAll(); } catch (err) { console.error(err); }
  };

  // Drag & Drop
  const handleDragStart = (e, task) => { dragItem.current = task; e.dataTransfer.effectAllowed = 'move'; e.target.classList.add('dragging'); };
  const handleDragEnd = (e) => { e.target.classList.remove('dragging'); dragItem.current = null; document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over')); };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over')); e.currentTarget.closest('.board-column')?.classList.add('drag-over'); };
  const handleDrop = async (e, status) => {
    e.preventDefault();
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    if (dragItem.current && dragItem.current.status !== status) {
      try { await updateTask(dragItem.current.id, { status }); fetchAll(); } catch {}
    }
    dragItem.current = null;
  };

  const handleProjectDrop = async (e, status) => {
    e.preventDefault();
    document.querySelectorAll('.board-column').forEach(col => col.classList.remove('drag-over'));
    if (dragItem.current && dragItem.current.status !== status) {
      try { await updateProject(dragItem.current._id, { status }); fetchAll(); } catch {}
    }
    dragItem.current = null;
  };

  const projectTasks = activeProject ? tasks.filter(t => t.projectId === activeProject._id && !t.parentId) : [];
  const getTasksByStatus = (status) => projectTasks.filter(t => t.status === status);

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        onBack={() => { setSelectedTask(null); fetchAll(); }}
        onUpdated={fetchAll}
      />
    );
  }

  if (loading) return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;

  // Inside a project — show tasks
  if (activeProject) {
    return (
      <div className="tasks-page">
        <ViewTabs 
          views={projectTaskViews} 
          activeViewId={activeProjectTaskViewId} 
          onChangeView={setActiveProjectTaskViewId} 
          onAddView={handleAddProjectTaskView} 
        />
        <div className="tasks-toolbar" style={{ paddingTop: 0 }}>
          <div className="tasks-toolbar-left">
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveProject(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
              Back
            </button>
            <span className="project-active-icon" style={{ background: activeProject.color }}>{activeProject.icon}</span>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{activeProject.name}</h3>
            <span className="tasks-count">{projectTasks.length} tasks</span>
          </div>
          <div className="tasks-toolbar-right">
            {canCreateTaskHere ? (
              <button className="btn btn-primary btn-sm" onClick={handleCreateTask} title={`Create a task in ${activeProject.name} (you have an allocation)`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Task
              </button>
            ) : (
              <span className="muted" style={{ fontSize: '0.75rem' }} title="No allocation in this project">🔒 No allocation in this project</span>
            )}
          </div>
        </div>

        {/* Board View */}
        {projectTaskViewType === 'board' && (
          <div className="board">
            {STATUSES.map((status) => {
              const statusTasks = getTasksByStatus(status);
              return (
                <div className="board-column" key={status} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, status)}>
                  <div className="board-column-header">
                    <div className="board-column-title">
                      <span className={`board-dot ${STATUS_DOT[status]}`} />
                      <h3>{status}</h3>
                      <span className="board-column-count">{statusTasks.length}</span>
                    </div>
                  </div>
                  <div className="board-column-cards">
                    {statusTasks.map((task, i) => (
                      <div className="task-card animate-in" key={task.id} style={{ animationDelay: `${i * 0.05}s` }}
                        draggable onDragStart={(e) => handleDragStart(e, task)} onDragEnd={handleDragEnd}
                        onClick={() => setSelectedTask(task)}
                      >
                        <h4 className="task-card-title">{task.title}</h4>
                        <div className="task-card-footer">
                          <div className="task-card-meta">
                            {task.dueDate && <span className="task-card-date">📅 {formatDate(task.dueDate)}</span>}
                            {(task.estimatedHours > 0 || task.actualHours > 0) && (
                              <span className="task-card-hours">⏱ {task.actualHours || 0}/{task.estimatedHours || 0}h</span>
                            )}
                          </div>
                          {task.assignee && (
                            <span className="task-card-assignee">
                              <div className="task-card-avatar">{task.assignee.charAt(0).toUpperCase()}</div>
                            </span>
                          )}
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
        {projectTaskViewType === 'list' && (
          <div className="list-view">
            {projectTasks.length === 0 ? (
              <div className="empty-state"><p>No tasks in this project.</p></div>
            ) : projectTasks.map((task, i) => (
              <div className="list-item animate-in" key={task.id} style={{ animationDelay: `${i * 0.03}s` }} onClick={() => setSelectedTask(task)}>
                <div className="list-item-left">
                  <div className={`list-dot ${STATUS_DOT[task.status] || 'dot-notstarted'}`} />
                  <span className="list-item-title">{task.title}</span>
                </div>
                <div className="list-item-right">
                  {task.assignee && <span className="list-item-assignee">{task.assignee}</span>}
                  {(task.estimatedHours > 0 || task.actualHours > 0) && (
                    <span className="list-item-hours">⏱ {task.actualHours || 0}/{task.estimatedHours || 0}h</span>
                  )}
                  {task.dueDate && <span className="list-item-date">{formatDate(task.dueDate)}</span>}
                  <span className={`badge ${STATUS_BADGE[task.status] || 'badge-notstarted'}`}>{task.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Table View */}
        {projectTaskViewType === 'table' && (
          <div className="table-wrapper">
            <table className="task-table">
              <thead>
                <tr><th>Title</th><th>Status</th><th>Assignee</th><th>Est. Hours</th><th>Actual Hours</th><th>Due Date</th><th></th></tr>
              </thead>
              <tbody>
                {projectTasks.map((task, i) => (
                  <tr key={task.id} className="animate-in" style={{ animationDelay: `${i * 0.03}s` }}>
                    <td className="table-title" onClick={() => setSelectedTask(task)}>{task.title}</td>
                    <td>
                      <select className="table-status-select" value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value)}>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="table-assignee">{task.assignee || '—'}</td>
                    <td className="table-hours">{task.estimatedHours || 0}h</td>
                    <td className="table-hours">{task.actualHours || 0}h</td>
                    <td className="table-date">{formatDate(task.dueDate) || '—'}</td>
                    <td>
                      <button className="btn-icon" onClick={() => handleDeleteTask(task.id)} title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {projectTasks.length === 0 && <div className="empty-state" style={{ marginTop: 32 }}><p>No tasks in this project.</p></div>}
          </div>
        )}
      </div>
    );
  }

  // Project grid
  return (
    <div className="projects-page">
      <div className="team-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ViewTabs 
          views={views} 
          activeViewId={activeViewId} 
          onChangeView={setActiveViewId} 
          onAddView={handleAddView} 
        />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Project
        </button>
      </div>

      {viewType === 'cards' && (
        <div className="row g-4 animate-in">
          {projects.map((p, i) => (
            <div className="col-12 col-md-6 col-lg-4" key={p._id}>
              <div className="glass-card h-100 p-4" style={{ animationDelay: `${i * 0.05}s`, borderTop: `4px solid ${p.color}` }}
                onClick={() => setActiveProject(p)}
              >
                <div className="d-flex justify-content-between align-items-start mb-3">
                  <div className="project-active-icon" style={{ background: p.color }}>
                    {p.icon}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon rounded-circle" title="Project P&L" onClick={(e) => { e.stopPropagation(); navigate(`/t/${activeTeamspaceId}/time/projects/${p._id}/pnl?month=${currentMonth}`); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    </button>
                    <button className="btn-icon rounded-circle" title="Edit" onClick={(e) => { e.stopPropagation(); openEditModal(p); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    </button>
                    <button className="btn-icon rounded-circle" title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(p._id); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>
                <h3 className="mb-2 fw-bold text-white">{p.name}</h3>
                {p.description && <p className="text-muted small mb-3">{p.description}</p>}
                <div className="mt-auto d-flex justify-content-between align-items-center pt-3 border-top border-secondary">
                  <span className="badge bg-primary bg-opacity-25 text-primary">{p.taskCount || 0} tasks</span>
                  <span className="text-muted small">Created {new Date(p.createdDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewType === 'gallery' && (
        <div className="projects-gallery animate-in">
          {projects.map((p, i) => (
            <div className="project-gallery-card" key={p._id} onClick={() => setActiveProject(p)}>
              <div className="project-gallery-cover" style={{ background: p.color + '22' }}>
                <span style={{ fontSize: '3rem' }}>{p.icon}</span>
              </div>
              <div className="project-gallery-body">
                <h3>{p.name}</h3>
                <p>{p.description || 'No description'}</p>
                <div className="project-gallery-footer">
                  <span>{p.taskCount || 0} tasks</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewType === 'list' && (
        <div className="table-responsive animate-in glass-panel p-3">
          <table className="table table-hover table-borderless align-middle text-white mb-0">
            <thead className="border-bottom border-secondary">
              <tr>
                <th className="text-muted small text-uppercase">Icon</th>
                <th className="text-muted small text-uppercase">Project Name</th>
                <th className="text-muted small text-uppercase">Tasks</th>
                <th className="text-muted small text-uppercase">Created</th>
                <th className="text-muted small text-uppercase text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p._id} onClick={() => setActiveProject(p)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontSize: '1.5rem' }}>{p.icon}</td>
                  <td className="fw-bold">{p.name}</td>
                  <td><span className="badge bg-primary bg-opacity-25 text-primary">{p.taskCount || 0}</span></td>
                  <td className="text-muted small">{new Date(p.createdDate).toLocaleDateString()}</td>
                  <td className="text-end">
                    <button className="btn btn-outline-secondary btn-sm me-2" title="P&L" onClick={(e) => { e.stopPropagation(); navigate(`/t/${activeTeamspaceId}/time/projects/${p._id}/pnl?month=${currentMonth}`); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    </button>
                    <button className="btn btn-outline-secondary btn-sm me-2" title="Edit" onClick={(e) => { e.stopPropagation(); openEditModal(p); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    </button>
                    <button className="btn btn-outline-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(p._id); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewType === 'board' && (
        <div className="board animate-in">
          {PROJECT_STATUSES.map(status => {
            const statusProjects = projects.filter(p => (p.status || 'Active') === status);
            return (
              <div className="board-column" key={status} onDragOver={handleDragOver} onDrop={(e) => handleProjectDrop(e, status)}>
                <div className="board-column-header">
                  <div className="board-column-title">
                    <span className={`board-dot ${status === 'Completed' ? 'dot-done' : status === 'On Hold' ? 'dot-review' : 'dot-progress'}`} />
                    <h3>{status}</h3>
                    <span className="board-column-count">{statusProjects.length}</span>
                  </div>
                </div>
                <div className="board-column-cards">
                  {statusProjects.map((p, i) => (
                    <div className="task-card animate-in" key={p._id} style={{ animationDelay: `${i * 0.05}s`, borderLeft: `3px solid ${p.color}` }}
                      draggable onDragStart={(e) => handleDragStart(e, p)} onDragEnd={handleDragEnd}
                      onClick={() => setActiveProject(p)}
                    >
                      <div className="project-card-top" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                        <span className="project-icon" style={{ fontSize: '1.5rem' }}>{p.icon}</span>
                        <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={(e) => { e.stopPropagation(); handleDelete(p._id); }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                      </div>
                      <h4 className="task-card-title">{p.name}</h4>
                      {p.description && <p className="task-card-desc" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.description}</p>}
                      <div className="task-card-footer" style={{ marginTop: 12 }}>
                        <span className="task-card-hours">{p.taskCount || 0} tasks</span>
                        <select
                          className="table-status-select"
                          style={{ marginLeft: 'auto', background: 'transparent', padding: '2px 4px', fontSize: '0.75rem', border: '1px solid var(--border)' }}
                          value={p.status || 'Active'}
                          onClick={e => e.stopPropagation()}
                          onChange={e => handleProjectStatusChange(p._id, e.target.value)}
                        >
                          {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  {statusProjects.length === 0 && <div className="board-empty"><p>Drop projects here</p></div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingProjectId ? 'Edit Project' : 'New Project'}</h2>
              <button className="btn-icon" onClick={() => setShowCreate(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-field">
                <label className="label">Project Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seyo App, Marketing..." required autoFocus />
              </div>
              <div className="form-field">
                <label className="label">Description</label>
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." />
              </div>
              <div className="form-field">
                <label className="label">Icon</label>
                <div className="picker-row">
                  {PROJECT_ICONS.map(ic => (
                    <button type="button" key={ic} className={`picker-item ${icon === ic ? 'active' : ''}`} onClick={() => setIcon(ic)}>{ic}</button>
                  ))}
                </div>
              </div>
              <div className="form-field">
                <label className="label">Color</label>
                <div className="picker-row">
                  {PROJECT_COLORS.map(c => (
                    <button type="button" key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
                  ))}
                </div>
              </div>
              <div className="form-field">
                <label className="label">Billing type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button"
                    className={`btn btn-sm ${billingType === 'tm' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setBillingType('tm')}>
                    ⏱ Time &amp; Materials
                  </button>
                  <button type="button"
                    className={`btn btn-sm ${billingType === 'fixed' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setBillingType('fixed')}>
                    📜 Fixed bid
                  </button>
                </div>
                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 6 }}>
                  {billingType === 'tm'
                    ? 'Client pays per billable hour. Loss = cost > revenue.'
                    : 'Client pays a flat contract value. Loss = cost > contract.'}
                </div>
              </div>
              <div className="form-field">
                <label className="label">
                  Contract value (₹) <span className="muted" style={{ fontWeight: 400 }}>
                    {billingType === 'tm' ? '— optional ceiling' : '— required'}
                  </span>
                </label>
                <input className="input" type="number" min="0" step="1000"
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  placeholder="e.g. 500000" />
                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                  Client-approved budget. Plans whose committed cost crosses this trigger an overrun warning.
                </div>
              </div>
              <div className="form-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={scope === 'org'} onChange={(e) => setScope(e.target.checked ? 'org' : 'teamspace')} />
                  <span className="label" style={{ margin: 0 }}>Org-wide project</span>
                </label>
                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                  Check this for projects (like "Seyo") where multiple departments contribute — Design, Dev, and Testing each get their own tasks + budget approval within the same project. Leave unchecked for projects owned by a single team.
                </div>
              </div>
              <div className="modal-actions">
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">{editingProjectId ? 'Save Changes' : 'Create Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
