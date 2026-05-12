import axios from 'axios';

const API_ROOT = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
const API = axios.create({ baseURL: `${API_ROOT}/api` });

API.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Auto-inject the active teamspace so backend `requireTeamspaceMembership`
  // middleware works even when call sites don't include teamspaceId in the body.
  const activeTs = localStorage.getItem('mayvel_activeTeamspace');
  if (activeTs && activeTs !== 'undefined' && activeTs !== 'null') {
    config.headers['x-teamspace-id'] = activeTs;
  }
  return config;
});

API.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const hadSession = !!localStorage.getItem('mayvel_user') || !!localStorage.getItem('token');
      localStorage.removeItem('mayvel_user');
      localStorage.removeItem('token');
      if (hadSession) window.location.reload();
    }
    return Promise.reject(err);
  }
);
// Stamp /uploads/* URLs with the current JWT so the auth-protected static
// handler will serve them. Pass-through for external URLs (e.g. pravatar.cc).
export const signedFileUrl = (url) => {
  if (!url) return url;
  if (!url.includes('/uploads/')) return url;
  const token = localStorage.getItem('token');
  if (!token) return url;
  return url + (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(token);
};

// Auth
export const login = (email, password) => API.post('/auth/login', { email, password });
export const signup = (name, email, password, role) => API.post('/auth/signup', { name, email, password, role });
export const forgotPassword = (email) => API.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) => API.post('/auth/reset-password', { token, password });

// Tasks
export const getTasks = (tsId) => API.get('/tasks' + (tsId !== undefined ? `?teamspaceId=${tsId}` : ''));
export const createTask = (task) => API.post('/tasks', task);
export const updateTask = (id, task) => API.put(`/tasks/${id}`, task);
export const deleteTask = (id) => API.delete(`/tasks/${id}`);

// Team
export const getTeam = (tsId) => API.get('/team' + (tsId !== undefined ? `?teamspaceId=${tsId}` : ''));
export const removeUser = (id) => API.delete(`/team/${id}`);
export const inviteUser = (teamspaceId, email, role, inviterName) => API.post('/team/invite', { teamspaceId, email, role, inviterName });

// Projects
export const getProjects = (tsId) => API.get('/projects' + (tsId !== undefined ? `?teamspaceId=${tsId}` : ''));
export const createProject = (data) => API.post('/projects', data);
export const updateProject = (id, data) => API.put(`/projects/${id}`, data);
export const deleteProject = (id) => API.delete(`/projects/${id}`);

// Notion
export const syncNotionSprints = (data) => API.post('/sprints/notion/sync', data);

// Sprints
export const getSprints = (params) => {
  // If a string is passed, assume it's teamspaceId for backward compatibility
  const query = typeof params === 'string' ? { teamspaceId: params } : params;
  return API.get('/sprints', { params: query || {} });
};
export const getSprint   = (id) => API.get(`/sprints/${id}`);
export const createSprint = (sprint) => API.post('/sprints', sprint);
export const updateSprint = (id, data) => API.put(`/sprints/${id}`, data);
export const deleteSprint = (id) => API.delete(`/sprints/${id}`);
export const startSprint  = (id) => API.post(`/sprints/${id}/start`);
export const completeSprint = (id, rolloverSprintId) => API.post(`/sprints/${id}/complete`, { rolloverSprintId });
export const addTaskToSprint    = (sprintId, taskId) => API.post(`/sprints/${sprintId}/tasks`, { taskId });
export const removeTaskFromSprint = (sprintId, taskId) => API.delete(`/sprints/${sprintId}/tasks/${taskId}`);

// Pages
export const getPages    = (tsId) => API.get('/pages' + (tsId !== undefined ? `?teamspaceId=${tsId}` : ''));
export const getPage     = (id) => API.get(`/pages/${id}`);
export const createPage  = (page) => API.post('/pages', page);
export const updatePage  = (id, page) => API.put(`/pages/${id}`, page);
export const deletePage  = (id) => API.delete(`/pages/${id}`);

