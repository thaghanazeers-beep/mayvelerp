#!/usr/bin/env python3
"""Generate Mayvel_Task_Flow.docx — ERP lifecycle from top (Workspace) to
bottom (Task + time logging). Uses only Python stdlib so no pip install.

Run:  python3 scripts/build_flow_doc.py
Out:  Mayvel_Task_Flow.docx (in repo root)
"""
import zipfile, os, html
from datetime import datetime

OUT = os.path.join(os.path.dirname(__file__), "..", "Mayvel_Task_Flow.docx")

# ─── XML building blocks ───────────────────────────────────────────────────
def esc(s): return html.escape(str(s), quote=False)

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

def bullet(text, indent=0): return p(text, list_style='bullet', indent=indent)

def code(text):
    return f'''<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/><w:ind w:left="200"/></w:pPr>
<w:r><w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/><w:sz w:val="18"/></w:rPr>
<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'''

def hr_(): return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="C7C7CC"/></w:pBdr></w:pPr></w:p>'
def empty(): return '<w:p/>'

def table(rows, widths=None):
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

def step(num, text):
    """Numbered step for lifecycle walkthroughs."""
    return f'''<w:p><w:pPr><w:ind w:left="540" w:hanging="540"/></w:pPr>
<w:r><w:rPr><w:b/><w:color w:val="2E2A6E"/></w:rPr><w:t xml:space="preserve">{num}.  </w:t></w:r>
<w:r><w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'''

# ─── Content ────────────────────────────────────────────────────────────────
TODAY = datetime.now().strftime("%B %d, %Y")
body = []

# ── Title block ──
body.append(f'''<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="2E2A6E"/></w:rPr>
<w:t xml:space="preserve">Mayvel Task — ERP Lifecycle</w:t></w:r></w:p>''')
body.append(f'''<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:i/><w:sz w:val="22"/><w:color w:val="6E6E73"/></w:rPr>
<w:t xml:space="preserve">Top-to-bottom walkthrough: Workspace → Projects → Budget &amp; Plan → Sprints → Tasks → Time. — {TODAY}</w:t></w:r></w:p>''')
body.append(empty()); body.append(hr_()); body.append(empty())

# ─────────────────────────────────────────────────────────────────
body.append(h("0. The ERP hierarchy at a glance", 1))
body.append(p("Mayvel Task is structured as a strict top-to-bottom hierarchy. Every entity lives inside the one above it."))
body.append(code(
"  Workspace (Teamspace)                ← departments: Marketing, Product Design, ...\n"
"   │\n"
"   ├── Members         (per-workspace role: admin / member / viewer; one is the Owner)\n"
"   │\n"
"   ├── Projects        (org-wide; every workspace sees every project — contributes its own tasks + budget)\n"
"   │      │\n"
"   │      ├── Project Members  (via allocations from approved plans)\n"
"   │      │\n"
"   │      ├── Budget Approval  (ProjectHoursPlan — monthly, per workspace)\n"
"   │      │     │\n"
"   │      │     ├── Plan        (draft state — line items)\n"
"   │      │     ├── Submit      (draft → pending)\n"
"   │      │     ├── Approve     (pending → approved → allocate hours)\n"
"   │      │     └── Reject      (pending → rejected → reopen → draft → resubmit)\n"
"   │      │\n"
"   │      ├── Sprints           (time-boxed iteration; each task belongs to one sprint)\n"
"   │      │\n"
"   │      └── Tasks             (the actual unit of work; status: Not Yet Started → In Progress → In Review → Completed / Rejected)\n"
"   │             │\n"
"   │             ├── Comments / @mentions\n"
"   │             └── Time entries (daily log → weekly slice → approved → P&L)\n"
"   │\n"
"   └── Notifications   (every transition above fires in-app + push + email)\n"
))
body.append(empty())

body.append(p("The rest of this document walks each level top-to-bottom. For each entity we cover: how it's created, who owns it, the state machine, and exactly what fires (UI + backend + emails + workflows) at every transition."))
body.append(empty())

# ============================================================================
# LEVEL 1: WORKSPACE
# ============================================================================
body.append(h("1. Workspace (Teamspace)", 1))
body.append(p("A Workspace (called 'Teamspace' in code) is a department-level container — e.g. Marketing, Product Design, Engineering. Everything else in the system lives inside one. Personal workspaces are private spaces for a single user."))

