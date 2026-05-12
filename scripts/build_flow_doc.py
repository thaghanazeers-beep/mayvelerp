#!/usr/bin/env python3
"""Generate Mayvel_Task_Flow.docx — a complete A-Z flow document for the
Mayvel Task platform. Uses only Python stdlib (zipfile + xml) so no pip
install is required.

Run:  python3 scripts/build_flow_doc.py
Out:  Mayvel_Task_Flow.docx (in repo root)
"""
import zipfile, os, html
from datetime import datetime

OUT = os.path.join(os.path.dirname(__file__), "..", "Mayvel_Task_Flow.docx")

# ─── XML building blocks ───────────────────────────────────────────────────
def esc(s):
    return html.escape(str(s), quote=False)

def p(text, *, bold=False, italic=False, size=22, color=None, indent=0, list_style=None):
    rpr_parts = []
    if bold: rpr_parts.append('<w:b/>')
    if italic: rpr_parts.append('<w:i/>')
    if size: rpr_parts.append(f'<w:sz w:val="{size}"/>')
    if color: rpr_parts.append(f'<w:color w:val="{color}"/>')
    rpr = f'<w:rPr>{"".join(rpr_parts)}</w:rPr>' if rpr_parts else ''
    ppr_parts = []
    if indent: ppr_parts.append(f'<w:ind w:left="{indent*360}"/>')
    if list_style == 'bullet':
        ppr_parts.append('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
    ppr = f'<w:pPr>{"".join(ppr_parts)}</w:pPr>' if ppr_parts else ''
    return f'<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'

def h(text, level=1):
    sizes = {1: 36, 2: 30, 3: 26, 4: 24}
    return f'''<w:p><w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr>
<w:r><w:rPr><w:b/><w:sz w:val="{sizes.get(level, 22)}"/><w:color w:val="2E2A6E"/></w:rPr>
<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'''

def bullet(text, indent=0):
    return p(text, list_style='bullet', indent=indent)

def code(text):
    return f'''<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/><w:ind w:left="200"/></w:pPr>
<w:r><w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/><w:sz w:val="18"/></w:rPr>
<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'''

def hr():
    return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="C7C7CC"/></w:pBdr></w:pPr></w:p>'

def empty():
    return '<w:p/>'

def table(rows, widths=None):
    """rows: list of lists of strings. First row = header."""
    if not rows: return ''
    cols = len(rows[0])
    widths = widths or [9000 // cols] * cols
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    parts = [f'''<w:tbl>
<w:tblPr><w:tblBorders>
  <w:top w:val="single" w:sz="4" w:color="C7C7CC"/>
  <w:left w:val="single" w:sz="4" w:color="C7C7CC"/>
  <w:bottom w:val="single" w:sz="4" w:color="C7C7CC"/>
  <w:right w:val="single" w:sz="4" w:color="C7C7CC"/>
  <w:insideH w:val="single" w:sz="4" w:color="E5E5EA"/>
  <w:insideV w:val="single" w:sz="4" w:color="E5E5EA"/>
</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>''']
    for i, row in enumerate(rows):
        is_header = i == 0
        cells = ''
        for j, cell in enumerate(row):
            shading = '<w:shd w:val="clear" w:color="auto" w:fill="2E2A6E"/>' if is_header else ''
            text_color = 'FFFFFF' if is_header else '000000'
            bold_tag = '<w:b/>' if is_header else ''
            cells += f'''<w:tc><w:tcPr><w:tcW w:w="{widths[j]}" w:type="dxa"/>{shading}</w:tcPr>
<w:p><w:r><w:rPr>{bold_tag}<w:sz w:val="20"/><w:color w:val="{text_color}"/></w:rPr>
<w:t xml:space="preserve">{esc(cell)}</w:t></w:r></w:p></w:tc>'''
        parts.append(f'<w:tr>{cells}</w:tr>')
    parts.append('</w:tbl>')
    parts.append(empty())
    return ''.join(parts)

# ─── Content ────────────────────────────────────────────────────────────────
TODAY = datetime.now().strftime("%B %d, %Y")
body = []

# Title block
body.append(f'''<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="2E2A6E"/></w:rPr>
<w:t xml:space="preserve">Mayvel Task — End-to-End Flow</w:t></w:r></w:p>''')
body.append(f'''<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:i/><w:sz w:val="22"/><w:color w:val="6E6E73"/></w:rPr>
<w:t xml:space="preserve">A walkthrough of every state transition, who sees what, and what fires at each step. — {TODAY}</w:t></w:r></w:p>''')
body.append(empty()); body.append(hr()); body.append(empty())

# === 1. System Overview ===
body.append(h("1. System overview", 1))
body.append(p("Mayvel Task is a three-tier hosted platform:"))
body.append(bullet("Frontend — React 19 + Vite on Netlify, served from https://mayvelerp.netlify.app"))
body.append(bullet("Backend — Node 22 + Express 5 on Render, https://mayvelerp.onrender.com"))
body.append(bullet("Database — MongoDB Atlas (M0, Mumbai region) — 22 collections, ~700 documents"))
body.append(bullet("Email — Brevo HTTPS API (port 443) for all transactional mail"))
body.append(bullet("Push — Web Push (FCM + VAPID keys), opt-in per browser"))
body.append(empty())
body.append(p("The frontend is a single React SPA; every navigation produces a real URL " "so links into deep state are bookmarkable. The backend is stateless apart from " "uploads; all auth is JWT-based."))
body.append(empty())

# === 2. Account model ===
body.append(h("2. Accounts, roles, teamspaces", 1))
body.append(p("Three role tiers exist:"))
body.append(table([
    ["Tier", "Where stored", "Powers"],
    ["Super Admin", "User.isSuperAdmin = true", "Single workspace owner. Bypasses every gate, can impersonate any user, manages user access levels, edits the org chart."],
    ["Admin", "User.role = 'Admin'", "Global Admin. Sees Org chart + Members. Can create projects, edit anyone's tasks."],
    ["Member", "User.role = 'Member'", "Regular team member. Sees only their teamspaces and tasks."],
], widths=[1800, 2400, 4800]))

body.append(p("On top of the global role each user has a per-teamspace role via TeamspaceMembership:"))
body.append(table([
    ["Per-team role", "Notes"],
    ["admin", "Full read/write inside the teamspace (but not governance — see owner)"],
    ["member", "Default. Create/edit tasks, log time, comment"],
    ["viewer", "Read-only"],
], widths=[2400, 6600]))

body.append(p("Each teamspace has a single Owner (Teamspace.ownerId). The owner is the only " "non-Super-Admin who can see/use governance pages — Plans, Plan Approvals, Week Approvals, " "Team Management, Teamspace Control."))
body.append(empty())

# === 3. Login flow ===
body.append(h("3. Login flow (A-Z)", 1))
body.append(p("Public signup is disabled. Super Admin creates every user from the Access Control page. The login flow:"))
body.append(bullet("User hits https://mayvelerp.netlify.app/. Frontend loads the React bundle from Netlify."))
body.append(bullet("If localStorage has a valid JWT, user is restored. Otherwise AuthPage renders the login form."))
body.append(bullet("Submit → POST /api/auth/login with {email, password}. Backend looks up user, verifies password (bcrypt or plaintext-upgrade legacy)."))
body.append(bullet("On success: backend signs a 7-day JWT carrying {userId, email, role}, returns {user, token}."))
body.append(bullet("Frontend stores user in localStorage.mayvel_user + token in localStorage.token."))
body.append(bullet("Active teamspace is restored from localStorage.mayvel_activeTeamspace OR set to the user's first teamspace."))
body.append(bullet("Layout sidebar renders all teamspaces the user belongs to (filters out other people's personal spaces)."))
body.append(bullet("AI Assistant + Notifications bell start polling every 5 seconds."))
body.append(empty())

# === 4. Task lifecycle ===
body.append(h("4. Task lifecycle — every state + what fires", 1))
body.append(p("A task lives in a single teamspace and (usually) a single project. Statuses follow:"))
body.append(code("Not Yet Started → In Progress → In Review → Completed   (happy path)\n"
                  "                                    ↓\n"
                  "                                Rejected → (rework) → Not Yet Started ...\n"
                  "(any status) → Deleted"))

body.append(h("4.1 Create a task", 2))
body.append(bullet("Creator opens Tasks page, clicks New Task or adds via a project's task list."))
body.append(bullet("Frontend → POST /api/tasks with {title, projectId, teamspaceId, assignee, ...}."))
body.append(bullet("Backend: requireTeamspaceMembership middleware checks the caller is in that teamspace. Non-admins must also have an active allocation for the assignee in the project (ERP gate)."))
body.append(bullet("Task is saved. workflowEngine.fire('task_created') runs every matching user-defined workflow."))
body.append(bullet("createNotification fires for the assignee (if not the creator). Three channels go in parallel:"))
body.append(bullet("In-app row in notifications collection — shows in the bell + Notifications page", indent=1))
body.append(bullet("Web push to every browser the assignee has subscribed (FCM)", indent=1))
body.append(bullet("Email via Brevo HTTPS API — subject = 'New task created', button → /tasks/<id>", indent=1))
body.append(bullet("Notification carries teamspaceId so the per-team sidebar bell badge increments."))
body.append(empty())

body.append(h("4.2 Move status: In Progress → In Review", 2))
body.append(bullet("Assignee clicks the status dropdown → 'In Review' (or any other transition)."))
body.append(bullet("Frontend → PUT /api/tasks/:id with {status: 'In Review', updatedBy}."))
body.append(bullet("Backend compares old vs new status, fires three things:"))
body.append(bullet("createNotification('review_requested') to every global Admin", indent=1))
body.append(bullet("workflowEngine.fire('status_changed') for any custom automations", indent=1))
body.append(bullet("If the status change is NOT one of the special cases (Review / Completed / Rejected), a catch-all 'status_changed' notif goes to the assignee describing the move", indent=1))
body.append(empty())

body.append(h("4.3 Approve a task (Completed)", 2))
body.append(bullet("An Admin opens the task and changes status to Completed."))
body.append(bullet("Backend fires createNotification('task_completed') to the assignee."))
body.append(bullet("Email subject: 'Task Approved ✅', body links to the task."))
body.append(empty())

body.append(h("4.4 Reject a task — full flow", 2))
body.append(p("This is the most interesting transition. Sequence:"))
body.append(bullet("Admin views the task, changes status to 'Rejected'. May also leave a comment."))
body.append(bullet("Frontend → PUT /api/tasks/:id with {status: 'Rejected', updatedBy: <admin name>}."))
body.append(bullet("Backend updates the task. Then:"))
body.append(bullet("Compares old vs new status, sees Rejected.", indent=1))
body.append(bullet("createNotification('task_rejected', userId: task.assignee) — notif title 'Task Rejected ❌', message 'rejected by <admin>. Please rework.'", indent=1))
body.append(bullet("In parallel: in-app notif row created → push fires to assignee's browser → email goes to assignee via Brevo with link to the task.", indent=1))
body.append(bullet("workflowEngine.fire('status_changed', {fromStatus: 'In Review', toStatus: 'Rejected'}). Any user-defined workflow listening for this fires too.", indent=1))
body.append(bullet("Auto-rebound behaviour (server.js): if the assignee edits any reviewed field (title, description, attachments, dueDate, estimatedHours, customProperties) WITHOUT explicitly changing status, the task flips back to 'Not Yet Started'. So rework moves the task back into the active queue automatically."))
body.append(bullet("On the assignee's screen: 🔔 bell badge increments, OS-level push notification pops up, email lands in inbox within ~5 seconds, sidebar's per-team bell badge for that teamspace also increments."))
body.append(empty())

body.append(h("4.5 Delete a task", 2))
body.append(bullet("Admin or task owner clicks Delete → confirm dialog."))
body.append(bullet("Frontend → DELETE /api/tasks/:id?actor=<name>."))
body.append(bullet("Backend reads the task, deletes it, then fires createNotification('task_deleted') to both the assignee AND the creator (whichever differ from the actor)."))
body.append(bullet("Push + email + in-app for each recipient."))
body.append(empty())

body.append(h("4.6 Comment & @mention", 2))
body.append(bullet("User posts a comment via POST /api/tasks/:id/comments with body."))
body.append(bullet("Backend parses @mentions (lookup users by name). For each mentioned user (excluding the author): createNotification('comment_mention'). Title: '<author> mentioned you'."))
body.append(bullet("Also fires task_comment to the assignee (if not the author and not already mentioned)."))
body.append(empty())

# === 5. Project + Budget ===
body.append(h("5. Project + ProjectHoursPlan (budget) flow", 1))
body.append(p("Projects are org-wide — every teamspace sees every project. Each project has one Owner who governs its monthly budget plan. The budget object is ProjectHoursPlan."))

body.append(h("5.1 ProjectHoursPlan states", 2))
body.append(code("draft → pending → approved\n                ↓\n              rejected → (reopen) → draft"))

body.append(h("5.2 Create a plan", 2))
body.append(bullet("Owner opens Time → Plans, selects a project from the dropdown."))
body.append(bullet("Page shows their existing plans for that project, with approval status timeline."))
body.append(bullet("Click + New Plan → modal asks for month + optional title."))
body.append(bullet("Frontend → POST /api/time/plans {projectId, periodMonth, title?}."))
body.append(bullet("Backend creates the plan in 'draft' status. Owner is recorded as createdBy."))
body.append(bullet("Toast appears: 'Draft plan created — add rows and submit when ready'."))
body.append(empty())

body.append(h("5.3 Build out the plan rows", 2))
body.append(bullet("Each row represents a slice of work: task type + rate bucket + person + planned hours."))
body.append(bullet("Click + Add row → POST /api/time/plans/:id/lines with sensible defaults."))
body.append(bullet("Edit cells inline → PUT /api/time/plans/:id/lines/:lineId — recomputes totals every patch."))
body.append(bullet("Bottom of the page shows live totals: Billable / Non-billable hours, cost, revenue, projected profit + margin."))
body.append(bullet("If the project has a contract value and this plan would push committed cost past it, a budget-overrun warning shows."))
body.append(empty())

body.append(h("5.4 Submit for approval", 2))
body.append(bullet("Owner clicks 📤 Submit for Approval → confirm dialog."))
body.append(bullet("Frontend → POST /api/time/plans/:id/submit."))
body.append(bullet("Backend validates: status is draft or rejected, lines are not empty, every billable line has a frozen bill rate."))
body.append(bullet("'refreezeRates' snapshots current rate-bucket rates onto each line so future bucket edits don't ripple back."))
body.append(bullet("Plan status → pending. submittedAt + submittedBy set. Audit log written."))
body.append(bullet("notify('plan_submitted') fires for every Admin in the teamspace. Three channels: in-app + push + email (Brevo)."))
body.append(bullet("workflowEngine.fire('plan_submitted') — custom automation hooks."))
body.append(bullet("Toast: 'Plan submitted for approval — owner will be notified'."))
body.append(empty())

body.append(h("5.5 Approve a plan — full flow", 2))
body.append(p("The Admin who owns the project is the only one who can approve."))
body.append(bullet("Approver opens Plan Approvals page → list filtered to ?awaitingMyApproval=1 → only pending plans on projects they own."))
body.append(bullet("Clicks into the plan, reviews each line and totals."))
body.append(bullet("Forecast check: if project.contractValueCents > 0 and approving would push committed cost > contract, a confirm dialog warns 'This will overrun by ₹X — approve anyway?'"))
body.append(bullet("Clicks ✅ Approve → POST /api/time/plans/:id/approve."))
body.append(bullet("Backend updates: status → approved, approvedAt + approvedBy set. Audit log written."))
body.append(bullet("notify('plan_approved', userId: plan.createdBy) — three channels. Subject: 'Project hours plan approved ✅'."))
body.append(bullet("workflowEngine.fire('plan_approved')."))
body.append(bullet("Toast: 'Plan approved'."))
body.append(bullet("Owner can now click '📅 Allocate hours' → backend creates weekly Allocation rows for each user × week from the plan."))
body.append(bullet("Each allocated user receives notify('allocation_created') with the project + planned hours."))
body.append(empty())

body.append(h("5.6 Reject a plan — full flow", 2))
body.append(bullet("Approver clicks ❌ Reject → modal asks for a reason (minimum 10 characters)."))
body.append(bullet("Frontend → POST /api/time/plans/:id/reject {reason}."))
body.append(bullet("Backend updates: status → rejected, rejectedAt + rejectedBy + rejectionReason set. Audit log written."))
body.append(bullet("notify('plan_rejected', userId: plan.createdBy) — three channels. Subject: 'Project hours plan rejected ❌'. Message includes the reason verbatim."))
body.append(bullet("workflowEngine.fire('plan_rejected')."))
body.append(bullet("Toast: 'Plan rejected — owner notified'."))
body.append(bullet("Owner sees the rejected plan on their Time · Plans page with status badge + rejection date."))
body.append(bullet("Owner clicks '🔁 Reopen' → status flips back to 'draft', editing is unlocked."))
body.append(bullet("notify('plan_reopened') is informational only (no email by default)."))
body.append(empty())

body.append(h("5.7 What happens financially after approve/reject", 2))
body.append(table([
    ["Side effect", "On approve", "On reject"],
    ["Plan status", "approved", "rejected"],
    ["Owner notified?", "Yes (plan_approved)", "Yes (plan_rejected, with reason)"],
    ["Cost committed to project P&L?", "Yes — totals roll into project's committedCost", "No — plan is excluded from financials"],
    ["Allocations created?", "Optional, via owner clicking 📅 Allocate hours", "No"],
    ["Lock?", "Yes, plan is read-only; clone to revise", "No, owner can reopen → draft → resubmit"],
    ["Audit trail?", "Yes, 'approve' entry", "Yes, 'reject' entry with reason"],
], widths=[2400, 3300, 3300]))

# === 6. Weekly timesheet ===
body.append(h("6. Weekly timesheet flow", 1))
body.append(bullet("Member opens My Timesheet → sees current week's allocations from approved plans."))
body.append(bullet("Logs daily hours per allocation → PUT /api/time/entries. Optimistic UI."))
body.append(bullet("End of week: clicks 📤 Submit week → splits the week into per-project slices (TimesheetSlice), each routed to that project's owner."))
body.append(bullet("Each project owner receives notify('time_submitted')."))
body.append(bullet("Owner approves → notify('time_approved') back to the member. Cost rolls into actuals."))
body.append(bullet("Owner rejects (with reason) → notify('time_rejected'); slice status → rejected; member's entries flip back to draft for rework."))
body.append(empty())

# === 7. Notifications ===
body.append(h("7. Notification system overview", 1))
body.append(p("Every event fires three channels at once, gated by the user's notificationPrefs[type]."))
body.append(table([
    ["Channel", "Mechanism", "When"],
    ["In-app", "Mongo notifications row, polled every 5s by bell", "Always"],
    ["Web Push", "FCM endpoint POST via web-push library", "If user clicked 'Enable push'"],
    ["Email", "Brevo HTTPS API (api.brevo.com)", "If user has an email on file and SMTP env is configured"],
], widths=[1500, 4000, 3500]))

body.append(p("Sidebar shows a per-teamspace bell badge: count of unread notifications scoped to each teamspace. Click → jumps into that teamspace's Tasks list. Header bell shows the global unread count."))
body.append(p("Click any notification → uses notification.teamspaceId for routing (not active teamspace), so deep links work even when you're viewing a different team."))
body.append(empty())

# === 8. Permissions ===
body.append(h("8. Permission matrix (sidebar + page level)", 1))
body.append(table([
    ["Page", "viewer", "member", "admin", "owner", "Super Admin"],
    ["Tasks", "view", "view+CRUD", "view+CRUD", "view+CRUD", "view+CRUD"],
    ["Projects", "view", "view", "CRUD", "CRUD", "CRUD"],
    ["Sprints", "view", "view", "CRUD", "CRUD", "CRUD"],
    ["Workflows", "view", "view", "CRUD", "CRUD", "CRUD"],
    ["My Timesheet", "—", "log+submit", "log+submit", "log+submit", "log+submit"],
    ["Time Plans", "—", "—", "—", "CRUD", "CRUD"],
    ["Plan Approvals", "—", "—", "—", "approve/reject", "approve/reject"],
    ["Week Approvals", "—", "—", "—", "approve/reject", "approve/reject"],
    ["Team / Members", "—", "—", "—", "manage", "manage"],
    ["Teamspace Control", "—", "—", "—", "rename / delete", "rename / delete"],
    ["Org Chart edit", "view", "view", "view", "view", "edit"],
    ["Organization sidebar", "—", "—", "see", "see", "see"],
    ["Access Control", "—", "—", "—", "—", "full"],
], widths=[1900, 1100, 1300, 1300, 1500, 1900]))

body.append(p("Notes: 'owner' is the per-teamspace Teamspace.ownerId. Super Admin gets owner-level access in every teamspace while the header toggle is ON; flipping to Normal mode demotes them to a regular Admin view."))
body.append(empty())

# === 9. Impersonation ===
body.append(h("9. Impersonation flow (Super Admin only)", 1))
body.append(bullet("Super Admin opens the header dropdown 👁️ View as… and picks any user."))
body.append(bullet("Frontend → POST /api/admin/impersonate {userId}."))
body.append(bullet("Backend verifies caller is Super Admin, signs a fresh JWT as the target user, returns {user, token}."))
body.append(bullet("Frontend stashes the ORIGINAL token + user in sessionStorage (so it auto-clears on tab close)."))
body.append(bullet("Replaces localStorage.token + localStorage.mayvel_user with the target's, then full-page reload."))
body.append(bullet("After reload: the app sees the target user — sees their teamspaces, sees their owner-only items only for teams they own, etc."))
body.append(bullet("A yellow banner is pinned to the header: '👁️ Viewing as <Target>  [Switch back to <Super Admin>]'."))
body.append(bullet("Click Switch back → restores the original token from sessionStorage → page reloads back to Super Admin view."))
body.append(empty())

# === 10. Files ===
body.append(h("10. File attachments + media preview", 1))
body.append(bullet("Upload: drag a file into the task editor → POST /api/uploads (multipart). Multer caps at 200 MB. Backend renames to <timestamp>-<safename> + serves from /uploads/<file>."))
body.append(bullet("Response includes the absolute URL, stored in task.attachments[].path."))
body.append(bullet("Read: <img src={signedFileUrl(att.path)}> — signedFileUrl stamps the JWT on the URL as ?t=… and rewrites any legacy 127.0.0.1 host to the live backend."))
body.append(bullet("Videos use the same path with <video controls>. Authenticated static handler streams the file."))
body.append(bullet("On Render free tier the uploads disk is ephemeral — re-run migrateUploadsToLive.js after a service restart to re-push. For production, migrate to S3 / Cloudinary."))
body.append(empty())

# === 11. Email pipeline ===
body.append(h("11. Email pipeline (Brevo)", 1))
body.append(bullet("On startup: initTransporter() picks Brevo if BREVO_API_KEY is set. Otherwise falls back to nodemailer SMTP (then Ethereal dev inbox)."))
body.append(bullet("Brevo path: makeBrevoTransport returns an object with sendMail({from, to, subject, html}) that POSTs to https://api.brevo.com/v3/smtp/email."))
body.append(bullet("Every existing transporter.sendMail call in the codebase works unchanged."))
body.append(bullet("Sender = MAIL_FROM env (must be verified in Brevo)."))
body.append(bullet("Links in emails use APP_URL env so they point to https://mayvelerp.netlify.app/tasks/<id>."))
body.append(empty())

# === 12. Web push ===
body.append(h("12. Web push pipeline (FCM + VAPID)", 1))
body.append(bullet("VAPID keypair generated once via Node crypto; public key shipped to frontend via GET /api/push/vapid-public-key."))
body.append(bullet("Frontend service worker (/sw.js) registers on app boot."))
body.append(bullet("User clicks 🔔 Enable push → browser prompts → subscribe via FCM → POST /api/push/subscribe with {endpoint, keys}."))
body.append(bullet("Subscription persisted (PushSubscription model, indexed by endpoint)."))
body.append(bullet("On every notification: sendPushToUser(userName) fans out to every endpoint stored for that user."))
body.append(bullet("404/410 responses auto-prune dead endpoints."))
body.append(bullet("Service worker's 'push' handler shows the OS notification; 'notificationclick' focuses an existing tab or opens a new one at /tasks/<id>."))
body.append(empty())

# === 13. Audit + workflow ===
body.append(h("13. Audit trail + custom workflows", 1))
body.append(bullet("Every plan transition writes a TimesheetAudit row capturing actor, before/after, reason."))
body.append(bullet("Visible at /audit (admin-only)."))
body.append(bullet("Workflow Engine lets admins build user-defined automations: 'When task assignee changes → notify <user>', 'When plan submitted → email <slack-webhook>', etc."))
body.append(bullet("Triggers in code: task_created, status_changed, assignee_changed, task_updated, task_moved_to_project, plan_submitted, plan_approved, plan_rejected."))
body.append(bullet("Each workflow execution logs to WorkflowLog (visible in the Workflows page)."))
body.append(empty())

# === 14. Worked example ===
body.append(h("14. End-to-end worked example", 1))
body.append(p("'Karthick (Admin) creates a marketing task assigned to Pooja, she submits time, the budget gets rejected, then approved.' Walkthrough:"))
body.append(bullet("1. Karthick logs in at /. JWT issued, sees Product Design + Marketing in his sidebar."))
body.append(bullet("2. Switches active teamspace to Marketing. Sidebar shows Marketing's projects (org-wide list)."))
body.append(bullet("3. Opens Marketing project, creates a task 'Landing page redesign', assigns to 'Pooja Sridhar', sets due date."))
body.append(bullet("4. Server fires task_created → Pooja receives in-app, push (her browser is subscribed), and an email at pooja.s@mayvel.ai with a 'Open task' button linking to https://mayvelerp.netlify.app/tasks/<id>."))
body.append(bullet("5. Pooja clicks the email → lands directly on the task. Bell badge already shows 1 unread."))
body.append(bullet("6. She moves status In Progress → In Review. Admins receive 'review_requested' notif. Karthick approves → Completed. Pooja receives 'task_completed' email + push."))
body.append(bullet("7. Pooja (as Marketing owner) creates a Time · Plan for May, adds rows: Lead 80h billable, Junior 120h billable, etc. Cost ₹X, revenue ₹Y, profit ₹Z."))
body.append(bullet("8. She submits → plan goes to 'pending'. Project owner (Pooja in this case — but if someone else owned the Marketing project, they'd be the approver) sees it in Plan Approvals."))
body.append(bullet("9. Approver clicks Reject with reason 'Bill rate too low for Lead role — revise to ₹4500/hr'. Plan flips to rejected, Pooja receives rejection email with the reason."))
body.append(bullet("10. Pooja clicks Reopen → plan back to draft. Adjusts the rate. Re-submits."))
body.append(bullet("11. Approver clicks Approve. Plan → approved. Pooja receives approval email + push."))
body.append(bullet("12. Pooja clicks 📅 Allocate hours. Backend creates per-week Allocation rows for each user. Each allocated user gets 'allocation_created' notif."))
body.append(bullet("13. Members log daily hours throughout the month → My Timesheet page."))
body.append(bullet("14. End of each week: member submits the week → split into per-project slices, each routed to the project owner."))
body.append(bullet("15. Approver reviews + approves each slice → cost rolls into the project's actuals → live P&L."))
body.append(empty())

# === 15. Production caveats ===
body.append(h("15. Known production caveats", 1))
body.append(bullet("Render free tier: 15-min idle sleep (first request ~30s slow); ephemeral uploads disk; outbound SMTP port 587 blocked (mitigated by Brevo HTTPS)."))
body.append(bullet("CORS is open — lock down to https://mayvelerp.netlify.app for production."))
body.append(bullet("Atlas password, Brevo API key, GitHub PAT all need rotation post-demo (they leaked into chat history)."))
body.append(bullet("X-Forwarded-For warning from express-rate-limit — add app.set('trust proxy', 1) to silence."))
body.append(empty())

body.append(hr())
body.append(p(f"Document generated {TODAY}", italic=True, size=18, color="6E6E73"))

document_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + \
'<w:body>' + ''.join(body) + \
'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>' + \
'</w:body></w:document>'

content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>'''

rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

doc_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>'''

numbering = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>'''

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/_rels/document.xml.rels', doc_rels)
    z.writestr('word/document.xml', document_xml)
    z.writestr('word/numbering.xml', numbering)

size = os.path.getsize(OUT)
print(f'✅ Wrote {OUT} ({size:,} bytes)')
