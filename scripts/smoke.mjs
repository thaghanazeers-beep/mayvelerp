/* Smoke test: run from backend/ with PATH set.
 * Hits the real backend at :3001 with real JWTs and confirms each
 * golden-path feature still works after the bug fixes.
 *
 *  cd backend && PATH="$HOME/.local/opt/node/bin:$PATH" node ../scripts/smoke.mjs
 */
// Run from backend/ so node_modules resolves dotenv/mongoose/jsonwebtoken.
import { createRequire } from 'module';
const require = createRequire(import.meta.url + '/../../backend/');
const dotenv   = require('dotenv');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
dotenv.config({ path: new URL('../backend/.env', import.meta.url).pathname });

const BASE = 'http://127.0.0.1:3001';
const PASS = '✅';
const FAIL = '❌';

const results = [];
const log = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? PASS : FAIL} ${label}${detail ? ' — ' + detail : ''}`);
};

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

async function api(token, path, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { ...init, headers });
  let body;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

function tokenFor(user) {
  return jwt.sign({ userId: String(user._id), email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const TS_PRODUCT = '69f0d4c70c14f3d081540d9f'; // Product Design

const thagha = await db.collection('users').findOne({ email: 'thaghanazeer.s@mayvel.ai' });
const pooja  = await db.collection('users').findOne({ email: 'pooja.s@mayvel.ai' });
const suha   = await db.collection('users').findOne({ email: 'suha.a@mayvel.ai' });

const Tthagha = tokenFor(thagha);
const Tpooja  = tokenFor(pooja);
const Tsuha   = tokenFor(suha);

// ─── 1. Auth: each known user can authenticate via JWT ────────────────────────
{
  const r = await api(Tthagha, '/api/teamspaces');
  log('Auth/teamspaces — Thagha', r.status === 200 && Array.isArray(r.body));
  const r2 = await api(Tpooja, '/api/teamspaces');
  log('Auth/teamspaces — Pooja',  r2.status === 200 && Array.isArray(r2.body));
}

// ─── 2. Notifications scoping (B002) ──────────────────────────────────────────
{
  const r = await api(Tthagha, '/api/notifications?user=' + encodeURIComponent('Pooja Sridhar'));
  const ids = [...new Set((r.body || []).map(n => n.userId))];
  log('B002 spoof blocked', ids.length === 0 || ids.every(x => x === 'Thagha Nazeer'), `recipients=${JSON.stringify(ids)}`);
}

// ─── 3. Time entries scoping (B006) ───────────────────────────────────────────
{
  const r = await api(Tpooja, `/api/time/entries?userId=${thagha._id}&teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  const ids = [...new Set((r.body || []).map(e => String(e.userId)))];
  const allMine = ids.every(x => x === String(pooja._id));
  log('B006 entries spoof blocked', allMine, `userIds=${JSON.stringify(ids)}`);
  const r2 = await api(Tpooja, `/api/time/allocations?userId=${thagha._id}&teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  const ids2 = [...new Set((r2.body || []).map(a => String(a.userId)))];
  log('B006 allocations spoof blocked', ids2.every(x => x === String(pooja._id)), `userIds=${JSON.stringify(ids2)}`);
}

// ─── 4. Projects list (org-scoped) ────────────────────────────────────────────
{
  const r = await api(Tthagha, `/api/projects?teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  log('Projects list', r.status === 200 && Array.isArray(r.body) && r.body.length > 0, `count=${r.body?.length}`);
}

