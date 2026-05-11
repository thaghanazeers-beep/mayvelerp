// URL helpers for pretty task URLs: /<project-slug>/<sprint-slug>/<task-slug>-<mongoId>

export function slugify(s) {
  return (s || '')
    .toString()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')         // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')             // any non-alphanumeric run → '-'
    .replace(/^-+|-+$/g, '')                 // trim leading/trailing '-'
    .slice(0, 60) || 'untitled';
}

// Mongo ObjectId is exactly 24 hex chars.
const MONGO_ID_RE = /[a-f0-9]{24}$/i;

// Build the pretty URL for a task. Falls back to the bare /t/:tsId/tasks/:id form
// when project/sprint/teamspace context is missing.
export function taskUrl(task, projects = [], sprints = []) {
  if (!task) return '/';
  const id = task._id || task.id;
  const proj   = projects.find(p => p._id === task.projectId);
  const sprint = sprints.find(s => s._id === task.sprintId);
  const projSlug   = slugify(proj?.name)   || 'no-project';
  const sprintSlug = slugify(sprint?.name) || 'no-sprint';
  const titleSlug  = slugify(task.title);
  if (id && MONGO_ID_RE.test(String(id))) {
    return `/${projSlug}/${sprintSlug}/${titleSlug}-${id}`;
  }
  // Notion-imported tasks have id like "notion_<32hex>" — use Mongo _id if available.
  if (task._id) {
    return `/${projSlug}/${sprintSlug}/${titleSlug}-${task._id}`;
  }
  // Fallback: old route form
  const tsId = task.teamspaceId || '';
  return tsId ? `/t/${tsId}/tasks/${id}` : '/';
}

// Extract the 24-hex ObjectId from the trailing segment of /a/b/<slug>-<id>
export function idFromTaskUrlSegment(seg) {
  if (!seg) return null;
  const m = String(seg).match(MONGO_ID_RE);
  return m ? m[0] : null;
}