body.append(h("1.1 Creating a workspace", 2))
body.append(step(1, "An Admin or Super Admin clicks the + next to 'Teamspaces' in the sidebar."))
body.append(step(2, "Modal asks for name + icon + type (org workspace vs personal). Submits to POST /api/teamspaces."))
body.append(step(3, "Backend creates a Teamspace row (name, icon, ownerId = caller, isPersonal flag) and adds the creator as an admin TeamspaceMembership."))
body.append(step(4, "Sidebar refreshes; new workspace appears as the active one."))
body.append(empty())

body.append(h("1.2 Workspace ownership", 2))
body.append(bullet("Each Teamspace.ownerId is the single 'department head'."))
body.append(bullet("Owner powers (only visible to them, or to Super Admin in elevated mode): Time · Plans, Time · Plan Approvals, Time · Week Approvals, Team, Teamspace Control."))
body.append(bullet("Owner can be reassigned via Teamspace Control."))
body.append(bullet("Other admins inside the workspace still get full read/write on tasks/projects but NOT the governance pages."))
body.append(empty())

body.append(h("1.3 Adding members to a workspace", 2))
body.append(step(1, "Super Admin opens Access Control page (sidebar, super-admin only)."))
body.append(step(2, "Scrolls to 'Per-teamspace roles' section, fills the 'Add' row: pick a user, pick a workspace, choose role (viewer / member / admin)."))
body.append(step(3, "Frontend → POST /api/admin/memberships {userId, teamspaceId, role}. Backend upserts TeamspaceMembership row, status: 'active'."))
body.append(step(4, "Sidebar of the added member will show the workspace on their next refresh."))
body.append(empty())

body.append(h("1.4 Per-workspace role matrix", 2))
body.append(table([
    ["Role", "Can view", "Can create / edit", "Can delete", "Governance pages"],
    ["viewer", "Tasks, Projects, Sprints, Workflows", "—", "—", "—"],
    ["member", "All of the above", "Tasks, log time on assigned work", "Own tasks/comments", "—"],
    ["admin", "All of the above", "Projects, Sprints, all Tasks", "Anything in the workspace", "Only if also Owner"],
    ["owner", "Everything in the workspace", "Everything", "Everything", "All — Plans, Approvals, Team, Control"],
], widths=[1100, 2400, 2200, 1600, 1700]))

# ============================================================================
# LEVEL 2: PROJECTS
# ============================================================================
body.append(h("2. Projects (org-wide)", 1))
body.append(p("Projects in Mayvel Task are organization-wide. A project like 'Seyo' or 'Sales' is created once and is visible to every workspace. Each workspace contributes its own tasks + budget within the same project."))
body.append(p("Rationale: real client projects span multiple departments. Design, Dev, and Testing all work on Seyo — they each have their own task list + budget approval inside the single project."))

body.append(h("2.1 Creating a project", 2))
body.append(step(1, "User opens Projects page (within any workspace; the list is org-wide)."))
body.append(step(2, "Clicks + New Project. Modal asks for name, description, icon, color, billing type (Time & Materials or Fixed), contract value (optional)."))
body.append(step(3, "Frontend → POST /api/projects with payload."))
body.append(step(4, "Backend creates a Project row with the caller as createdBy, current workspace as teamspaceId (legacy field; not used for filtering)."))
body.append(step(5, "Project appears in every workspace's Projects list immediately."))
body.append(empty())

body.append(h("2.2 Project owner", 2))
body.append(bullet("Project.ownerId is set when an Admin creates the project. The owner approves the project's monthly hours plan + weekly time slices."))
body.append(bullet("Approval routing: Plan Approvals page (?awaitingMyApproval=1) filters to plans whose project.ownerId matches the current user."))
body.append(bullet("Multiple departments can contribute to the same project but the project has a single owner overseeing the budget."))
body.append(empty())

body.append(h("2.3 Project members + allocations", 2))
body.append(p("There is no explicit 'project membership' table. A user becomes a 'project member' implicitly when they have an Allocation in that project. Allocations are auto-created when a ProjectHoursPlan is approved + 📅 Allocate hours is clicked."))
body.append(empty())