// ─── 5. Tasks list ────────────────────────────────────────────────────────────
{
  const r = await api(Tthagha, `/api/tasks?teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  log('Tasks list', r.status === 200 && Array.isArray(r.body) && r.body.length > 0, `count=${r.body?.length}`);
}

// ─── 6. Team list ─────────────────────────────────────────────────────────────
{
  const r = await api(Tthagha, `/api/team?teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  log('Team list', r.status === 200 && Array.isArray(r.body) && r.body.length > 0, `count=${r.body?.length}`);
}

// ─── 7. Plans list ────────────────────────────────────────────────────────────
{
  const r = await api(Tthagha, `/api/time/plans?teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  const arr = Array.isArray(r.body) ? r.body : (r.body?.data || []);
  log('Plans list', r.status === 200 && Array.isArray(arr), `status=${r.status} count=${arr.length}`);
}

// ─── 8. Plan approvals awaiting me (SuperAdmin sees all) ──────────────────────
{
  const r = await api(Tthagha, `/api/time/plans?awaitingMyApproval=1&teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  const arr = Array.isArray(r.body) ? r.body : (r.body?.data || []);
  log('Plans awaitingMyApproval (Super)', r.status === 200, `status=${r.status} count=${arr.length}`);
}

// ─── 9. Sprints list ──────────────────────────────────────────────────────────
{
  const r = await api(Tthagha, `/api/sprints?teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  log('Sprints list', r.status === 200 && Array.isArray(r.body), `count=${r.body?.length}`);
}

// ─── 10. Workflows list ───────────────────────────────────────────────────────
{
  const r = await api(Tthagha, `/api/workflows?teamspaceId=${TS_PRODUCT}`, { headers: { 'x-teamspace-id': TS_PRODUCT } });
  log('Workflows list', r.status === 200, `status=${r.status}`);
}

// ─── 11. Org chart ────────────────────────────────────────────────────────────
{
  const r = await api(Tthagha, '/api/orgchart');
  log('Org chart fetch', r.status === 200, `status=${r.status}`);
}

// ─── 12. Notification mark-as-read for someone else (B002) ────────────────────
{
  // Find a notification whose userId is "Pooja Sridhar" but call it with Thagha
  const pNotif = await db.collection('notifications').findOne({ userId: 'Pooja Sridhar', read: false });
  if (pNotif) {
    const r = await api(Tthagha, `/api/notifications/${pNotif._id}/read`, { method: 'PUT' });
    log('B002 cannot mark-others-as-read', r.status === 404, `status=${r.status}`);
    // ensure still unread
    const after = await db.collection('notifications').findOne({ _id: pNotif._id });
    log('  …notification untouched', after.read === false, `read=${after.read}`);
  } else {
    log('B002 cannot mark-others-as-read', true, 'skipped — no unread Pooja notif');
  }
}

// ─── 13. CRUD task: create, fetch, update, delete ─────────────────────────────
{
  // Find a project to attach
  const proj = await db.collection('projects').findOne({ teamspaceId: new mongoose.Types.ObjectId(TS_PRODUCT) });
  if (!proj) { log('Task CRUD', false, 'no project to attach'); }
  else {
    const newTask = {
      id: `task_${Date.now()}`,
      title: '[smoke] test ' + Date.now(),
      status: 'To Do',
      priority: 'Low',
      assignee: 'Thagha Nazeer',
      projectId: String(proj._id),
      teamspaceId: TS_PRODUCT,
      createdBy: 'Thagha Nazeer',
      type: 'task',
    };
    const c = await api(Tthagha, '/api/tasks', { method: 'POST', body: JSON.stringify(newTask), headers: { 'x-teamspace-id': TS_PRODUCT } });
    const ok = c.status === 201 && c.body?.id;
    log('Task create', ok, `status=${c.status} id=${c.body?.id}`);
    if (ok) {
      const id = c.body.id;
      const u = await api(Tthagha, `/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'In Progress', updatedBy: 'Thagha Nazeer' }), headers: { 'x-teamspace-id': TS_PRODUCT } });
      log('Task update', u.status === 200, `status=${u.status}`);
      const d = await api(Tthagha, `/api/tasks/${id}?actor=Thagha+Nazeer`, { method: 'DELETE', headers: { 'x-teamspace-id': TS_PRODUCT } });
      log('Task delete', d.status === 200, `status=${d.status}`);
    }
  }
}

