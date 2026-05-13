require('dotenv').config();
// Force IPv4 for outbound DNS lookups. Render's free-tier containers have
// IPv6 disabled, so smtp.gmail.com (which resolves to both v4 + v6) fails
// with ENETUNREACH on the v6 attempt. Setting ipv4first avoids that hop.
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// ── password helpers ────────────────────────────────────────────────────────
// Backwards-compatible: bcrypt hashes start with `$2`. Anything else is treated
// as a legacy plaintext password and verified by direct compare. On successful
// legacy login we silently upgrade to a bcrypt hash so the next login is safe.
const BCRYPT_ROUNDS = 10;
const isBcryptHash = (s) => typeof s === 'string' && /^\$2[aby]\$/.test(s);
async function hashPassword(plain) { return bcrypt.hash(plain, BCRYPT_ROUNDS); }
async function verifyPassword(user, plain) {
  if (!user || !plain) return false;
  if (isBcryptHash(user.password)) return bcrypt.compare(plain, user.password);
  // Legacy plaintext — match exactly, then upgrade.
  if (user.password === plain) {
    user.password = await hashPassword(plain);
    await user.save();
    return true;
  }
  return false;
}
const cors = require('cors');
const { authenticate, authenticateAnySource, generateToken } = require('./middleware/auth');
const { extractTeamspaceId, requireTeamspaceMembership, requireRole } = require('./middleware/teamspaceAccess');
const TeamspaceMembership = require('./models/TeamspaceMembership');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');

const User = require('./models/User');
const { Task, PropertyDefinition } = require('./models/Task');
const Project = require('./models/Project');
const Sprint = require('./models/Sprint');
const Teamspace = require('./models/Teamspace');
const Page = require('./models/Page');
const { Workflow, WorkflowLog } = require('./models/Workflow');
const Notification = require('./models/Notification');
const PushSubscription = require('./models/PushSubscription');
const { sendPushToUser } = require('./lib/push');
const workflowEngine = require('./workflowEngine');

const app = express();
app.use(cors());
app.use(express.json());

// ── Basic rate limiting on the riskier endpoints ──
// Auth endpoints get a tight limit to slow down credential-stuffing.
// Chat / chat-stream get a moderate limit to prevent runaway LLM cost.
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,        // 15 min
  max: 20,                          // 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again in a few minutes.' },
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,              // 1 min
  max: 30,                          // ~30 messages per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many chat requests. Wait a moment.' },
});
app.use('/api/auth/', authLimiter);
app.use('/api/chat', chatLimiter);

// Serve uploaded files — JWT-gated. Accepts Authorization header OR ?token=...
// query param so <img>/<iframe>/<a download> elements can authenticate without
// JS intercepting the request.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', authenticateAnySource, express.static(uploadsDir));