# ============================================================================
# LEVEL 3: BUDGET / PROJECTHOURSPLAN
# ============================================================================
body.append(h("3. Budget Approval — ProjectHoursPlan lifecycle", 1))
body.append(p("Each (project × month × workspace) gets one ProjectHoursPlan. The plan owner (typically the workspace owner) builds out the line items, submits for approval, and the project owner approves or rejects."))

body.append(h("3.1 State machine", 2))
body.append(code("draft → pending → approved\n                ↓\n              rejected → (reopen) → draft → ..."))

body.append(h("3.2 Create the plan", 2))
body.append(step(1, "Workspace owner opens Time · Plans page."))
body.append(step(2, "Top of page: project picker dropdown. Picks the project (e.g., 'Seyo')."))
body.append(step(3, "Table below shows that owner's existing plans for the project, with status + approval history."))
body.append(step(4, "Clicks + New Plan → modal asks for month + optional title. Defaults to '<Project> <Month> Approval'."))
body.append(step(5, "Frontend → POST /api/time/plans {projectId, periodMonth, title?}."))
body.append(step(6, "Backend creates ProjectHoursPlan with status='draft', createdBy=owner.name."))
body.append(step(7, "Toast: 'Draft plan created — add rows and submit when ready'. User redirected to Plan Editor."))
body.append(empty())

body.append(h("3.3 Build out the plan (Plan editor)", 2))
body.append(p("Each row in the plan is a slice of work: task type + rate bucket + assignee + planned hours. Cost & revenue computed live."))
body.append(bullet("+ Add row → POST /api/time/plans/:id/lines. Backend defaults: 8 hours, billable, distribution Continuous, rate bucket = Junior, bill rate = project's defaultBillRateCents."))
body.append(bullet("Inline cell edit → PUT /api/time/plans/:id/lines/:lineId. Recomputes plan totals on every patch."))
body.append(bullet("Bottom card shows: Total billable hours, Total non-billable, Cost, Revenue, Projected Profit, Margin %."))
body.append(bullet("Over-budget guard: if approving would push committed cost past project.contractValueCents, a warning is shown at submit time."))
body.append(empty())

body.append(h("3.4 Submit for approval", 2))
body.append(step(1, "Owner clicks 📤 Submit for Approval. Confirm dialog: 'Submit … for approval? Rates will be frozen.'"))
body.append(step(2, "Frontend → POST /api/time/plans/:id/submit."))
body.append(step(3, "Backend validates: status is draft or rejected; plan has ≥1 line; every billable line has a bill rate."))
body.append(step(4, "refreezeRates(plan): snapshots current rate-bucket cost rates onto each line. After this, rate-bucket edits won't ripple back into the plan."))
body.append(step(5, "Status: draft → pending. submittedAt + submittedBy set. TimesheetAudit row written ('submit')."))
body.append(step(6, "notify('plan_submitted') fires for every Admin in the workspace. Three channels — in-app row, web push, email via Brevo. Email subject: 'New project hours plan awaiting approval', button → /tasks/<id> (links into Mayvel Task)."))
body.append(step(7, "workflowEngine.fire('plan_submitted') runs any user-defined automation."))
body.append(step(8, "Toast: 'Plan submitted for approval — owner will be notified'."))
body.append(empty())

body.append(h("3.5 Approve a plan — full flow", 2))
body.append(p("The project owner is the only non-Super-Admin who can approve."))
body.append(step(1, "Project owner opens Plan Approvals page → filtered to plans awaiting their approval (?awaitingMyApproval=1)."))
body.append(step(2, "Clicks into the plan. Reviews each line + totals. Sees the project's financial forecast banner if contractValueCents is set."))
body.append(step(3, "Clicks ✅ Approve. If approving would push committed cost > contract, a confirm dialog warns 'This will overrun by ₹X — approve anyway?'"))
body.append(step(4, "Frontend → POST /api/time/plans/:id/approve."))
body.append(step(5, "Backend: status: pending → approved. approvedAt + approvedBy set. TimesheetAudit row written."))
body.append(step(6, "notify('plan_approved', userId: plan.createdBy) — in-app + push + email. Subject: 'Project hours plan approved ✅'."))
body.append(step(7, "workflowEngine.fire('plan_approved')."))
body.append(step(8, "Toast: 'Plan approved'. The plan is now read-only (clone to revise)."))
body.append(step(9, "Owner clicks 📅 Allocate hours → POST /api/time/plans/:id/allocate. Backend creates weekly Allocation rows per (user × week). For each user with allocations: notify('allocation_created') with their hours + the project name."))
body.append(empty())

