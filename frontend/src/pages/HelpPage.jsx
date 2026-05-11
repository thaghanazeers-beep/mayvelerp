import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTeamspace } from '../context/TeamspaceContext';
import { useAuth } from '../context/AuthContext';
import './HelpPage.css';

// ─── Guide content (kept as plain markdown so it's easy to edit) ─────────────
// Each section: { id, title, icon, audience, body, links? }
//   audience: 'all' | 'admin' | 'owner' | 'employee'
//   body: markdown string. Use {{TS_LINK}} placeholder; we replace at render time.
//   links: optional array of { label, path } for "Jump to…" buttons.
const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '🚀',
    audience: 'all',
    body: `
This is **Mayvel Task** — a project management platform with a built-in ERP timesheet module.

### Your first 5 minutes

1. **Pick your active teamspace** from the sidebar dropdown. Most data (tasks, projects, plans, time entries) is scoped to a teamspace, so always confirm you're in the right one.
2. Open **Tasks** to see what's on your plate. Use the filter pills at the top to narrow by sprint, assignee, or status.
3. Open **Time** if your role logs hours. Your week starts blank on Monday — fill in the cells, then click **Submit Week** Friday EOD.
4. Use the **AI Assistant** (✨ button bottom-right) when you want a quick answer like "what tasks do I have due this week?" — it has access to your live data.
5. **Press \`Cmd+K\`** (or \`Ctrl+K\` on Windows/Linux) to jump anywhere — see "Shortcuts" below.

### Your role determines what you see

- **Admin** — can approve project hours plans, manage rate buckets, edit any project, see all P&L.
- **Project Owner** — can submit hours plans for projects they own, allocate hours to employees, approve weekly slices for their projects.
- **Member** (everyone else) — logs their own time and works the tasks assigned to them.

### First-time welcome

The first time you log in, a **welcome modal** pops up with quick-start buttons (Read guide / See tasks / Set up project / Try AI assistant). It only shows once per user. You can always reopen this guide from **Help & Guide** in the sidebar.
`,
    links: [
      { label: 'Open Tasks', path: '__TS__/tasks' },
      { label: 'Open Time', path: '__TS__/time' },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks — Creating & Tracking',
    icon: '✓',
    audience: 'all',
    body: `
### Creating a task

Click **+ New Task** on the Tasks page. You'll need:
- **Project** — only projects where you (or the assignee) have an active hours allocation appear in the dropdown.
- **Hours type** — Billable (revenue-bearing) or Non-billable (overhead). This affects cost rates and the assignee's score.
- **Assignee** — only employees with the matching billable/non-billable allocation in this project show up.
- **Title** + **estimated hours**.

> 💡 **Why the project list looks short:** the system gates task creation by allocation. If you don't have hours allocated in a project, you can't create tasks there. Ask the project owner to allocate hours to you first.

### Status flow

Tasks move through: **Not Yet Started → In Progress → In Review → Completed** (or → **Rejected** which sends them back to "Not Yet Started" automatically when you next edit any field).

### Views

- **Board** — Kanban columns by status. Drag cards across.
- **Table** — sortable spreadsheet view with bulk filters.
- **List** — compact rows; useful for daily standups.

### Attachments

Drop files into the task detail. Excel, Word, PowerPoint, PDF, images, audio, and video all preview inline. File access is JWT-gated — share the task itself, not the raw URL.

### Comments & @mentions

Every task has a comments thread at the bottom of the detail page.

- Type \`@\` to open an autocomplete picker of teammates. Click a name (or arrow-key + Enter) to insert it.
- Mentioned users get a **comment_mention** notification. The task assignee gets a **task_comment** notification (if not already mentioned and not the commenter).
- \`Cmd+Enter\` (\`Ctrl+Enter\`) submits without reaching for the mouse.
- Authors and admins can delete a comment via the ✕ button.
`,
    links: [{ label: 'Open Tasks', path: '__TS__/tasks' }],
  },
  {
    id: 'projects',
    title: 'Projects — Setup & Edit',
    icon: '📁',
    audience: 'all',
    body: `
### Creating a project

On the Projects page, click **+ New Project**. Fill in:

- **Name + icon + color** — visual identifiers across the app.
- **Billing type**:
  - **⏱ Time & Materials (T&M)** — client pays per billable hour. Loss = cost > revenue.
  - **📜 Fixed bid** — client pays a flat *contract value*. Loss = cost > contract.
- **Contract value (₹)** — client-approved budget ceiling. **0** means no ceiling. For fixed-bid projects, this is required (it's how revenue is computed).

### Editing a project

On every project card / table row there's a **✏️** edit button. Use it to change billing type, contract value, name, color, etc. Existing tasks and plans aren't affected, but P&L recomputes the next time you load it.

### Why this matters

The contract value drives the **forecast loss** check: when an admin tries to approve a plan whose committed cost would exceed contract, they get a confirmation dialog with the overrun amount. See the Loss Model section below for the full math.
`,
    links: [{ label: 'Open Projects', path: '__TS__/projects' }],
  },
  {
    id: 'time-overview',
    title: 'Time Tracking — Big Picture',
    icon: '⏱',
    audience: 'all',
    body: `
The timesheet workflow has **5 stages**. Each stage has a clear owner.

\`\`\`
1. Project Owner    → creates a monthly plan
2. Admin            → approves the plan (rates freeze)
3. Project Owner    → allocates hours to employees per week
4. Employee         → logs daily time against their allocations
5. Project Owner    → approves each week's slice (Friday/Saturday)
\`\`\`

**Why it's structured this way:**

- **Budget gate at stage 1** — no time can be logged without an approved plan. This stops scope creep.
- **Hard cap at stage 4** — the system blocks an employee from logging more hours than they've been allocated.
- **Per-project, per-week approval at stage 5** — catches errors fast (within a 5-day cycle) instead of waiting till month-end.

### Mon–Fri only

Time entries on weekends are rejected at the API level. Weeks always run Monday–Friday.

### Hours type

Every plan line is **Billable** or **Non-Billable**. Billable hours generate revenue at the project's bill rate; non-billable hours are overhead (no revenue). The split is preserved end-to-end through allocations, time entries, and the P&L.
`,
  },
  {
    id: 'time-owner',
    title: 'Time — Project Owner Workflow',
    icon: '👔',
    audience: 'owner',
    body: `
### 1. Create a plan

Go to **Time → Plans → + New Plan**. Pick the project + month. Optionally set a custom plan name (e.g. "Marketing May 2026 — Phase 2"). If you don't set a name, it auto-generates as *"Project Month Year Approval"* — duplicates get a (#2), (#3) suffix.

### 2. Add lines to the plan

Each line = one (Task Type, Assignee, Billable/Non-billable) combination. Specify:
- **Task type** (e.g. Development, QA, Design)
- **Assignee bucket** — defaults from the user's rate bucket but can be overridden per line
- **Planned hours**
- **Distribution** — Continuous, Distributed, or Open

### 3. Submit for admin approval

Click **📤 Submit for Approval**. Rates freeze at this moment — even if you change a user's bucket later, the plan keeps the rates that were in effect at submission time.

### 4. Once approved → Allocate

The plan toolbar gets an **📅 Allocate hours** button. Clicking it auto-creates one Task per line and one weekly Allocation per (employee × week). Open **Allocations** to fine-tune the per-week split.

### 5. Friday — approve each employee's slice

Open **Time → Approvals → Weeks**. Each row = one employee × project for one week. Click **✅ Approve** if the hours look right; **❌ Reject** with a reason if not. Approved slices lock the actuals and feed the P&L.
`,
    links: [
      { label: 'Open Plans', path: '__TS__/time/plans' },
      { label: 'Week Approvals', path: '__TS__/time/approvals/weeks' },
    ],
  },
  {
    id: 'time-admin',
    title: 'Time — Admin (Plan Approval)',
    icon: '🛡',
    audience: 'admin',
    body: `
### The plan-approval queue

Open **Time → Approvals → Plans**. Each card shows:
- Project + month + total cost / revenue / margin
- Forecast contract status (if the project has a contract value)

### Approving

Click **✅ Approve**. **Heads-up**: if approving would push committed cost past the contract value, you'll see a confirmation dialog showing the exact overrun:

\`\`\`
⚠️ Forecast loss
Contract value: ₹5,00,000
Committed after approval: ₹5,80,000
Overrun: ₹80,000
\`\`\`

You can still proceed, but you've been warned.

### Rejecting

Click **❌ Reject** and write a reason (≥ 10 characters). The reason gets emailed/notified to the plan owner so they can fix and resubmit.

### After approval

The plan is locked: rates freeze, the title is final, and the project owner sees the **Allocate** button to start distributing hours to employees. You don't need to do anything else.
`,
    links: [{ label: 'Plan Approvals', path: '__TS__/time/approvals/plans' }],
  },
  {
    id: 'time-employee',
    title: 'Time — Employee Workflow',
    icon: '⌨️',
    audience: 'employee',
    body: `
### Daily — log your hours

Open **Time → My Timesheet**. The grid shows your allocations for the current week (Mon–Fri). Each cell = one (allocation × day).

- Type duration in any of these formats: \`2h\`, \`1h30m\`, \`90m\`, \`1.5\`, \`1:30\`.
- Click **Save** as you go (auto-saves on focus change too).
- The cell glows red if you'd exceed your weekly cap.

### Friday EOD — submit

Click **📤 Submit Week**. Each project you've logged on becomes its own *slice* and goes to the project owner's queue.

> ⚠️ If you forget, the system auto-submits all open periods Friday 9 PM onward — so even on weekends, your owner sees the data Sunday at the latest.

### What if your week is rejected?

You'll get a notification with the owner's reason. The slice flips back to Open — fix the entries, save, and re-submit. Status resets automatically.

### Allocation cap

The platform won't let you log more hours than you've been allocated. If you hit the cap, ping your project owner — they may need to top up the allocation or move scope to a different week.
`,
    links: [{ label: 'My Timesheet', path: '__TS__/time' }],
  },
  {
    id: 'pnl',
    title: 'P&L and the Loss Model',
    icon: '💰',
    audience: 'all',
    body: `
### How profit is calculated

\`\`\`
Profit = Revenue − Cost
Revenue (T&M)    = billable hours × bill rate
Revenue (fixed)  = contract value (flat)
Cost             = (billable + non-billable) hours × cost rate
\`\`\`

Cost includes BOTH billable and non-billable hours. Revenue only counts billable hours (or the flat contract value for fixed-bid).

### Where to see it

- **Projects page → 📊 button** on any card → **Project P&L** for the current month.
- **Plan Editor** → 📊 P&L button in toolbar → P&L scoped to that plan's month.
- **Dashboard → Finance & Time** tab → "Top 5 Most Profitable / Loss-Making" tables → click any row.

### The four loss buckets

The dashboard's "Loss this month" KPI takes the *worst* of:

1. **Realized loss** — actual cost > actual revenue (real money lost from logged time).
2. **Cost overrun** — actual cost > planned cost (burning faster than approved).
3. **Forecast loss** — planned cost > planned revenue (a plan was approved at a deficit).
4. **Contract overrun** — committed cost > client contract value (you've promised more than the client is paying for).

### Non-billable cost ≠ loss (usually)

Non-billable hours are cost-only — but they're typically intended overhead (internal reviews, sales support, training). The dashboard surfaces them as a separate **"Non-billable overhead"** KPI so you can see how much your billable side absorbs. As long as billable revenue covers it with margin, you're profitable even with significant NB hours.

### Export

On the P&L page, click **📥 PDF** for a one-page summary you can share with finance. **📥 Excel** is on the Plan Editor for the line-by-line breakdown.
`,
    links: [{ label: 'Finance Dashboard', path: '/dashboard?tab=finance' }],
  },
  {
    id: 'workflows',
    title: 'Workflows — Automation',
    icon: '⚡',
    audience: 'admin',
    body: `
### What workflows do

Workflows automate notifications and actions when something happens. Each rule has 3 parts:

1. **Trigger** — what fires it (task created, plan submitted, budget overrun, …)
2. **Conditions** — optional filters (only if status = "In Review", only for project X, …)
3. **Actions** — what to do (send notification, change status, create subtask, …)

### Built-in triggers

- **Task lifecycle**: created, status changed, assignee changed, moved to project, due date approaching, updated.
- **Plan / approval**: plan submitted, plan approved, plan rejected, budget overrun.

### Pre-seeded workflows

Open **Workflows** to see 10 default rules already wired up — e.g.:

| Trigger | Action |
|---|---|
| Task created | Notify assignee |
| Status → Completed | Notify admins |
| Plan submitted | Notify all admins |
| Budget overrun | Notify admins **+** project owner |

Toggle each on/off via the green pill switch. Edit (pencil icon) to change recipients — choose **Specific User** in the dropdown to ping a named person instead of a role.

### Logs

Click the document icon on any workflow card to see its execution history (last 50 runs).
`,
    links: [{ label: 'Open Workflows', path: '__TS__/workflows' }],
  },
  {
    id: 'org-members',
    title: 'Organization & Members',
    icon: '👥',
    audience: 'all',
    body: `
### Org Chart

The **Organization** page shows the full reporting hierarchy as a draggable chart. Edit nodes inline (admin only). Click any node to see managers + direct reports.

### Members directory

**Organization → Members** shows every employee — both User accounts (with login) and chart-only entries (people on the chart but no login yet).

For each member you see:
- Name, email, avatar, role (Admin / Member)
- Org role + department + manager (from the chart)
- **Cost rate** (from rate bucket)
- This-month workload: allocated, consumed, billable / non-billable hours, cost MTD, projects

### Admin: change a user's cost rate

Each card with a login has a purple-bordered **"✏️ Change cost rate"** dropdown. Pick a rate bucket; the change saves instantly. Existing approved plans keep their frozen rates — only NEW plans use the updated rate.

### Filters

- **Search** — name, email, role, department.
- **Department** — narrow to one team.
- **Kind** — "With login" (editable) vs "Chart only" (needs an invite).
- **Sort** — by name, role, cost (high→low), or allocated hours.
`,
    links: [
      { label: 'Org Chart', path: '/organization' },
      { label: 'Members', path: '/organization/members' },
    ],
  },
  {
    id: 'ai-assistant',
    title: 'AI Assistant',
    icon: '✨',
    audience: 'all',
    body: `
### What it can do

The ✨ button (bottom-right of every page) opens a full-screen chat. The assistant has:
- Read access to your live database (tasks, projects, plans, time entries, employees) — scoped to your active teamspace.
- The full product docs (this guide + the engineering PRDs) in its system prompt.

### Example queries

- *"Show me last week's data for Seyo project"*
- *"Who has the highest cost rate this month?"*
- *"What tasks did Suha complete this month?"*
- *"List all pending plan approvals"*
- *"How does weekly slice approval work?"* (answers from the docs)

### Streaming responses

Replies stream token-by-token as the model generates them — you see partial output immediately instead of staring at "..." for several seconds. Tool-call results (e.g. when the assistant fetches your live data) also stream in mid-answer with a 🔧 disclosure so you can audit what was queried.

### Chat history

Every conversation is auto-saved to your browser's local storage and grouped by **Today / Yesterday / This week / Earlier**. Click any past chat to resume it. Use the search bar to find a chat by title or content. Hover any conversation → ⋯ menu for **Rename** and **Delete**. The footer has a "Clear all" button if you want to start fresh.

### Privacy note

Your messages + tool-call results go to Google's Gemini API. Don't paste secrets (API keys, passwords) into chat.
`,
    links: [{ label: 'Open AI Assistant', path: '/ai' }],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: '🔔',
    audience: 'all',
    body: `
### Where they show up

- **Bell icon** in the top-right header — quick dropdown with the 10 most recent.
- **Full notifications page** at \`/notifications\` — filter pills (All / Unread / Tasks / Time / Budget), grouped by day, mark-all-read, per-row delete.

### What triggers them

| Type | When |
|---|---|
| task_assigned | A task is assigned to you |
| status_changed | Status of one of your tasks changes |
| comment_mention | Someone @mentions you on a task comment |
| task_comment | A new comment is posted on a task assigned to you |
| plan_submitted | (Admins) A plan needs your approval |
| plan_approved | (Owners) Your submitted plan was approved |
| plan_rejected | (Owners) Your plan was rejected — reason in the message |
| time_submitted | (Owners) An employee submitted their week for your project |
| time_overdue | (Members) Friday EOD — you haven't submitted yet |
| budget_overrun | A plan's actual cost crossed planned cost |
| workflow_notification | Custom rules built in the Workflows page fire |

### Mute what you don't want

Open **Profile → 🔔 Notification preferences**. Toggle any of the 15 notification types off and the system silently skips creating new ones for you. Existing notifications aren't deleted.

### Weekly email digest

Every **Friday at 18:00**, anyone with a registered email gets a one-page summary of their week — completed tasks, in-flight tasks, unread notification count. Mute it via Profile → Notification preferences → "Weekly digest" off.

### Click-through

Most notifications link to the relevant page when clicked (task detail, approval queue, etc.).
`,
    links: [
      { label: 'Open Notifications', path: '/notifications' },
      { label: 'Profile', path: '/profile' },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts & Cmd+K',
    icon: '⌨️',
    audience: 'all',
    body: `
### Global shortcuts

| Key | What it does |
|---|---|
| \`Cmd/Ctrl + K\` | Open command palette — search anything, jump anywhere |
| \`Cmd/Ctrl + /\` | Open this user guide |
| \`Cmd/Ctrl + .\` | Open AI assistant |
| \`?\` | Open this guide (when not typing in an input) |
| \`Esc\` | Close palette / chat / modal |

### Cmd+K command palette

Press **\`Cmd+K\`** anywhere in the app to open a search-everything bar. The palette searches across:

- **Navigation actions** — "Go to Tasks", "Go to Plans", "Open AI Assistant", etc.
- **Tasks** — match on title, ID, assignee, or status. Picking one opens it directly.
- **Projects** — picking opens the project's P&L for the current month.
- **Members** — picking opens the Members directory.

Use \`↑\`/\`↓\` to navigate results, \`Enter\` to select, \`Esc\` to dismiss. The palette pre-loads tasks, projects, and members when opened so search is instant.
`,
  },
  {
    id: 'audit-activity',
    title: 'Audit Log & Activity Feed',
    icon: '📜',
    audience: 'admin',
    body: `
Two views into "what's happened in this teamspace":

### Activity feed — \`/t/<ts>/activity\`

A unified, day-grouped timeline merging:

- **📜 Audit events** — every plan submit/approve/reject, line edit, allocation change, period flip, slice approval.
- **⚡ Workflow runs** — successful trigger executions from the Workflows page.
- **🔔 Notifications** — system + custom alerts that fired in the window.

Use the **days dropdown** (24h / 7d / 14d / 30d / 90d) and the **source filter** to scope. Search bar filters by actor / title / kind.

### Audit log — \`/t/<ts>/time/audit\`

Forensic-grade log of every state change on the timesheet entities. Filter by:

- **Entity type** — plan, plan-line, allocation, time-entry, period, slice
- **Action** — create, update, delete, submit, approve, reject, reopen, admin_override
- **Date range**
- **Free-text search** — actor name, rejection reason, action

Each row shows the actor + role, the action with a colored badge, and a click-to-expand **field-by-field diff** of what changed. Use this for finance / compliance signoff.
`,
    links: [
      { label: 'Activity Feed', path: '__TS__/activity' },
      { label: 'Audit Log', path: '__TS__/time/audit' },
    ],
  },
  {
    id: 'exports',
    title: 'Exports — PDF / Excel / CSV / JSON',
    icon: '📥',
    audience: 'all',
    body: `
### Project P&L → PDF

On any project's P&L page, click **📥 PDF** in the toolbar. You get a one-page A4 summary with the contract panel, billable / non-billable split, planned vs actual, and the list of plans rolled up.

### Plan → Excel

On the Plan Editor toolbar, click **📥 Excel**. Downloads the line-by-line breakdown matching the format from the original spec sheets.

### Time entries → CSV / JSON

On the Time Dashboard (Finance & Time tab), click **📊 Entries CSV**. Streams every time entry in the selected month with: date, user, email, project, task, hours, billable, cost, revenue, status, notes. Useful for payroll ingest or BI tools.

For JSON instead, use the URL with \`?format=json\`:
\`\`\`
/api/time/export/entries?from=2026-05-01&to=2026-05-31&format=json
\`\`\`

### Plans → CSV

Right next to it, **📋 Plans CSV** dumps every plan for the month with totals, status, submitter, approver. Same \`?format=json\` flag works.

> 💡 All export endpoints are JWT-gated — they accept the token via Authorization header OR \`?token=...\` query param.
`,
    links: [{ label: 'Time Dashboard', path: '/dashboard?tab=finance' }],
  },
  {
    id: 'profile-settings',
    title: 'Profile & Personal Settings',
    icon: '🙂',
    audience: 'all',
    body: `
Open **Profile** from the sidebar. Beyond your name, email, and avatar, you can configure:

### Contact & availability

- **Phone** — for urgent escalation, not currently used by automation.
- **Slack handle** — \`@username\` or full URL. Surfaced on the Members page.
- **Timezone** (IANA name like \`Asia/Kolkata\`, \`Europe/London\`). Drives "today" calculations on My Timesheet so users in non-UTC zones don't accidentally land on tomorrow's UTC date.
- **Working hours** — start, end, weekdays-only checkbox. Used for "available now?" indicators (planned).
- **Bio** — short description / current focus.

### Notification preferences

15 toggles for every notification type. Mute the categories you don't care about. Toggling off stops creating new in-app notifications of that type — existing ones aren't deleted. Includes a **Weekly digest** toggle that turns off the Friday email.

### Avatar

Click the avatar to upload a new one. Stored under \`/uploads/\` and served via JWT-gated static serving. The same avatar shows in the Members directory, comments, task assignee dropdowns, and the header.

### Sign out

Bottom of the page. Clears the JWT and refreshes — you're returned to the login screen.
`,
    links: [{ label: 'Open Profile', path: '/profile' }],
  },
  {
    id: 'troubleshooting',
    title: 'FAQ & Troubleshooting',
    icon: '🛠',
    audience: 'all',
    body: `
**"I can't create a task in project X"**
You don't have an active allocation in that project. Ask the project owner to allocate hours to you first via Time → Plans → Allocate.

**"My week is showing 0 slices to approve"**
Either no employee has logged hours yet, or they haven't clicked Submit Week. The system auto-submits open periods Friday 9 PM through Sunday — wait until then or manually nudge the employee.

**"The Loss this month KPI is ₹0 but I have non-billable hours"**
Correct. Non-billable cost is already deducted from your planned profit. Loss is only > 0 when revenue can't cover cost. The "Non-billable overhead" KPI shows how much NB cost you absorb.

**"AI Assistant says 'Stream failed'"**
Usually a stale browser session. Hard-refresh (Cmd+Shift+R), make sure you're logged in, and try again. If it persists, check that the backend has \`GEMINI_API_KEY\` set in \`.env\`.

**"I forgot my password"**
Click **Forgot Password** on the login page. You'll get an email with a 1-hour reset link. In dev mode without SMTP, the link prints directly in the API response.

**"Where's the dark/light theme toggle?"**
Bottom of the sidebar — sun/moon icon next to Logout.

**"How do I export reports for finance?"**
- Per-project P&L → 📥 PDF on the P&L page.
- Per-plan line breakdown → 📥 Excel on the Plan Editor.
- Bulk CSV (all entries / all plans for a month) → buttons on the Finance dashboard.
- Custom data → ask the AI Assistant; it returns markdown tables you can copy-paste into Excel/Sheets.

**"My timezone is wrong / dates are off by a day"**
Open **Profile**, set your **Timezone** to your IANA name (e.g. \`Asia/Tokyo\`, \`America/New_York\`), and save. The My Timesheet page will then compute "this week" using your local time.

**"I'm getting too many notifications"**
**Profile → Notification preferences** has a toggle per notification type. Mute what you don't care about. The Friday digest email is also togglable from there.

**"Cmd+K isn't doing anything"**
Make sure you're not focused inside a textarea — most apps swallow shortcuts when you're typing. Click outside any input first, then press \`Cmd+K\`. On Linux/Windows it's \`Ctrl+K\`.

**"The audit log is showing diffs that look weird (\`{$type: ...}\`)"**
Some Mongoose-internal fields surface in the before/after blobs. They're harmless — focus on the named fields (status, allocatedHours, etc.).
`,
  },
];

