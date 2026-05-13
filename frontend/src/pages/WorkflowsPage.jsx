import { useState, useEffect } from 'react';
import { getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, toggleWorkflow, getWorkflowLogs, getTeam, getProjects, copyWorkflows } from '../api';
import { useTeamspace } from '../context/TeamspaceContext';
import { useToast } from '../context/ToastContext';
import ViewTabs from '../components/ViewTabs';
import { PageIntro } from '../components/PageIntro';
import './WorkflowsPage.css';

// Each trigger declares which `category` it belongs to ('task' | 'plan').
// The builder uses this to filter the action picker + condition fields appropriately.
const TRIGGERS = [
  // ── Task lifecycle ──
  { category: 'task', type: 'task_created',           label: 'Task Created',          icon: '✨', desc: 'When a new task is created' },
  { category: 'task', type: 'status_changed',         label: 'Status Changed',        icon: '🔄', desc: 'When task status changes' },
  { category: 'task', type: 'assignee_changed',       label: 'Assignee Changed',      icon: '👤', desc: 'When task is reassigned' },
  { category: 'task', type: 'task_moved_to_project',  label: 'Moved to Project',      icon: '📁', desc: 'When task moves to a project' },
  { category: 'task', type: 'due_date_approaching',   label: 'Due Date Near',         icon: '⏰', desc: 'When due date is approaching' },
  { category: 'task', type: 'task_updated',           label: 'Task Updated',          icon: '📝', desc: 'When any task field changes' },
  // ── Project / plan approval lifecycle ──
  { category: 'plan', type: 'plan_submitted',         label: 'Plan Submitted',        icon: '📤', desc: 'When an owner submits a project hours plan for admin approval' },
  { category: 'plan', type: 'plan_approved',          label: 'Plan Approved',         icon: '✅', desc: 'When admin approves a project hours plan' },
  { category: 'plan', type: 'plan_rejected',          label: 'Plan Rejected',         icon: '❌', desc: 'When admin rejects a project hours plan' },
  { category: 'plan', type: 'budget_overrun',         label: 'Budget Overrun',        icon: '💸', desc: 'When a plan\'s actual cost crosses the planned budget' },
];

const TRIGGER_GROUPS = [
  { id: 'task', label: 'Task lifecycle',           hint: 'React to changes on individual tasks' },
  { id: 'plan', label: 'Project / plan approval',  hint: 'React to monthly hours plan workflow' },
];

// Actions valid per category. Plan triggers can only emit notifications (engine
// silently ignores task-mutating actions for plan entities).
const ACTIONS = [
  { type: 'change_status',     label: 'Change Status',       icon: '🔀', categories: ['task'] },
  { type: 'assign_to',         label: 'Assign To',           icon: '👤', categories: ['task'] },
  { type: 'move_to_project',   label: 'Move to Project',     icon: '📁', categories: ['task'] },
  { type: 'create_subtask',    label: 'Create Subtask',      icon: '📋', categories: ['task'] },
  { type: 'set_due_date',      label: 'Set Due Date',        icon: '📅', categories: ['task'] },
  { type: 'add_label',         label: 'Add Label',           icon: '🏷️', categories: ['task'] },
  { type: 'send_notification', label: 'Send Notification',   icon: '🔔', categories: ['task', 'plan'] },
  { type: 'duplicate_task',    label: 'Duplicate Task',      icon: '📄', categories: ['task'] },
];

const CONDITION_FIELDS_TASK = [
  { value: 'status',   label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'project',  label: 'Project' },
  { value: 'title',    label: 'Title' },
  { value: 'billable', label: 'Billable (true/false)' },
];

const CONDITION_FIELDS_PLAN = [
  { value: 'status',              label: 'Plan status' },
  { value: 'title',               label: 'Plan title' },
  { value: 'periodMonth',         label: 'Period month (YYYY-MM)' },
  { value: 'totalCostCents',      label: 'Planned cost (paise)' },
  { value: 'totalRevenueCents',   label: 'Planned revenue (paise)' },
  { value: 'plannedProfitCents',  label: 'Planned profit (paise)' },
  { value: 'submittedBy',         label: 'Submitted by (email)' },
];