body.append(h("3.6 Reject a plan — full flow", 2))
body.append(step(1, "Project owner opens the pending plan, clicks ❌ Reject."))
body.append(step(2, "Modal asks for a reason (minimum 10 characters). 'Bill rate too low for Lead role — revise to ₹4500/hr', e.g."))
body.append(step(3, "Frontend → POST /api/time/plans/:id/reject {reason}."))
body.append(step(4, "Backend: status: pending → rejected. rejectedAt + rejectedBy + rejectionReason set. Audit row 'reject' with reason."))
body.append(step(5, "notify('plan_rejected', userId: plan.createdBy) — in-app + push + email. Subject: 'Project hours plan rejected ❌'. Message body includes the rejection reason verbatim."))
body.append(step(6, "workflowEngine.fire('plan_rejected', {reason})."))
body.append(step(7, "Toast: 'Plan rejected — owner notified'."))
body.append(step(8, "Owner sees the rejected plan on their Time · Plans page with red badge + the rejection date + reason."))
body.append(step(9, "Owner clicks 🔁 Reopen → status flips back to draft, editing unlocked. Address the reason, click Submit again."))
body.append(empty())

body.append(h("3.7 What changes financially on approve vs reject", 2))
body.append(table([
    ["Side effect", "On approve", "On reject"],
    ["Plan status", "approved", "rejected"],
    ["Owner notified?", "Yes (plan_approved email + push)", "Yes (plan_rejected, with reason in body)"],
    ["Cost committed to project P&L?", "Yes — totals roll into committedCost", "No — plan excluded from financials"],
    ["Allocations created?", "Optional, via 📅 Allocate hours", "No"],
    ["Lock?", "Yes — clone to revise", "No — owner can Reopen → draft → resubmit"],
    ["Audit trail?", "'approve' entry", "'reject' entry with reason"],
], widths=[2400, 3300, 3300]))

# ============================================================================
# LEVEL 4: SPRINTS
# ============================================================================
body.append(h("4. Sprints", 1))
body.append(p("Sprints are time-boxed iterations within a project — typically 1-2 weeks. Each task lives in at most one sprint. Sprints have a start date, end date, and status: planned / active / completed."))

body.append(h("4.1 Creating a sprint", 2))
body.append(step(1, "Admin opens the Sprints page within a workspace."))
body.append(step(2, "Clicks + New Sprint. Modal asks for name, start/end dates, goal."))
body.append(step(3, "Frontend → POST /api/sprints. Status defaults to 'planned'."))
body.append(empty())

body.append(h("4.2 Sprint lifecycle", 2))
body.append(bullet("planned → active (POST /api/sprints/:id/start) — marks today as the active sprint, all tasks added to it count toward velocity."))
body.append(bullet("active → completed (POST /api/sprints/:id/complete) — optionally rolls unfinished tasks into a successor sprint via rolloverSprintId."))
body.append(bullet("Tasks can be added or removed from a sprint at any time (POST /api/sprints/:id/tasks, DELETE …)."))
body.append(empty())

# ============================================================================
# LEVEL 5: TASKS
# ============================================================================
body.append(h("5. Tasks — the unit of work", 1))
body.append(p("Tasks live inside a workspace, optionally a project, optionally a sprint. Status moves them through the lifecycle. Every status transition fires notifications + workflow hooks."))

body.append(h("5.1 Status state machine", 2))
body.append(code("Not Yet Started → In Progress → In Review → Completed   (happy path)\n"
                  "                                    ↓\n"
                  "                                 Rejected → (rework) → Not Yet Started → ...\n"
                  "(any status) → Deleted (hard delete)"))