// Generic file upload (returns { url, name, sizeBytes, mimeType })
export const uploadFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return API.post('/uploads', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// Profile
export const updateUser = (id, data) => API.put(`/users/${id}`, data);

// Super Admin — user management
export const listAllUsers   = ()           => API.get('/users');
export const createUser     = (data)       => API.post('/users', data);
export const deleteUserAccount = (id)      => API.delete(`/users/${id}`);
export const uploadAvatar = (id, file) => {
  const formData = new FormData();
  formData.append('avatar', file);
  return API.post(`/users/${id}/avatar`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// Notifications (filtered by user name)
export const getNotifications = (userName) => API.get('/notifications', { params: { user: userName } });
export const getUnreadCount = (userName) => API.get('/notifications/unread-count', { params: { user: userName } });
export const markNotificationRead = (id) => API.put(`/notifications/${id}/read`);
export const markAllNotificationsRead = (userName) => API.post('/notifications/mark-all-read', { user: userName });
export const deleteNotification = (id) => API.delete(`/notifications/${id}`);

// Workflows
export const getWorkflows = (tsId) => API.get('/workflows' + (tsId !== undefined ? `?teamspaceId=${tsId}` : ''));
export const createWorkflow = (wf) => API.post('/workflows', wf);
export const updateWorkflow = (id, wf) => API.put(`/workflows/${id}`, wf);
export const deleteWorkflow = (id) => API.delete(`/workflows/${id}`);
export const toggleWorkflow = (id) => API.post(`/workflows/${id}/toggle`);
export const getWorkflowLogs = (id) => API.get(`/workflows/${id}/logs`);
export const getAllWorkflowLogs = () => API.get('/workflow-logs');
export const runWorkflow = (id, taskId) => API.post(`/workflows/${id}/run`, { taskId });

export default API;

export const getTeamspaces = () => API.get('/teamspaces');
export const createTeamspace = (data) => API.post('/teamspaces', data);
export const updateTeamspace = (id, data) => API.put(`/teamspaces/${id}`, data);
export const deleteTeamspace = (id) => API.delete(`/teamspaces/${id}`);

// ─── Timesheet (ERP v1) ──────────────────────────────────────────────
export const getRateBuckets    = ()        => API.get('/time/buckets');
export const createRateBucket  = (data)    => API.post('/time/buckets', data);
export const updateRateBucket  = (id, data)=> API.put(`/time/buckets/${id}`, data);
export const deleteRateBucket  = (id)      => API.delete(`/time/buckets/${id}`);

export const getTaskTypes      = ()        => API.get('/time/task-types');
export const createTaskType    = (data)    => API.post('/time/task-types', data);
export const updateTaskType    = (id, data)=> API.put(`/time/task-types/${id}`, data);
export const deleteTaskType    = (id)      => API.delete(`/time/task-types/${id}`);

export const getPlans          = (params)  => API.get('/time/plans', { params: params || {} });
export const getPlan           = (id)      => API.get(`/time/plans/${id}`);
export const createPlan        = (data)    => API.post('/time/plans', data);
export const updatePlan        = (id, data)=> API.put(`/time/plans/${id}`, data);
export const deletePlan        = (id)      => API.delete(`/time/plans/${id}`);
export const submitPlan        = (id)      => API.post(`/time/plans/${id}/submit`);
export const approvePlan       = (id)      => API.post(`/time/plans/${id}/approve`);
export const rejectPlan        = (id, reason) => API.post(`/time/plans/${id}/reject`, { reason });
export const reopenPlan        = (id)      => API.post(`/time/plans/${id}/reopen`);
export const getPlanAudit      = (id)      => API.get(`/time/plans/${id}/audit`);

export const createPlanLine    = (planId, data)        => API.post(`/time/plans/${planId}/lines`, data);
export const updatePlanLine    = (planId, lineId, data)=> API.put(`/time/plans/${planId}/lines/${lineId}`, data);
export const deletePlanLine    = (planId, lineId)      => API.delete(`/time/plans/${planId}/lines/${lineId}`);

export const getTimeEntries    = (params)  => API.get('/time/entries', { params: params || {} });
export const createTimeEntry   = (data)    => API.post('/time/entries', data);
export const updateTimeEntry   = (id, data)=> API.put(`/time/entries/${id}`, data);
export const deleteTimeEntry   = (id)      => API.delete(`/time/entries/${id}`);

export const allocatePlan      = (id)              => API.post(`/time/plans/${id}/allocate`);
export const getPlanAllocations= (planId)          => API.get(`/time/plans/${planId}/allocations`);
export const getAllocations    = (params)          => API.get('/time/allocations', { params: params || {} });
export const updateAllocation  = (id, data)        => API.put(`/time/allocations/${id}`, data);
export const deleteAllocation  = (id)              => API.delete(`/time/allocations/${id}`);

// Dashboard / reports (Phase 5). Each accepts an optional `params` object: { month, projectId, status, ... }
export const getTimeDashboardTotals     = (params)  => API.get('/time/dashboard/totals',   { params: params || {} });
export const getTimeDashboardPipeline   = ()        => API.get('/time/dashboard/pipeline');
export const getProjectsReport          = (params)  => API.get('/time/reports/projects',   { params: params || {} });
export const getCostByBucket            = (params)  => API.get('/time/reports/cost-by-bucket', { params: params || {} });
export const getMonthlyTrend            = (params)  => API.get('/time/reports/monthly-trend', { params: params || { months: 6 } });
export const getUtilizationReport       = (weekStart) => API.get('/time/reports/utilization', { params: weekStart ? { weekStart } : {} });
export const getProjectPnL              = (projectId, month) => API.get(`/time/reports/project/${projectId}/pnl`, { params: month ? { month } : {} });
export const exportPlanXlsxUrl          = (planId) => `${API.defaults.baseURL}/time/plans/${planId}/export`;

// Member time logging (Phase 4)
export const getMyWeek         = (params)          => API.get('/time/periods/me', { params: params || {} });
export const bulkSaveEntries   = (data)            => API.post('/time/entries/bulk', data);
export const submitPeriod      = (id)              => API.post(`/time/periods/${id}/submit`);
export const getWeekApprovalQueue = ()             => API.get('/time/queue/weeks');
export const approveSlice      = (id)              => API.post(`/time/slices/${id}/approve`);
export const rejectSlice       = (id, reason)      => API.post(`/time/slices/${id}/reject`, { reason });

// Format paise (cents) → "₹1,22,496" with Indian numbering
export const formatINR = (cents) =>
  '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');

// Project P&L PDF — returns a URL the FE can fetch with the JWT (or use signedFileUrl)
export const projectPnlPdfUrl = (projectId, month) =>
  `${API_ROOT}/api/time/reports/project/${projectId}/pnl/pdf?month=${encodeURIComponent(month)}`;

// Audit log
export const getAuditLog = (params = {}) => API.get('/time/audit', { params });

// Activity feed (merged timeline)
export const getActivity = (params = {}) => API.get('/activity', { params });

// Task comments
export const getTaskComments = (taskId) => API.get(`/tasks/${taskId}/comments`);
export const postTaskComment = (taskId, body) => API.post(`/tasks/${taskId}/comments`, { body });
export const deleteTaskComment = (taskId, commentId) => API.delete(`/tasks/${taskId}/comments/${commentId}`);

// Timezone-aware "today as YYYY-MM-DD" using a user's IANA timezone (or
// browser default). Avoids the "Tokyo user logging hours at 11 PM gets
// tomorrow's date" bug that plain Date.toISOString() causes.
export const todayInTz = (tz) => {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());           // "YYYY-MM-DD"
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};
// Monday of a given YYYY-MM-DD (treats the date as local-tz neutral)
export const mondayOfDate = (yyyymmdd) => {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
};

// CSV/JSON exports — return URL strings the FE can fetch with the JWT
export const exportEntriesUrl = (from, to, format = 'csv') =>
  `${API_ROOT}/api/time/export/entries?from=${from}&to=${to}&format=${format}`;
export const exportPlansUrl = (month, format = 'csv') =>
  `${API_ROOT}/api/time/export/plans?month=${month}&format=${format}`;

// Org Chart
export const getOrgChart = (teamspaceId) => API.get('/orgchart', { params: teamspaceId ? { teamspaceId } : {} });
export const saveOrgChart = (data) => API.put('/orgchart', data);
export const getOrgHierarchy = (memberId, teamspaceId) => API.get(`/orgchart/hierarchy/${memberId}`, { params: teamspaceId ? { teamspaceId } : {} });
export const getOrganizationMembers = (params = {}) => API.get('/organization/members', { params });

// AI chat (Gemini-backed)
export const sendChat = (messages, teamspaceId) => API.post('/chat', { messages, teamspaceId });

// Streaming chat: wraps EventSource. Returns a function to close the stream.
//   handlers = { onToken({text}), onTool({name,args,result}), onDone(), onError({message}) }
export const streamChat = (messages, teamspaceId, handlers = {}) => {
  const token = localStorage.getItem('token');
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ messages, teamspaceId }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');     // base64url
  const url = `${API_ROOT}/api/chat/stream?token=${encodeURIComponent(token)}&payload=${encodeURIComponent(payload)}`;
  const es = new EventSource(url);
  es.addEventListener('token', e => { try { handlers.onToken?.(JSON.parse(e.data)); } catch {} });
  es.addEventListener('tool',  e => { try { handlers.onTool?.(JSON.parse(e.data)); }  catch {} });
  es.addEventListener('done',  () => { handlers.onDone?.(); es.close(); });
  es.addEventListener('error', e => {
    try { handlers.onError?.(JSON.parse(e.data || '{}')); } catch { handlers.onError?.({ message: 'Connection error' }); }
    es.close();
  });
  return () => es.close();
};
