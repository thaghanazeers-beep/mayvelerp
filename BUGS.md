# Mayvel Task — Bug Log

Single source of truth for every reported bug. We work from this list so nothing slips and we don't re-fix the same thing twice.

**Conventions**
- Status: `OPEN` (not started) · `IN PROGRESS` (being worked on) · `FIXED` (commit linked) · `WONT FIX` (with reason)
- Severity: `P0` (demo blocker) · `P1` (broken feature) · `P2` (annoying) · `P3` (polish)
- Add new bugs at the bottom. Don't renumber when one is fixed — keep IDs stable.

---

## How to file a bug
For each bug, capture:
- **Who**: which user / role
- **Where**: page or URL
- **What you did**: step-by-step
- **What happened**: actual
- **What should happen**: expected

A one-liner is fine. I'll repro and fill in details.

---

## Open bugs

### B001 — Team "Remove" not working
- **Status**: IN PROGRESS (added toast feedback + fixed id mismatch — pending user retest)
- **Severity**: P1
- **Where**: [frontend/src/pages/TeamPage.jsx](frontend/src/pages/TeamPage.jsx)
- **Repro**: As Admin, open Team → click Remove on a member → nothing happens (or member reappears)
- **Findings so far**:
  - Backend DELETE `/api/team/:id` works end-to-end (tested with curl; returns 200 + member disappears from `/api/team` after).
  - Frontend `handleRemove` swallowed errors silently — no toast on success or failure. Added toast feedback.
  - `user?.id` vs `user?._id` shape mismatch — normalized to `myId`.
  - **Likely root cause**: user is on a teamspace where their *teamspace role* is member, but UI's `isAdmin` reads global role → button shown, backend 403s. Toast will now surface "Requires admin role".
- **Next**: user retests; if 403, gate the button on teamspace role too.

---