// File upload config
function safeFilename(original) {
  // Strip path separators, replace any unsafe chars with '-', collapse repeats.
  const ext = path.extname(original);
  const base = path.basename(original, ext)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${Date.now()}-${base || 'file'}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, safeFilename(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Email transporter — uses configured SMTP if SMTP_USER is set,
// otherwise creates an Ethereal test inbox so dev mail is previewable.
let transporter = null;
let usingEthereal = false;

// Brevo HTTP API transport — mimics the nodemailer `transporter.sendMail` shape
// so existing call sites work unchanged. Uses port 443 / HTTPS, which works on
// platforms (like Render's free tier) that block outbound SMTP port 587.
function parseAddress(addr) {
  if (!addr) return null;
  const m = String(addr).match(/^\s*(?:"?([^"<]*?)"?\s*<)?\s*([^\s<>]+@[^\s<>]+)\s*>?\s*$/);
  if (!m) return null;
  return { name: (m[1] || '').trim(), email: m[2].trim() };
}
function makeBrevoTransport(apiKey, defaultFrom) {
  return {
    sendMail: async (opts) => {
      const fromObj = parseAddress(opts.from) || defaultFrom;
      const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
      const body = {
        sender: { name: fromObj.name || 'Mayvel Task', email: fromObj.email },
        to: toList.map(parseAddress).filter(Boolean).map(a => ({ email: a.email, name: a.name || undefined })),
        subject: opts.subject || 'Mayvel Task',
        htmlContent: opts.html || `<p>${(opts.text || '').replace(/\n/g, '<br>')}</p>`,
        textContent: opts.text || undefined,
      };
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${text.slice(0, 200)}`);
      let parsed = {}; try { parsed = JSON.parse(text); } catch {}
      return { messageId: parsed.messageId, response: `Brevo HTTP ${res.status}`, accepted: toList, rejected: [] };
    },
  };
}

async function initTransporter() {
  // Prefer Brevo HTTP API (port 443) — works on Render free tier which blocks SMTP 587.
  if (process.env.BREVO_API_KEY) {
    const senderEmail = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@mayvel.ai';
    transporter = makeBrevoTransport(process.env.BREVO_API_KEY, { name: 'Mayvel Task', email: senderEmail });
    console.log('Email: using Brevo HTTP API as ' + senderEmail);
    return;
  }
  if (process.env.SMTP_USER) {
    const hostName = process.env.SMTP_HOST || 'smtp.gmail.com';
    // Pre-resolve to an IPv4 address. Render's free-tier containers cannot
    // reach IPv6 destinations, so connecting to the v6 address Node otherwise
    // picks via happy-eyeballs fails with ENETUNREACH. We connect to the IPv4
    // IP directly and keep `servername` so the TLS cert still validates against
    // the original hostname.
    let connectHost = hostName;
    try {
      const ips = await require('dns').promises.resolve4(hostName);
      if (ips.length) connectHost = ips[0];
    } catch (e) {
      console.warn('[email] DNS resolve4 failed, falling back to hostname:', e.message);
    }
    transporter = nodemailer.createTransport({
      host: connectHost,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false,
      family: 4,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' },
      tls: { servername: hostName },
      connectionTimeout: 15000,
      socketTimeout: 15000,
    });
    console.log(`Email: using SMTP host ${hostName} (resolved to ${connectHost}) as ${process.env.SMTP_USER}`);
    return;
  }
  try {
    const acct = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: acct.smtp.host,
      port: acct.smtp.port,
      secure: acct.smtp.secure,
      auth: { user: acct.user, pass: acct.pass },
    });
    usingEthereal = true;
    console.log('Email: SMTP_USER not set — using Ethereal dev inbox');
    console.log(`  inbox: https://ethereal.email/login   user: ${acct.user}   pass: ${acct.pass}`);
  } catch (err) {
    console.log('Email: could not create Ethereal account:', err.message);
  }
}

// ==================== HELPER: Create Notification ====================
// Honor per-user notification preferences. The `userId` field stores the user's
// NAME (legacy choice) — we look the user up by name to read prefs + email.
function emailHtmlFor(title, message, taskId) {
  const safe = (s) => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const taskHref = taskId ? `${APP_URL}/tasks/${encodeURIComponent(taskId)}` : APP_URL;
  return `
    <div style="font-family: 'Inter', system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #6c5ce7; margin-top: 0;">${safe(title)}</h2>
      <p style="font-size: 15px; line-height: 1.5; color: #333;">${safe(message)}</p>
      <p style="margin: 24px 0;">
        <a href="${taskHref}" style="display: inline-block; background: #6c5ce7; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">${taskId ? 'Open task' : 'Open Mayvel Task'}</a>
      </p>
      <p style="font-size: 12px; color: #999; margin-top: 24px;">You're receiving this because you're a member of a Mayvel Task workspace. You can mute this type from your notification settings.</p>
    </div>
  `;
}

// Fire-and-forget email send for a notification. Looks up the user's email
// from the User collection. No-op if SMTP isn't configured or user has no
// email on record. Errors are logged but never thrown.
function sendNotificationEmail(userName, type, title, message, taskId) {
  if (!transporter || !userName) return;
  User.findOne({ name: userName }).select('email notificationPrefs emailNotificationsEnabled').lean().then(target => {
    if (!target?.email) return;
    // Master kill switch — respect user's "Email notifications: off" setting.
    if (target.emailNotificationsEnabled === false) {
      console.log(`[email] skipped for ${target.email} — emailNotificationsEnabled=false (${type})`);
      return;
    }
    // Per-type mute.
    if (target.notificationPrefs && target.notificationPrefs[type] === false) {
      console.log(`[email] skipped for ${target.email} — type "${type}" muted in prefs`);
      return;
    }
    return transporter.sendMail({
      from: `"Mayvel Task" <${process.env.SMTP_USER || 'no-reply@mayvel.local'}>`,
      to: target.email,
      subject: title || 'Mayvel Task',
      html: emailHtmlFor(title, message, taskId),
    });
  }).catch(err => console.error('[email] notif send failed:', err.message));
}

async function createNotification({ type, title, message, taskId, taskTitle, userId, actorName, teamspaceId }) {
  try {
    if (userId) {
      const target = await User.findOne({ name: userId }).select('notificationPrefs').lean();
      // Treat absence as enabled. Explicit `false` → mute.
      if (target?.notificationPrefs && target.notificationPrefs[type] === false) return null;
    }
    // Denormalize teamspaceId from the task so the sidebar can count per-team.
    let tsId = teamspaceId;
    if (!tsId && taskId) {
      try { const t = await Task.findOne({ id: taskId }).select('teamspaceId').lean(); tsId = t?.teamspaceId; } catch {}
    }
    const notif = new Notification({ type, title, message, taskId, taskTitle, userId, actorName, teamspaceId: tsId });
    await notif.save();
    if (userId) {
      sendPushToUser(userId, {
        title: title || 'Mayvel Task',
        body: message || '',
        url: taskId ? `/tasks/${taskId}` : '/notifications',
        notifId: String(notif._id),
      }).catch(e => console.error('[push] fire-and-forget failed:', e.message));
      sendNotificationEmail(userId, type, title, message, taskId);
    }
    return notif;
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

// Same gate for direct Notification.create() callers — wrap them through this.
async function createNotificationFiltered(doc) {
  try {
    if (doc.userId) {
      const target = await User.findOne({ name: doc.userId }).select('notificationPrefs').lean();
      if (target?.notificationPrefs && target.notificationPrefs[doc.type] === false) return null;
    }
    // Denormalize teamspaceId from the task so the sidebar can count per-team.
    if (!doc.teamspaceId && doc.taskId) {
      try { const t = await Task.findOne({ id: doc.taskId }).select('teamspaceId').lean(); if (t?.teamspaceId) doc.teamspaceId = t.teamspaceId; } catch {}
    }
    const notif = await Notification.create(doc);
    if (doc.userId) {
      sendPushToUser(doc.userId, {
        title: doc.title || 'Mayvel Task',
        body: doc.message || '',
        url: doc.taskId ? `/tasks/${doc.taskId}` : '/notifications',
        notifId: String(notif._id),
      }).catch(e => console.error('[push] fire-and-forget failed:', e.message));
      sendNotificationEmail(doc.userId, doc.type, doc.title, doc.message, doc.taskId);
    }
    return notif;
  } catch (err) {
    console.error('createNotificationFiltered failed:', err.message);
  }
}
// Export so other route files / engine can use it
global.__createNotificationFiltered = createNotificationFiltered;

// Route ALL Notification.createIfAllowed callers (workflow engine, timesheet
// routes) through createNotificationFiltered too, so they get push + email
// alongside the in-app row. Otherwise those events would only show in the
// bell, never as a real notification.
Notification.createIfAllowed = (doc) => createNotificationFiltered(doc);

// ==================== AUTH ROUTES ====================
// Public signup is disabled. Only a Super Admin can create new users (via the
// admin user management page → POST /api/users). The route is left in place
// returning 403 so old clients show a clear error instead of a silent 404.
// Strip sensitive fields before returning a User to the client. Used by every
// auth flow (login, reset, impersonate, create) so password hashes and reset
// tokens never leak in API responses.
function sanitizeUser(userDoc) {
  if (!userDoc) return userDoc;
  const u = typeof userDoc.toObject === 'function' ? userDoc.toObject() : { ...userDoc };
  delete u.password;
  delete u.passwordResetToken;
  delete u.passwordResetExpires;
  return u;
}

app.post('/api/auth/signup', (req, res) => {
  res.status(403).json({ message: 'Public signup is disabled. Ask a Super Admin to add you.' });
});

// Super Admin–only: create a user with a chosen role. The caller must be
// authenticated and have isSuperAdmin === true.
app.post('/api/users', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
    if (!me?.isSuperAdmin) return res.status(403).json({ message: 'Super Admin only' });
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email, password required' });
    const normalized = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return res.status(400).json({ message: 'Invalid email' });
    const clash = await User.findOne({ email: normalized }).select('_id').lean();
    if (clash) return res.status(409).json({ message: 'Email already in use' });
    const hashed = await hashPassword(password);
    const user = await User.create({
      name, email: normalized, password: hashed,
      role: ['Admin', 'Member'].includes(role) ? role : 'Member',
      profilePictureUrl: `https://i.pravatar.cc/150?u=${normalized}`,
    });
    res.status(201).json(sanitizeUser(user));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Super Admin–only: list all users (for the access-level management page).
app.get('/api/users', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
    if (!me?.isSuperAdmin) return res.status(403).json({ message: 'Super Admin only' });
    const users = await User.find({}).select('-password -passwordResetToken -passwordResetExpires').sort({ name: 1 }).lean();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Super Admin–only: delete a user. Cannot delete yourself or other Super Admins.
app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
    if (!me?.isSuperAdmin) return res.status(403).json({ message: 'Super Admin only' });
    if (String(req.params.id) === String(req.user.userId)) return res.status(400).json({ message: "Can't delete yourself" });
    const target = await User.findById(req.params.id).select('isSuperAdmin').lean();
    if (target?.isSuperAdmin) return res.status(403).json({ message: "Can't delete another Super Admin" });
    await User.findByIdAndDelete(req.params.id);
    await TeamspaceMembership.deleteMany({ userId: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Super Admin: per-teamspace membership management ──
// GET /api/admin/memberships
// Membership management is open to two roles:
//   (1) SuperAdmin — can manage every teamspace.
//   (2) The owner of a teamspace — can manage memberships only in their own
//       teamspace. Pre-fix this was locked to SuperAdmin only, leaving
//       teamspace owners unable to promote/demote/remove their own team.
async function membershipAuth(req, opts = {}) {
  const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
  return { me, isSuper: !!me?.isSuperAdmin };
}
async function ownsTeamspace(userId, teamspaceId) {
  if (!teamspaceId) return false;
  const ts = await Teamspace.findById(teamspaceId).select('ownerId').lean();
  return !!ts && String(ts.ownerId) === String(userId);
}

//   Returns every (user × teamspace × role) row with both sides populated so
//   the Access Control page can render a single matrix. SuperAdmin sees all
//   rows; a teamspace owner sees only rows for teamspaces they own.
app.get('/api/admin/memberships', authenticate, async (req, res) => {
  try {
    const { me, isSuper } = await membershipAuth(req);
    let filter = {};
    if (!isSuper) {
      const owned = await Teamspace.find({ ownerId: me._id }).select('_id').lean();
      if (!owned.length) return res.status(403).json({ message: 'Not allowed' });
      filter = { teamspaceId: { $in: owned.map(t => t._id) } };
    }
    const rows = await TeamspaceMembership.find(filter)
      .populate('userId', 'name email role isSuperAdmin')
      .populate('teamspaceId', 'name icon isPersonal ownerId')
      .lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/memberships
//   Body: { userId, teamspaceId, role }. Idempotent on (userId, teamspaceId).
app.post('/api/admin/memberships', authenticate, async (req, res) => {
  try {
    const { me, isSuper } = await membershipAuth(req);
    const { userId, teamspaceId, role } = req.body || {};
    if (!userId || !teamspaceId) return res.status(400).json({ error: 'userId + teamspaceId required' });
    if (!isSuper && !(await ownsTeamspace(me._id, teamspaceId))) {
      return res.status(403).json({ message: 'Only the teamspace owner or a Super Admin can manage members.' });
    }
    const r = ['admin', 'member', 'viewer'].includes(role) ? role : 'member';
    const upserted = await TeamspaceMembership.findOneAndUpdate(
      { userId, teamspaceId },
      { $set: { role: r, status: 'active' }, $setOnInsert: { joinedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(upserted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/admin/memberships/:id  → change role only
app.put('/api/admin/memberships/:id', authenticate, async (req, res) => {
  try {
    const { me, isSuper } = await membershipAuth(req);
    const { role } = req.body || {};
    if (!['admin', 'member', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be admin / member / viewer' });
    const existing = await TeamspaceMembership.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Membership not found' });
    if (!isSuper && !(await ownsTeamspace(me._id, existing.teamspaceId))) {
      return res.status(403).json({ message: 'Only the teamspace owner or a Super Admin can manage members.' });
    }
    const updated = await TeamspaceMembership.findByIdAndUpdate(req.params.id, { role }, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/memberships/:id  → remove from teamspace
app.delete('/api/admin/memberships/:id', authenticate, async (req, res) => {
  try {
    const { me, isSuper } = await membershipAuth(req);
    const existing = await TeamspaceMembership.findById(req.params.id).lean();
    if (!existing) return res.json({ success: true });
    if (!isSuper && !(await ownsTeamspace(me._id, existing.teamspaceId))) {
      return res.status(403).json({ message: 'Only the teamspace owner or a Super Admin can manage members.' });
    }
    await TeamspaceMembership.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/impersonate { userId }  → returns { user, token } for that
// user, signed as the target. Used by SuperAdmin to "log in as <user>" to
// debug what they're seeing. The frontend stashes the original token and can
// restore it when they're done.
app.post('/api/admin/impersonate', authenticate, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).select('isSuperAdmin name email').lean();
    if (!me?.isSuperAdmin) return res.status(403).json({ message: 'Super Admin only' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const token = generateToken(target);
    console.log('[impersonate] ' + me.email + ' → ' + target.email);
    res.json({ user: sanitizeUser(target), token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
    const user = await User.findOne({ email });
    if (!user || !(await verifyPassword(user, password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = generateToken(user);
    res.json({ user: sanitizeUser(user), token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teamspaces/personal — opt-in: user explicitly asks to create their
// personal workspace. Idempotent: returns the existing one if it already exists.
app.post('/api/teamspaces/personal', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const existing = await Teamspace.findOne({ isPersonal: true, ownerId: user._id });
    if (existing) return res.json(existing);
    const ts = await Teamspace.create({
      name: `${user.name}'s space`,
      description: 'Private workspace — only you can see tasks here.',
      icon: '🔒',
      ownerId: user._id,
      isPersonal: true,
    });
    await TeamspaceMembership.create({
      userId: user._id, teamspaceId: ts._id, role: 'admin', status: 'active',
    });
    res.status(201).json(ts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PASSWORD RESET ====================
// Production frontend URL. Defaults to the live Netlify site so emails never
// link to localhost even if the APP_URL env var is unset on Render.
const APP_URL = process.env.APP_URL || 'https://mayvelerp.netlify.app';

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email });

    // Generic response — don't leak whether the email is registered
    const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

    if (!user) return res.json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${APP_URL}/?reset=${token}`;

    let emailSent = false;
    let previewUrl = null;
    if (transporter) {
      try {
        const info = await transporter.sendMail({
          from: `"Mayvel Task" <${process.env.SMTP_USER || 'no-reply@mayvel.local'}>`,
          to: email,
          subject: 'Reset your Mayvel Task password',
          html: `
            <div style="font-family: 'Inter', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #6c5ce7;">Reset your password</h2>
              <p>We received a request to reset the password for your Mayvel Task account.</p>
              <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
              <p style="margin: 24px 0;">
                <a href="${resetUrl}" style="display: inline-block; background: #6c5ce7; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Reset Password</a>
              </p>
              <p style="font-size: 12px; color: #666;">If the button doesn't work, paste this link into your browser:</p>
              <p style="font-size: 12px; color: #666; word-break: break-all;">${resetUrl}</p>
              <p style="font-size: 12px; color: #999; margin-top: 24px;">If you didn't request this, you can ignore this email — your password will stay the same.</p>
            </div>
          `,
        });
        emailSent = true;
        if (usingEthereal) previewUrl = nodemailer.getTestMessageUrl(info);
      } catch (mailErr) {
        console.log('Reset email send failed:', mailErr.message);
      }
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const payload = { ...genericResponse };
    if (previewUrl) payload.previewUrl = previewUrl;
    if (!emailSent && isDev) payload.devResetUrl = resetUrl;
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and new password are required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ message: 'Reset link is invalid or has expired' });

    user.password = await hashPassword(password);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    const authToken = generateToken(user);
    res.json({ user: sanitizeUser(user), token: authToken, message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GLOBAL MIDDLEWARE ====================
// Use authenticateAnySource so EventSource / <a download> / <iframe> can
// authenticate via ?token=... query param (browsers can't set headers on those).
// Same security model as `authenticate` — JWT is verified identically.
app.use('/api', authenticateAnySource);
app.use('/api', extractTeamspaceId);

// ==================== ERP / TIMESHEET ROUTES (Phase 1) ====================
app.use('/api/time', require('./routes/timesheets'));
app.use('/api/chat', require('./routes/chat'));

// ==================== TEAMSPACE ROUTES ====================
app.get('/api/teamspaces', async (req, res) => {
  try {
    const memberships = await TeamspaceMembership.find({ userId: req.user.userId, status: 'active' }).populate('teamspaceId');
    let teamspaces = memberships.map(m => m.teamspaceId).filter(Boolean);
    // Hide other people's personal workspaces from the picker. A personal
    // teamspace must only be visible to its owner.
    teamspaces = teamspaces.filter(ts => !ts.isPersonal || String(ts.ownerId) === String(req.user.userId));
    res.json(teamspaces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teamspaces', async (req, res) => {
  try {
    const { name, description, icon, ownerId, isPersonal } = req.body;
    const ts = new Teamspace({
      name,
      description,
      icon,
      ownerId,
      isPersonal: !!isPersonal,
      members: ownerId ? [{ userId: ownerId, role: 'Admin' }] : []
    });
    await ts.save();
    res.status(201).json(ts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teamspaces/:id', async (req, res) => {
  try {
    const ts = await Teamspace.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(ts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teamspaces/:id', async (req, res) => {
  try {
    await Teamspace.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TEAM ROUTES ====================
app.get('/api/team', requireTeamspaceMembership, async (req, res) => {
  try {
    const teamspaceId = req.teamspaceId; // Extracted by middleware
    if (!teamspaceId || teamspaceId === 'undefined') {
      return res.json([]);
    }
    
    // Fetch active memberships and populate user details
    const memberships = await TeamspaceMembership.find({ teamspaceId, status: 'active' })
      .populate('userId', '-password');
      
    // Format response to match the expected team member array. We also expose
    // the membership document's _id as `membershipId` so the UI can call
    // PUT/DELETE /api/admin/memberships/:id (now allowed for teamspace owners
    // — see /api/admin/memberships routes).
    const team = memberships.map(m => {
      if (!m.userId) return null;
      const obj = m.userId.toObject();
      obj.role = m.role;                  // teamspace role: admin/member/viewer
      obj.membershipId = String(m._id);
      return obj;
    }).filter(Boolean);

    res.json(team);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/team/:id', requireTeamspaceMembership, requireRole('admin'), async (req, res) => {
  try {
    await TeamspaceMembership.findOneAndUpdate(
      { userId: req.params.id, teamspaceId: req.teamspaceId },
      { status: 'removed' }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EMAIL INVITE ====================
app.post('/api/team/invite', requireTeamspaceMembership, requireRole('admin'), async (req, res) => {
  try {
    const { email, role, inviterName } = req.body;
    const teamspaceId = req.body.teamspaceId || req.teamspaceId;
    if (!teamspaceId || teamspaceId === '__personal__') return res.status(400).json({ message: 'Invalid teamspace' });

    let user = await User.findOne({ email });
    let isNewUser = false;
    let tempPassword = null;

    if (!user) {
      tempPassword = `mayvel_${Math.random().toString(36).slice(2, 10)}`;
      const name = email.split('@')[0];
      user = new User({
        name,
        email,
        password: await hashPassword(tempPassword),       // hash on creation; tempPassword stays in scope only to email it once
        role: role || 'Member',
        profilePictureUrl: `https://i.pravatar.cc/150?u=${email}`,
      });
      await user.save();
      isNewUser = true;
    }

    const teamspace = await Teamspace.findById(teamspaceId);
    if (!teamspace) return res.status(404).json({ message: 'Teamspace not found' });

    const existingMembership = await TeamspaceMembership.findOne({ userId: user._id, teamspaceId: teamspace._id });
    if (existingMembership) {
      if (existingMembership.status === 'active') {
        return res.status(400).json({ message: 'User is already a member of this teamspace' });
      } else {
        // Reactivate removed member
        existingMembership.status = 'active';
        existingMembership.role = role ? role.toLowerCase() : 'member';
        await existingMembership.save();
      }
    } else {
      await TeamspaceMembership.create({ userId: user._id, teamspaceId: teamspace._id, role: role ? role.toLowerCase() : 'member', status: 'active', invitedBy: req.user.userId });
    }

    let emailSent = false;
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"Mayvel Task" <${process.env.SMTP_USER || 'no-reply@mayvel.local'}>`,
          to: email,
          subject: `${inviterName || 'Someone'} invited you to Mayvel Task`,
          html: `
            <div style="font-family: 'Inter', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #6c5ce7;">You're invited to Mayvel Task!</h2>
              <p>${inviterName || 'A team admin'} has invited you to join the workspace.</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Email:</strong> ${email}</p>
                ${isNewUser ? `<p><strong>Temporary Password:</strong> ${tempPassword}</p>` : `<p>Log in with your existing password.</p>`}
                <p><strong>Role:</strong> ${role || 'Member'}</p>
              </div>
              ${isNewUser ? `<p>Please change your password after logging in.</p>` : ''}
              <a href="${APP_URL}" style="display: inline-block; background: #b8ff03; color: #050505; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700;">Open Mayvel Task</a>
            </div>
          `,
        });
        emailSent = true;
      } catch (emailErr) {
        console.log('Email send failed:', emailErr.message);
      }
    }

    res.status(201).json({
      user,
      tempPassword,
      emailSent,
      message: emailSent 
        ? `Invitation sent to ${email}` 
        : (isNewUser ? `User created. Email not sent (SMTP not configured). Temp password: ${tempPassword}` : `User added to teamspace. Email not sent.`),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GENERIC FILE UPLOAD ====================
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;

app.post('/api/uploads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    res.status(201).json({
      url:       `${PUBLIC_BASE_URL}/uploads/${req.file.filename}`,
      name:      req.file.originalname,
      sizeBytes: req.file.size,
      mimeType:  req.file.mimetype,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROFILE PICTURE UPLOAD ====================
app.post('/api/users/:id/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const avatarUrl = `${PUBLIC_BASE_URL}/uploads/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { profilePictureUrl: avatarUrl },
      { new: true }
    );
    
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ profilePictureUrl: avatarUrl, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user profile
app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const callerId = String(req.user.userId);
    const targetId = String(req.params.id);
    const caller = await User.findById(callerId).select('isSuperAdmin').lean();
    const isSelf = callerId === targetId;
    if (!isSelf && !caller?.isSuperAdmin) return res.status(403).json({ error: 'Only the user themselves or a Super Admin can edit this profile.' });

    // Strip privileged fields when the caller isn't a Super Admin.
    if (!caller?.isSuperAdmin) {
      delete req.body.role;
      delete req.body.isSuperAdmin;
    }

    if (req.body?.email) {
      const lower = String(req.body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return res.status(400).json({ error: 'Invalid email format' });
      const clash = await User.findOne({ email: lower, _id: { $ne: req.params.id } }).select('_id').lean();
      if (clash) return res.status(409).json({ error: 'That email is already used by another account.' });
      req.body.email = lower;
    }
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(user);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That email is already used by another account.' });
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROJECT ROUTES ====================
app.get('/api/projects', async (req, res) => {
  try {
    // Projects are org-wide: every teamspace sees every project. Departments
    // (teamspaces) contribute their own tasks + budgets to each project.
    // The `teamspaceId` query param is accepted for backward compatibility but
    // no longer used for filtering (skip the empty-array shortcut so callers
    // without a tsId still get the full list).
    const projects = await Project.find({}).sort({ createdDate: -1 });
    const projectsWithCounts = await Promise.all(projects.map(async (p) => {
      const taskCount = await Task.countDocuments({ projectId: p._id.toString() });
      return { ...p.toObject(), taskCount };
    }));
    res.json(projectsWithCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Projects are org-scoped (visible to all teamspaces), so writes need a stronger
// gate than the per-teamspace role: only a global Admin or a Super Admin may
// create, edit, or delete a project. Anyone with an account used to be able to
// mutate the org-wide catalog.
async function requireGlobalAdmin(req, res, next) {
  try {
    const me = await User.findById(req.user.userId).select('role isSuperAdmin').lean();
    if (!me) return res.status(401).json({ error: 'Not authenticated' });
    if (me.isSuperAdmin || me.role === 'Admin' || me.role === 'Team Owner') return next();
    return res.status(403).json({ error: 'Only an Admin or Super Admin can manage projects' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

app.post('/api/projects', requireGlobalAdmin, async (req, res) => {
  try {
    const project = new Project({ ...req.body, teamspaceId: req.body.teamspaceId || req.teamspaceId });
    await project.save();
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', requireGlobalAdmin, async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', requireGlobalAdmin, async (req, res) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    await Task.updateMany({ projectId: req.params.id }, { $unset: { projectId: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TASK ROUTES ====================
app.get('/api/tasks', requireTeamspaceMembership, async (req, res) => {
  try {
    const { status, assignee, projectId, pageId, priority, sprintId, teamspaceId, search, limit, skip } = req.query;
    if (!teamspaceId || teamspaceId === 'undefined') return res.json([]);
    
    const filter = { teamspaceId };
    if (status)    filter.status = status;
    if (assignee)  filter.assignee = { $regex: assignee, $options: 'i' };
    if (projectId) filter.projectId = projectId;
    if (pageId)    filter.pageId = pageId;
    if (priority)  filter.priority = priority;
    if (sprintId)  filter.sprintId = sprintId;
    if (search)    filter.title = { $regex: search, $options: 'i' };

    const query = Task.find(filter).sort({ createdDate: -1 });
    if (limit) query.limit(parseInt(limit));
    if (skip)  query.skip(parseInt(skip));

    const tasks = await query;
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', requireTeamspaceMembership, async (req, res) => {
  try {
    const projectId = req.body.projectId;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required to create a task' });
    }
    // ERP gate: the *assignee* must have an active allocation in this project.
    // (Project owner / admin creates the task, picks an employee, assigns hours.
    //  The assignee is who the budget belongs to.)
    if (req.user?.role !== 'Admin') {
      const Allocation = require('./models/Allocation');
      const User       = require('./models/User');

      // Resolve assignee: req.body.assigneeUserId (preferred), or by name string
      let assigneeUserId = req.body.assigneeUserId || null;
      if (!assigneeUserId && req.body.assignee) {
        const u = await User.findOne({ name: req.body.assignee });
        if (u) assigneeUserId = u._id;
      }
      // Fall back to creator (the legacy "create task for myself" path)
      if (!assigneeUserId) assigneeUserId = req.user.userId;

      // Default to billable if not specified — keeps legacy callers working.
      const billable = req.body.billable === undefined ? true : !!req.body.billable;
      const has = await Allocation.exists({ userId: assigneeUserId, projectId, status: 'active', billable });
      if (!has) {
        const bucketLabel = billable ? 'billable' : 'non-billable';
        return res.status(403).json({
          error: `The assignee has no ${bucketLabel} allocation in this project. Allocate ${bucketLabel} hours first via Time → Plans.`,
        });
      }
    }
    const task = new Task({ ...req.body, teamspaceId: req.body.teamspaceId || req.teamspaceId });
    await task.save();
    workflowEngine.fire('task_created', task.toObject());

    // Notify the assignee (if it's not the creator). Also notify all admins
    // so they can keep tabs on new work entering the system.
    const creatorName = req.body.createdBy || req.body.updatedBy || (req.user ? (await User.findById(req.user.userId).select('name').lean())?.name : null);
    const recipients = new Set();
    if (task.assignee && task.assignee !== creatorName) recipients.add(task.assignee);
    for (const name of recipients) {
      createNotification({
        type: 'task_created',
        title: 'New task created',
        message: `"${task.title}" was created${creatorName ? ' by ' + creatorName : ''} and assigned to you.`,
        taskId: task.id,
        taskTitle: task.title,
        userId: name,
        actorName: creatorName || 'Someone',
      });
    }
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', requireTeamspaceMembership, async (req, res) => {
  try {
    const oldTask = await Task.findOne({ id: req.params.id });
    // Auto-clear rejection: if a Rejected task is being edited (any non-status
    // field) without an explicit status change, flip it back to 'Not Yet Started'
    // so the rework is visible in the queue. Avoids the "stuck Rejected" papercut
    // where the assignee tweaks a field but it still shows as Rejected.
    if (oldTask?.status === 'Rejected' && req.body.status === undefined) {
      const REVIEWED_FIELDS = ['title', 'description', 'attachments', 'dueDate', 'estimatedHours', 'customProperties'];
      const editedAReviewedField = REVIEWED_FIELDS.some(k => Object.prototype.hasOwnProperty.call(req.body, k));
      if (editedAReviewedField) req.body.status = 'Not Yet Started';
    }

    // Approve / reject gate — only the teamspace OWNER (or Super Admin) can
    // flip a task to Completed/Rejected from In Review. Regular admins
    // can't unilaterally approve.
    if (oldTask && req.body.status && (req.body.status === 'Completed' || req.body.status === 'Rejected')) {
      const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
      if (!me?.isSuperAdmin) {
        const ts = await Teamspace.findById(oldTask.teamspaceId).select('ownerId').lean();
        if (!ts || String(ts.ownerId) !== String(req.user.userId)) {
          return res.status(403).json({ error: 'Only the teamspace owner can approve or reject tasks.' });
        }
      }
    }

    const task = await Task.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (oldTask) {
      // Status changed
      if (req.body.status && oldTask.status !== req.body.status) {
        const ctx = { fromStatus: oldTask.status, toStatus: req.body.status };

        // Task submitted for review → notify admins OF THIS TEAMSPACE only.
        // (Workspace owner is already an admin row in the membership table.)
        if (req.body.status === 'In Review') {
          const tsAdminMemberships = await TeamspaceMembership.find({
            teamspaceId: task.teamspaceId,
            role: 'admin',
            status: 'active',
          }).populate('userId', 'name');
          for (const m of tsAdminMemberships) {
            if (!m.userId?.name) continue;
            createNotification({
              type: 'review_requested',
              title: 'Review Requested',
              message: `"${task.title}" submitted for review by ${task.assignee || 'a team member'}`,
              taskId: task.id,
              taskTitle: task.title,
              userId: m.userId.name,
              actorName: task.assignee || 'Someone',
            });
          }
        }

        // Task approved → notify the assignee
        if (req.body.status === 'Completed' && oldTask.status === 'In Review') {
          if (task.assignee) {
            createNotification({
              type: 'task_completed',
              title: 'Task Approved ✅',
              message: `"${task.title}" has been approved by ${req.body.updatedBy || 'Admin'}`,
              taskId: task.id,
              taskTitle: task.title,
              userId: task.assignee,
              actorName: req.body.updatedBy || 'Admin',
            });
          }
        }

        // Task rejected → notify the assignee
        if (req.body.status === 'Rejected') {
          if (task.assignee) {
            createNotification({
              type: 'task_rejected',
              title: 'Task Rejected ❌',
              message: `"${task.title}" was rejected by ${req.body.updatedBy || 'Admin'}. Please rework.`,
              taskId: task.id,
              taskTitle: task.title,
              userId: task.assignee,
              actorName: req.body.updatedBy || 'Admin',
            });
          }
        }

        workflowEngine.fire('status_changed', task.toObject(), ctx);

        // Generic status-change notification — fires for moves that aren't
        // already covered above (e.g., In Progress → Blocked, To Do → In Progress).
        const handledByAbove = ['In Review', 'Rejected'].includes(req.body.status) ||
                               (req.body.status === 'Completed' && oldTask.status === 'In Review');
        if (!handledByAbove && task.assignee && task.assignee !== req.body.updatedBy) {
          createNotification({
            type: 'status_changed',
            title: `Status: ${oldTask.status} → ${req.body.status}`,
            message: `"${task.title}" moved to ${req.body.status}${req.body.updatedBy ? ' by ' + req.body.updatedBy : ''}.`,
            taskId: task.id,
            taskTitle: task.title,
            userId: task.assignee,
            actorName: req.body.updatedBy || 'Someone',
          });
        }
      }

      // Assignee changed → notify the new assignee
      if (req.body.assignee && oldTask.assignee !== req.body.assignee) {
        createNotification({
          type: 'task_assigned',
          title: 'Task Assigned',
          message: `"${task.title}" has been assigned to you by ${req.body.updatedBy || 'Admin'}`,
          taskId: task.id,
          taskTitle: task.title,
          userId: req.body.assignee,
          actorName: req.body.updatedBy || 'Someone',
        });
        workflowEngine.fire('assignee_changed', task.toObject(), { oldAssignee: oldTask.assignee, newAssignee: req.body.assignee });
      }

      if (req.body.projectId && oldTask.projectId !== req.body.projectId) {
        workflowEngine.fire('task_moved_to_project', task.toObject());
      }
      workflowEngine.fire('task_updated', task.toObject());
    }

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', requireTeamspaceMembership, async (req, res) => {
  try {
    const doomed = await Task.findOne({ id: req.params.id });
    await Task.findOneAndDelete({ id: req.params.id });

    if (doomed) {
      const actor = req.query.actor || req.body?.deletedBy || (req.user ? (await User.findById(req.user.userId).select('name').lean())?.name : 'Someone');
      const recipients = new Set();
      if (doomed.assignee && doomed.assignee !== actor) recipients.add(doomed.assignee);
      if (doomed.createdBy && doomed.createdBy !== actor && doomed.createdBy !== doomed.assignee) recipients.add(doomed.createdBy);
      for (const name of recipients) {
        createNotification({
          type: 'task_deleted',
          title: 'Task deleted',
          message: `"${doomed.title}" was deleted by ${actor || 'someone'}.`,
          taskId: doomed.id,
          taskTitle: doomed.title,
          userId: name,
          actorName: actor || 'Someone',
        });
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TASK COMMENTS ====================
const TaskComment = require('./models/TaskComment');

// Resolve @name tokens in body against the teamspace's user roster.
// Returns array of unique resolved User names.
async function resolveMentions(body, teamspaceId) {
  const tokens = [...new Set((body.match(/@([\w.\-' ]+?)(?=[\s.,!?;:]|$)/g) || [])
    .map(t => t.replace(/^@/, '').trim()).filter(Boolean))];
  if (!tokens.length) return [];
  const names = [];
  for (const tok of tokens) {
    // exact case-insensitive match against User.name
    const u = await User.findOne({ name: new RegExp(`^${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('name');
    if (u?.name) names.push(u.name);
  }
  return [...new Set(names)];
}

// GET /api/tasks/:id/comments — list, oldest-first
app.get('/api/tasks/:id/comments', requireTeamspaceMembership, async (req, res) => {
  try {
    const comments = await TaskComment.find({ taskId: req.params.id }).sort({ createdAt: 1 }).lean();
    res.json(comments);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks/:id/comments  body: { body }
app.post('/api/tasks/:id/comments', requireTeamspaceMembership, async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment body required' });
    if (body.length > 5000) return res.status(400).json({ error: 'Comment too long (max 5000 chars)' });

    const mentions = await resolveMentions(body, req.teamspaceId);
    const c = await TaskComment.create({
      teamspaceId: req.teamspaceId,
      taskId: req.params.id,
      authorId: req.user.userId,
      authorName: req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'Someone'),
      body,
      mentions,
    });

    // Fire mention notifications + a generic comment notif to the assignee (if not the commenter)
    const task = await Task.findOne({ id: req.params.id }).select('title assignee');
    for (const name of mentions) {
      if (name === c.authorName) continue;
      await createNotification({
        type: 'comment_mention',
        title: `${c.authorName} mentioned you`,
        message: `On "${task?.title || 'a task'}": ${body.length > 120 ? body.slice(0, 120) + '…' : body}`,
        taskId: req.params.id,
        taskTitle: task?.title,
        userId: name,
        actorName: c.authorName,
      });
    }
    if (task?.assignee && task.assignee !== c.authorName && !mentions.includes(task.assignee)) {
      await createNotification({
        type: 'task_comment',
        title: `New comment on "${task.title}"`,
        message: `${c.authorName}: ${body.length > 120 ? body.slice(0, 120) + '…' : body}`,
        taskId: req.params.id,
        taskTitle: task.title,
        userId: task.assignee,
        actorName: c.authorName,
      });
    }
    res.status(201).json(c);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/tasks/:id/comments/:commentId — only the author or an admin can delete.
app.delete('/api/tasks/:id/comments/:commentId', requireTeamspaceMembership, async (req, res) => {
  try {
    const c = await TaskComment.findById(req.params.commentId);
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    const isAuthor = String(c.authorId) === String(req.user.userId);
    const isAdmin  = req.user.role === 'Admin';
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Only the author or an admin can delete this comment' });
    await c.deleteOne();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== WEB PUSH ROUTES ====================
// Public VAPID key — frontend uses this to subscribe.
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Save (or upsert) a browser subscription for the authenticated user.
// Body: { endpoint, keys: { p256dh, auth } }
app.post('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Bad subscription payload' });
    const user = await User.findById(req.user.userId).select('name').lean();
    if (!user) return res.status(401).json({ error: 'No such user' });
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId: user.name, endpoint, keys, userAgent: req.headers['user-agent'] || '' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove a subscription (called when user clicks "Disable push" or unsubscribes
// at the browser level).
app.post('/api/push/unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    await PushSubscription.deleteOne({ endpoint });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a test push to the authenticated user — useful for the "test
// notification" button in the UI.
app.post('/api/push/test', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('name').lean();
    if (!user) return res.status(401).json({ error: 'No such user' });
    const result = await sendPushToUser(user.name, {
      title: 'Mayvel Task',
      body: 'Push notifications are working 🎉',
      url: '/notifications',
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== NOTIFICATION ROUTES ====================
// Recipient is *always* the JWT caller. The legacy `?user=NAME` query is
// ignored to prevent cross-user notification reads (any logged-in user used to
// be able to read another user's notifications by passing their name).
// Notifications are stored keyed by the user's display name (legacy schema),
// so we resolve the caller's name from their userId on the JWT.
async function jwtCallerName(req) {
  // Trust only req.user.userId — never req.query.user.
  const me = await User.findById(req.user.userId).select('name').lean();
  return me?.name || null;
}

app.get('/api/notifications', async (req, res) => {
  try {
    const name = await jwtCallerName(req);
    if (!name) return res.json([]);
    const notifications = await Notification.find({ userId: name })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const name = await jwtCallerName(req);
    if (!name) return res.json({ count: 0 });
    const count = await Notification.countDocuments({ read: false, userId: name });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-teamspace unread counts for the sidebar bell icons.
app.get('/api/notifications/unread-by-teamspace', async (req, res) => {
  try {
    const name = await jwtCallerName(req);
    if (!name) return res.json({});
    const rows = await Notification.aggregate([
      { $match: { read: false, userId: name, teamspaceId: { $ne: null } } },
      { $group: { _id: '$teamspaceId', count: { $sum: 1 } } },
    ]);
    const out = {};
    rows.forEach(r => { if (r._id) out[String(r._id)] = r.count; });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const name = await jwtCallerName(req);
    // Only mark as read if this notification actually belongs to the caller.
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: name },
      { read: true }
    );
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const name = await jwtCallerName(req);
    if (!name) return res.json({ success: true });
    await Notification.updateMany({ read: false, userId: name }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const name = await jwtCallerName(req);
    const n = await Notification.findOneAndDelete({ _id: req.params.id, userId: name });
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROPERTY DEFINITIONS ====================
app.get('/api/properties', async (req, res) => {
  try {
    const props = await PropertyDefinition.find();
    res.json(props);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/properties', async (req, res) => {
  try {
    const prop = new PropertyDefinition(req.body);
    await prop.save();
    res.status(201).json(prop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== WORKFLOW ROUTES ====================
app.get('/api/workflows', async (req, res) => {
  try {
    const { teamspaceId } = req.query;
    if (!teamspaceId || teamspaceId === 'undefined') return res.json([]);
    const filter = { teamspaceId };
    const workflows = await Workflow.find(filter).sort({ createdDate: -1 });
    res.json(workflows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflows', async (req, res) => {
  try {
    const workflow = new Workflow({ ...req.body, teamspaceId: req.body.teamspaceId || req.teamspaceId });
    await workflow.save();
    res.status(201).json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/workflows/:id', async (req, res) => {
  try {
    const workflow = await Workflow.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workflows/:id', async (req, res) => {
  try {
    await Workflow.findByIdAndDelete(req.params.id);
    await WorkflowLog.deleteMany({ workflowId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clone every workflow from one teamspace into another. The copies belong to
// the target teamspace exclusively — editing one never affects the source.
// Used to seed a brand-new teamspace with a known-good rule set or to share
// rules from a "template" teamspace like Product Design.
app.post('/api/workflows/copy', async (req, res) => {
  try {
    const { sourceTeamspaceId, targetTeamspaceId, workflowIds } = req.body;
    if (!sourceTeamspaceId || !targetTeamspaceId) {
      return res.status(400).json({ error: 'sourceTeamspaceId and targetTeamspaceId are required' });
    }
    if (String(sourceTeamspaceId) === String(targetTeamspaceId)) {
      return res.status(400).json({ error: 'Source and target must be different teamspaces' });
    }
    const filter = { teamspaceId: sourceTeamspaceId };
    if (Array.isArray(workflowIds) && workflowIds.length > 0) filter._id = { $in: workflowIds };
    const sourceWorkflows = await Workflow.find(filter);
    if (sourceWorkflows.length === 0) return res.json({ copied: 0, workflows: [] });

    const copies = sourceWorkflows.map(w => ({
      name: w.name,
      description: w.description,
      icon: w.icon,
      color: w.color,
      enabled: w.enabled,
      trigger: w.trigger,
      conditions: w.conditions,
      actions: w.actions,
      executionCount: 0,
      lastExecuted: null,
      createdBy: req.user?.name || w.createdBy,
      teamspaceId: targetTeamspaceId,
    }));
    const inserted = await Workflow.insertMany(copies);
    res.status(201).json({ copied: inserted.length, workflows: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflows/:id/toggle', async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ message: 'Workflow not found' });
    wf.enabled = !wf.enabled;
    await wf.save();
    res.json(wf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflows/:id/logs', async (req, res) => {
  try {
    const logs = await WorkflowLog.find({ workflowId: req.params.id })
      .sort({ executedAt: -1 })
      .limit(50);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflow-logs', async (req, res) => {
  try {
    const logs = await WorkflowLog.find().sort({ executedAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activity?days=14&limit=200
//   Unified timeline: TimesheetAudit + WorkflowLog + Notification, scoped to the
//   current teamspace where applicable. Returns events sorted by `at` desc.
app.get('/api/activity', requireTeamspaceMembership, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const TimesheetAudit = require('./models/TimesheetAudit');

    const [audits, wfLogs, notifs] = await Promise.all([
      TimesheetAudit.find({ teamspaceId: req.teamspaceId, at: { $gte: since } })
        .sort({ at: -1 }).limit(limit).lean(),
      WorkflowLog.find({ executedAt: { $gte: since }, status: 'success' })
        .sort({ executedAt: -1 }).limit(limit).lean(),
      Notification.find({ createdAt: { $gte: since } })
        .sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    // Normalize to a common shape: { source, kind, at, actor, title, summary, link? }
    const merged = [];
    audits.forEach(a => merged.push({
      source: 'audit',
      kind:   a.action,            // submit, approve, reject, etc.
      at:     a.at,
      actor:  a.actorName || '',
      entityType: a.entityType,
      entityId: a.entityId,
      title:  `${a.action} on ${a.entityType}`,
      summary: a.reason || '',
    }));
    wfLogs.forEach(w => merged.push({
      source: 'workflow',
      kind:   w.trigger,
      at:     w.executedAt,
      actor:  'Workflow',
      title:  w.taskTitle || 'Workflow ran',
      summary: `Trigger: ${w.trigger} → actions: ${(w.actionsExecuted || []).join(', ')}`,
    }));
    notifs.forEach(n => merged.push({
      source: 'notification',
      kind:   n.type,
      at:     n.createdAt,
      actor:  n.actorName || '',
      title:  n.title || '',
      summary: n.message || '',
      taskId: n.taskId,
    }));

    merged.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ count: merged.length, events: merged.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflows/:id/run', async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });
    const task = await Task.findOne({ id: req.body.taskId });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    await workflowEngine.fire(workflow.trigger.type, task.toObject());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SPRINT ROUTES ====================

// GET all sprints (optionally filter by projectId)
app.get('/api/sprints', async (req, res) => {
  try {
    const { status, teamspaceId, projectId } = req.query;
    if (!teamspaceId || teamspaceId === 'undefined') return res.json([]);
    const filter = { teamspaceId };
    if (status) filter.status = status;
    if (projectId) filter.projectId = projectId;
    const sprints = await Sprint.find(filter).sort({ startDate: -1 });
    // Attach task counts per sprint
    const sprintsWithCounts = await Promise.all(sprints.map(async (s) => {
      const taskCount    = await Task.countDocuments({ sprintId: s._id.toString() });
      const doneCount    = await Task.countDocuments({ sprintId: s._id.toString(), status: 'Completed' });
      const totalPoints  = await Task.aggregate([
        { $match: { sprintId: s._id.toString() } },
        { $group: { _id: null, total: { $sum: '$estimatedHours' } } }
      ]);
      return { ...s.toObject(), taskCount, doneCount, totalPoints: totalPoints[0]?.total || 0 };
    }));
    res.json(sprintsWithCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single sprint + its tasks
app.get('/api/sprints/:id', async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });
    const tasks = await Task.find({ sprintId: req.params.id }).sort({ createdDate: -1 });
    res.json({ ...sprint.toObject(), tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NOTION SYNC
app.post('/api/sprints/notion/sync', async (req, res) => {
  try {
    const { token, databaseId, teamspaceId } = req.body;
    if (!token || !databaseId) return res.status(400).json({ error: 'Token and Database ID are required' });

    const { Client } = require('@notionhq/client');
    const notion = new Client({ auth: token });
    const response = await notion.databases.query({ database_id: databaseId });
    
    const sprintsToInsert = [];
    for (const page of response.results) {
      const nameProp = Object.values(page.properties).find(p => p.type === 'title');
      const name = nameProp && nameProp.title[0] ? nameProp.title[0].plain_text : 'Untitled Sprint';
      
      const statusProp = Object.values(page.properties).find(p => p.type === 'select' || p.type === 'status');
      const statusStr = statusProp?.select?.name || statusProp?.status?.name || 'planned';
      const status = statusStr.toLowerCase() === 'active' || statusStr.toLowerCase() === 'in progress' ? 'active' 
                   : statusStr.toLowerCase() === 'completed' || statusStr.toLowerCase() === 'done' ? 'completed' : 'planned';

      const dateProp = Object.values(page.properties).find(p => p.type === 'date');
      const startDate = dateProp?.date?.start || new Date();
      const endDate = dateProp?.date?.end || null;

      sprintsToInsert.push({
        name,
        status,
        startDate,
        endDate,
        goal: 'Imported from Notion',
        teamspaceId: teamspaceId || undefined
      });
    }

    if (sprintsToInsert.length > 0) {
      await Sprint.insertMany(sprintsToInsert);
    }
    
    res.json({ message: `Successfully imported ${sprintsToInsert.length} sprints from Notion`, count: sprintsToInsert.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE sprint
app.post('/api/sprints', async (req, res) => {
  try {
    const sprint = new Sprint({ ...req.body, teamspaceId: req.body.teamspaceId || req.teamspaceId });
    await sprint.save();
    res.status(201).json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE sprint metadata
app.put('/api/sprints/:id', async (req, res) => {
  try {
    const sprint = await Sprint.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE sprint (tasks become unassigned)
app.delete('/api/sprints/:id', async (req, res) => {
  try {
    await Sprint.findByIdAndDelete(req.params.id);
    await Task.updateMany({ sprintId: req.params.id }, { $unset: { sprintId: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// START sprint (set status = active, only one active at a time per project)
app.post('/api/sprints/:id/start', async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });
    // Deactivate any other active sprint in this project
    if (sprint.projectId) {
      await Sprint.updateMany({ projectId: sprint.projectId, status: 'active' }, { status: 'completed', completedAt: new Date() });
    }
    sprint.status = 'active';
    if (!sprint.startDate) sprint.startDate = new Date();
    await sprint.save();
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// COMPLETE sprint — roll unfinished tasks to a target sprint
app.post('/api/sprints/:id/complete', async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found' });

    const { rolloverSprintId } = req.body; // optional target sprint for unfinished tasks

    if (rolloverSprintId) {
      // Move incomplete tasks to the next sprint
      await Task.updateMany(
        { sprintId: req.params.id, status: { $nin: ['Completed', 'Rejected'] } },
        { sprintId: rolloverSprintId }
      );
    } else {
      // Unassign unfinished tasks from sprint
      await Task.updateMany(
        { sprintId: req.params.id, status: { $nin: ['Completed', 'Rejected'] } },
        { $unset: { sprintId: '' } }
      );
    }

    sprint.status = 'completed';
    sprint.completedAt = new Date();
    await sprint.save();
    res.json(sprint);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD task to sprint
app.post('/api/sprints/:id/tasks', async (req, res) => {
  try {
    const { taskId } = req.body;
    const task = await Task.findOneAndUpdate({ id: taskId }, { sprintId: req.params.id }, { new: true });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REMOVE task from sprint
app.delete('/api/sprints/:id/tasks/:taskId', async (req, res) => {
  try {
    await Task.findOneAndUpdate({ id: req.params.taskId }, { $unset: { sprintId: '' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PAGE ROUTES ====================

app.get('/api/pages', async (req, res) => {
  try {
    const { teamspaceId } = req.query;
    if (!teamspaceId || teamspaceId === 'undefined') return res.json([]);
    const filter = { teamspaceId };
    const pages = await Page.find(filter).sort({ title: 1 });
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pages/:id', async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) return res.status(404).json({ message: 'Page not found' });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pages', async (req, res) => {
  try {
    const page = new Page({ ...req.body, teamspaceId: req.body.teamspaceId || req.teamspaceId });
    await page.save();
    res.status(201).json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pages/:id', async (req, res) => {
  try {
    const page = await Page.findByIdAndUpdate(req.params.id, { ...req.body, updatedDate: new Date() }, { new: true });
    if (!page) return res.status(404).json({ message: 'Page not found' });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pages/:id', async (req, res) => {
  try {
    await Page.findByIdAndDelete(req.params.id);
    // Delete all tasks associated with this page
    await Task.deleteMany({ pageId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const OrgChart = require('./models/OrgChart');

// ==================== ORG CHART ROUTES ====================

// GET org chart (optionally filter by teamspaceId)
app.get('/api/orgchart', async (req, res) => {
  try {
    const filter = {};
    if (req.query.teamspaceId) {
      filter.teamspaceId = req.query.teamspaceId;
    } else {
      filter.teamspaceId = null;
    }
    const chart = await OrgChart.findOne(filter);
    if (!chart) return res.json({ nodes: [], edges: [] });
    res.json(chart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT (upsert) org chart
app.put('/api/orgchart', async (req, res) => {
  try {
    // Only Super Admin can save the org chart. Everyone else gets it
    // read-only (the frontend hides edit controls but we double-check here so
    // it can't be bypassed via curl / DevTools).
    const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
    if (!me?.isSuperAdmin) return res.status(403).json({ error: 'Only the Super Admin can edit the org chart.' });

    const { nodes, edges, teamspaceId, updatedBy } = req.body;
    const filter = { teamspaceId: teamspaceId || null };
    const chart = await OrgChart.findOneAndUpdate(
      filter,
      { nodes, edges, updatedBy, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(chart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET hierarchy info for a specific member
// Returns: the node, its parent chain (managers), and direct reports
app.get('/api/orgchart/hierarchy/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const tsId = req.query.teamspaceId || null;
    const filter = tsId ? { teamspaceId: tsId } : { teamspaceId: null };
    const chart = await OrgChart.findOne(filter);
    if (!chart) return res.json({ node: null, managers: [], directReports: [] });

    // Find the node for this member
    const node = chart.nodes.find(n => n.memberId === memberId);
    if (!node) return res.json({ node: null, managers: [], directReports: [] });

    // Build adjacency
    const parentMap = {};
    const childMap = {};
    chart.edges.forEach(e => {
      parentMap[e.to] = e.from;
      if (!childMap[e.from]) childMap[e.from] = [];
      childMap[e.from].push(e.to);
    });

    // Walk up to find all managers
    const managers = [];
    let current = node.id;
    while (parentMap[current]) {
      const parentNode = chart.nodes.find(n => n.id === parentMap[current]);
      if (parentNode) managers.push({ id: parentNode.id, name: parentNode.name, orgRole: parentNode.orgRole, memberId: parentNode.memberId });
      current = parentMap[current];
    }

    // Direct reports
    const directReportIds = childMap[node.id] || [];
    const directReports = directReportIds
      .map(rid => chart.nodes.find(n => n.id === rid))
      .filter(Boolean)
      .map(n => ({ id: n.id, name: n.name, orgRole: n.orgRole, memberId: n.memberId }));

    // All subordinates (recursive)
    const allSubordinates = [];
    const queue = [...directReportIds];
    while (queue.length) {
      const cid = queue.shift();
      const cNode = chart.nodes.find(n => n.id === cid);
      if (cNode) allSubordinates.push({ id: cNode.id, name: cNode.name, orgRole: cNode.orgRole, memberId: cNode.memberId });
      (childMap[cid] || []).forEach(sub => queue.push(sub));
    }

    res.json({
      node: { id: node.id, name: node.name, orgRole: node.orgRole, department: node.department, memberId: node.memberId },
      managers,
      directReports,
      allSubordinates,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/organization/members
//   Returns every user with their org-chart info (role, dept, manager) and rate-bucket cost.
//   Optional aggregates for the requested month: allocated hours, consumed hours, cost MTD, projects.
//
//   Query: ?month=YYYY-MM (defaults to current month)
app.get('/api/organization/members', async (req, res) => {
  try {
    const RateBucket  = require('./models/RateBucket');
    const Allocation  = require('./models/Allocation');
    const TimeEntry   = require('./models/TimeEntry');
    const Project     = require('./models/Project');
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59));

    // Org chart is global (teamspaceId: null) per the model's existing usage.
    const chart   = await OrgChart.findOne({ teamspaceId: null }) || { nodes: [], edges: [] };
    const buckets = await RateBucket.find({}).lean();
    const users   = await User.find({}).select('-password -passwordResetToken -passwordResetExpires').populate('rateBucketId').lean();

    // Build manager-lookup: edge.from = manager nodeId, edge.to = report nodeId
    const nodeById = new Map(chart.nodes.map(n => [n.id, n]));
    const parentByNodeId = new Map();
    for (const e of chart.edges) parentByNodeId.set(e.to, e.from);

    // Aggregate this month's allocations + actuals per user (no per-user round-trip)
    const allocs = await Allocation.find({
      weekStart: { $gte: monthStart, $lte: monthEnd },
    }).select('userId allocatedHours consumedHours projectId').lean();
    const entries = await TimeEntry.find({
      date: { $gte: month + '-01', $lte: month + '-31' },
    }).select('userId minutes costCents projectId billable').lean();

    const aggByUser = new Map();
    const get = (uid) => {
      const k = String(uid);
      if (!aggByUser.has(k)) aggByUser.set(k, {
        allocatedHours: 0, consumedHours: 0, billableMinutes: 0, nonBillableMinutes: 0,
        actualCostCents: 0, projectIds: new Set(),
      });
      return aggByUser.get(k);
    };
    for (const a of allocs) {
      const g = get(a.userId);
      g.allocatedHours += a.allocatedHours || 0;
      g.consumedHours  += a.consumedHours  || 0;
      g.projectIds.add(String(a.projectId));
    }
    for (const e of entries) {
      const g = get(e.userId);
      if (e.billable) g.billableMinutes    += e.minutes || 0;
      else            g.nonBillableMinutes += e.minutes || 0;
      g.actualCostCents += e.costCents || 0;
      g.projectIds.add(String(e.projectId));
    }

    // Project-name lookup so the row can show the count *and* names
    const allProjectIds = [...new Set([
      ...allocs.map(a => String(a.projectId)),
      ...entries.map(e => String(e.projectId)),
    ])];
    const projects = allProjectIds.length
      ? await Project.find({ _id: { $in: allProjectIds } }).select('name icon').lean()
      : [];
    const projById = new Map(projects.map(p => [String(p._id), p]));

    // Helper: resolve a node's manager from the parent edge map
    const managerOf = (node) => {
      if (!node) return { managerName: null, managerRole: null };
      const parentId = parentByNodeId.get(node.id);
      const parent   = parentId ? nodeById.get(parentId) : null;
      return parent
        ? { managerName: parent.name, managerRole: parent.orgRole }
        : { managerName: null, managerRole: null };
    };
    const emptyMonth = () => ({
      allocatedHours: 0, consumedHours: 0, billableHours: 0, nonBillableHours: 0,
      actualCostCents: 0, projects: [], projectsCount: 0,
    });

    // ── 1) People who DO have a User account (login + bucket + workload aggregates) ──
    const usersWithChart = users.map(u => {
      const node = chart.nodes.find(n => String(n.memberId) === String(u._id));
      const { managerName, managerRole } = managerOf(node);
      const agg = aggByUser.get(String(u._id)) || {
        allocatedHours: 0, consumedHours: 0, billableMinutes: 0, nonBillableMinutes: 0,
        actualCostCents: 0, projectIds: new Set(),
      };
      const projectsThisMonth = [...agg.projectIds].map(pid => projById.get(pid)).filter(Boolean);
      return {
        _id: u._id,
        kind: 'user',                                      // has a login + can be allocated
        name: u.name,
        email: u.email,
        role: u.role,
        profilePictureUrl: u.profilePictureUrl,
        rateBucket: u.rateBucketId ? {
          _id: u.rateBucketId._id,
          name: u.rateBucketId.name,
          ratePerHourCents: u.rateBucketId.ratePerHourCents,
          kind: u.rateBucketId.kind,
        } : null,
        orgRole: node?.orgRole || null,
        department: node?.department || null,
        managerName,
        managerRole,
        inOrgChart: !!node,
        nodeId: node?.id || null,
        thisMonth: {
          allocatedHours:    +agg.allocatedHours.toFixed(2),
          consumedHours:     +agg.consumedHours.toFixed(2),
          billableHours:     +(agg.billableMinutes / 60).toFixed(2),
          nonBillableHours:  +(agg.nonBillableMinutes / 60).toFixed(2),
          actualCostCents:   agg.actualCostCents,
          projects:          projectsThisMonth,
          projectsCount:     projectsThisMonth.length,
        },
      };
    });

    // ── 2) Org-chart nodes WITHOUT a User account (chart-only employees) ──
    // These exist on the chart but have no login — they show up so the org-wide member count
    // matches what's drawn on the chart. No rate, no email, no workload — just identity.
    const linkedUserIds = new Set(users.map(u => String(u._id)));
    const chartOnly = chart.nodes
      // Division headers (Seyo, MHS, Bacsys, …) are structural nodes — not people.
      .filter(n => n.orgRole !== 'Division')
      .filter(n => !n.memberId || !linkedUserIds.has(String(n.memberId)))
      .map(n => {
        const { managerName, managerRole } = managerOf(n);
        return {
          _id: `chart:${n.id}`,                            // synthetic id so React keys stay unique
          kind: 'chart-only',                              // no login / no allocation possible
          name: n.name,
          email: null,
          role: null,
          profilePictureUrl: null,
          rateBucket: null,
          orgRole: n.orgRole || null,
          department: n.department || null,
          managerName,
          managerRole,
          inOrgChart: true,
          nodeId: n.id,
          thisMonth: emptyMonth(),
        };
      });

    const result = [...usersWithChart, ...chartOnly];
    res.json({
      month,
      members: result,
      totalCount: result.length,
      counts: {
        withAccount:   usersWithChart.length,
        chartOnly:     chartOnly.length,
        onChart:       result.filter(m => m.inOrgChart).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== WEEKLY EMAIL DIGEST ====================
// Friday 18:00–18:59 — send each user a summary of their week:
//   - Tasks they completed
//   - Tasks still in progress / overdue
//   - Notifications they haven't read
//   - For project owners: pending plan approvals + week slices waiting
// Skipped if user has notificationPrefs.weekly_digest === false.
async function weeklyDigestTick() {
  try {
    const now = new Date();
    if (now.getDay() !== 5) return;
    if (now.getHours() !== 18) return;
    if (!transporter) return;

    const monday = new Date(now); monday.setHours(0,0,0,0);
    const dow = monday.getDay();
    monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4); friday.setHours(23,59,59,999);

    const users = await User.find({}).select('name email notificationPrefs emailNotificationsEnabled').lean();
    let sent = 0;
    for (const u of users) {
      if (!u.email || u.email === 'unknown@example.com') continue;
      if (u.emailNotificationsEnabled === false) continue;       // master kill switch
      if (u.notificationPrefs?.weekly_digest === false) continue; // per-type mute
      // De-dupe: skip if we already sent a digest in the last 20 hours
      const recent = await Notification.findOne({
        type: 'weekly_digest_sent', userId: u.name,
        createdAt: { $gte: new Date(Date.now() - 20 * 60 * 60 * 1000) },
      });
      if (recent) continue;

      // Gather data
      const myTasksCompleted = await Task.find({
        assignee: u.name,
        status: 'Completed',
        updatedAt: { $gte: monday, $lte: friday },
      }).select('title projectId').limit(20).lean();
      const myTasksInFlight = await Task.find({
        assignee: u.name,
        status: { $in: ['Not Yet Started', 'In Progress', 'In Review'] },
      }).select('title status dueDate').limit(20).lean();
      const unreadCount = await Notification.countDocuments({ userId: u.name, read: false });

      // Build email body
      const li = (title, sub) => `<li style="margin:4px 0">${title}${sub ? ` <span style="color:#888;font-size:12px">— ${sub}</span>` : ''}</li>`;
      const html = `
        <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">
          <h2 style="color:#6c5ce7;margin:0 0 16px">Your week at Mayvel Task</h2>
          <p style="margin:0 0 16px;color:#555">Hi ${u.name?.split(' ')[0] || ''}, here's what you did this week (${monday.toDateString()} – ${friday.toDateString()}).</p>
          ${myTasksCompleted.length ? `
            <h3 style="margin:16px 0 6px;font-size:14px">✅ Completed (${myTasksCompleted.length})</h3>
            <ul style="margin:0;padding-left:20px;color:#444;font-size:14px">${myTasksCompleted.map(t => li(t.title)).join('')}</ul>
          ` : ''}
          ${myTasksInFlight.length ? `
            <h3 style="margin:16px 0 6px;font-size:14px">📋 Still in flight (${myTasksInFlight.length})</h3>
            <ul style="margin:0;padding-left:20px;color:#444;font-size:14px">${myTasksInFlight.slice(0, 10).map(t => li(t.title, t.status)).join('')}</ul>
          ` : ''}
          ${unreadCount ? `<p style="margin:16px 0 6px;font-size:14px">🔔 You have <strong>${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}</strong>.</p>` : ''}
          <p style="margin:24px 0 0;font-size:12px;color:#888">
            <a href="${APP_URL}" style="color:#b8ff03;font-weight:600">Open Mayvel Task →</a><br>
            Don't want these? Profile → Notification preferences → toggle "Weekly digest" off.
          </p>
        </div>`;
      try {
        await transporter.sendMail({
          from: `"Mayvel Task" <${process.env.SMTP_USER || 'no-reply@mayvel.local'}>`,
          to: u.email,
          subject: `Your Mayvel Task week — ${myTasksCompleted.length} completed, ${myTasksInFlight.length} in flight`,
          html,
        });
        // Mark sent so we don't double-fire if cron runs again in the same hour
        await Notification.create({
          type: 'weekly_digest_sent', title: 'Weekly digest sent',
          message: `Email digest sent to ${u.email}`, userId: u.name, actorName: 'System',
        });
        sent++;
      } catch (mailErr) {
        console.error(`Digest send failed for ${u.email}:`, mailErr.message);
      }
    }
    if (sent > 0) console.log(`[weeklyDigest] Sent ${sent} digest email(s).`);
  } catch (e) { console.error('weeklyDigestTick failed:', e.message); }
}

// Once-a-day tick: maintenance projects' recurrence templates create next
// month's plan when the current month's periodEnd has passed. Idempotent —
// if the child plan already exists for the next month, skip.
async function maintenanceRecurrenceTick() {
  try {
    const ProjectHoursPlan = require('./models/ProjectHoursPlan');
    const now = new Date();
    const templates = await ProjectHoursPlan.find({
      periodKind: 'maintenance',
      'recurrence.active': true,
      'recurrence.nextRunOn': { $lte: now },
    }).lean();
    for (const tpl of templates) {
      // Next month after the template's periodEnd
      const baseEnd = new Date(tpl.recurrence.nextRunOn || tpl.periodEnd);
      const nextStart = new Date(Date.UTC(baseEnd.getUTCFullYear(), baseEnd.getUTCMonth() + 1, 1));
      const ym = nextStart.toISOString().slice(0, 7);
      const exists = await ProjectHoursPlan.findOne({ parentPlanId: tpl._id, periodMonth: ym });
      if (exists) {
        await ProjectHoursPlan.updateOne({ _id: tpl._id }, { $set: { 'recurrence.nextRunOn': new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 1, 0)) } });
        continue;
      }
      const periodEnd = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 1, 0, 23, 59, 59));
      const project = await mongoose.model('Project').findById(tpl.projectId).select('name').lean();
      await ProjectHoursPlan.create({
        teamspaceId: tpl.teamspaceId,
        projectId:   tpl.projectId,
        title:       `${project?.name || 'Maintenance'} ${ym} (auto)`,
        periodMonth: ym,
        periodStart: nextStart,
        periodEnd,
        periodKind:  'maintenance',
        parentPlanId: tpl._id,
        status:       'draft',
        createdBy:   'system',
        totalPlannedHours: tpl.recurrence.monthlyHours,
      });
      await ProjectHoursPlan.updateOne({ _id: tpl._id }, { $set: { 'recurrence.nextRunOn': periodEnd } });
      console.log('[maintenance] spawned ' + ym + ' for project ' + tpl.projectId);
    }
  } catch (e) { console.error('maintenanceRecurrenceTick failed:', e.message); }
}

const PORT = process.env.PORT || 3001;
initTransporter().finally(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    // Schedule due-date-approaching checks every hour
    setInterval(() => {
      workflowEngine.runScheduledChecks();
    }, 60 * 60 * 1000);
    setTimeout(() => workflowEngine.runScheduledChecks(), 5000);

    // Weekly digest — checked every hour, only fires Friday 18:00.
    setInterval(weeklyDigestTick, 60 * 60 * 1000);
    setTimeout(weeklyDigestTick, 60 * 1000);

    // Maintenance recurrence — checked every 6 hours. Cheap query (template
    // count is small) so over-running is fine; the work itself is idempotent.
    setInterval(maintenanceRecurrenceTick, 6 * 60 * 60 * 1000);
    setTimeout(maintenanceRecurrenceTick, 5 * 60 * 1000);
  });
});