body.append(h("5.2 Create a task", 2))
body.append(step(1, "Admin / member opens Tasks page or a Project's task list, clicks + New Task."))
body.append(step(2, "Modal asks for title, description, assignee, priority, due date, project, sprint (optional)."))
body.append(step(3, "Frontend → POST /api/tasks. Backend checks: requireTeamspaceMembership (caller must be in the workspace)."))
body.append(step(4, "ERP gate (non-admins only): the chosen assignee must have an active Allocation in the project. Prevents over-committing hours past the approved plan. If no allocation, returns 403 with explanation."))
body.append(step(5, "Task saved. workflowEngine.fire('task_created') runs any matching workflow."))
body.append(step(6, "If assignee ≠ creator: createNotification('task_created') for the assignee. In-app row + web push to subscribed browsers + email via Brevo. Email subject: 'New task created', button → /tasks/<id>."))
body.append(step(7, "Notification carries teamspaceId so the per-workspace sidebar bell badge increments."))
body.append(empty())

body.append(h("5.3 Status transitions — what fires at each move", 2))
body.append(table([
    ["From → To", "Who is notified", "Notification type", "Workflow trigger"],
    ["any → In Review", "All global Admins", "review_requested", "status_changed"],
    ["In Review → Completed", "Assignee", "task_completed", "status_changed"],
    ["any → Rejected", "Assignee", "task_rejected (with comment if any)", "status_changed"],
    ["other moves", "Assignee", "status_changed (catch-all)", "status_changed"],
    ["Assignee changed", "New assignee", "task_assigned", "assignee_changed"],
    ["Project changed", "—", "—", "task_moved_to_project"],
    ["Any edit", "—", "—", "task_updated"],
], widths=[1900, 1800, 2600, 1800]))

body.append(h("5.4 Reject a task — full flow", 2))
body.append(step(1, "Admin opens the task (currently in 'In Review'). Optionally adds a comment explaining what's wrong."))
body.append(step(2, "Changes status from 'In Review' to 'Rejected'. Frontend → PUT /api/tasks/:id {status:'Rejected', updatedBy:<admin>}."))
body.append(step(3, "Backend updates the task. Compares old vs new status; sees Rejected."))
body.append(step(4, "createNotification('task_rejected', userId: task.assignee). Title 'Task Rejected ❌'. Message includes who rejected + 'Please rework.'"))
body.append(step(5, "Three channels fire in parallel:"))
body.append(bullet("In-app row in notifications collection (bell badge increments + per-workspace sidebar bell badge)", indent=2))
body.append(bullet("Web push to assignee's subscribed browsers (FCM) — OS-level toast pops up", indent=2))
body.append(bullet("Email via Brevo HTTPS API to assignee's inbox — 'Open task' button → /tasks/<id>", indent=2))
body.append(step(6, "workflowEngine.fire('status_changed', {fromStatus:'In Review', toStatus:'Rejected'}) — custom user-defined workflows run."))
body.append(step(7, "Auto-rebound: if the assignee subsequently edits any reviewed field (title, description, attachments, dueDate, estimatedHours, customProperties) WITHOUT explicitly changing status, the task automatically flips back to 'Not Yet Started'. So rework is visible in the active queue without manual flipping."))
body.append(step(8, "Assignee can also chain: Rejected → In Progress → In Review again, full cycle."))
body.append(empty())

body.append(h("5.5 Approve a task (Completed)", 2))
body.append(step(1, "Admin views a task in 'In Review' status. Changes to 'Completed'."))
body.append(step(2, "Backend fires createNotification('task_completed', userId: assignee). Subject: 'Task Approved ✅'."))
body.append(step(3, "Three channels fire. workflowEngine.fire('status_changed'). Task locks (still editable but appears under Completed list)."))
body.append(empty())

body.append(h("5.6 Delete a task", 2))
body.append(step(1, "Admin / task owner clicks Delete → confirm dialog."))
body.append(step(2, "Frontend → DELETE /api/tasks/:id?actor=<name>."))
body.append(step(3, "Backend reads the task, performs findOneAndDelete, then fires createNotification('task_deleted'). Recipients: assignee AND creator (excluding the actor; deduped)."))
body.append(step(4, "Each recipient gets in-app + push + email."))
body.append(empty())