export default function HelpPage() {
  const navigate = useNavigate();
  const { activeTeamspaceId } = useTeamspace();
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase().includes('admin') || String(user?.role || '').toLowerCase().includes('owner');

  const [active, setActive] = useState('getting-started');
  const [search, setSearch] = useState('');
  const sectionRefs = useRef({});

  const filtered = useMemo(() => {
    if (!search.trim()) return SECTIONS;
    const q = search.toLowerCase();
    return SECTIONS.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.body.toLowerCase().includes(q)
    );
  }, [search]);

  // Resolve {{TS_LINK}} / __TS__ tokens at render time
  const resolveLink = (path) => {
    if (!path) return '#';
    if (path.startsWith('__TS__')) return path.replace('__TS__', `/t/${activeTeamspaceId}`);
    return path;
  };

  // Scroll active section into view when clicked from TOC
  const jumpTo = (id) => {
    setActive(id);
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Highlight section as user scrolls (basic: nearest to top)
  useEffect(() => {
    const handler = () => {
      const containers = Object.entries(sectionRefs.current);
      let best = active;
      let bestDist = Infinity;
      for (const [id, el] of containers) {
        if (!el) continue;
        const dist = Math.abs(el.getBoundingClientRect().top - 120);
        if (dist < bestDist) { best = id; bestDist = dist; }
      }
      if (best !== active) setActive(best);
    };
    const scroller = document.querySelector('.help-content');
    if (scroller) scroller.addEventListener('scroll', handler, { passive: true });
    return () => { if (scroller) scroller.removeEventListener('scroll', handler); };
  }, [active]);

  return (
    <div className="help-page">
      {/* TOC sidebar */}
      <aside className="help-toc">
        <div className="help-toc-head">
          <h2>📘 User Guide</h2>
          <p className="muted">Learn how to use Mayvel Task</p>
        </div>
        <div className="help-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            placeholder="Search the guide…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <nav className="help-toc-list">
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: 12, fontSize: '0.78rem' }}>No matches.</div>
          ) : filtered.map(s => (
            <button
              key={s.id}
              className={`help-toc-item ${active === s.id ? 'active' : ''}`}
              onClick={() => jumpTo(s.id)}
            >
              <span className="help-toc-icon">{s.icon}</span>
              <span className="help-toc-title">{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="help-toc-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>← Back to app</button>
        </div>
      </aside>

      {/* Content */}
      <main className="help-content">
        <div className="help-content-inner">
          <header className="help-hero">
            <h1>Welcome to Mayvel Task</h1>
            <p>Everything you need to navigate the platform — from logging your first hour to approving a multi-lakh project plan.</p>
            <div className="help-hero-quick">
              <button className="help-quick-btn" onClick={() => jumpTo('getting-started')}>🚀 Getting started</button>
              <button className="help-quick-btn" onClick={() => jumpTo('time-overview')}>⏱ Time tracking</button>
              <button className="help-quick-btn" onClick={() => jumpTo('pnl')}>💰 P&L & Loss</button>
              <button className="help-quick-btn" onClick={() => jumpTo('shortcuts')}>⌨️ Cmd+K & shortcuts</button>
              <button className="help-quick-btn" onClick={() => jumpTo('ai-assistant')}>✨ AI assistant</button>
            </div>
          </header>

          {filtered.map(s => {
            // Skip admin-only sections for non-admins to reduce noise — they can still search for them.
            if (s.audience === 'admin' && !isAdmin && !search) return null;
            return (
              <section
                key={s.id}
                id={s.id}
                ref={el => { sectionRefs.current[s.id] = el; }}
                className="help-section"
              >
                <h2 className="help-section-title">
                  <span>{s.icon}</span>
                  <span>{s.title}</span>
                  {s.audience !== 'all' && (
                    <span className={`help-audience help-audience-${s.audience}`}>
                      {s.audience === 'admin' ? 'Admin' : s.audience === 'owner' ? 'Project Owners' : 'Employees'}
                    </span>
                  )}
                </h2>
                <div className="help-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
                </div>
                {s.links && s.links.length > 0 && (
                  <div className="help-jumps">
                    {s.links.map(l => (
                      <button key={l.label} className="help-jump-btn" onClick={() => navigate(resolveLink(l.path))}>
                        Jump to: {l.label} →
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          <footer className="help-foot">
            <p>Still stuck? Ping the AI assistant (✨ button) — it can answer ad-hoc questions about your data and the docs.</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
