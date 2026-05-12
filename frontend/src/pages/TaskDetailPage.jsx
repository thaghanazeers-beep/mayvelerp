import { useState, useEffect, useRef } from 'react';
import { updateTask, getTeam, createTask, deleteTask, getTasks, getProjects, getSprints, uploadFile, signedFileUrl } from '../api';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { init as initPptxPreview } from 'pptx-preview';
import { useAuth } from '../context/AuthContext';
import { useTeamspace } from '../context/TeamspaceContext';
import TaskComments from '../components/TaskComments';
import './TaskDetailPage.css';

// ─── Inline Office preview components ────────────────────────────────
function ExcelPreview({ url, name }) {
  const [state, setState] = useState({ loading: true });
  const [activeSheet, setActiveSheet] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheets = wb.SheetNames.map(n => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n], { editable: false }) }));
        if (!cancelled) setState({ sheets });
      } catch (e) {
        if (!cancelled) setState({ error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [url]);
  if (state.loading) return <div className="td-preview-fallback"><div className="spinner" style={{ width: 24, height: 24, borderColor: 'var(--text-muted)', borderTopColor: 'var(--text)' }} /><p style={{ marginTop: 16 }}>Parsing {name}…</p></div>;
  if (state.error)   return <div className="td-preview-fallback"><div style={{ fontSize: 32 }}>📊</div><p>Couldn't parse this spreadsheet.</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{state.error}</p></div>;
  return (
    <div className="td-office-preview">
      {state.sheets.length > 1 && (
        <div className="td-sheet-tabs">
          {state.sheets.map((s, i) => (
            <button key={s.name} className={`td-sheet-tab ${activeSheet === i ? 'active' : ''}`} onClick={() => setActiveSheet(i)}>{s.name}</button>
          ))}
        </div>
      )}
      <div className="td-office-content td-excel-content" dangerouslySetInnerHTML={{ __html: state.sheets[activeSheet].html }} />
    </div>
  );
}

function PptxPreview({ url, name }) {
  const containerRef = useRef(null);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        // Defer one frame so the container has its final layout width
        await new Promise(r => requestAnimationFrame(r));
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        const w = containerRef.current.clientWidth || 900;
        const previewer = initPptxPreview(containerRef.current, { width: w, height: Math.round(w * 0.5625) });
        try {
          const out = previewer.preview(buf);
          if (out && typeof out.then === 'function') await out;
        } catch (renderErr) {
          throw renderErr;
        }
        if (!cancelled) setState({ ready: true });
      } catch (e) {
        console.error('[PptxPreview]', e);
        if (!cancelled) setState({ error: e?.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [url]);
  return (
    <div className="td-pptx-wrap">
      <div ref={containerRef} className="td-pptx-container" />
      {state.loading && (
        <div className="td-pptx-overlay">
          <div className="spinner" style={{ width: 28, height: 28, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
          <p style={{ marginTop: 16 }}>Rendering {name}…</p>
        </div>
      )}
      {state.error && (
        <div className="td-pptx-overlay">
          <div style={{ fontSize: 36 }}>📊</div>
          <p style={{ marginTop: 8 }}>Couldn't render this presentation in the browser.</p>
          <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 4 }}>{state.error}</p>
          <p style={{ fontSize: '0.78rem', marginTop: 12 }}>Use <strong>Download</strong> above to open it in PowerPoint or Keynote.</p>
        </div>
      )}
    </div>
  );
}

function WordPreview({ url, name }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setState({ html: out.value });
      } catch (e) {
        if (!cancelled) setState({ error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [url]);
  if (state.loading) return <div className="td-preview-fallback"><div className="spinner" style={{ width: 24, height: 24, borderColor: 'var(--text-muted)', borderTopColor: 'var(--text)' }} /><p style={{ marginTop: 16 }}>Parsing {name}…</p></div>;
  if (state.error)   return <div className="td-preview-fallback"><div style={{ fontSize: 32 }}>📝</div><p>Couldn't parse this document.</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{state.error}</p></div>;
  return <div className="td-office-content td-word-content" dangerouslySetInnerHTML={{ __html: state.html }} />;
}

const STATUSES = ['Not Yet Started', 'In Progress', 'In Review', 'Completed', 'Rejected'];
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
const PRIORITY_COLOR = { Urgent: '#f85149', High: '#d29922', Medium: '#6e56cf', Low: '#3fb950' };
const STATUS_DOT_CLS = {
  'Not Yet Started': 'dot-notstarted',
  'In Progress':     'dot-progress',
  'In Review':       'dot-review',
  'Completed':       'dot-done',
  'Rejected':        'dot-rejected',
};
const STATUS_BADGE_CLS = {
  'Not Yet Started': 'badge-notstarted',
  'In Progress':     'badge-progress',
  'In Review':       'badge-review',
  'Completed':       'badge-done',
  'Rejected':        'badge-rejected',
};

export default function TaskDetailPage({ task, onBack, onUpdated }) {
  const auth = useAuth();
  const currentUser = auth?.user;
  const { activeTeamspaceId, teamspaces } = useTeamspace();
  // The teamspace's owner — only they (or Super Admin in elevated mode) can
  // approve/reject a task that's In Review.
  const activeTeamspace = teamspaces?.find(t => String(t._id) === String(activeTeamspaceId));
  const isTeamspaceOwner = activeTeamspace && String(activeTeamspace.ownerId) === String(currentUser?._id);
  const isSuperAdminFlag = currentUser?.isSuperAdmin === true;
  const canApproveReject = isTeamspaceOwner || isSuperAdminFlag;
  const [title, setTitle] = useState(task?.title || '');
  const [blocks, setBlocks] = useState(() => {
    if (task?.description) {
      try { const p = JSON.parse(task.description); if (Array.isArray(p)) return p; } catch {}
      return [{ id: Date.now().toString(), type: 'text', content: task.description }];
    }
    return [{ id: Date.now().toString(), type: 'text', content: '' }];
  });
  const [status, setStatus] = useState(task?.status || 'Not Yet Started');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [dueDate, setDueDate] = useState(task?.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
  const [attachments, setAttachments] = useState(task?.attachments || []);
  const [projectId, setProjectId] = useState(task?.projectId || '');
  const [estimatedHours, setEstimatedHours] = useState(task?.estimatedHours || 0);
  const [actualHours, setActualHours] = useState(task?.actualHours || 0);
  const [sprintId, setSprintId] = useState(task?.sprintId || '');
  const [priority, setPriority] = useState(task?.priority || '');
  const [isDragOver, setIsDragOver] = useState(false);
  const [childTasks, setChildTasks] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [showBlockMenu, setShowBlockMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [previewAtt, setPreviewAtt] = useState(null);

  // Close preview on Escape
  useEffect(() => {
    if (!previewAtt) return;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewAtt(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewAtt]);
  const titleRef = useRef(null);
  const saveTimer = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadTeam(); loadProjects(); loadSprints(); loadChildTasks(); }, []);
  useEffect(() => { if (titleRef.current && !task) titleRef.current.focus(); }, []);

  const loadTeam = async () => { try { const r = await getTeam(activeTeamspaceId); setTeamMembers(r.data); } catch {} };
  const loadProjects = async () => { try { const r = await getProjects(activeTeamspaceId); setProjects(r.data); } catch {} };
  const loadSprints = async () => { try { const r = await getSprints(activeTeamspaceId); setSprints(r.data); } catch {} };
  const loadChildTasks = async () => {
    if (!task?.id) return;
    try { const r = await getTasks(activeTeamspaceId); setChildTasks(r.data.filter(t => t.parentId === task.id)); } catch {}
  };

  const autoSave = (updates = {}) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!task?.id) return;
      setSaving(true);
      try {
        await updateTask(task.id, {
          title: updates.title ?? title,
          description: JSON.stringify(updates.blocks ?? blocks),
          status: updates.status ?? status,
          assignee: updates.assignee ?? assignee,
          dueDate: (updates.dueDate ?? dueDate) || null,
          attachments: updates.attachments ?? attachments,
          projectId: (updates.projectId ?? projectId) || null,
          sprintId: (updates.sprintId ?? sprintId) || null,
          priority: updates.priority ?? priority,
          estimatedHours: updates.estimatedHours ?? estimatedHours,
          actualHours: updates.actualHours ?? actualHours,
          updatedBy: currentUser?.name || 'Someone',
        });
        setLastSaved(new Date());
        onUpdated?.();
      } catch (err) { console.error(err); }
      finally { setSaving(false); }
    }, 800);
  };

  const isAdminOrOwner = currentUser?.role === 'Admin' || currentUser?.role === 'Team Owner' || currentUser?.isSuperAdmin;
  const isCreator = currentUser?.name && task?.createdBy && currentUser.name === task.createdBy;
  // Only the assignee, the task creator, or an admin can edit. An empty assignee
  // used to make the task open to anyone — too permissive — so we no longer treat
  // unassigned as "anyone can edit".
  const isAssignee = !!assignee && currentUser?.name === assignee;
  const canEdit = isAdminOrOwner || isAssignee || isCreator;

  const canChangeStatusTo = (newStatus) => {
    if (!canEdit) return false;
    // Approve / reject transitions are owner-only: only the teamspace owner
    // (or Super Admin in elevated mode) can flip a task to Completed/Rejected.
    if (newStatus === 'Completed' || newStatus === 'Rejected') return canApproveReject;
    if (isAdminOrOwner) return true;
    return true;
  };

  const handleTitleChange = (v) => { if (!canEdit) return; setTitle(v); autoSave({ title: v }); };
  const handleStatusChange = (v) => { if (!canChangeStatusTo(v)) return; setStatus(v); autoSave({ status: v }); };
  const handleAssigneeChange = (m) => { if (!canEdit) return; setAssignee(m.name); setShowAssigneeDropdown(false); autoSave({ assignee: m.name }); };
  const handleDueDateChange = (v) => { if (!canEdit) return; setDueDate(v); autoSave({ dueDate: v }); };
  const handleEstHoursChange = (v) => { if (!canEdit) return; const n = parseFloat(v) || 0; setEstimatedHours(n); autoSave({ estimatedHours: n }); };
  const handleActHoursChange = (v) => { if (!canEdit) return; const n = parseFloat(v) || 0; setActualHours(n); autoSave({ actualHours: n }); };
  const handlePriorityChange = (v) => { if (!canEdit) return; setPriority(v); autoSave({ priority: v }); };

  // Drag-and-drop file handler — wraps handleFileAdd
  const onDropFiles = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!canEdit) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    await handleFileAdd({ target: { files, value: '' } });
  };

  // Review/Approval actions
  const handleSubmitForReview = () => { setStatus('In Review'); autoSave({ status: 'In Review' }); };
  const handleApprove = () => { setStatus('Completed'); autoSave({ status: 'Completed' }); };
  const handleReject = () => { setStatus('Rejected'); autoSave({ status: 'Rejected' }); };
  const handleRework = () => { setStatus('In Progress'); autoSave({ status: 'In Progress' }); };

  const updateBlock = (id, content) => { if (!canEdit) return; const u = blocks.map(b => b.id === id ? { ...b, content } : b); setBlocks(u); autoSave({ blocks: u }); };
  const addBlock = (afterId, type = 'text') => {
    if (!canEdit) return;
    const nb = { id: Date.now().toString(), type, content: '' };
    const idx = blocks.findIndex(b => b.id === afterId);
    const u = [...blocks]; u.splice(idx + 1, 0, nb); setBlocks(u); setShowBlockMenu(null);
    setTimeout(() => { document.querySelector(`[data-block-id="${nb.id}"]`)?.focus(); }, 50);
  };
  const removeBlock = (id) => {
    if (!canEdit || blocks.length <= 1) return;
    const u = blocks.filter(b => b.id !== id); setBlocks(u); autoSave({ blocks: u });
    const idx = blocks.findIndex(b => b.id === id);
    if (idx > 0) setTimeout(() => { document.querySelector(`[data-block-id="${blocks[idx-1].id}"]`)?.focus(); }, 50);
  };
  const handleBlockKeyDown = (e, block) => {
    if (!canEdit) return;
    if (e.key === 'Enter' && !e.shiftKey && block.type === 'text') { e.preventDefault(); addBlock(block.id, 'text'); }
    if (e.key === 'Backspace' && block.content === '' && blocks.length > 1) { e.preventDefault(); removeBlock(block.id); }
    if (e.key === '/' && block.content === '') { e.preventDefault(); setShowBlockMenu(block.id); }
  };

  const handleFileAdd = async (e) => {
    if (!canEdit) return;
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = ''; // allow re-uploading the same file later
    try {
      const uploaded = await Promise.all(files.map(async (f) => {
        const res = await uploadFile(f);
        return {
          id: Date.now().toString() + Math.random(),
          name: res.data.name,
          sizeBytes: res.data.sizeBytes,
          path: res.data.url,
          mimeType: res.data.mimeType,
          addedAt: new Date().toISOString(),
        };
      }));
      const u = [...attachments, ...uploaded];
      setAttachments(u);
      autoSave({ attachments: u });
    } catch (err) {
      console.error('Upload failed', err);
      alert('File upload failed: ' + (err.response?.data?.message || err.message));
    }
  };
  const removeAttachment = (id) => { if (!canEdit) return; const u = attachments.filter(a => a.id !== id); setAttachments(u); autoSave({ attachments: u }); };

  const addChildTask = async () => {
    if (!canEdit) return;
    try {
      const child = { id: `task_${Date.now()}`, title: 'Untitled subtask', description: '', status: 'Not Yet Started', assignee: '', dueDate: null, createdDate: new Date().toISOString(), customProperties: [], attachments: [], parentId: task.id, estimatedHours: 0, actualHours: 0, teamspaceId: task.teamspaceId };
      await createTask(child); loadChildTasks(); onUpdated?.();
    } catch {}
  };

  const formatSize = (b) => { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; };

  const blockTypes = [
    { type: 'text', label: 'Text', icon: 'T', desc: 'Plain text block' },
    { type: 'heading', label: 'Heading', icon: 'H', desc: 'Large heading' },
    { type: 'bullet', label: 'Bullet List', icon: '•', desc: 'Bulleted list item' },
    { type: 'checkbox', label: 'To-do', icon: '☐', desc: 'Checkbox item' },
    { type: 'quote', label: 'Quote', icon: '"', desc: 'Quote block' },
    { type: 'divider', label: 'Divider', icon: '—', desc: 'Horizontal line' },
    { type: 'code', label: 'Code', icon: '</>', desc: 'Code snippet' },
    { type: 'callout', label: 'Callout', icon: '💡', desc: 'Highlighted callout' },
  ];

  const isAdmin = currentUser?.role === 'Admin' || currentUser?.role === 'Team Owner';

  return (
    <div className="task-detail-page">
      <div className="td-topbar">
        <div className="td-topbar-left">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
            Back
          </button>
          <div className="td-breadcrumb">
            {projects.find(p => p._id === projectId) && (
              <>
                <span className="td-crumb">{projects.find(p => p._id === projectId).icon} {projects.find(p => p._id === projectId).name}</span>
                <span className="td-crumb-sep">/</span>
              </>
            )}
            {sprints.find(s => s._id === sprintId) && (
              <>
                <span className="td-crumb">🏃 {sprints.find(s => s._id === sprintId).name}</span>
                <span className="td-crumb-sep">/</span>
              </>
            )}
            <span className="td-crumb td-crumb-current">{title || 'Untitled'}</span>
          </div>
        </div>
        <div className="td-topbar-right">
          {saving && <span className="td-saving">Saving…</span>}
          {!saving && lastSaved && <span className="td-saved">✓ Saved</span>}
        </div>
      </div>

      {/* Review/Approval Banner — Approve / Reject buttons render only for
          the teamspace OWNER (or Super Admin in elevated mode). Regular
          global Admins who happen to be members of this workspace don't see
          these actions. */}
      {status === 'In Review' && canApproveReject && (
        <div className="td-banner td-banner-review">
          <div className="td-banner-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
          </div>
          <div className="td-banner-text">
            <div className="td-banner-title">Awaiting your review</div>
            <div className="td-banner-sub">{assignee || 'A teammate'} submitted this task. Approve to mark it complete, or reject to send it back.</div>
          </div>
          <div className="td-banner-actions">
            <button className="btn btn-sm td-action-reject" onClick={handleReject}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Reject
            </button>
            <button className="btn btn-sm td-action-approve" onClick={handleApprove}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Approve
            </button>
          </div>
        </div>
      )}
      {status === 'Rejected' && isAssignee && (
        <div className="td-banner td-banner-rejected">
          <div className="td-banner-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <div className="td-banner-text">
            <div className="td-banner-title">Rejected — needs rework</div>
            <div className="td-banner-sub">This task was sent back for changes. Make the updates, then resubmit for review.</div>
          </div>
          <div className="td-banner-actions">
            <button className="btn btn-sm btn-primary td-action-rework" onClick={handleRework}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
              Start Rework
            </button>
          </div>
        </div>
      )}

      <div className="td-layout">
        <div className="td-main" style={{ opacity: canEdit ? 1 : 0.8, pointerEvents: canEdit ? 'auto' : 'none' }}>
          <input ref={titleRef} className="td-title" value={title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Untitled" readOnly={!canEdit} />

          {/* Hero meta strip — quick-glance task metadata */}
          <div className="td-meta-strip">
            <span className={`td-meta-chip td-meta-status ${STATUS_BADGE_CLS[status] || ''}`}>
              <span className={`td-meta-dot ${STATUS_DOT_CLS[status] || 'dot-notstarted'}`} />
              {status}
            </span>
            {priority && (
              <span className="td-meta-chip td-meta-priority" style={{ borderColor: PRIORITY_COLOR[priority] + '55', color: PRIORITY_COLOR[priority] }}>
                <span className="td-meta-prio-dot" style={{ background: PRIORITY_COLOR[priority] }} />
                {priority}
              </span>
            )}
            <span className="td-meta-chip td-meta-assignee">
              {assignee ? (
                <>
                  <span className="td-meta-avatar">
                    {(() => { const m = teamMembers.find(tm => tm.name === assignee); return m?.profilePictureUrl ? <img src={signedFileUrl(m.profilePictureUrl)} alt="" /> : assignee.charAt(0).toUpperCase(); })()}
                  </span>
                  {assignee}
                </>
              ) : (
                <>👤 Unassigned</>
              )}
            </span>
            {dueDate && (
              <span className={`td-meta-chip td-meta-date ${new Date(dueDate) < new Date() && status !== 'Completed' ? 'td-meta-overdue' : ''}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                {new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            {(estimatedHours > 0 || actualHours > 0) && (
              <span className="td-meta-chip td-meta-hours">
                ⏱ {actualHours || 0}/{estimatedHours || 0}h
              </span>
            )}
          </div>

          <div className="td-blocks">
            {blocks.map((block) => (
              <div className="td-block-wrapper" key={block.id}>
                <div className="td-block-handle" onClick={() => setShowBlockMenu(showBlockMenu === block.id ? null : block.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
                <div className="td-block-drag">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/></svg>
                </div>
                {block.type === 'divider' ? <hr className="td-divider" />
                : block.type === 'heading' ? <input data-block-id={block.id} className="td-block-input td-block-heading" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="Heading..." />
                : block.type === 'bullet' ? (
                  <div className="td-block-bullet-row"><span className="td-bullet-dot">•</span><input data-block-id={block.id} className="td-block-input" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="List item..." /></div>
                ) : block.type === 'checkbox' ? (
                  <div className="td-block-checkbox-row">
                    <input type="checkbox" className="td-checkbox" checked={block.content.startsWith('[x]')} onChange={(e) => { const t = block.content.replace(/^\[[ x]\]\s*/, ''); updateBlock(block.id, e.target.checked ? `[x] ${t}` : t); }} />
                    <input data-block-id={block.id} className={`td-block-input ${block.content.startsWith('[x]') ? 'td-checked' : ''}`} value={block.content.replace(/^\[[ x]\]\s*/, '')} onChange={(e) => { const p = block.content.startsWith('[x]') ? '[x] ' : ''; updateBlock(block.id, p + e.target.value); }} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="To-do..." />
                  </div>
                ) : block.type === 'quote' ? (
                  <div className="td-block-quote"><textarea data-block-id={block.id} className="td-block-textarea" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addBlock(block.id); }}} placeholder="Quote..." rows={2} /></div>
                ) : block.type === 'code' ? (
                  <textarea data-block-id={block.id} className="td-block-textarea td-block-code" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} placeholder="// Code..." rows={3} />
                ) : block.type === 'callout' ? (
                  <div className="td-block-callout"><span className="td-callout-icon">💡</span><input data-block-id={block.id} className="td-block-input" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="Callout text..." /></div>
                ) : (
                  <textarea data-block-id={block.id} className="td-block-textarea td-block-text" value={block.content} onChange={(e) => updateBlock(block.id, e.target.value)} onKeyDown={(e) => handleBlockKeyDown(e, block)} placeholder="Type '/' for commands, or start writing..." rows={1} onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} />
                )}
                {showBlockMenu === block.id && (
                  <div className="td-block-menu animate-in">
                    <div className="td-block-menu-title">Block Type</div>
                    {blockTypes.map(bt => (
                      <button key={bt.type} className="td-block-menu-item" onClick={() => {
                        if (bt.type === 'divider') { addBlock(block.id, 'divider'); } else { const u = blocks.map(b => b.id === block.id ? { ...b, type: bt.type } : b); setBlocks(u); setShowBlockMenu(null); autoSave({ blocks: u }); }
                      }}><span className="td-block-menu-icon">{bt.icon}</span><div><div className="td-block-menu-label">{bt.label}</div><div className="td-block-menu-desc">{bt.desc}</div></div></button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Attachments */}
          <div
            className={`td-section td-attachments-section ${isDragOver ? 'td-dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (canEdit) setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={onDropFiles}
          >
            <div className="td-section-header">
              <h3>Attachments {attachments.length > 0 && <span className="td-section-count">{attachments.length}</span>}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={!canEdit}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Upload
              </button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileAdd} />
            </div>
            {attachments.length > 0 ? (
              <div className="td-attach-grid">
                {attachments.map(att => {
                  const isImage = (att.mimeType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name || '');
                  const isPdf   = (att.mimeType === 'application/pdf') || /\.pdf$/i.test(att.name || '');
                  const isVideo = (att.mimeType || '').startsWith('video/') || /\.(mp4|webm|mov)$/i.test(att.name || '');
                  const canPreview = !!att.path && !att.path.startsWith('blob:');
                  const open = (e) => { e.stopPropagation(); if (canPreview) setPreviewAtt(att); };
                  const fileIcon = isPdf ? '📄' : isVideo ? '🎬' : (att.mimeType || '').startsWith('audio/') ? '🎵' : '📎';
                  return (
                    <div className={`td-attach-card ${isImage && canPreview ? 'td-attach-card-image' : ''}`} key={att.id} onClick={open} style={{ cursor: canPreview ? 'pointer' : 'default' }} title={canPreview ? 'Click to preview' : 'Stale link — re-upload to enable preview'}>
                      <button className="td-attach-remove" onClick={(e) => { e.stopPropagation(); if (canEdit) removeAttachment(att.id); }} title="Remove">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                      <div className="td-attach-thumb-area">
                        {isImage && canPreview ? (
                          <img src={signedFileUrl(att.path)} alt={att.name} className="td-attach-image" loading="lazy" />
                        ) : (
                          <div className="td-attach-icon">{fileIcon}</div>
                        )}
                      </div>
                      <div className="td-attach-meta">
                        <div className="td-attach-name" title={att.name}>{att.name}</div>
                        <div className="td-attach-sub">{formatSize(att.sizeBytes)}{!canPreview && ' · stale'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <button type="button" className="td-dropzone" onClick={() => canEdit && fileInputRef.current?.click()} disabled={!canEdit}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div className="td-dropzone-text">{canEdit ? 'Drop files here, or click to upload' : 'No attachments'}</div>
              </button>
            )}
          </div>

          {/* Subtasks */}
          {task?.id && (
            <div className="td-section">
              <div className="td-section-header"><h3>Subtasks</h3>
                <span className="muted" style={{ fontSize: '0.7rem' }}>🔒 add via Project Plan</span>
              </div>
              {childTasks.length > 0 ? (
                <div className="td-subtasks">{childTasks.map(c => (
                  <div className="td-subtask" key={c.id}>
                    <div className={`list-dot ${c.status === 'Completed' ? 'dot-done' : c.status === 'In Progress' ? 'dot-progress' : c.status === 'In Review' ? 'dot-review' : c.status === 'Rejected' ? 'dot-rejected' : 'dot-notstarted'}`} />
                    <span className="td-subtask-title">{c.title}</span>
                    <span className={`badge badge-sm ${c.status === 'Completed' ? 'badge-done' : c.status === 'In Progress' ? 'badge-progress' : c.status === 'In Review' ? 'badge-review' : c.status === 'Rejected' ? 'badge-rejected' : 'badge-notstarted'}`}>{c.status}</span>
                  </div>
                ))}</div>
              ) : <p className="td-empty-hint">No subtasks yet.</p>}
            </div>
          )}

          {/* Comments thread */}
          <TaskComments taskId={task?.id || task?._id} teamMembers={teamMembers} />
        </div>

        {/* Sidebar */}
        <div className="td-sidebar">

          <div className="td-sidebar-group">
            <h4 className="td-sidebar-group-title">Status</h4>
            <div className="td-prop"><label className="td-prop-label">Status</label>
              <select className="td-prop-select" value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={!canEdit}>
                {STATUSES.map(s => <option key={s} value={s} disabled={!canChangeStatusTo(s)}>{s}</option>)}
              </select>
            </div>
            <div className="td-prop"><label className="td-prop-label">Priority</label>
              <select className="td-prop-select" value={priority} onChange={(e) => handlePriorityChange(e.target.value)} disabled={!canEdit}>
                <option value="">No priority</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {status === 'In Progress' && isAssignee && (
              <button className="btn btn-sm btn-review-submit" onClick={handleSubmitForReview} style={{ width: '100%', marginTop: 8 }}>📝 Submit for Review</button>
            )}
          </div>

          <div className="td-sidebar-group">
            <h4 className="td-sidebar-group-title">People</h4>
            <div className="td-prop"><label className="td-prop-label">Assignee</label>
            <div className="td-assignee-wrapper">
              <button className="td-assignee-btn" onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}>
                {assignee ? (<div className="td-assignee-selected"><div className="td-assignee-avatar-sm">{assignee.charAt(0).toUpperCase()}</div><span>{assignee}</span></div>) : (<span className="td-assignee-placeholder">Select assignee...</span>)}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6,9 12,15 18,9"/></svg>
              </button>
              {showAssigneeDropdown && (
                <div className="td-assignee-dropdown animate-in">
                  {assignee && <button className="td-assignee-option" onClick={() => { setAssignee(''); setShowAssigneeDropdown(false); autoSave({ assignee: '' }); }}><span className="td-assignee-none">✕</span><span>Unassigned</span></button>}
                  {teamMembers.map(m => (
                    <button className="td-assignee-option" key={m._id} onClick={() => handleAssigneeChange(m)}>
                      <div className="td-assignee-avatar-sm">{m.profilePictureUrl ? <img src={signedFileUrl(m.profilePictureUrl)} alt="" /> : m.name?.charAt(0)?.toUpperCase()}</div>
                      <div className="td-assignee-option-info"><span className="td-assignee-option-name">{m.name}</span><span className="td-assignee-option-email">{m.email}</span></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            </div>
          </div>

          <div className="td-sidebar-group">
            <h4 className="td-sidebar-group-title">Timeline</h4>
            <div className="td-prop"><label className="td-prop-label">Due Date</label>
              <input className="td-prop-input" type="date" value={dueDate} onChange={(e) => handleDueDateChange(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="td-prop-row">
              <div className="td-prop" style={{ flex: 1 }}>
                <label className="td-prop-label">Est. Hours</label>
                <input className="td-prop-input" type="number" min="0" step="0.5" value={estimatedHours} onChange={(e) => handleEstHoursChange(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="td-prop" style={{ flex: 1 }}>
                <label className="td-prop-label">Actual</label>
                <input className="td-prop-input" type="number" min="0" step="0.5" value={actualHours} onChange={(e) => handleActHoursChange(e.target.value)} disabled={!canEdit} />
              </div>
            </div>
            {estimatedHours > 0 && (
              <div className="td-hours-bar">
                <div className="td-hours-progress" style={{ width: `${Math.min(100, (actualHours / estimatedHours) * 100)}%`, background: actualHours > estimatedHours ? 'var(--accent-red)' : 'var(--primary)' }} />
                <span className="td-hours-label">{actualHours}/{estimatedHours}h ({Math.round((actualHours / estimatedHours) * 100)}%)</span>
              </div>
            )}
          </div>

          <div className="td-sidebar-group">
            <h4 className="td-sidebar-group-title">Context</h4>
            <div className="td-prop"><label className="td-prop-label">Project</label>
              <select className="td-prop-select" value={projectId} onChange={(e) => { setProjectId(e.target.value); autoSave({ projectId: e.target.value }); }} disabled={!canEdit}>
                <option value="">No project</option>{projects.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
              </select>
            </div>
            <div className="td-prop"><label className="td-prop-label">Sprint</label>
              <select className="td-prop-select" value={sprintId} onChange={(e) => { setSprintId(e.target.value); autoSave({ sprintId: e.target.value }); }} disabled={!canEdit}>
                <option value="">No sprint</option>{sprints.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div className="td-prop"><label className="td-prop-label">Created</label>
              <span className="td-prop-value">{task?.createdDate ? new Date(task.createdDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Now'}</span>
            </div>
          </div>

          {task?.id && (
            <div className="td-sidebar-group td-sidebar-danger">
              <button className="btn btn-danger btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={async () => { if (!confirm('Delete this task?')) return; await deleteTask(task.id); onUpdated?.(); onBack(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                Delete Task
              </button>
            </div>
          )}
        </div>
      </div>

      {previewAtt && (() => {
        const name = previewAtt.name || '';
        const mt   = previewAtt.mimeType || '';
        const isImage = mt.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
        const isPdf   = mt === 'application/pdf' || /\.pdf$/i.test(name);
        const isVideo = mt.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name);
        const isAudio = mt.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(name);
        const isText  = mt.startsWith('text/')  || /\.(txt|md|log|json)$/i.test(name);
        const isExcel = /\.(xlsx|xls|csv|ods)$/i.test(name) || /sheet|excel|spreadsheet|csv/i.test(mt);
        const isWord  = /\.(docx|doc|odt)$/i.test(name) || /wordprocessing|msword/i.test(mt);
        const isPpt   = /\.(pptx|ppt|odp)$/i.test(name) || /presentation/i.test(mt);
        return (
          <div className="td-preview-overlay" onClick={() => setPreviewAtt(null)}>
            <div className="td-preview-frame" onClick={(e) => e.stopPropagation()}>
              <div className="td-preview-header">
                <div className="td-preview-title">
                  <span className="td-preview-name">{previewAtt.name}</span>
                  <span className="td-preview-meta">{formatSize(previewAtt.sizeBytes)}{previewAtt.mimeType ? ' · ' + previewAtt.mimeType : ''}</span>
                </div>
                <div className="td-preview-actions">
                  <a className="btn btn-ghost btn-sm" href={signedFileUrl(previewAtt.path)} download={previewAtt.name}>Download</a>
                  <a className="btn btn-ghost btn-sm" href={signedFileUrl(previewAtt.path)} target="_blank" rel="noopener noreferrer">Open in new tab</a>
                  <button className="btn-icon" onClick={() => setPreviewAtt(null)} title="Close (Esc)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
              <div className="td-preview-body">
                {isImage ? (
                  <img src={signedFileUrl(previewAtt.path)} alt={previewAtt.name} className="td-preview-image" />
                ) : isPdf ? (
                  <iframe src={signedFileUrl(previewAtt.path)} className="td-preview-iframe" title={previewAtt.name} />
                ) : isVideo ? (
                  <video src={signedFileUrl(previewAtt.path)} controls className="td-preview-video" />
                ) : isAudio ? (
                  <audio src={signedFileUrl(previewAtt.path)} controls className="td-preview-audio" />
                ) : isExcel ? (
                  <ExcelPreview url={signedFileUrl(previewAtt.path)} name={previewAtt.name} />
                ) : isWord ? (
                  <WordPreview url={signedFileUrl(previewAtt.path)} name={previewAtt.name} />
                ) : isPpt ? (
                  <PptxPreview url={signedFileUrl(previewAtt.path)} name={previewAtt.name} />
                ) : isText ? (
                  <iframe src={signedFileUrl(previewAtt.path)} className="td-preview-iframe" title={previewAtt.name} />
                ) : (
                  <div className="td-preview-fallback">
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📎</div>
                    <p>This file type can't be previewed inline.</p>
                    <p style={{ marginTop: 4, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Use Download or Open in new tab.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