// ─── 14. PUT user profile gate (B005) ─────────────────────────────────────────
{
  // Pooja is Admin (not SuperAdmin). She should NOT be able to PUT Suha.
  const r = await api(Tpooja, `/api/users/${suha._id}`, { method: 'PUT', body: JSON.stringify({ name: 'Hacked' }) });
  log('B005 non-Super cannot edit other user', r.status === 403, `status=${r.status}`);
  // Pooja editing herself OK
  const r2 = await api(Tpooja, `/api/users/${pooja._id}`, { method: 'PUT', body: JSON.stringify({ name: pooja.name }) });
  log('B005 self-edit OK', r2.status === 200, `status=${r2.status}`);
  // Thagha (SuperAdmin) editing Pooja OK
  const r3 = await api(Tthagha, `/api/users/${pooja._id}`, { method: 'PUT', body: JSON.stringify({ name: pooja.name }) });
  log('B005 SuperAdmin can edit', r3.status === 200, `status=${r3.status}`);
}

// ─── 15. Avatar route SHOULD require auth ─────────────────────────────────────
{
  const r = await fetch(BASE + `/api/users/${thagha._id}/avatar`, { method: 'POST' });
  log('Avatar route requires auth', r.status === 401 || r.status === 403, `status=${r.status}`);
}

// ─── 16. B033 — login response must NOT contain password hash ────────────────
{
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: thagha.email, password: 'Demo2026!' }),
  });
  const data = await r.json();
  const leaks = data.user && ('password' in data.user || 'passwordResetToken' in data.user || 'passwordResetExpires' in data.user);
  log('B033 login response sanitized', !leaks, `keys=${Object.keys(data.user || {}).filter(k => /pass/i.test(k)).join(',') || '(none)'}`);
}

// ─── 17. B033 — login with missing fields → 400 ──────────────────────────────
{
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  log('B033 login no creds → 400', r.status === 400, `status=${r.status}`);
}

// ─── 18. B026 — /plans/:id/allocations needs auth to the plan's teamspace ────
{
  // Find a plan in Product Design and try to read its allocations as a user
  // who isn't in that teamspace. (HR is "Member" with no teamspaces.)
  const planInTs = await db.collection('projecthoursplans').findOne({ teamspaceId: new mongoose.Types.ObjectId(TS_PRODUCT) });
  const hr = await db.collection('users').findOne({ role: 'Member' });
  if (planInTs && hr) {
    const Thr = tokenFor(hr);
    const r = await api(Thr, `/api/time/plans/${planInTs._id}/allocations`);
    log('B026 plan allocations gated', r.status === 403, `status=${r.status}`);
  } else {
    log('B026 plan allocations gated', true, 'skipped — no plan or no Member');
  }
}

// ─── 19. B027 — Allocation PUT/DELETE require ownership or admin ─────────────
{
  // Find an allocation, try to mutate as HR (not project owner, not admin, not Super).
  const someAlloc = await db.collection('allocations').findOne({});
  const hr = await db.collection('users').findOne({ role: 'Member' });
  if (someAlloc && hr) {
    const Thr = tokenFor(hr);
    const r = await api(Thr, `/api/time/allocations/${someAlloc._id}`, { method: 'PUT', body: JSON.stringify({ allocatedHours: 999 }) });
    log('B027 allocation PUT gated', r.status === 403, `status=${r.status}`);
  } else {
    log('B027 allocation PUT gated', true, 'skipped');
  }
}

console.log('---');
const pass = results.filter(x => x.ok).length;
const total = results.length;
console.log(`${pass}/${total} passed`);
if (pass < total) {
  console.log('\nFailures:');
  results.filter(x => !x.ok).forEach(x => console.log(' ', x.label, '—', x.detail));
}
process.exit(pass === total ? 0 : 1);
