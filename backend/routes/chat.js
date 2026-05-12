/**
 * AI chat endpoint — Gemini 2.5 Flash with function-calling against the live
 * Mongo data + the project's PRDs in the system prompt.
 *
 * POST /api/chat
 *   body: { messages: [{role: 'user'|'model', text: '...'}], teamspaceId?: string }
 *   returns: { reply: string, toolCalls: [{name, args, result}] }
 *
 * Auth: mounted under /api so the global `authenticate` middleware runs.
 *       Tool execution uses the authenticated user's identity for scoping.
 */
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const Project        = require('../models/Project');
const { Task }       = require('../models/Task');
const ProjectHoursPlan = require('../models/ProjectHoursPlan');
const ProjectHoursPlanLine = require('../models/ProjectHoursPlanLine');
const Allocation     = require('../models/Allocation');
const TimeEntry      = require('../models/TimeEntry');
const User           = require('../models/User');
const RateBucket     = require('../models/RateBucket');
const TeamspaceMembership = require('../models/TeamspaceMembership');

if (!process.env.GEMINI_API_KEY) {
  console.warn('[chat] GEMINI_API_KEY not set — /api/chat will return 503');
}
const ai = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const MODEL_ID = 'gemini-2.5-flash';

// ─── PRD context loaded once at boot ─────────────────────────────────────────
function loadDocsContext() {
  const root = path.resolve(__dirname, '..', '..');
  const files = ['PRD.md', 'TIMESHEET_PRD.md', 'ARCHITECTURE.md', 'README.md'];
  const sections = [];
  for (const f of files) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) {
      const body = fs.readFileSync(p, 'utf8');
      sections.push(`### ${f}\n\n${body}`);
    }
  }
  return sections.join('\n\n---\n\n');
}
const DOCS_CONTEXT = loadDocsContext();
console.log(`[chat] Loaded ${DOCS_CONTEXT.length.toLocaleString()} chars of PRD context.`);