body.append(h("5.7 Comments + @mentions", 2))
body.append(step(1, "User posts a comment via POST /api/tasks/:id/comments {body}."))
body.append(step(2, "Backend parses @mentions (lookup users by name)."))
body.append(step(3, "For each mentioned user (excluding the author): createNotification('comment_mention'). Title: '<author> mentioned you'. Message: comment body excerpt."))
body.append(step(4, "If task has an assignee who is neither the author nor already mentioned: createNotification('task_comment') for them."))
body.append(empty())

# ============================================================================
# LEVEL 6: TIME ENTRIES
# ============================================================================
body.append(h("6. Time entries — the bottom of the chain", 1))
body.append(p("Once a plan is approved + hours allocated, members log daily time against their allocations. End of week → submit → owner approves → cost rolls into project actuals."))

body.append(h("6.1 Daily logging (My Timesheet)", 2))
body.append(step(1, "Member opens My Timesheet page. Sees current week's allocations from approved plans."))
body.append(step(2, "Enters daily hours per allocation. Frontend uses PUT /api/time/entries (optimistic, batched)."))
body.append(step(3, "Each entry is gated by the allocation's plannedHours cap — you can't exceed."))
body.append(empty())

body.append(h("6.2 Submit week", 2))
body.append(step(1, "End of week: member clicks 📤 Submit week on My Timesheet."))
body.append(step(2, "Frontend → POST /api/time/periods/:id/submit."))
body.append(step(3, "Backend splits the week into one TimesheetSlice per project the member worked on. Each slice is routed to that project's owner."))
body.append(step(4, "For each project owner: notify('time_submitted'). Subject 'Weekly time submitted for your approval'. Message includes hours, project, week start. In-app + push + email."))
body.append(empty())

body.append(h("6.3 Approve / Reject a week slice", 2))
body.append(step(1, "Project owner opens Time · Week Approvals page."))
body.append(step(2, "List shows slices awaiting their approval, one per (project × member × week)."))
body.append(step(3, "Approve → POST /api/time/slices/:id/approve. notify('time_approved') to the submitter. Cost rolls into project's actualCostCents."))
body.append(step(4, "Reject → POST /api/time/slices/:id/reject {reason ≥10 chars}. notify('time_rejected') with the reason. Member's TimeEntries flip back to 'draft' status so they can revise + resubmit."))
body.append(empty())

# ============================================================================
# CROSS-CUTTING
# ============================================================================
body.append(h("7. Cross-cutting concerns", 1))

body.append(h("7.1 Notification system (three channels)", 2))
body.append(p("Every entity transition above creates a Notification document. The single helper createNotification() fans out to three channels in parallel, all gated by the recipient's notificationPrefs[type]:"))
body.append(table([
    ["Channel", "How", "When"],
    ["In-app", "Mongo row in 'notifications', polled by bell every 5s", "Always"],
    ["Web Push", "POST to FCM endpoint via web-push lib + VAPID keys", "If user clicked 🔔 Enable push"],
    ["Email", "POST to https://api.brevo.com/v3/smtp/email (HTTPS port 443)", "If MAIL_FROM + BREVO_API_KEY env set"],
], widths=[1300, 4500, 3200]))
body.append(p("Each notification carries the teamspaceId of the underlying object so the sidebar can show per-workspace unread badges. Click a notification → uses notification.teamspaceId for routing (not active workspace), so deep links work cross-workspace."))
body.append(empty())

body.append(h("7.2 Access control (Super Admin only)", 2))
body.append(bullet("Super Admin = single workspace owner. User.isSuperAdmin = true."))
body.append(bullet("/access page: list/create/delete users, change global role, manage per-workspace memberships, see CRUD permission matrix."))
body.append(bullet("Public signup is OFF — only Super Admin creates users."))
body.append(bullet("Super Admin / Normal mode toggle in header — sandboxes Super Admin into a regular-Admin view for testing."))
body.append(bullet("'👁️ View as <user>' impersonation — Super Admin signs a JWT as another user, full reload, sees the app as them. Yellow banner + Switch-back button."))
body.append(empty())

body.append(h("7.3 Org chart", 2))
body.append(bullet("Read-only for everyone except Super Admin in elevated mode."))
body.append(bullet("Backend (PUT /api/orgchart) rejects non-super-admin with 403 — so no curl bypass."))
body.append(bullet("Captures: nodes (memberId / name / role / department / position), edges (manager → report)."))
body.append(empty())

