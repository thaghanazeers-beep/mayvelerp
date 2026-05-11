# Product Requirements Document (PRD)
## Mayvel Task — Workspace Management Platform

> Snapshot taken just before the ERP version branch. Reflects the live state of the codebase, the contents of MongoDB at the time the pre-ERP backup was taken (`Task_backup_pre_erp_20260510_084334Z.tar.gz`), and every feature added in this iteration.

---

### 1. Overview

**Name:** Mayvel Task
**Description:** A Notion-inspired workspace platform for cross-functional teams. Combines task / project / sprint management, an org-chart with role-aware permissions, a Notion-style document editor for tasks (with file preview), workflow automation, and Notion-import tooling, all behind a teamspace-scoped permission model.
**Target users:** Cross-functional product / engineering / design teams who currently live in a mix of Notion + Jira + email and want one tool with deep links, roles, and automation.

---

### 2. Tech Stack

**Frontend** (`/frontend`)
- React 19 + Vite 8 + ES Modules.
- Routing: `react-router-dom` v7 with deep-link, Notion-style URL scheme.
- State: React Context (`AuthContext`, `ThemeContext`, `TeamspaceContext`, `OrgContext`).
- Charts: `recharts`.
- Org-chart canvas: custom DOM + SVG (not React Flow).
- File preview: `xlsx` (SheetJS) for Excel/CSV, `mammoth` for Word, `pptx-preview` for PowerPoint, browser-native iframes for PDF/text.
- Bootstrap 5 imported globally for utility classes (custom rules in `index.css` override its `.modal` / `.card` / `.table` defaults so they're theme-aware).

**Backend** (`/backend`)
- Node 22 + Express 5.
- Mongoose 9 against MongoDB 8 (data dir `~/.local/var/mongo/data`).
- JWT auth (`jsonwebtoken`).
- File uploads: `multer` (50 MB cap, sanitized filenames).
- Email: `nodemailer` — automatically falls back to an Ethereal dev inbox if `SMTP_USER` env var isn't set.
- Notion integration: `@notionhq/client`.

**Local toolchain**
- Node 22.11 → `~/.local/opt/node` (no system install).
- MongoDB 8.0.4 community → `~/.local/opt/mongodb` (forked daemon).
- All install state self-contained in `~/.local/opt/`; nothing in `/usr/local` or homebrew.

---

### 3. URL Scheme (Routing)

Every navigation produces a real URL — bookmarkable, shareable, browser-back/forward friendly.

```
/                                                  → redirect to last teamspace (or /dashboard)
/dashboard                                         → org-wide KPI dashboard
/profile                                           → current user profile
/organization                                      → org chart editor
/t/:teamspaceId                                    → teamspace home (Tasks)
/t/:teamspaceId/tasks                              → tasks list
/t/:teamspaceId/tasks/:taskId                      → task detail (legacy URL)
/t/:teamspaceId/sprints                            → sprints
/t/:teamspaceId/projects                           → projects
/t/:teamspaceId/projects/:projectId                → project detail
/t/:teamspaceId/workflows                          → workflows
/t/:teamspaceId/team                               → members
/t/:teamspaceId/control                            → teamspace settings (rename / icon / delete)
/<project-slug>/<sprint-slug>/<task-slug>-<24hex>  → Notion-style pretty task URL
                                                     (e.g. /seyo-product-and-design/s2-3-26/seyo-mascot-video-6a002b4f15a3a2cd41f5f8a0)
                                                     The trailing 24-hex Mongo _id is what resolves; the slugs are cosmetic and changing the title doesn't break old links.
```

Implementation: `App.jsx` `<Routes>`, `TeamspaceSync` component syncs URL `:teamspaceId` into context, helper at [`frontend/src/utils/slug.js`](frontend/src/utils/slug.js) builds and parses the pretty URL.

---

### 4. Auth & Identity

- **Signup / Login** via `/api/auth/signup` and `/api/auth/login`. Passwords stored in plaintext (mock setup; `User.js` line 6 documents this).
- **JWT** issued at login, sent on every API call via axios interceptor. Token + user object also persisted to localStorage for refresh-survival.
- **Forgot / Reset password** flow:
  - `/api/auth/forgot-password` — generates a 32-byte hex token, 1-hour expiry, generic response (no enumeration leak), sends email via configured SMTP or Ethereal.
  - `/api/auth/reset-password` — validates token + expiry, updates password, returns a fresh JWT for auto-login.
  - AuthPage handles 4 modes: `login`, `signup`, `forgot`, `reset` (enters reset mode automatically when URL has `?reset=<token>`).
- **401 handler**: axios response interceptor clears stored credentials and reloads exactly once (no infinite redirect loops).

---

### 5. Teamspaces (Tenancy Model)

Every resource (task, project, sprint, workflow, page, org chart) belongs to a teamspace. Membership is required to read/write its data.

- **Teamspace CRUD** at `/api/teamspaces` (POST/PUT/DELETE).
- **TeamspaceMembership** model joins users ↔ teamspaces with `role: 'admin' | 'member' | 'viewer'`, `status: 'active' | 'pending' | 'removed'`, `invitedBy`. Compound unique index on `(userId, teamspaceId)`.
- **Active teamspace** persisted in localStorage (`mayvel_activeTeamspace`); axios interceptor injects it as `x-teamspace-id` header on every request, so backend handlers always have a teamspace even when call sites omit it from the body.
- **`requireTeamspaceMembership`** middleware gates writes. **`requireRole('admin')`** gates admin-only operations (e.g. invite / remove member).
- All CRUD POST handlers fall back to `req.teamspaceId` (set by middleware) when the body doesn't include it — so simple frontend calls like `updateTask(id, {status})` work without leaking teamspace plumbing into every call site.

---

### 6. Tasks

#### Data model (`models/Task.js`)
`id` (string, e.g. `notion_<32hex>` or `task_<ts>`), `notionId`, `title`, `description` (JSON-stringified array of editor blocks), `status`, `priority`, `assignee` (string name), `dueDate`, `startDate`, `estimatedHours`, `actualHours`, `taskType[]`, `projectId` (Mongo ObjectId of Project), `sprintId` (ObjectId), `parentId` (for subtasks), `notionProjectId`, `notionSprintId`, `attachments[]`, `customProperties[]`, `teamspaceId` (required, indexed).

#### Tasks list view
- **Three view types** via tabs: Board (Kanban), List, Table — persisted in localStorage.
- **Filters**: assignee, project, sprint, status, priority, due-date range, search; persisted per filter in localStorage (`mf_*`).
- **Sprint quick-pills** above the toolbar (Notion-style): "All tasks", "Current: <name>" (active sprint), "Last: <name>" (most recent completed), then up to 4 more recent sprints inline.
- **Group by** dropdown: None / Assignee / Status / Project / Priority / Sprint. When set, the table view renders Notion-style collapsible groups with avatar (for assignee groups) + name + count chip; sorted by descending task count.
- **Bulk select** with sprint reassignment.

#### Task detail page
A full-page view (route, not modal) with a Notion-style block editor.

- **Hero meta strip** below the title: status pill (with colored dot), priority chip (color-coded), assignee chip (avatar + name), due-date pill (turns red if overdue), hours (`actual/estimated`).
- **Topbar breadcrumb**: `Project › Sprint › Task title`.
- **Block editor** (description): text, heading, bullet, numbered, checkbox, quote, code, callout, divider, toggle. Slash menu for inserting blocks. Auto-save 800ms after edit.
- **Attachments section**:
  - Card-grid layout (responsive `auto-fill, minmax(160px, 1fr)`).
  - Image attachments render as thumbnails; PDFs/docs/videos/audio get type-appropriate icons.
  - **Drag-and-drop file upload** zone (highlighted with primary outline on dragover).
  - Inline preview modal opens on click — supports image (`<img>`), PDF (`<iframe>`), video (`<video>`), audio (`<audio>`), text (`<iframe>`), Excel/CSV (`xlsx` library, multi-sheet tabs), Word `.docx` (`mammoth`), PowerPoint `.pptx` (`pptx-preview`).
  - Preview header has Download + Open-in-new-tab buttons. Esc / backdrop-click closes.
- **Sidebar grouped sections**: Status (status + priority + Submit-for-Review action), People (assignee dropdown), Timeline (due date + side-by-side est/actual hours + progress bar), Context (project + sprint + created date), Danger (delete).
- **Review banner** (top of page):
  - Awaiting-your-review banner with green Approve / red Reject buttons (visible to admins when status is "In Review").
  - Rejected banner with "Start Rework" action (visible to assignee).
  - Both styled as proper cards with colored left-border accents, SVG icons, title + subtitle, and CTA-placement-correct button order.
- **Subtasks**: nested tasks with `parentId`, status badges, click to drill in.

#### Task CRUD endpoints
- `GET /api/tasks?teamspaceId=&status=&priority=&assignee=&projectId=&sprintId=&pageId=&search=&limit=&skip=`
- `POST /api/tasks` (auto-fires `task_created` workflow trigger)
- `PUT /api/tasks/:id` — status changes auto-create notifications (review-requested, approved, rejected) and fire `status_changed` workflow trigger; assignee changes fire `assignee_changed`; project moves fire `task_moved_to_project`.
- `DELETE /api/tasks/:id`

---

### 7. Projects

#### Data model (`models/Project.js`)
`name` (required), `description`, `color`, `icon`, `createdBy`, `createdDate`, `teamspaceId` (required), `status`, `notionId` (indexed, for idempotent re-imports).

#### Endpoints
- `GET /api/projects?teamspaceId=` — returns projects with `taskCount` rolled up.
- `POST/PUT/DELETE /api/projects[/:id]`. Delete unsets `projectId` on associated tasks.

---

### 8. Sprints

#### Data model (`models/Sprint.js`)
`name`, `goal`, `projectId`, `status: 'planned' | 'active' | 'completed'`, `startDate`, `endDate`, `completedAt`, `teamspaceId`, `notionId`.

#### Endpoints
- `GET /api/sprints?teamspaceId=&status=&projectId=` — includes `taskCount`, `doneCount`, `totalPoints` (sum of `estimatedHours`).
- `GET /api/sprints/:id` — sprint + its tasks.
- `POST /api/sprints/:id/start` — flips to active, deactivates other active sprints in the same project.
- `POST /api/sprints/:id/complete` — flips to completed; optional `rolloverSprintId` body param moves all incomplete tasks to a target sprint.
- `POST /api/sprints/:id/tasks` / `DELETE /api/sprints/:id/tasks/:taskId` — add / remove a task from a sprint.
- `POST /api/sprints/notion/sync` — legacy sync from Notion (single DB).

---

### 9. Org Chart

#### Data model (`models/OrgChart.js`)
One chart per teamspace (or one global with `teamspaceId: null`). `nodes[]` and `edges[]` schemas: `id`, `name`, `orgRole`, `department`, `memberId` (optional User._id link), `x`, `y`, `w`, `h`. Edges: `id`, `from`, `to`.

#### Editor (`pages/OrgChartPage.jsx`)
- Custom canvas with pan + zoom (mouse wheel zoom, drag-empty-space pan).
- Each node card has always-visible action buttons (Add child / Edit / Duplicate / Delete) in a toolbar at top-right of the card.
- **Single-click** a node body opens the edit modal directly (4-pixel movement threshold distinguishes click from drag).
- **Drag** moves the node; new position auto-saves 700ms after mouse-up.
- **Re-parent** via "Move under" dropdown in the edit modal.
- Every action (Add / Edit / Delete / Duplicate / Re-parent / drag-stop) **auto-persists** to `/api/orgchart`. Toolbar Save Chart button kept as a manual safety net.
- **Role color coding**: 13 role buckets (Founder/CEO/CTO/COO/CFO/Director/Manager/Lead/Designer/Developer/Consultant/Intern/Marketing/Member/Admin/Team Owner) each with their own background + border color.

#### Endpoints
- `GET /api/orgchart?teamspaceId=` — returns the chart for the teamspace, or empty `{nodes: [], edges: []}`.
- `PUT /api/orgchart` — upserts; body: `{nodes, edges, teamspaceId, updatedBy}`.
- `GET /api/orgchart/hierarchy/:memberId?teamspaceId=` — returns the node, full manager chain (walking up), direct reports, and all subordinates (recursive). Used by `OrgContext` for permission helpers (`isManagerOf`, `getDirectReports`, `getAllSubordinates`, `isCLevel`, `isManagement`, `canManage`).

#### Seed
[`scripts/loadOrgChartV2.js`](backend/scripts/loadOrgChartV2.js) bulk-loads the Mayvel Org Chart V2 PDF structure (67 nodes, 66 edges) using a Reingold-Tilford-ish tree layout so it renders cleanly without manual dragging.

---

### 10. Team Members

- **`GET /api/team?teamspaceId=`** — populated active memberships with user details + role.
- **`POST /api/team/invite`** (admin only) — find-or-create user, find-or-create membership, email invite (or surface temp password in response if SMTP off).
- **`DELETE /api/team/:id`** (admin only) — soft-removes membership (`status: 'removed'`), doesn't delete the user.
- **`POST /api/users/:id/avatar`** — multer single-file upload, returns full URL.
- **`PUT /api/users/:id`** — update profile.

---

### 11. Notifications

#### Data model (`models/Notification.js`)
`type`, `title`, `message`, `taskId`, `taskTitle`, `userId` (recipient name string), `actorName`, `read`, `createdAt`.

#### Triggers
- Task submitted for review → notifies all admins.
- Task approved (In Review → Completed) → notifies the assignee.
- Task rejected → notifies the assignee.
- Task assigned (assignee changes) → notifies the new assignee.

#### UI
- Bell icon in the header polls `/api/notifications` every 5s; unread badge.
- Dropdown shows the latest 50; clicking a notification with a `taskId` navigates to `/t/<activeTeamspaceId>/tasks/<taskId>`.
- Mark-one-read and mark-all-read endpoints.

---

### 12. Workflow Engine

#### Data model (`models/Workflow.js`)
`name`, `enabled`, `trigger: { type, config }`, `actions[]`, `teamspaceId`. `WorkflowLog` records every fire.

#### Triggers
- `task_created`
- `status_changed` (with `fromStatus` / `toStatus` filter)
- `assignee_changed`
- `task_moved_to_project`
- `task_updated`
- `due_date_approaching` (scheduled hourly via `setInterval`)

#### Actions
Update fields, send notifications, reassign tasks (extensible).

#### Endpoints
- `GET /api/workflows?teamspaceId=`, full CRUD, plus `POST /api/workflows/:id/toggle`, `POST /api/workflows/:id/run` (manual fire on a chosen task), `GET /api/workflows/:id/logs`, `GET /api/workflow-logs` (last 100 across all workflows).

---

### 13. Email

- Configurable SMTP via env (`SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `APP_URL`).
- If `SMTP_USER` isn't set, the backend automatically calls `nodemailer.createTestAccount()` at boot and logs the Ethereal inbox URL/user/pass to stdout. Reset emails and team invites both go through this transporter; the API response includes a `previewUrl` (the Ethereal preview link) when in Ethereal mode so the dev can view what the recipient would have seen.

---

### 14. File Uploads & Documents

- **Generic upload endpoint**: `POST /api/uploads` (multer, 50 MB cap). Filenames are sanitized at save (`safeFilename()` strips spaces / parens / unsafe chars) so served URLs are URL-safe.
- **Static serving**: `app.use('/uploads', express.static(uploadsDir))` exposes `~/.../backend/uploads/<filename>`.
- **Frontend wrapper**: `uploadFile(file)` posts to `/api/uploads`, returns `{url, name, sizeBytes, mimeType}`. Used by TaskDetail attachments.
- **Inline preview** in TaskDetail (see §6, Task Detail).

---

### 15. Notion Importers (`backend/scripts/`)

| Script | Purpose |
|---|---|
| `importLast3Months.js` | Pulls the Notion **Tasks** data source (last 3 months by `created_time`) into Mongo `tasks` with notion-id linkage. |
| `importProjectsAndSprints.js` | Pulls **Projects** + **Design Sprints** data sources, upserts by `notionId`, then backfills `tasks.projectId` / `tasks.sprintId` from each task's `notionProjectId` / `notionSprintId`. |
| `backfillTaskDescriptions.js` | For every task with a `notionId`, fetches the page's child blocks and writes them as JSON into `task.description` so the block editor renders Notion content. |
| `backfillTaskAttachments.js` | For every task with a `notionId`, walks blocks for image/file/pdf/video, downloads each Notion-S3 file to `/uploads`, attaches to `task.attachments`, and strips the URL out of the description. Idempotent via `attachment.notionBlockId`. |
| `importNotion.js` | Older general-purpose discovery + page importer (token revoked; left for reference). |
| `loadOrgChartV2.js` | Loads the Mayvel Org Chart V2 PDF structure into Mongo OrgChart. |
| `dumpDb.js` | Exports every collection in `mayvel_task` as JSON for backup. |
| `fixProjects.js` | Legacy migration utility. |

Notion API token is hardcoded into the import scripts; rotate via env var `NOTION_TOKEN` if/when needed.

---

### 16. UI / Theme

- **Design tokens** in [`index.css`](frontend/src/index.css): semantic CSS variables for surfaces, brand, semantic colors, typography, borders, geometry, shadows, motion. Light theme overrides via `[data-theme="light"]`.
- **Theme is set synchronously** in `index.html` (script tag reads `mayvel_theme` from localStorage and sets `data-theme` on `<html>` *before* React mounts) — eliminates dark→light flash on page load.
- **Bootstrap overrides**: explicit rules in `index.css` remap Bootstrap's `--bs-table-*` variables to ours and override `.modal { display: none }`, `.card`, `.text-muted`, `.bg-dark`, `.text-white`, `.form-control` so they're theme-aware.
- **Inter font** loaded via Google Fonts `@import` at top of `index.css`.

---

### 17. Persistence Layout

```
Mongo:  mayvel_task @ mongodb://localhost:27017
        Collections: users, teamspaces, teamspacememberships, tasks, projects,
                     sprints, workflows, workflowlogs, notifications, pages,
                     orgcharts, propertydefinitions

Files:  ~/Volumes/Antigravity/antigravity/Task/backend/uploads/   (93 files, 470 MB)
        Filename format: <unix-ms>-<random6>-<sanitized-original>.<ext>

LocalStorage keys (frontend):
  - mayvel_user, token                    (auth)
  - mayvel_theme                          (dark | light)
  - mayvel_activeTeamspace                (active teamspace _id)
  - tasks_views                           (Tasks page view tabs)
  - mf_assignee, mf_project, mf_sprint, mf_status, mf_priority, mf_dateFrom, mf_dateTo, mf_groupBy   (Tasks filters)
  - mayvel_orgchart                       (org chart local snapshot)
```

---

### 18. Backups

- Pre-ERP backup tarball: **`/Volumes/Antigravity/antigravity/Task_backup_pre_erp_20260510_084334Z.tar.gz`** (375 MB).
- Includes: full source tree, the 93 uploaded files, JSON dump of all 12 collections (237 tasks, 35 projects, 58 sprints, 7 users, 6 memberships, 1 teamspace, 1 org chart, 0 in workflows / pages / notifications / propertydefinitions / workflowlogs).
- Excludes: `node_modules`, `build`, `dist`, `.dart_tool`, iOS/Android build caches, `.idea`, `.DS_Store`.
- Restore guide is in the previous chat turn that produced the tarball, plus `db_dump/_manifest.json` includes the exact dump timestamp and Node version.

---

### 19. Known Limitations

- **Plaintext passwords** in Mongo (mock setup; bcrypt is in `package.json` but unused).
- **Static file serving** of `/uploads/*` is **not auth-protected** — anyone who can reach the backend can fetch any file by URL.
- **Notion file URLs** in scripts/imports expire ~1 hour after fetch — that's why we re-host locally instead of storing the s3 URL.
- **Cross-teamspace deep links**: opening a pretty task URL while a different teamspace is active falls back to legacy URL until tasks load (no global task lookup yet).
- **PowerPoint preview** quality depends on `pptx-preview`'s rendering — fonts, animations, SmartArt, embedded videos are limited or absent. Server-side LibreOffice→PDF conversion is the durable answer if/when needed.
- **Bootstrap is still imported globally** even though the codebase doesn't use Bootstrap components — keeps the bundle bigger than necessary, and we have to override Bootstrap rules where they collide. Worth removing if a future cleanup pass takes it on.
- **`Rejected → reset`** workflow doesn't auto-clear the rejected status on next edit — assignee must click Start Rework.

---

### 20. Roadmap (Pre-ERP)

The next branch (ERP version) will add:
- Inventory / SKU management
- Purchase orders & vendors
- Invoices & payments
- HR/payroll modules tying into the existing org chart (`OrgChart` already has `memberId` linking nodes to `User._id`, so reporting lines can drive approval flows).
- Finance dashboard rolling up the above into the existing Dashboard page.

This document is the snapshot of "what existed *before* that branch starts."

---

## 21. Changelog — Post-ERP additions (2026-05-10, evening)

This section captures everything added/changed after the original PRD was written today (14:18) — same day, in the same shipping push. Anything in §1–§20 above remains accurate; this is purely additive.

### 21.1 New page — Organization Members (`/organization/members`)

A full-page directory of every employee, sourced from the Org Chart **and** the User table.

- **Why**: the org chart shows boxes but doesn't surface cost rate, current-month workload, or who has a login vs. who doesn't.
- **Endpoint**: `GET /api/organization/members?month=YYYY-MM` — joins `User` + `OrgChart` + `RateBucket` + this-month `Allocation` + `TimeEntry`. Returns split counts (`withAccount`, `chartOnly`).
- **Page features**: card / table view toggle, search (name/email/role/dept), department filter, kind filter (`with login` / `chart only`), sort by name/role/cost/allocated.
- **Per-card data**: avatar, email (or "No login account"), org role, department, manager (resolved from chart edges), cost rate (e.g. `₹1,250/hr · Senior`), this-month allocated/consumed/cost/projects mini-stats, expand-for-detail with billable vs non-billable hour split + project chip list.
- **"Chart only" pill**: members that exist on the org chart but have no User account (so they can't be allocated/log time yet) — surfaces who needs an invite.
- **Sidebar**: nested under Organization. **Cross-link button**: "👥 Members list" on the Org Chart toolbar.

### 21.2 Org Chart V2 loader (`backend/loadOrgChartV3.js`)

Replaced the empty/V1 chart with the V2 PDF the user uploaded. **63 nodes, 71 edges, 44 unique people, 19 division headers.**

- **Schema repurpose**: `orgRole = 'Division'` marks structural header nodes (Seyo, MHS, Bacsys, etc.) so the Members API can filter them out (they're not employees).
- **Multi-role people**: nodes are deduplicated (Murali = 1 node, Ravi = 1 node, Deva = 1 node, Saravanakumar = 1 node), with `EXTRA_EDGES` capturing their secondary roles (e.g. `ceo → div_mhs` because Murali is also MHS Account Manager).
- **Auto-link**: chart names are matched against existing User accounts (case-insensitive, normalized whitespace). Re-run the script whenever new users are added so they relink to their chart node.

### 21.3 Notifications

- **Full notifications page** at `/notifications` (was bell-dropdown only). Filter pills (All / Unread / Tasks / Time / Budget), grouped by day, mark-all-read, per-row delete, click-to-task navigation.
- **CSS regression fix**: bell dropdown CSS was using class names that didn't match the JSX (`.notif-panel` → `.notif-dropdown`, etc.). Rewritten to match.

### 21.4 Modal height fix (global)

- Bootstrap's stylesheet was forcing `.modal { height: 100%; }`, stretching every modal to the full viewport (huge empty white space below short forms).
- One-line fix in `index.css`: `.modal { height: auto; }` added to the existing override block. Affects every modal in the app.

### 21.5 Pre-ERP backup (already noted in §18) — superseded

The 2026-05-10 morning backup tarball is older than this changelog. If you need a snapshot that includes everything in §21, run a fresh backup.

---

## 22. Changelog — Late evening additions (2026-05-10)

After §21, a security + UX polish pass added these. All additive; nothing in §1–§21 is invalidated.

### 22.1 Security hardening

- **bcrypt password hashing** (`backend/server.js`).
  - Signup, login, reset, member-invite all hash via `bcrypt.hash(plain, 10)`.
  - Login also auto-upgrades any existing plaintext password — first successful login swaps the row to a bcrypt hash, no manual migration needed.
- **`/uploads/*` is JWT-gated.** New `authenticateAnySource` middleware accepts the JWT via `Authorization` header **OR** `?token=...` query param. Frontend wraps image / file URLs in `signedFileUrl()` so `<img>` / `<iframe>` / `<a download>` work without JS interception.
- **Global `/api/*` middleware switched to `authenticateAnySource`** — same JWT check, but EventSource (used by chat streaming) and direct file fetches now work.
- **Basic rate limiting** via `express-rate-limit`:
  - `/api/auth/*` — 20 attempts / 15 min / IP.
  - `/api/chat*` — 30 requests / min / IP (caps runaway LLM cost).

### 22.2 First-run + navigation

- **Welcome modal** (`components/WelcomeModal.jsx`) — auto-shows once per user with role-aware quick links (Read guide / See tasks / Set up project or Log hours / Try AI assistant). Dismissal stored in `localStorage` keyed by user id.
- **Cmd+K command palette** (`components/CommandPalette.jsx`) — instant search across navigation actions + tasks + projects + members. Arrow-key nav, Enter to select, Esc to close.
- **Global keyboard shortcuts** (wired in `Layout.jsx`):
  - `Cmd/Ctrl+K` — open palette
  - `Cmd/Ctrl+/` or `?` — open user guide
  - `Cmd/Ctrl+.` — open AI assistant
  - `Esc` — close palette / chat / modal

### 22.3 Profile expansion

- **User schema additions** (`backend/models/User.js`): `phone`, `slackHandle`, `timezone` (default `Asia/Kolkata`), `workingHours { start, end, weekdaysOnly }`, `bio`, `notificationPrefs` (object).
- **Profile page** now has a "Contact & availability" section + a "Notification preferences" section with 15 toggles per notification type. Saves via single `PUT /api/users/:id`.
- **Timezone-aware `today`** — frontend uses `todayInTz(user.timezone)` (in `api.js`) which leverages `Intl.DateTimeFormat`. Used in `MyTimesheetPage` so a user logging at 11 PM JST doesn't accidentally land on tomorrow's UTC date.

### 22.4 Notifications — preferences + email digest

- **`Notification.createIfAllowed()`** — new static method on the Notification model that looks up the recipient's `notificationPrefs` and silently skips muted types. All Notification-creation sites in `routes/timesheets.js` and `workflowEngine.js` migrated to this method.
- **Weekly email digest cron** (`server.js weeklyDigestTick`) — runs hourly, only fires Friday 18:00 local. Sends each user (with email + not muted) a one-page HTML summary: completed tasks, in-flight tasks, unread count, link back to the app. De-duped via a sentinel notification (`type: weekly_digest_sent`) so re-runs in the same hour don't double-send.

### 22.5 Audit log + activity feed

- **Audit log UI** at `/t/<ts>/time/audit` (`pages/AuditLogPage.jsx`). Backed by new endpoint `GET /api/time/audit?entityType=&action=&from=&to=&limit=`. Filters by entity type, action, date range, free-text search. Each row has a click-to-expand field-by-field diff (red = before, green = after).
- **Activity feed** at `/t/<ts>/activity` (`pages/ActivityPage.jsx`). New endpoint `GET /api/activity?days=14` merges three sources into a single timeline: `TimesheetAudit` + `WorkflowLog` (success only) + `Notification`. Day-grouped, source filter, search.

### 22.6 Exports — CSV + JSON + PDF

- `GET /api/time/export/entries?from=&to=&format=csv|json` — flat per-time-entry export with date/user/project/task/hours/billable/cost/revenue/notes.
- `GET /api/time/export/plans?month=&format=csv|json` — per-plan export with totals/status/submitter/approver.
- **PDF export of project P&L** (already in §21 background work but worth a call-out here): `GET /api/time/reports/project/:projectId/pnl/pdf?month=YYYY-MM` — A4 one-pager via `pdfkit`. Surfaced as **📥 PDF** button on the P&L page.

### 22.7 Task comments + @mentions

- New `TaskComment` model (`backend/models/TaskComment.js`): `taskId`, `authorId`, `authorName`, `body`, `mentions[]`, `createdAt`.
- Routes: `GET/POST/DELETE /api/tasks/:id/comments`.
- `resolveMentions()` parses `@name` tokens against the User collection (case-insensitive); resolved names are stored on the comment doc + each gets a `comment_mention` notification. The task's assignee gets a `task_comment` notification too (if they're not the commenter and not already mentioned).
- Frontend: `components/TaskComments.jsx` — threaded list + textarea with `@`-autocomplete dropdown of teammates, `Cmd/Ctrl+Enter` to submit, author/admin can delete via ✕.

### 22.8 Project + Plan polish

- **Project edit modal** — pencil icon on each card / row reuses the New Project modal in edit mode. Lets admins set billing type / contract value on existing projects.
- **Plan editor** — added 📊 P&L button to toolbar that jumps to the project's P&L scoped to the plan's month.
- **Project P&L button on each project card** — direct nav to P&L for the current month.

### 22.9 Friday EOD auto-submit

- New `fridayAutoSubmitTick` in `routes/timesheets.js` — runs hourly. From 21:00 Friday through end of Sunday, finds any still-`open` period (with logged hours) and:
  - Flips period → `submitted`
  - Flips every slice → `submitted`
  - Notifies the project owner of each affected slice
- Catches the case where a user forgets — ensures the owner sees the data by Monday morning at the latest.

### 22.10 Rejected-task auto-reset

- `PUT /api/tasks/:id` now detects: if the task is currently `Rejected` and a non-status field is being edited (title, description, attachments, dueDate, estimatedHours, customProperties), it auto-flips status back to `Not Yet Started`. No more "stuck Rejected" papercut.

### 22.11 Org chart V2 + members improvements

- **Members page rate-bucket dropdown** for admins on each user with a login. Dropdown has a purple-bordered "✏️ Change cost rate" treatment so it's hard to miss.
- **Admin tip banner** at the top of Members for admins — points at the bucket dropdown.
- **Auto-link** in the V3 loader (`backend/loadOrgChartV3.js`) is case-insensitive whitespace-normalised name match.

### 22.12 Backup automation

- **`backup.sh`** at the repo root — cron-ready. Dumps Mongo to `db_dump/` (uses `mongodump` if present, else a Node fallback that uses the existing mongoose connection), tarballs the source tree (excludes node_modules / build artifacts), prunes tarballs older than `KEEP_DAYS` (default 30).
- Cron example: \`0 2 * * * /Volumes/Antigravity/antigravity/Task/backup.sh >> /var/log/mayvel_backup.log 2>&1\`

### 22.13 What's still NOT done

Carried forward from earlier conversations — these need decisions / infrastructure:

- HTTPS / production deploy story (Docker, hosting platform).
- Automated test suite (zero tests currently).
- CSRF protection (would need cookie-based session rework).
- Sentry / error monitoring (paid service decision).
- Bootstrap removal (multi-PR refactor).
- Recurring tasks / task dependencies / Gantt views (each is a multi-day net-new feature).
- Task dependencies / blocking relationships.
- Time-off / vacation tracking.
- Cross-teamspace pretty URLs (architectural — needs global task lookup index).

---

> **Where the ERP-specific stuff lives**: see `TIMESHEET_PRD.md` for the budget-gated plan/allocation/time-entry/approval workflow, the contract value + billing-type loss model, the Finance dashboard, and the Members page's rate-bucket integration. The TIMESHEET_PRD.md §14 changelog mirrors the ERP-relevant items above.