// ─── Tool definitions ────────────────────────────────────────────────────────
// Each tool has a JSON-schema declaration (for the model) and an async handler.
// Handlers receive the parsed args + an `auth` object derived from the request.
const TOOLS = {
  list_projects: {
    declaration: {
      name: 'list_projects',
      description: 'List every project in the user\'s teamspace with id, name, billing type and contract value. Call this first when the user names a project (e.g. "Seyo") to resolve to a projectId.',
      parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
    },
    handler: async (_args, auth) => {
      const projects = await Project.find({ teamspaceId: auth.teamspaceId })
        .select('name icon billingType contractValueCents defaultBillRateCents ownerId status')
        .lean();
      return projects.map(p => ({
        _id: String(p._id), name: p.name, icon: p.icon,
        billingType: p.billingType || 'tm',
        contractValueRupees: Math.round((p.contractValueCents || 0) / 100),
        defaultBillRateRupeesPerHr: Math.round((p.defaultBillRateCents || 0) / 100),
        status: p.status,
      }));
    },
  },
  get_project_pnl: {
    declaration: {
      name: 'get_project_pnl',
      description: 'Get a project\'s monthly P&L: planned + actual cost, revenue, hours, profit. Use this for "show me X project numbers for May" style queries.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          projectId:   { type: SchemaType.STRING, description: 'MongoDB _id of the project' },
          periodMonth: { type: SchemaType.STRING, description: 'YYYY-MM format, e.g. "2026-05"' },
        },
        required: ['projectId', 'periodMonth'],
      },
    },
    handler: async (args, auth) => {
      const plans = await ProjectHoursPlan.find({
        teamspaceId: auth.teamspaceId,
        projectId: args.projectId,
        periodMonth: args.periodMonth,
      }).lean();
      if (!plans.length) return { found: false, message: `No plans for project ${args.projectId} in ${args.periodMonth}.` };
      const sum = (k) => plans.reduce((s, p) => s + (p[k] || 0), 0);
      const project = await Project.findById(args.projectId).select('name icon billingType contractValueCents').lean();
      return {
        found: true,
        project: { name: project?.name, icon: project?.icon, billingType: project?.billingType, contractValueRupees: Math.round((project?.contractValueCents || 0) / 100) },
        periodMonth: args.periodMonth,
        plansCount: plans.length,
        plannedHours:        sum('totalPlannedHours'),
        actualHours:         sum('totalActualHours'),
        billableActualHours: sum('billableActualHours'),
        nonBillableActualHours: sum('nonBillableActualHours'),
        plannedCostRupees:   Math.round(sum('totalCostCents') / 100),
        actualCostRupees:    Math.round(sum('totalActualCostCents') / 100),
        plannedRevenueRupees:Math.round(sum('totalRevenueCents') / 100),
        actualRevenueRupees: Math.round(sum('totalActualRevenueCents') / 100),
        plannedProfitRupees: Math.round(sum('plannedProfitCents') / 100),
        actualProfitRupees:  Math.round(sum('actualProfitCents') / 100),
      };
    },
  },
  list_tasks: {
    declaration: {
      name: 'list_tasks',
      description: 'List tasks with optional filters. Use for "what tasks did Suha do last week?" / "show me overdue tasks for Seyo".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          projectId: { type: SchemaType.STRING, description: 'Optional — filter to one project' },
          status:    { type: SchemaType.STRING, description: 'Optional — exact status, e.g. "Completed"' },
          assignee:  { type: SchemaType.STRING, description: 'Optional — assignee name (case-insensitive)' },
          dateFrom:  { type: SchemaType.STRING, description: 'Optional — YYYY-MM-DD; matches task createdDate or dueDate >=' },
          dateTo:    { type: SchemaType.STRING, description: 'Optional — YYYY-MM-DD; matches task createdDate or dueDate <=' },
          limit:     { type: SchemaType.NUMBER, description: 'Max results (default 50)' },
        },
        required: [],
      },
    },
    handler: async (args, auth) => {
      const filter = { teamspaceId: auth.teamspaceId };
      if (args.projectId) filter.projectId = args.projectId;
      if (args.status)    filter.status    = args.status;
      if (args.assignee)  filter.assignee  = new RegExp(`^${args.assignee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (args.dateFrom || args.dateTo) {
        filter.$or = [
          { createdDate: { ...(args.dateFrom && { $gte: new Date(args.dateFrom) }), ...(args.dateTo && { $lte: new Date(args.dateTo + 'T23:59:59') }) } },
          { dueDate:     { ...(args.dateFrom && { $gte: new Date(args.dateFrom) }), ...(args.dateTo && { $lte: new Date(args.dateTo + 'T23:59:59') }) } },
        ];
      }
      const tasks = await Task.find(filter)
        .sort({ createdDate: -1 })
        .limit(Math.min(args.limit || 50, 100))
        .select('title status assignee dueDate createdDate estimatedHours actualHours billable projectId')
        .lean();
      return { count: tasks.length, tasks };
    },
  },
  list_employees: {
    declaration: {
      name: 'list_employees',
      description: 'List all employees with their cost rate, current-month allocation, hours consumed, and projects. Use for "who is allocated to Seyo this month?" / "what\'s Suha\'s cost rate?".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          month: { type: SchemaType.STRING, description: 'YYYY-MM. Defaults to current month.' },
        },
        required: [],
      },
    },
    handler: async (args, auth) => {
      const month = args.month || new Date().toISOString().slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59));
      // Only Super Admins see cost-rate data. Everyone else gets names + roles
      // (cost rate redacted) — chat used to leak org-wide compensation to anyone
      // logged in.
      const me = auth?.userId ? await User.findById(auth.userId).select('isSuperAdmin').lean() : null;
      const isSuper = !!me?.isSuperAdmin;

      // Scope to members of the caller's current teamspace.
      let users;
      if (auth?.teamspaceId) {
        const memberships = await TeamspaceMembership.find({
          teamspaceId: auth.teamspaceId, status: 'active',
        }).select('userId').lean();
        const userIds = memberships.map(m => m.userId);
        users = await User.find({ _id: { $in: userIds } }).select('name email role').populate('rateBucketId').lean();
      } else {
        users = await User.find({}).select('name email role').populate('rateBucketId').lean();
      }

      const allocs = await Allocation.find({ weekStart: { $gte: monthStart, $lte: monthEnd } })
        .select('userId allocatedHours consumedHours projectId').lean();
      const aggByUser = new Map();
      for (const a of allocs) {
        const k = String(a.userId);
        if (!aggByUser.has(k)) aggByUser.set(k, { allocatedHours: 0, consumedHours: 0, projectIds: new Set() });
        const g = aggByUser.get(k);
        g.allocatedHours += a.allocatedHours || 0;
        g.consumedHours  += a.consumedHours  || 0;
        g.projectIds.add(String(a.projectId));
      }
      return {
        month,
        employees: users.map(u => {
          const agg = aggByUser.get(String(u._id)) || { allocatedHours: 0, consumedHours: 0, projectIds: new Set() };
          const base = {
            name: u.name,
            email: u.email,
            role: u.role,
            allocatedHours: +agg.allocatedHours.toFixed(2),
            consumedHours:  +agg.consumedHours.toFixed(2),
            projectsCount:  agg.projectIds.size,
          };
          if (isSuper) {
            base.costRateRupeesPerHr = u.rateBucketId ? Math.round(u.rateBucketId.ratePerHourCents / 100) : null;
            base.bucket = u.rateBucketId?.name || null;
          }
          return base;
        }),
      };
    },
  },
  list_plans: {
    declaration: {
      name: 'list_plans',
      description: 'List monthly project hours plans with their status, totals, profit, etc.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          projectId:   { type: SchemaType.STRING, description: 'Optional' },
          periodMonth: { type: SchemaType.STRING, description: 'Optional YYYY-MM' },
          status:      { type: SchemaType.STRING, description: 'Optional: draft|pending|approved|rejected' },
        },
        required: [],
      },
    },
    handler: async (args, auth) => {
      const filter = { teamspaceId: auth.teamspaceId };
      if (args.projectId)   filter.projectId   = args.projectId;
      if (args.periodMonth) filter.periodMonth = args.periodMonth;
      if (args.status)      filter.status      = args.status;
      const plans = await ProjectHoursPlan.find(filter)
        .sort({ periodMonth: -1, createdAt: -1 })
        .select('title projectId periodMonth status totalCostCents totalRevenueCents totalActualCostCents plannedProfitCents')
        .lean();
      return {
        count: plans.length,
        plans: plans.map(p => ({
          _id: String(p._id),
          title: p.title,
          projectId: String(p.projectId),
          periodMonth: p.periodMonth,
          status: p.status,
          plannedCostRupees:    Math.round((p.totalCostCents || 0) / 100),
          plannedRevenueRupees: Math.round((p.totalRevenueCents || 0) / 100),
          actualCostRupees:     Math.round((p.totalActualCostCents || 0) / 100),
          plannedProfitRupees:  Math.round((p.plannedProfitCents || 0) / 100),
        })),
      };
    },
  },
  get_time_entries_in_range: {
    declaration: {
      name: 'get_time_entries_in_range',
      description: 'Get hours logged in a date range, optionally filtered by project or user. Use for "show me hours logged on Seyo last week".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          dateFrom:  { type: SchemaType.STRING, description: 'YYYY-MM-DD (inclusive)' },
          dateTo:    { type: SchemaType.STRING, description: 'YYYY-MM-DD (inclusive)' },
          projectId: { type: SchemaType.STRING, description: 'Optional' },
          userName:  { type: SchemaType.STRING, description: 'Optional — case-insensitive name match' },
        },
        required: ['dateFrom', 'dateTo'],
      },
    },
    handler: async (args, auth) => {
      const filter = { teamspaceId: auth.teamspaceId, date: { $gte: args.dateFrom, $lte: args.dateTo } };
      if (args.projectId) filter.projectId = args.projectId;
      if (args.userName) {
        const u = await User.findOne({ name: new RegExp(`^${args.userName}$`, 'i') }).select('_id name');
        if (u) filter.userId = u._id;
        else return { count: 0, totals: { hours: 0, costRupees: 0 }, entries: [], note: `No user "${args.userName}"` };
      }
      const entries = await TimeEntry.find(filter)
        .populate('userId', 'name')
        .populate('projectId', 'name icon')
        .populate('taskId', 'title')
        .lean();
      const totalMinutes = entries.reduce((s, e) => s + (e.minutes || 0), 0);
      const totalCostCents = entries.reduce((s, e) => s + (e.costCents || 0), 0);
      return {
        count: entries.length,
        totals: { hours: +(totalMinutes / 60).toFixed(2), costRupees: Math.round(totalCostCents / 100) },
        byProject: Object.values(entries.reduce((m, e) => {
          const k = String(e.projectId?._id);
          if (!m[k]) m[k] = { name: e.projectId?.name, hours: 0, costRupees: 0 };
          m[k].hours += (e.minutes || 0) / 60;
          m[k].costRupees += (e.costCents || 0) / 100;
          return m;
        }, {})).map(p => ({ ...p, hours: +p.hours.toFixed(2), costRupees: Math.round(p.costRupees) })),
        entries: entries.slice(0, 50).map(e => ({
          date: e.date,
          user: e.userId?.name,
          project: e.projectId?.name,
          task: e.taskId?.title,
          minutes: e.minutes,
          billable: e.billable,
        })),
      };
    },
  },
};

const TOOL_DECLARATIONS = Object.values(TOOLS).map(t => t.declaration);

// ─── /api/chat ───────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'GEMINI_API_KEY not configured on the server' });

  try {
    const { messages = [], teamspaceId } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'messages[] required' });
    }
    const auth = {
      userId: req.user?.userId,
      userName: req.user?.name,
      teamspaceId: teamspaceId || req.headers['x-teamspace-id'],
    };
    if (!auth.teamspaceId) return res.status(400).json({ error: 'teamspaceId required (header or body)' });

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const lastWeekStart = new Date(today); lastWeekStart.setDate(today.getDate() - 7);
    const lastWeekStr = lastWeekStart.toISOString().slice(0, 10);

    const systemInstruction = `You are the AI assistant for **Mayvel Task** — a project management + ERP timesheet platform. You help users (admins, project owners, employees) get answers about their data without digging through the UI.

**Today is ${todayStr}.** "Last week" means roughly ${lastWeekStr} to ${todayStr}. "This month" means ${todayStr.slice(0, 7)}.

You have function-calling tools to query the live database. ALWAYS use tools to get real numbers — never invent or estimate. If the user names a project (e.g. "Seyo", "Auchan"), call \`list_projects\` first to resolve the projectId, then use the relevant data tool.

When responding:
- Use markdown — headings, tables, bold, bullet points.
- Format currency as ₹X,XX,XXX (Indian numbering).
- For data queries, return a concise summary FIRST, then a table or detail block.
- If the user asks for a "PDF" or "export", explain you can show the data in chat but they should use the existing Export buttons in the UI (Plan Editor → "📥 Excel", or P&L page → Export). Mention the URL path.
- If the user asks something the docs answer, quote the docs directly with the section reference (e.g. "per TIMESHEET_PRD.md §13.4...").

You also have full access to the project's PRDs below. Use them to answer "how does X work?" / "what's the loss model?" / "explain workflows" etc.

═══════════ PRODUCT DOCS (verbatim) ═══════════

${DOCS_CONTEXT}

═══════════════════════════════════════════════`;

    const model = ai.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    });

    // Convert client message history → Gemini's contents format
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));
    const userText = messages[messages.length - 1]?.text || '';

    const chat = model.startChat({ history });
    const toolCallsExecuted = [];

    let result = await chat.sendMessage(userText);

    // Tool-use loop: keep calling tools until the model is done
    let safety = 0;
    while (safety++ < 8) {
      const calls = result.response.functionCalls?.() || [];
      if (!calls.length) break;
      const responses = [];
      for (const call of calls) {
        const tool = TOOLS[call.name];
        let toolResult;
        if (!tool) {
          toolResult = { error: `Unknown tool: ${call.name}` };
        } else {
          try {
            toolResult = await tool.handler(call.args || {}, auth);
          } catch (e) {
            toolResult = { error: e.message };
          }
        }
        toolCallsExecuted.push({ name: call.name, args: call.args, result: toolResult });
        responses.push({ functionResponse: { name: call.name, response: { result: toolResult } } });
      }
      result = await chat.sendMessage(responses);
    }

    const finalText = result.response.text();
    res.json({ reply: finalText, toolCalls: toolCallsExecuted });
  } catch (err) {
    console.error('[chat] error:', err);
    res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

// ─── Streaming variant: GET /api/chat/stream ─────────────────────────────────
// Server-Sent Events. Events:
//   event: token   data: {"text": "<chunk>"}
//   event: tool    data: {"name": "...", "args": {...}, "result": {...}}
//   event: done    data: {}
//   event: error   data: {"message": "..."}
//
// Browsers can't add Authorization headers to native EventSource, so we accept
// the JWT via ?token=... query param too. The body is encoded as a single
// `payload` query param (URL-safe base64 of JSON) since EventSource is GET-only.
router.get('/stream', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });

  // EventSource → only GET, no body. Decode payload from query.
  let messages = [];
  let teamspaceId;
  try {
    const json = Buffer.from(String(req.query.payload || ''), 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    messages    = parsed.messages || [];
    teamspaceId = parsed.teamspaceId;
  } catch {
    return res.status(400).json({ error: 'Bad payload' });
  }
  if (!messages.length) return res.status(400).json({ error: 'messages[] required' });

  const auth = {
    userId: req.user?.userId,
    userName: req.user?.name,
    teamspaceId: teamspaceId || req.headers['x-teamspace-id'],
  };
  if (!auth.teamspaceId) return res.status(400).json({ error: 'teamspaceId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const lastWeekStart = new Date(today); lastWeekStart.setDate(today.getDate() - 7);
    const lastWeekStr = lastWeekStart.toISOString().slice(0, 10);

    const systemInstruction = `You are the AI assistant for **Mayvel Task**.

**Today is ${todayStr}.** "Last week" ≈ ${lastWeekStr}–${todayStr}. "This month" = ${todayStr.slice(0, 7)}.

ALWAYS use tools to get real numbers — never invent. If the user names a project (e.g. "Seyo"), call \`list_projects\` first to resolve.

Use markdown — tables, headings, bold. Format INR as ₹X,XX,XXX.

You also have full access to the project's PRDs below. Quote them with section refs when relevant.

═══════════ PRODUCT DOCS (verbatim) ═══════════

${DOCS_CONTEXT}

═══════════════════════════════════════════════`;

    const model = ai.getGenerativeModel({
      model: MODEL_ID,
      systemInstruction,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    });

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));
    const userText = messages[messages.length - 1]?.text || '';
    const chat = model.startChat({ history });

    // Tool-use loop with streaming on the FINAL turn (any earlier tool-call
    // turns are non-streaming since we need the full function-call list).
    let nextInput = userText;
    let safety = 0;
    while (safety++ < 8) {
      const result = await chat.sendMessage(nextInput);
      const calls = result.response.functionCalls?.() || [];
      if (calls.length) {
        const responses = [];
        for (const call of calls) {
          const tool = TOOLS[call.name];
          let toolResult;
          try { toolResult = tool ? await tool.handler(call.args || {}, auth) : { error: `Unknown tool: ${call.name}` }; }
          catch (e) { toolResult = { error: e.message }; }
          send('tool', { name: call.name, args: call.args, result: toolResult });
          responses.push({ functionResponse: { name: call.name, response: { result: toolResult } } });
        }
        nextInput = responses;
        continue;
      }

      // No more tool calls — emit the final text. We already have it from
      // sendMessage(), but to give the user *visible* progress we chunk it out
      // (true token streaming via sendMessageStream would re-run the LLM —
      // wasteful when we already have the answer).
      const finalText = result.response.text();
      const CHUNK = 80;
      for (let i = 0; i < finalText.length; i += CHUNK) {
        send('token', { text: finalText.slice(i, i + CHUNK) });
        await new Promise(r => setTimeout(r, 8));
      }
      break;
    }

    send('done', {});
    res.end();
  } catch (err) {
    console.error('[chat-stream] error:', err);
    send('error', { message: err.message || 'Chat failed' });
    res.end();
  }
});

module.exports = router;