body.append(h("7.4 Toasts", 2))
body.append(p("Every action that changes state fires a toast pill top-right. Success (green) / Error (red) / Info (purple). Replaces window.alert across the codebase. Pattern: const toast = useToast(); toast.success('Saved')."))
body.append(empty())

body.append(h("7.5 Audit + custom workflows", 2))
body.append(bullet("Every plan + slice transition writes a TimesheetAudit row capturing actor + before/after + reason."))
body.append(bullet("Workflow Engine lets admins build no-code automation: 'When status → In Review, ping #design-review on Slack'."))
body.append(bullet("Trigger events fired by code: task_created, status_changed, assignee_changed, task_updated, task_moved_to_project, plan_submitted, plan_approved, plan_rejected."))
body.append(empty())

# ============================================================================
# WORKED EXAMPLE
# ============================================================================
body.append(h("8. End-to-end worked example", 1))
body.append(p("Following the hierarchy top-to-bottom for a single piece of work:"))
body.append(step(1, "Super Admin creates 'Marketing' workspace (POST /api/teamspaces). Sets Pooja as owner."))
body.append(step(2, "Adds Karthick, HR, Thaha as workspace members via /access page → POST /api/admin/memberships."))
body.append(step(3, "Karthick creates a new project 'Sales' (POST /api/projects, ownerId=Pooja). Project is org-wide so every workspace sees it."))
body.append(step(4, "Pooja (as project owner + workspace owner) opens Time · Plans → picks 'Sales' → + New Plan for May 2026. Builds rows: Lead 80h @ ₹4500, Junior 120h @ ₹2500. Total cost ₹6.6L, revenue ₹9L."))
body.append(step(5, "Pooja clicks Submit. Plan status: draft → pending. notify('plan_submitted') fires to all admins. Pooja (as project owner) also receives it since she's the approver."))
body.append(step(6, "Pooja reviews her own plan + clicks ✅ Approve. Status → approved."))
body.append(step(7, "Clicks 📅 Allocate hours. Backend creates weekly Allocation rows for the 2 users. They receive 'allocation_created' notifications."))
body.append(step(8, "Karthick creates a Sprint 'May Sprint 1' (Apr 28 – May 11). Then creates a task 'Landing page redesign' in the Sales project, assigned to Pooja, added to May Sprint 1."))
body.append(step(9, "Pooja receives 'task_created' notif via in-app + push + email at pooja.s@mayvel.ai. Email button → /tasks/<id>."))
body.append(step(10, "Pooja moves task: Not Yet Started → In Progress. Logs 4 hours/day on My Timesheet against her Sales allocation."))
body.append(step(11, "Friday: Pooja submits week. Slice routed to project owner (herself). She approves → cost rolls into Sales actuals."))
body.append(step(12, "Pooja finishes the work, moves task to In Review. All Admins receive 'review_requested'."))
body.append(step(13, "Karthick reviews, finds an issue, leaves a comment '@Pooja the CTA color is wrong', changes status to Rejected."))
body.append(step(14, "Pooja receives: 'comment_mention' (Karthick mentioned you) AND 'task_rejected' (Karthick rejected this task). Both via in-app + push + email."))
body.append(step(15, "Pooja fixes the issue. Auto-rebound: editing the task description while in Rejected status flips it back to Not Yet Started."))
body.append(step(16, "Pooja → In Progress → In Review again. Karthick → Completed. Pooja receives 'task_completed'."))
body.append(step(17, "End of month: Sales project P&L reflects approved plan cost vs actual hours logged. Variance + margin live on the project dashboard."))
body.append(empty())

body.append(hr_())
body.append(p(f"Document generated {TODAY} — regenerate via python3 scripts/build_flow_doc.py", italic=True, size=18, color="6E6E73"))

# ─── Assemble docx ───────────────────────────────────────────────────────────
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
    z.writestr('word/numbering.xml', numbering)
    z.writestr('word/document.xml', document_xml)

print(f'✅ Wrote {OUT} ({os.path.getsize(OUT):,} bytes)')