### B002 — Notifications keyed by user *name*, not user ID (cross-user leak)
- **Status**: OPEN
- **Severity**: P0
- **Where**: [backend/models/Notification.js:9](backend/models/Notification.js#L9), [backend/server.js:243-269](backend/server.js#L243-L269), every `createNotification(...)` call site (lines 929, 989, 1004, 1019, 1038, 1052, 1087, 1151, 1162), and `/api/notifications*` reads filter by `?user=<name>`.
- **What's wrong**: Schema `userId: { type: String }` with comment "recipient user ID" — but every writer passes a *name*, not an ObjectId, and every reader queries by name (`?user=Thagha+Nazeer` in current logs). Two users sharing a display name share their notifications including private review/comment/plan-rejection content.
- **Why it matters**: P0 — real privacy bug. Easy to trip if two test users have the same first name.
- **Fix sketch**: Convert `userId` to ObjectId, change every call site to pass `_id`, drop `?user=` query param and read recipient from JWT.

---

### B003 — Team Settings "Invite" sends arguments in the wrong order
- **Status**: OPEN
- **Severity**: P1
- **Where**: [frontend/src/pages/TeamSettingsPage.jsx:30](frontend/src/pages/TeamSettingsPage.jsx#L30)
- **What's wrong**: Calls `inviteUser(invEmail, invRole, user?.name || 'Admin')` but API signature is `inviteUser(teamspaceId, email, role, inviterName)`. So teamspaceId = email, email = role, role = name → backend 400s with "Invalid teamspace".
- **Why it matters**: P1 — every invite from Team Settings fails silently behind an `alert()`. The newer Team page at TeamPage.jsx:92 is correct, so this is dead-looking-but-still-wired UI.
- **Fix sketch**: `await inviteUser(activeTeamspaceId, invEmail, invRole, user?.name);` (the page already imports `useTeamspace`).

---

### B006 — `/api/time/entries` and `/api/time/allocations` leak across users
- **Status**: OPEN
- **Severity**: P0
- **Where**: [backend/routes/timesheets.js:498-506](backend/routes/timesheets.js#L498-L506) and `routes/timesheets.js:972-980` (allocations GET)
- **What's wrong**: `if (req.query.userId) filter.userId = req.query.userId;` runs **before** the `!isAdmin` self-scope, so any member can pass `?userId=<anyone>` and read another user's time entries (with cost/revenue cents). `/allocations` has no user-scope check at all.
- **Why it matters**: P0 — payroll-level data (hours, rates, costs) exposed to anyone with an account.
- **Fix sketch**: For both routes, force `filter.userId = req.user.userId` when `!isAdmin(req)` regardless of query, *or* explicitly require admin/project-owner to pass a foreign `userId`.

---

### B010 — `GlobalApprovalsPage` violates Rules of Hooks (Super Admin toggle crashes page)
- **Status**: OPEN
- **Severity**: P1
- **Where**: [frontend/src/pages/GlobalApprovalsPage.jsx:15-48](frontend/src/pages/GlobalApprovalsPage.jsx#L15-L48)
- **What's wrong**: `useState` × N (lines 19-26) → early `return` if not super admin (28-29) → `useEffect` (line 48). On the render where the early return fires, the `useEffect` is never registered. When the user toggles Super Admin **on** without a reload, React sees a different hook count → "Rendered more hooks than during the previous render" → component tree unmounts.
- **Why it matters**: P1 — toggling Super Admin while standing on this page crashes the UI until full reload.
- **Fix sketch**: Move the early-return gates into the JSX (`return !user?.isSuperAdmin ? <Gate/> : <Main/>;`) so all hooks register on every render.

---

### B005 — Team "Edit member" button silently 403s for non-SuperAdmin admins
- **Status**: FIXED
- **Severity**: P1
- **Where**: button gate [frontend/src/pages/TeamPage.jsx:18-19](frontend/src/pages/TeamPage.jsx#L18-L19); backend gate [backend/server.js:778-784](backend/server.js#L778-L784)
- **What's wrong**: Edit button renders for anyone with global Admin/Team Owner role, but `PUT /api/users/:id` requires `isSelf || isSuperAdmin`. Regular workspace admins click Edit, fill the form, hit Save → 403 only surfaces in `editError`.
- **Fix**: Added `canEditUser(member)` helper (SuperAdmin OR self) and gated all three Edit buttons (cards/list/table) on it. Smoke-test now confirms: Pooja (Admin not Super) → 403 on edit other user; Pooja self-edit OK; Thagha (Super) can edit anyone.

---

### B007 — Task create/status/delete handlers swallow errors with `console.error`
- **Status**: FIXED
- **Severity**: P1
- **Where**: [frontend/src/pages/TasksPage.jsx](frontend/src/pages/TasksPage.jsx) (`handleCreateNew`, `handleStatusChange`, `handleDelete`) and [frontend/src/pages/ProjectsPage.jsx](frontend/src/pages/ProjectsPage.jsx) (`handleDelete`, `handleCreateTask`, `handleStatusChange`, `handleProjectStatusChange`, `handleDeleteTask`, drag-and-drop `handleDrop`)
- **What's wrong**: Each catch was just `console.error(err)` — users saw "button does nothing" when the backend returned 400/403 with a real message (e.g. allocation-gate failure).
- **Fix**: Wired `useToast()` into both pages and surface `err.response?.data?.error || err.message` on every catch.

---

### B008 — Unassigned task editable by anyone in the workspace
- **Status**: FIXED
- **Severity**: P1
- **Where**: [frontend/src/pages/TaskDetailPage.jsx:229-230](frontend/src/pages/TaskDetailPage.jsx#L229-L230)
- **What's wrong**: `const isAssignee = currentUser?.name === assignee || !assignee;` — the `|| !assignee` clause meant any logged-in user could rewrite any unassigned task (title, blocks, attachments, status).
- **Fix**: Drop the `|| !assignee` permissiveness. Now `canEdit = isAdminOrOwner || isAssignee || isCreator`, where assignee must be non-empty *and* match the current user. Task creator can still edit their own unassigned drafts.

---

### B016 — Editing any workflow silently fails (`updateWorkflow` not imported)
- **Status**: FIXED
- **Severity**: P0 (demo blocker)
- **Where**: [frontend/src/pages/WorkflowsPage.jsx:2](frontend/src/pages/WorkflowsPage.jsx#L2), `handleSave` line ~157
- **What's wrong**: `handleSave` calls `updateWorkflow(editingWfId, payload)` but the import on line 2 was missing the symbol. Every edit threw `ReferenceError`, swallowed by the bare `catch (err) { console.error(err); }` → modal stayed open, no toast.
- **Fix**: Added `updateWorkflow` to the import and added toast feedback to all WorkflowsPage handlers.

---

### B017 — "Complete Sprint" modal crashes (`planned` not defined)
- **Status**: FIXED
- **Severity**: P0 (demo blocker)
- **Where**: [frontend/src/pages/SprintsPage.jsx:503](frontend/src/pages/SprintsPage.jsx#L503)
- **What's wrong**: Roll-over dropdown referenced `planned.filter(...)` but `planned` was never declared (probably a refactor leftover). Clicking "✓ Complete Sprint" threw → blank page on the headline admin action.
- **Fix**: Replaced with `sprints.filter(s => s.status === 'planned' && s._id !== showComplete._id)`.

---

### B018 — SprintsPage admin actions gated on global role, not teamspace role
- **Status**: FIXED (partial — includes SuperAdmin; teamspace-role exposure deferred)
- **Severity**: P1
- **Where**: [frontend/src/pages/SprintsPage.jsx:34](frontend/src/pages/SprintsPage.jsx#L34)
- **Fix**: Added `user?.isSuperAdmin` to the gate. Proper teamspace-role plumbing is a deeper change (would require exposing membership role through TeamspaceContext) — deferred.

---

### B019 — PlanApprovalsPage hides itself behind global Admin role
- **Status**: FIXED
- **Severity**: P1
- **Where**: [frontend/src/pages/PlanApprovalsPage.jsx:29](frontend/src/pages/PlanApprovalsPage.jsx#L29)
- **What's wrong**: Page returned "Admin only" for non-Admin users, but the backend's `?awaitingMyApproval=1` already filters to projects the user owns + SuperAdmin sees all. Project owners who weren't global Admin were locked out of approving their own projects.
- **Fix**: Dropped the role gate. Empty state already explains that only your-owned-project plans appear here.

---

### B012 — TaskDetailPage loaders never re-run if active teamspace changes
- **Status**: FIXED
- **Severity**: P2
- **Where**: [frontend/src/pages/TaskDetailPage.jsx:190](frontend/src/pages/TaskDetailPage.jsx#L190)
- **Fix**: Added `[activeTeamspaceId, task?.id]` to the useEffect deps so loaders re-run on teamspace switch / task swap.

---

### B020 — NotificationsPage swallows API failures while still mutating UI
- **Status**: FIXED
- **Severity**: P2
- **Where**: [frontend/src/pages/NotificationsPage.jsx](frontend/src/pages/NotificationsPage.jsx)
- **Fix**: Wrapped `handleClick`, `handleMarkAll`, `handleDelete`, `reload` in try/catch. Toast surfaces the actual error. Optimistic UI update now only fires after the API call succeeds.

---

### B021 — TeamspaceControlPage error handling drops server message
- **Status**: FIXED
- **Severity**: P2
- **Where**: [frontend/src/pages/TeamspaceControlPage.jsx](frontend/src/pages/TeamspaceControlPage.jsx)
- **Fix**: Swapped bare `alert('Failed to...')` for `toast.error(e.response?.data?.error || e.message)`. Success path now toasts too.

---

### B022 — OrgChartPage member dropdown missing teamspace context
- **Status**: FIXED
- **Severity**: P2
- **Where**: [frontend/src/pages/OrgChartPage.jsx:75-77](frontend/src/pages/OrgChartPage.jsx#L75-L77)
- **Fix**: `getTeam(activeTeamspaceId)` and `activeTeamspaceId` added to the dep array.

---

### B024 — `POST /api/projects` had no role gate (any authenticated user could create/edit/delete)
- **Status**: FIXED
- **Severity**: P1
- **Where**: [backend/server.js:826-853](backend/server.js#L826-L853)
- **What's wrong**: All three project mutation routes ran with only the global `authenticateAnySource` middleware — a Member could create or delete projects org-wide.
- **Fix**: Added `requireGlobalAdmin` middleware (Admin / Team Owner / SuperAdmin) on POST/PUT/DELETE `/api/projects`.

---

### B025 — Plan submitter could approve their own plan
- **Status**: FIXED
- **Severity**: P0
- **Where**: [backend/routes/timesheets.js:700-712](backend/routes/timesheets.js#L700-L712), `:758-772` (reject)
- **What's wrong**: Approve/reject only gated on `req.user.role === 'Admin'`. Any user with global Admin role (Pooja, Karthick, Suha all qualify) could submit a plan and then immediately approve it themselves — no separation of duties.
- **Fix**: Approve and Reject now compare `plan.submittedBy` against `req.user.email`. Self-approval returns 403 unless caller is SuperAdmin (emergency override). PlanEditorPage frontend hides the Approve/Reject buttons when the current user is the submitter.

---

### B026 — `GET /api/time/plans/:planId/allocations` had no auth check
- **Status**: FIXED
- **Severity**: P0
- **Where**: [backend/routes/timesheets.js:973-977](backend/routes/timesheets.js#L973-L977)
- **What's wrong**: Endpoint returned every allocation in the plan (frozen rates, allocated/consumed hours, per-user IDs) to any authenticated user — including users from another teamspace.
- **Fix**: Loads the plan, requires SuperAdmin or active TeamspaceMembership in the plan's teamspace.

---

### B027 — Allocation PUT/DELETE had no auth check
- **Status**: FIXED
- **Severity**: P0
- **Where**: [backend/routes/timesheets.js:998-1041](backend/routes/timesheets.js#L998-L1041)
- **What's wrong**: Any authenticated user could mutate or delete any allocation in any teamspace.
- **Fix**: Added `canMutateAllocation` helper. Allowed when caller is SuperAdmin, the project owner, or an admin in the project's teamspace.

---

### B030 — Chat `list_employees` tool leaked org-wide cost rates
- **Status**: FIXED
- **Severity**: P0
- **Where**: [backend/routes/chat.js:149-194](backend/routes/chat.js#L149-L194)
- **What's wrong**: Tool ran `User.find({})` and returned `costRateRupeesPerHr` + bucket name for every user. Any logged-in user could ask the AI "list employees" and exfiltrate compensation org-wide.
- **Fix**: Tool now scopes to members of the caller's current teamspace (via `TeamspaceMembership`) and redacts cost-rate fields unless caller is SuperAdmin.

---

### B033 — Login / reset / impersonate / create-user responses leaked bcrypt password hash
- **Status**: FIXED
- **Severity**: P0
- **Where**: [backend/server.js:311-345 + 422-460 + 550-570](backend/server.js#L436-L460)
- **What's wrong**: Every auth response (`login`, `impersonate`, `reset-password`, admin-create-user) serialized the full User document including `password`, `passwordResetToken`, and `passwordResetExpires`. Any logged-in user could call `/api/auth/login` (or watch the network tab) and read their own bcrypt hash; impersonation responses leaked any target's hash to the SuperAdmin's browser.
- **Fix**: Added `sanitizeUser()` helper that strips the three sensitive fields. Applied to all four routes. Login also now returns 400 when email/password is missing.

---

### B036 — Tab close stranded SuperAdmin in impersonated identity
- **Status**: FIXED
- **Severity**: P1
- **Where**: [frontend/src/context/AuthContext.jsx](frontend/src/context/AuthContext.jsx)
- **What's wrong**: Original user was stashed in `sessionStorage` while the impersonated token sat in `localStorage`. Tab close cleared sessionStorage but kept the impersonated token → next visit loaded the impersonated user with no SuperAdmin powers and no "View as" banner to revert.
- **Fix**: Original user + token now persist to `localStorage`. `logout()` clears both old and new keys for back-compat.

---

### B045 — NotificationBell polling captured stale empty username
- **Status**: FIXED
- **Severity**: P2
- **Where**: [frontend/src/components/NotificationBell.jsx:51-55](frontend/src/components/NotificationBell.jsx#L51-L55)
- **What's wrong**: `useEffect(() => fetchData(); setInterval(fetchData, 5000); ...)` with empty deps captured `userName` on mount. If auth resolved a tick later, the closure stayed empty-named forever and the bell never updated until manual reload.
- **Fix**: Deps now include `[userName]`, with an early return when empty so the interval doesn't fire until auth resolves.

---

### B037 — PlanEditorPage Approve button visible to plan submitter (UI side of B025)
- **Status**: FIXED
- **Severity**: P0
- **Where**: [frontend/src/pages/PlanEditorPage.jsx:64-71](frontend/src/pages/PlanEditorPage.jsx#L64-L71)
- **Fix**: `canApprove` now requires `isSuper || !isSubmitter`. Backend gate (B025) is the actual authority.

---

## Fixed (recent)

- `done` Plan-approved notification was navigating to `/tasks` — `bc976e7`
- `done` Email links going to localhost — `e051686`
- `done` Email kill switch ignored by weekly digest — `7bcbf0c`
- `done` Task approve/reject not restricted to teamspace owner — earlier commit
