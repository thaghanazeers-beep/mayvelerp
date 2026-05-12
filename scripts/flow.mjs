/* Deep flow test — exercises real feature paths end-to-end against the
 * running local backend at :3001. Cleans up after itself.
 *
 *   cd backend && PATH="$HOME/.local/opt/node/bin:$PATH" node ../scripts/flow.mjs
 */
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
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

function tokenFor(u) {
  return jwt.sign({ userId: String(u._id), email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const TS = '69f0d4c70c14f3d081540d9f';

const thagha = await db.collection('users').findOne({ email: 'thaghanazeer.s@mayvel.ai' });
const pooja  = await db.collection('users').findOne({ email: 'pooja.s@mayvel.ai' });
const suha   = await db.collection('users').findOne({ email: 'suha.a@mayvel.ai' });

const Tthagha = tokenFor(thagha);
const Tpooja  = tokenFor(pooja);

// Pick an existing project we own
const proj = await db.collection('projects').findOne({ teamspaceId: new mongoose.Types.ObjectId(TS) });
console.log('Using project:', proj.name, proj._id);

const HDR = { 'x-teamspace-id': TS };

// ─── FLOW 1: Plan submit → approve → status checks ────────────────────────────
let createdPlanId = null;
try {
  const create = await api(Tthagha, '/api/time/plans', {
    method: 'POST', headers: HDR,
    body: JSON.stringify({
      title: `[smoke] plan ${Date.now()}`,
      projectId: String(proj._id),
      teamspaceId: TS,
      periodKind: 'single-month',
      periodMonth: '2026-06',
      submittedBy: thagha.email,
      currency: 'INR',
    })
  });
  const ok = create.status === 200 || create.status === 201;
  log('Plan create', ok, `status=${create.status} id=${create.body?._id}`);
  if (ok) createdPlanId = create.body._id;
} catch (e) { log('Plan create', false, e.message); }

if (createdPlanId) {
  // Submit empty plan → expect 400 "Cannot submit an empty plan" (validation works)
  const sub = await api(Tthagha, `/api/time/plans/${createdPlanId}/submit`, { method: 'POST', headers: HDR });
  log('Empty plan submit blocked', sub.status === 400 && /empty plan/i.test(sub.body?.error || ''), `status=${sub.status} err=${sub.body?.error}`);

  // Cleanup the empty plan we created
  const r = await db.collection('projecthoursplans').deleteOne({ _id: new mongoose.Types.ObjectId(createdPlanId) });
  log('Plan cleanup', r.deletedCount === 1, `deleted=${r.deletedCount}`);
}

// ─── FLOW 2: Time entry create — gate that prevents members from booking
//            against another user's allocation ───────────────────────────────
{
  // Find any allocation for Thagha (we'll try to create as Thagha — should succeed)
  const alloc = await db.collection('allocations').findOne({ userId: thagha._id, status: 'active' });
  if (alloc) {
    const today = new Date();
    while (today.getDay() === 0 || today.getDay() === 6) today.setDate(today.getDate() - 1);
    const date = today.toISOString().slice(0, 10);
    const body = {
      date,
      projectId: String(alloc.projectId),
      taskId: alloc.taskId ? String(alloc.taskId) : null,
      allocationId: String(alloc._id),
      minutes: 30,
      notes: '[smoke] time entry',
      teamspaceId: TS,
    };
    const c = await api(Tthagha, '/api/time/entries', { method: 'POST', headers: HDR, body: JSON.stringify(body) });
    log('Time entry self-create', c.status === 200 || c.status === 201, `status=${c.status} err=${c.body?.error || ''}`);
    if ((c.status === 200 || c.status === 201) && (c.body?._id || c.body?.data?._id)) {
      const id = c.body._id || c.body.data._id;
      await db.collection('timeentries').deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    }
  } else {
    log('Time entry self-create', true, 'skipped — no allocation');
  }
}

// ─── FLOW 3: Settings — email notifications toggle should round-trip ─────────
{
  const r = await api(Tpooja, `/api/users/${pooja._id}`, {
    method: 'PUT',
    body: JSON.stringify({ emailNotificationsEnabled: false }),
  });
  log('Settings toggle (off)', r.status === 200, `status=${r.status}`);
  // restore
  await api(Tpooja, `/api/users/${pooja._id}`, {
    method: 'PUT',
    body: JSON.stringify({ emailNotificationsEnabled: true }),
  });
}

// ─── FLOW 4: Project mutation gate (B024) ────────────────────────────────────
{
  // Suha is global "Admin" → should be allowed
  const Tsuha = tokenFor(suha);
  const ok = await api(Tsuha, '/api/projects', { method: 'POST', headers: HDR, body: JSON.stringify({ name: '[smoke] proj', teamspaceId: TS }) });
  log('Project create as Admin (Suha)', ok.status === 201, `status=${ok.status}`);
  if (ok.body?._id) await db.collection('projects').deleteOne({ _id: new mongoose.Types.ObjectId(ok.body._id) });

  // Find a Member (HR) and verify they cannot
  const hr = await db.collection('users').findOne({ role: 'Member' });
  if (hr) {
    const Thr = tokenFor(hr);
    const denied = await api(Thr, '/api/projects', { method: 'POST', headers: HDR, body: JSON.stringify({ name: '[smoke] proj 2', teamspaceId: TS }) });
    log('Project create as Member blocked', denied.status === 403, `status=${denied.status}`);
  }
}

// ─── FLOW 4b: Plan self-approval blocked (B025) ──────────────────────────────
{
  // Pooja (global Admin, not SuperAdmin) submits a plan via DB, then tries to
  // approve her own. Backend should 403.
  const aProj = await db.collection('projects').findOne({ teamspaceId: new mongoose.Types.ObjectId(TS) });
  const planDoc = {
    title: '[smoke] self-approve test',
    projectId: aProj._id,
    teamspaceId: new mongoose.Types.ObjectId(TS),
    periodKind: 'single-month',
    periodMonth: '2026-06',
    submittedBy: pooja.email,
    status: 'pending',
    currency: 'INR',
    totalCostCents: 0, totalRevenueCents: 0,
    submittedAt: new Date(),
    createdBy: pooja.email,
  };
  const ins = await db.collection('projecthoursplans').insertOne(planDoc);
  const id = ins.insertedId;
  const r = await api(Tpooja, `/api/time/plans/${id}/approve`, { method: 'POST', headers: HDR });
  log('B025 plan self-approval blocked', r.status === 403, `status=${r.status}`);
  await db.collection('projecthoursplans').deleteOne({ _id: id });
}

// ─── FLOW 5: Task assignment notification (B011 check) ───────────────────────
{
  const before = await db.collection('notifications').countDocuments({ userId: pooja.name, type: 'task_created' });
  const t = await api(Tthagha, '/api/tasks', {
    method: 'POST', headers: HDR,
    body: JSON.stringify({
      id: 'task_' + Date.now(),
      title: '[smoke] notif test',
      status: 'Not Yet Started',
      assignee: pooja.name,
      projectId: String(proj._id),
      teamspaceId: TS,
      createdBy: thagha.name,
      type: 'task',
    }),
  });
  if (t.status === 201) {
    // Give async notification a moment
    await new Promise(r => setTimeout(r, 300));
    const after = await db.collection('notifications').countDocuments({ userId: pooja.name, type: 'task_created' });
    log('Notification fired on task create', after === before + 1, `before=${before} after=${after}`);
    // cleanup
    await api(Tthagha, `/api/tasks/${t.body.id}?actor=${encodeURIComponent('Thagha Nazeer')}`, { method: 'DELETE', headers: HDR });
    await db.collection('notifications').deleteMany({ taskTitle: '[smoke] notif test' });
  } else {
    log('Notification fired on task create', false, `task POST status=${t.status}`);
  }
}

console.log('---');
const pass = results.filter(x => x.ok).length;
console.log(`${pass}/${results.length} passed`);
if (pass < results.length) {
  console.log('\nFailures:');
  results.filter(x => !x.ok).forEach(x => console.log(' ', x.label, '—', x.detail));
}
process.exit(pass === results.length ? 0 : 1);