const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];
const WF_COLORS = ['#6c5ce7','#00cec9','#fd79a8','#fdcb6e','#74b9ff','#ff6b6b','#55efc4','#a29bfe'];

export default function WorkflowsPage() {
  const { activeTeamspaceId, teamspaces } = useTeamspace();
  const toast = useToast();
  const showErr = (err, fallback) => {
    console.error(err);
    toast?.error(err.response?.data?.error || err.message || fallback);
  };
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showLogs, setShowLogs] = useState(null);
  const [logs, setLogs] = useState([]);
  const [team, setTeam] = useState([]);
  const [projects, setProjects] = useState([]);

  // Builder state
  const [wfName, setWfName] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [wfColor, setWfColor] = useState('#6c5ce7');
  const [wfTrigger, setWfTrigger] = useState(null);
  const [wfTriggerConfig, setWfTriggerConfig] = useState({});
  const [wfConditions, setWfConditions] = useState([]);
  const [wfActions, setWfActions] = useState([]);
  const [builderStep, setBuilderStep] = useState(0);
  const [editingWfId, setEditingWfId] = useState(null);

  const [views, setViews] = useState(() => {
    const saved = localStorage.getItem('workflows_views');
    return saved ? JSON.parse(saved) : [
      { id: 'v1', type: 'grid', name: 'Grid View' },
      { id: 'v2', type: 'list', name: 'List View' }
    ];
  });
  const [activeViewId, setActiveViewId] = useState(views[0]?.id || 'v1');
  const viewType = views.find(v => v.id === activeViewId)?.type || 'grid';

  useEffect(() => {
    localStorage.setItem('workflows_views', JSON.stringify(views));
  }, [views]);

  const handleAddView = (type, label) => {
    const newId = `v${Date.now()}`;
    const newViews = [...views, { id: newId, type, name: label }];
    setViews(newViews);
    setActiveViewId(newId);
  };

  useEffect(() => { fetchAll(); }, [activeTeamspaceId]);

  const fetchAll = async () => {
    try {
      const [wRes, tRes, pRes] = await Promise.all([getWorkflows(activeTeamspaceId), getTeam(activeTeamspaceId), getProjects(activeTeamspaceId)]);
      setWorkflows(wRes.data);
      setTeam(tRes.data);
      setProjects(pRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── Copy-from-teamspace modal state ──
  // Pulls every workflow from another teamspace and clones a chosen subset into
  // the current one. Copies are independent — editing them never touches the source.
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [copySourceWorkflows, setCopySourceWorkflows] = useState([]);
  const [copySelected, setCopySelected] = useState(() => new Set());
  const [copyBusy, setCopyBusy] = useState(false);
  const otherTeamspaces = (teamspaces || []).filter(t => String(t._id) !== String(activeTeamspaceId) && !t.isPersonal);

  const openCopyModal = () => {
    setCopySourceId(''); setCopySourceWorkflows([]); setCopySelected(new Set());
    setShowCopyModal(true);
  };
  const loadCopySource = async (tsId) => {
    setCopySourceId(tsId);
    if (!tsId) { setCopySourceWorkflows([]); setCopySelected(new Set()); return; }
    try {
      const r = await getWorkflows(tsId);
      setCopySourceWorkflows(r.data || []);
      setCopySelected(new Set((r.data || []).map(w => w._id)));
    } catch (err) { showErr(err, 'Could not load workflows from that teamspace'); }
  };
  const toggleCopyPick = (id) => {
    setCopySelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const handleCopy = async () => {
    if (!copySourceId || copySelected.size === 0) return;
    setCopyBusy(true);
    try {
      const r = await copyWorkflows(copySourceId, activeTeamspaceId, [...copySelected]);
      toast?.success(`Copied ${r.data.copied} workflow${r.data.copied === 1 ? '' : 's'}`);
      setShowCopyModal(false);
      fetchAll();
    } catch (err) { showErr(err, 'Could not copy workflows'); }
    finally { setCopyBusy(false); }
  };

  const openBuilder = (wf = null) => {
    if (wf) {
      setEditingWfId(wf._id);
      setWfName(wf.name || '');
      setWfDesc(wf.description || '');
      setWfColor(wf.color || '#6c5ce7');
      setWfTrigger(wf.trigger?.type || null);
      setWfTriggerConfig(wf.trigger?.config || {});
      setWfConditions(wf.conditions || []);
      setWfActions(wf.actions || []);
    } else {
      setEditingWfId(null);
      setWfName(''); setWfDesc(''); setWfColor('#6c5ce7');
      setWfTrigger(null); setWfTriggerConfig({});
      setWfConditions([]); setWfActions([]);
    }
    setBuilderStep(0);
    setShowBuilder(true);
  };

  const handleSave = async () => {
    if (!wfName || !wfTrigger || wfActions.length === 0) return;
    try {
      const payload = {
        name: wfName, description: wfDesc, color: wfColor,
        trigger: { type: wfTrigger, config: wfTriggerConfig },
        conditions: wfConditions,
        actions: wfActions.map((a, i) => ({ ...a, order: i })),
        teamspaceId: activeTeamspaceId
      };

      if (editingWfId) {
        await updateWorkflow(editingWfId, payload);
        toast?.success('Workflow updated');
      } else {
        await createWorkflow(payload);
        toast?.success('Workflow created');
      }

      setShowBuilder(false);
      fetchAll();
    } catch (err) { showErr(err, 'Failed to save workflow'); }
  };

  const handleToggle = async (id) => {
    try { await toggleWorkflow(id); fetchAll(); }
    catch (err) { showErr(err, 'Failed to toggle workflow'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this workflow?')) return;
    try { await deleteWorkflow(id); fetchAll(); }
    catch (err) { showErr(err, 'Failed to delete workflow'); }
  };

  const viewLogs = async (wf) => {
    setShowLogs(wf);
    try { const res = await getWorkflowLogs(wf._id); setLogs(res.data); }
    catch (err) { showErr(err, 'Failed to fetch logs'); }
  };

  const addCondition = () => setWfConditions([...wfConditions, { field: 'status', operator: 'equals', value: '' }]);
  const removeCondition = (i) => setWfConditions(wfConditions.filter((_, idx) => idx !== i));
  const updateCondition = (i, updates) => setWfConditions(wfConditions.map((c, idx) => idx === i ? { ...c, ...updates } : c));

  const addAction = (type) => setWfActions([...wfActions, { type, config: {} }]);
  const removeAction = (i) => setWfActions(wfActions.filter((_, idx) => idx !== i));
  const updateActionConfig = (i, key, val) => {
    setWfActions(wfActions.map((a, idx) => idx === i ? { ...a, config: { ...a.config, [key]: val } } : a));
  };

  const renderActionConfig = (action, idx) => {
    switch (action.type) {
      case 'change_status':
        return (<select className="wf-cfg-input" value={action.config.status || ''} onChange={e => updateActionConfig(idx, 'status', e.target.value)}>
          <option value="">Select status</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>);
      case 'assign_to':
        return (<select className="wf-cfg-input" value={action.config.assignee || ''} onChange={e => updateActionConfig(idx, 'assignee', e.target.value)}>
          <option value="">Select assignee</option>{team.map(m => <option key={m._id} value={m.name}>{m.name}</option>)}</select>);
      case 'move_to_project':
        return (<select className="wf-cfg-input" value={action.config.projectId || ''} onChange={e => updateActionConfig(idx, 'projectId', e.target.value)}>
          <option value="">Select project</option>{projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}</select>);
      case 'create_subtask':
        return (<div className="wf-cfg-col" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input className="wf-cfg-input" placeholder="Subtask title" value={action.config.title || ''} onChange={e => updateActionConfig(idx, 'title', e.target.value)} />
          <select className="wf-cfg-input" value={action.config.status || ''} onChange={e => updateActionConfig(idx, 'status', e.target.value)}>
            <option value="">Default Status (Not Yet Started)</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="wf-cfg-input" value={action.config.assignee || ''} onChange={e => updateActionConfig(idx, 'assignee', e.target.value)}>
            <option value="">Same as parent task</option>{team.map(m => <option key={m._id} value={m.name}>{m.name}</option>)}
          </select>
        </div>);
      case 'set_due_date':
        return (<div className="wf-cfg-row">
          <select className="wf-cfg-input" value={action.config.mode || 'relative'} onChange={e => updateActionConfig(idx, 'mode', e.target.value)}>
            <option value="relative">Days from now</option><option value="fixed">Fixed date</option></select>
          {action.config.mode === 'fixed' ? <input className="wf-cfg-input" type="date" value={action.config.date || ''} onChange={e => updateActionConfig(idx, 'date', e.target.value)} />
            : <input className="wf-cfg-input" type="number" placeholder="7" value={action.config.daysFromNow || ''} onChange={e => updateActionConfig(idx, 'daysFromNow', parseInt(e.target.value))} />}
        </div>);
      case 'add_label':
        return (<input className="wf-cfg-input" placeholder="Label text" value={action.config.label || ''} onChange={e => updateActionConfig(idx, 'label', e.target.value)} />);
      case 'send_notification': {
        const isPlanCtx = TRIGGERS.find(t => t.type === wfTrigger)?.category === 'plan';
        const tokensHint = isPlanCtx
          ? 'Tokens: {plan} {status} {submitter} {month} {cost} {revenue} {reason}'
          : 'Tokens: {task} {assignee} {status}';
        return (<div className="wf-cfg-col" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <select className="wf-cfg-input" value={action.config.sendTo || (isPlanCtx ? 'project_owner' : 'assignee')} onChange={e => updateActionConfig(idx, 'sendTo', e.target.value)}>
            {!isPlanCtx && <option value="assignee">Task Assignee</option>}
            {isPlanCtx && <option value="project_owner">Project Owner</option>}
            {isPlanCtx && <option value="plan_submitter">Plan Submitter</option>}
            <option value="admins">All Admins</option>
            <option value="all">All Team Members</option>
            <option value="specific">Specific User...</option>
          </select>
          {action.config.sendTo === 'specific' && (
            <select className="wf-cfg-input" value={action.config.targetUser || ''} onChange={e => updateActionConfig(idx, 'targetUser', e.target.value)}>
              <option value="">Select User...</option>
              {team.map(m => <option key={m._id} value={m.name}>{m.name}</option>)}
            </select>
          )}
          <input className="wf-cfg-input" placeholder="Notification Title" value={action.config.title || ''} onChange={e => updateActionConfig(idx, 'title', e.target.value)} />
          <input className="wf-cfg-input" placeholder={`Message (${tokensHint})`} value={action.config.message || ''} onChange={e => updateActionConfig(idx, 'message', e.target.value)} />
          <div className="muted" style={{ fontSize: '0.7rem' }}>{tokensHint}</div>
        </div>);
      }
      case 'duplicate_task':
        return (<input className="wf-cfg-input" placeholder="Title prefix (e.g. 'Copy of')" value={action.config.titlePrefix || ''} onChange={e => updateActionConfig(idx, 'titlePrefix', e.target.value)} />);
      default: return null;
    }
  };

  const triggerNeedsConfig = (type) => ['status_changed', 'due_date_approaching', 'task_moved_to_project'].includes(type);

  const renderTriggerConfig = () => {
    if (!wfTrigger) return null;
    switch (wfTrigger) {
      case 'status_changed':
        return (<div className="wf-trigger-cfg">
          <div className="wf-cfg-row"><label>From</label><select className="wf-cfg-input" value={wfTriggerConfig.fromStatus || ''} onChange={e => setWfTriggerConfig({ ...wfTriggerConfig, fromStatus: e.target.value })}>
            <option value="">Any</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="wf-cfg-row"><label>To</label><select className="wf-cfg-input" value={wfTriggerConfig.toStatus || ''} onChange={e => setWfTriggerConfig({ ...wfTriggerConfig, toStatus: e.target.value })}>
            <option value="">Any</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
        </div>);
      case 'due_date_approaching':
        return (<div className="wf-trigger-cfg"><div className="wf-cfg-row"><label>Days before due</label>
          <input className="wf-cfg-input" type="number" min="1" value={wfTriggerConfig.daysBefore || 1} onChange={e => setWfTriggerConfig({ ...wfTriggerConfig, daysBefore: parseInt(e.target.value) })} /></div></div>);
      case 'task_moved_to_project':
        return (<div className="wf-trigger-cfg"><div className="wf-cfg-row"><label>Target project</label>
          <select className="wf-cfg-input" value={wfTriggerConfig.projectId || ''} onChange={e => setWfTriggerConfig({ ...wfTriggerConfig, projectId: e.target.value })}>
            <option value="">Any</option>{projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}</select></div></div>);
      default: return null;
    }
  };

  if (loading) return <div className="tasks-loading"><div className="spinner" style={{ width: 32, height: 32 }} /></div>;

  return (
    <div className="workflows-page">
      <PageIntro
        icon="⚡"
        title="Workflows"
        actor="Admins"
        purpose="Automate the boring parts. A workflow watches for an event (a task is created, a status changes, etc.) and runs an action — assign someone, set a due date, send a notification. Workflows here only run inside this teamspace; they never affect other teamspaces."
        storageKey="workflows-list"
        youCanDo={[
          'Create a workflow with a trigger (when X happens) and an action (do Y)',
          'Toggle a workflow on/off without deleting it',
          'Open the run log to see when each workflow last fired',
          'Copy rules from another teamspace as a starting point (the copies are independent)',
        ]}
        whatHappensNext={[
          'Turn on → the workflow runs automatically every time its trigger fires in this teamspace',
          'Turn off → no actions run, but the rule is kept so you can re-enable later',
          'Note: task review (Owner approves/rejects) and plan approval are not workflows — they\'re built-in, owner-based rules',
        ]}
      />
      <ViewTabs
        views={views}
        activeViewId={activeViewId}
        onChangeView={setActiveViewId}
        onAddView={handleAddView}
      />

      <div className="team-toolbar" style={{ paddingTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="tasks-count">{workflows.length} workflows</span>
        <div style={{ flex: 1 }} />
        {otherTeamspaces.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={openCopyModal} title="Clone workflows from another teamspace into this one">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          &nbsp;Copy from teamspace
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={openBuilder}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Workflow
        </button>
      </div>

      {viewType === 'grid' && (
        <div className="wf-grid">
          {workflows.map((wf, i) => {
            const trigInfo = TRIGGERS.find(t => t.type === wf.trigger?.type);
            return (
              <div className="wf-card animate-in" key={wf._id} style={{ animationDelay: `${i * 0.05}s`, borderLeft: `3px solid ${wf.color}` }}>
                <div className="wf-card-top">
                  <div className="wf-card-header">
                    <span className="wf-card-icon">{trigInfo?.icon || '⚡'}</span>
                    <div>
                      <h3 className="wf-card-name">{wf.name}</h3>
                      {wf.description && <p className="wf-card-desc">{wf.description}</p>}
                    </div>
                  </div>
                  <label className="wf-toggle">
                    <input type="checkbox" checked={wf.enabled} onChange={() => handleToggle(wf._id)} />
                    <span className="wf-toggle-slider" />
                  </label>
                </div>
                <div className="wf-card-flow">
                  <span className="wf-flow-chip trigger">{trigInfo?.label || wf.trigger?.type}</span>
                  <span className="wf-flow-arrow">→</span>
                  {wf.conditions?.length > 0 && (<><span className="wf-flow-chip condition">{wf.conditions.length} condition{wf.conditions.length > 1 ? 's' : ''}</span><span className="wf-flow-arrow">→</span></>)}
                  <span className="wf-flow-chip action">{wf.actions?.length || 0} action{(wf.actions?.length || 0) !== 1 ? 's' : ''}</span>
                </div>
                <div className="wf-card-footer">
                  <span className="wf-card-stat">Ran {wf.executionCount || 0} times</span>
                  <div className="wf-card-actions">
                    <button className="btn-icon" onClick={() => viewLogs(wf)} title="View logs" style={{ width: 28, height: 28 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                    </button>
                    <button className="btn-icon" onClick={() => openBuilder(wf)} title="Edit" style={{ width: 28, height: 28 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="btn-icon" onClick={() => handleDelete(wf._id)} title="Delete" style={{ width: 28, height: 28 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {workflows.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>No workflows yet. Create your first automation!</p></div>}
        </div>
      )}

      {viewType === 'list' && (
        <div className="table-wrapper table-responsive">
          <table className="table table-hover table-borderless task-table align-middle mb-0">
            <thead>
              <tr>
                <th>Workflow Name</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Executions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf, i) => {
                const trigInfo = TRIGGERS.find(t => t.type === wf.trigger?.type);
                return (
                  <tr key={wf._id} className="animate-in" style={{ animationDelay: `${i * 0.03}s` }}>
                    <td style={{ fontWeight: 500 }}>
                      <span style={{ marginRight: 8, color: wf.color }}>●</span>
                      {wf.name}
                    </td>
                    <td>{trigInfo?.label || wf.trigger?.type}</td>
                    <td>
                      <label className="wf-toggle" style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
                        <input type="checkbox" checked={wf.enabled} onChange={() => handleToggle(wf._id)} />
                        <span className="wf-toggle-slider" />
                      </label>
                    </td>
                    <td>{wf.executionCount || 0}</td>
                    <td>
                      <div className="wf-card-actions" style={{ justifyContent: 'flex-start' }}>
                        <button className="btn-icon" onClick={() => viewLogs(wf)} title="View logs" style={{ width: 28, height: 28 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                        </button>
                        <button className="btn-icon" onClick={() => openBuilder(wf)} title="Edit" style={{ width: 28, height: 28 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="btn-icon" onClick={() => handleDelete(wf._id)} title="Delete" style={{ width: 28, height: 28 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {workflows.length === 0 && <div className="empty-state" style={{ marginTop: 32 }}><p>No workflows yet.</p></div>}
        </div>
      )}

      {/* Builder Modal */}
      {showBuilder && (
        <div className="modal-overlay" onClick={() => setShowBuilder(false)}>
          <div className="wf-builder animate-in" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚡ {editingWfId ? 'Edit' : 'New'} Workflow</h2>
              <button className="btn-icon" onClick={() => setShowBuilder(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Steps */}
            <div className="wf-steps">
              {['Trigger', 'Conditions', 'Actions', 'Details'].map((s, i) => (
                <button key={s} className={`wf-step ${builderStep === i ? 'active' : ''} ${builderStep > i ? 'done' : ''}`} onClick={() => setBuilderStep(i)}>
                  <span className="wf-step-num">{builderStep > i ? '✓' : i + 1}</span>{s}
                </button>
              ))}
            </div>

            <div className="wf-builder-body">
              {/* Step 0: Trigger */}
              {builderStep === 0 && (
                <div className="wf-step-content">
                  <h3>When should this run?</h3>
                  {TRIGGER_GROUPS.map(g => (
                    <div key={g.id} style={{ marginBottom: 16 }}>
                      <div style={{
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        marginBottom: 6,
                      }}>
                        {g.label} <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {g.hint}</span>
                      </div>
                      <div className="wf-trigger-grid">
                        {TRIGGERS.filter(t => t.category === g.id).map(t => (
                          <button
                            key={t.type}
                            className={`wf-trigger-option ${wfTrigger === t.type ? 'selected' : ''}`}
                            onClick={() => { setWfTrigger(t.type); setWfTriggerConfig({}); setWfActions([]); setWfConditions([]); }}
                          >
                            <span className="wf-trigger-icon">{t.icon}</span>
                            <div><strong>{t.label}</strong><p>{t.desc}</p></div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {renderTriggerConfig()}
                </div>
              )}

              {/* Step 1: Conditions */}
              {builderStep === 1 && (() => {
                const triggerCat = TRIGGERS.find(t => t.type === wfTrigger)?.category || 'task';
                const fields = triggerCat === 'plan' ? CONDITION_FIELDS_PLAN : CONDITION_FIELDS_TASK;
                return (
                <div className="wf-step-content">
                  <h3>Only run if... <span className="wf-optional">(optional)</span></h3>
                  {wfConditions.map((c, i) => (
                    <div className="wf-condition-row" key={i}>
                      <select className="wf-cfg-input" value={c.field} onChange={e => updateCondition(i, { field: e.target.value })}>
                        {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      <select className="wf-cfg-input" value={c.operator} onChange={e => updateCondition(i, { operator: e.target.value })}>
                        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {!['is_empty', 'is_not_empty'].includes(c.operator) && (
                        <input className="wf-cfg-input" placeholder="Value..." value={c.value} onChange={e => updateCondition(i, { value: e.target.value })} />
                      )}
                      <button className="btn-icon" onClick={() => removeCondition(i)} style={{ width: 28, height: 28 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={addCondition}>+ Add Condition</button>
                </div>
                );
              })()}

              {/* Step 2: Actions */}
              {builderStep === 2 && (
                <div className="wf-step-content">
                  <h3>Then do this...</h3>
                  {wfActions.map((a, i) => {
                    const info = ACTIONS.find(x => x.type === a.type);
                    return (
                      <div className="wf-action-card" key={i}>
                        <div className="wf-action-header">
                          <span>{info?.icon} {info?.label}</span>
                          <button className="btn-icon" onClick={() => removeAction(i)} style={{ width: 24, height: 24 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                        <div className="wf-action-body">{renderActionConfig(a, i)}</div>
                      </div>
                    );
                  })}
                  <div className="wf-action-picker">
                    {ACTIONS
                      .filter(a => a.categories.includes(TRIGGERS.find(t => t.type === wfTrigger)?.category || 'task'))
                      .map(a => (
                        <button key={a.type} className="wf-action-pick-btn" onClick={() => addAction(a.type)}>
                          <span>{a.icon}</span> {a.label}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Step 3: Details */}
              {builderStep === 3 && (
                <div className="wf-step-content">
                  <h3>Name your workflow</h3>
                  <div className="form-field"><label className="label">Name</label>
                    <input className="input" value={wfName} onChange={e => setWfName(e.target.value)} placeholder="e.g. Auto-assign new tasks" required autoFocus /></div>
                  <div className="form-field"><label className="label">Description</label>
                    <input className="input" value={wfDesc} onChange={e => setWfDesc(e.target.value)} placeholder="What does this workflow do?" /></div>
                  <div className="form-field"><label className="label">Color</label>
                    <div className="picker-row">{WF_COLORS.map(c => (
                      <button type="button" key={c} className={`color-swatch ${wfColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setWfColor(c)} />
                    ))}</div></div>
                  {/* Summary */}
                  <div className="wf-summary">
                    <div className="wf-summary-flow">
                      <span className="wf-flow-chip trigger">{TRIGGERS.find(t => t.type === wfTrigger)?.label}</span>
                      <span className="wf-flow-arrow">→</span>
                      {wfConditions.length > 0 && (<><span className="wf-flow-chip condition">{wfConditions.length} condition{wfConditions.length > 1 ? 's' : ''}</span><span className="wf-flow-arrow">→</span></>)}
                      <span className="wf-flow-chip action">{wfActions.length} action{wfActions.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="wf-builder-footer">
              {builderStep > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setBuilderStep(builderStep - 1)}>Back</button>}
              <div style={{ flex: 1 }} />
              {builderStep < 3 ? (
                <button className="btn btn-primary btn-sm" onClick={() => setBuilderStep(builderStep + 1)}
                  disabled={builderStep === 0 && !wfTrigger}>Next</button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleSave}
                  disabled={!wfName || !wfTrigger || wfActions.length === 0}>{editingWfId ? 'Save Changes' : 'Create Workflow'}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Copy-from-teamspace modal */}
      {showCopyModal && (
        <div className="modal-overlay" onClick={() => !copyBusy && setShowCopyModal(false)}>
          <div className="modal animate-in" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📋 Copy workflows from another teamspace</h2>
              <button className="btn-icon" onClick={() => !copyBusy && setShowCopyModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: '0 4px 12px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Pick a teamspace to copy from. The copies belong to this teamspace — editing them later won\'t affect the source.
            </div>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label className="label">Source teamspace</label>
              <select className="input" value={copySourceId} onChange={(e) => loadCopySource(e.target.value)}>
                <option value="">— pick one —</option>
                {otherTeamspaces.map(t => (
                  <option key={t._id} value={t._id}>{t.icon || '🏢'} {t.name}</option>
                ))}
              </select>
            </div>
            {copySourceId && (
              <div className="form-field" style={{ marginBottom: 12 }}>
                <label className="label">Workflows to copy ({copySelected.size}/{copySourceWorkflows.length} selected)</label>
                {copySourceWorkflows.length === 0 ? (
                  <p className="muted" style={{ fontSize: '0.78rem', margin: '6px 0 0' }}>That teamspace has no workflows to copy.</p>
                ) : (
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                    {copySourceWorkflows.map(w => {
                      const trigInfo = TRIGGERS.find(t => t.type === w.trigger?.type);
                      return (
                        <label key={w._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: copySelected.has(w._id) ? 'var(--bg-selected)' : 'transparent' }}>
                          <input type="checkbox" checked={copySelected.has(w._id)} onChange={() => toggleCopyPick(w._id)} />
                          <span style={{ fontSize: 18 }}>{trigInfo?.icon || '⚡'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{w.name}</div>
                            <div className="muted" style={{ fontSize: '0.75rem' }}>{trigInfo?.label || w.trigger?.type} · {w.actions?.length || 0} action{(w.actions?.length || 0) !== 1 ? 's' : ''} {w.enabled ? '' : '· (off)'}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCopyModal(false)} disabled={copyBusy}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleCopy} disabled={copyBusy || !copySourceId || copySelected.size === 0}>
                {copyBusy ? 'Copying…' : `Copy ${copySelected.size} workflow${copySelected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogs && (
        <div className="modal-overlay" onClick={() => setShowLogs(null)}>
          <div className="modal animate-in" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📋 Logs: {showLogs.name}</h2>
              <button className="btn-icon" onClick={() => setShowLogs(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="wf-logs">
              {logs.length === 0 ? <p className="td-empty-hint">No executions yet.</p> : logs.map((log, i) => (
                <div className={`wf-log-item ${log.status}`} key={i}>
                  <div className="wf-log-top">
                    <span className={`wf-log-status ${log.status}`}>{log.status === 'success' ? '✓' : '✗'}</span>
                    <span className="wf-log-task">{log.taskTitle}</span>
                    <span className="wf-log-time">{new Date(log.executedAt).toLocaleString()}</span>
                  </div>
                  {log.actionsExecuted?.length > 0 && <p className="wf-log-actions">Actions: {log.actionsExecuted.join(', ')}</p>}
                  {log.error && <p className="wf-log-error">{log.error}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
