# Timesheet (ERP v1) — Product Requirements (revised)

> **Revised after the Excel screenshot + decisions thread.** The actual workflow is **budget-gated** — a Project Owner submits a monthly hours plan, Admin (Murali) approves, the Owner splits it into weekly buckets per user, users log time against their allocated tasks (hard-capped), and the Project Owner reviews each user's week on Friday EOD.

---

## 0. Decisions locked in (from user, do not relitigate)

| # | Decision |
|---|---|
| 1 | **Currency**: ₹ INR, hardcoded throughout. Stored as `cents` (paise) integers to avoid floats. |
| 2 | **Plan periodicity**: **Monthly** — one plan per project per calendar month. Unique `(projectId, periodMonth)` index. |
| 3 | **Plan approval scope**: per-plan (admin approves the whole plan or rejects it). |
| 4 | **Cost formula**: `cost = user.bucket.ratePerHourCents × hours`. Sum across lines / entries for project / period totals. |
| 5 | **Working days**: **Mon–Fri only**. Sat/Sun count as 0 working hours. |
| 6 | **Rate freeze**: When a plan is **submitted** for approval, every line snapshots `frozenRateCents` from `user.rateBucket.ratePerHourCents`. Subsequent rate-bucket changes don't affect the plan. |
| 7 | **Cap behavior**: **Hard cap** — server returns `400` and the UI blocks any time entry that would push `consumedHours > allocatedHours` for that allocation bucket. |
| 8 | **Project.ownerId**: New field. Project Owner is who builds the monthly plan + does weekly time approvals. |
| 9 | **Weekly approval routing**: The **Project Owner** approves their employees' weekly time (not the OrgChart manager). When a user logs time on multiple projects in one week, the week is **split into per-project slices** and each slice is routed to that project's owner independently. The user's overall week is "fully approved" only when every project slice is approved. |
| 10 | **Approval cadence**: Friday EOD — workflow trigger fires every Friday at 18:00 local, emailing Project Owners the week's pending slices. |
| 11 | **Expense buckets** (ExpensesBucket1–4): flat cost lines on a plan, no time logging. They contribute to plan total cost and project actual cost (since they're approved budget commitments). |
| 12 | **Dashboard**: Adds project-cost, P&L (budget vs actual), loss/overrun widgets, and time-pipeline (pending plan / pending week) status. See §11. |
| 13 | **Re-allocation when time is logged**: blocked. Owner must reduce allocation only on un-consumed buckets, or re-issue the plan. |
| 14 | **RAG thresholds**: 0–80% green, 80–110% amber, >110% red. Computed against elapsed-time-in-month. |
| 15 | **Billable vs non-billable budgets**: Each plan has BOTH a billable budget and a non-billable budget, each its own approval row in the totals. **Billable hours generate Revenue** (× project bill-rate); **all hours generate Cost** (× resource cost-rate). **Project P&L = Revenue − Cost**. See §3.4–3.5 for the schema and §11 for the dashboard breakdown. |

---

## 1. The flow in one diagram

```
              ┌──────────────────────────────────────────────────────────────┐
              │  STAGE 1 — Plan & Budget Approval (admin gate)               │
              │                                                              │
   Project    │  draft  ──submit──▶  pending  ──approve──▶  approved        │
   Owner      │                            │                                 │
              │                            └──reject──▶  rejected (reopen)   │
              └──────────────┬───────────────────────────────────────────────┘
                             │ (only after approval)
                             ▼
              ┌──────────────────────────────────────────────────────────────┐
              │  STAGE 2 — Allocation                                        │
              │                                                              │
   Project    │  Owner distributes the approved plan into per-user weekly /  │
   Owner      │  monthly buckets. System creates the tasks + per-user time   │
              │  caps. User sees allocated tasks in their Timesheet.         │
              └──────────────┬───────────────────────────────────────────────┘
                             │ (only allocated users)
                             ▼
              ┌──────────────────────────────────────────────────────────────┐
              │  STAGE 3 — Time logging & weekly submission                  │
              │                                                              │
   Member     │  draft entries  ──submit week──▶  pending  ──approve──▶  ok  │
              │                                          │                    │
              │  (entries capped to allocation; flagged ──reject──▶ rejected) │
              │   if user logs > allocated hours)                             │
              └──────────────────────────────────────────────────────────────┘
```

Three stages, three different approvers:
- **Stage 1 — Plan approval**: Admin (only Murali / teamspace `role: admin`).
- **Stage 2 — Allocation**: no approval; Project Owner does it after Stage 1 approves.
- **Stage 3 — Weekly time approval**: Manager from OrgChart (already exists in `OrgContext`).

Time cannot be logged on a task whose plan hasn't been approved AND whose allocation hasn't been set for the user.

---

## 2. Personas & permissions

| Persona | Capabilities |
|---|---|
| **Member** | See own allocated tasks. Log time within allocation. Submit weekly time. View own history. |
| **Project Owner** | All Member rights + create/edit/submit Project Hours Plan (Stage 1). After approval, allocate hours to users (Stage 2). View team utilization on their projects. |
| **Manager** (OrgChart parent) | All Member rights + approve/reject direct reports' weekly time (Stage 3). |
| **Admin** (`role: admin`, e.g. Murali) | Approve/reject Project Hours Plans (Stage 1). Override allocations. Manage rate buckets. All Manager + Owner rights. |
| **Viewer** | Read-only on plans, allocations, reports. |

---

## 3. Data model

### 3.1 New: `RateBucket` (one collection per teamspace)

The seniority bucket → rate-per-hour map from your Excel screenshot.

```js
{
  _id, teamspaceId,
  name,                      // "Trainee" | "Junior" | "Associate" | "Manager" | "Lead" | "Senior" | "Management" | ...
  ratePerHourCents,          // store cents to avoid float mistakes (501 → 50100)
  kind,                      // 'labor' | 'expense'
  active,                    // bool
}
```
Seeded with the buckets from your sheet:

| Bucket | kind | Rate (₹/hr) | cents |
|---|---|---|---|
| Trainee | labor | 346 | 34600 |
| Junior | labor | 501 | 50100 |
| Associate | labor | 696 | 69600 |
| Lead | labor | 1040 | 104000 |
| Manager | labor | 1398 | 139800 |
| Management | labor | 1760 | 176000 |
| Senior | labor | 2431 | 243100 |
| ExpensesBucket1 | expense | 2000 | 200000 |
| ExpensesBucket2 | expense | 5000 | 500000 |
| ExpensesBucket3 | expense | 10000 | 1000000 |
| ExpensesBucket4 | expense | 25000 | 2500000 |

### 3.2 `User` — additions
```js
{
  ...existing,
  rateBucketId: ObjectId('RateBucket'),   // links the user to their rate bucket
}
```
Backfill script seeds these from the user's name → bucket mapping in your screenshot.

### 3.3 `Project` — additions
```js
{
  ...existing,
  ownerId,                          // REQUIRED — User who owns the plan & approves weekly time slices for this project
  taskTypes,                        // optional override of allowed task types; defaults to global list
  defaultBillRateCents,             // OPTIONAL — default per-hour billing rate to client for THIS project's billable lines.
                                    //   Used as the default when adding a billable plan line; line can override.
                                    //   When 0/null, the project is "internal" — no revenue, only cost.
  trackTime: true,
  active: true,
}
```
Two distinct rates live in the system:

- **Cost rate** = `User.rateBucket.ratePerHourCents` — what the company *pays* for that resource (Trainee 346 ₹/hr, etc.). Used for cost calculation on every entry.
- **Bill rate** = `Project.defaultBillRateCents` (or per-line override) — what the *client pays* for one billable hour. Used for revenue calculation, but only on entries flagged `billable: true`.

Validation: `ownerId` must be a teamspace member. Backfill script picks an admin per project until owners are assigned through the UI.

### 3.4 New: `ProjectHoursPlan` — the monthly approval document

Each plan tracks **billable** and **non-billable** budgets side-by-side. The admin approves the whole plan; both budgets get committed together.

```js
{
  _id, teamspaceId, projectId,
  title,                            // auto = "<MMM YYYY> — <ProjectName>", editable
  periodMonth,                      // YYYY-MM (e.g. "2026-05") — UNIQUE per (projectId, periodMonth)
  periodStart, periodEnd,           // first and last calendar day of that month (computed; cached for queries)
  status,                           // 'draft' | 'pending' | 'approved' | 'rejected'

  // ── Hours (denormalized, recomputed on line write) ──
  totalPlannedHours,                // SUM(line.plannedHours)
  billablePlannedHours,             // SUM(line.plannedHours WHERE billable = true)
  nonBillablePlannedHours,          // SUM(line.plannedHours WHERE billable = false)

  // ── Cost (what the company spends — applies to ALL hours) ──
  totalCostCents,                   // SUM(line.plannedHours * line.frozenRateCents)
  billableCostCents,                // cost of billable lines (the cost-side of revenue work)
  nonBillableCostCents,             // cost of non-billable lines (pure overhead)

  // ── Revenue (what we'll bill the client — only billable lines) ──
  totalRevenueCents,                // SUM(line.plannedHours * line.frozenBillRateCents) for billable lines

  // ── Actuals (recomputed from approved TimeEntries) ──
  totalActualHours,
  billableActualHours, nonBillableActualHours,
  totalActualCostCents,             // cost of every approved entry
  billableActualCostCents, nonBillableActualCostCents,
  totalActualRevenueCents,          // revenue from approved billable entries

  // ── P&L ──
  plannedProfitCents,               // totalRevenueCents - totalCostCents
  actualProfitCents,                // totalActualRevenueCents - totalActualCostCents
  plannedMarginPct,                 // plannedProfit / totalRevenue (0 when revenue is 0)
  actualMarginPct,                  // actualProfit / totalActualRevenue
  variancePctCached,                // (totalActualCostCents - totalCostCents) / totalCostCents

  ragStatus,                        // 'green' | 'amber' | 'red' (see §6.4)
  submittedAt, submittedBy,
  approvedAt, approvedBy,           // admin
  rejectedAt, rejectedBy, rejectionReason,
  attachmentId,                     // optional original Excel upload
  createdAt, updatedAt, createdBy, updatedBy,
}
```
Indexes: **unique** `(teamspaceId, projectId, periodMonth)`, `(teamspaceId, status)`.

Plan editor totals row will show **both** sub-totals like:

```
                                BILLABLE      NON-BILLABLE      TOTAL
Planned hours                   210h          40h               250h
Cost                            ₹150,000      ₹28,000           ₹178,000
Revenue (× bill rate ₹2,500)    ₹525,000      —                 ₹525,000
                                                                ─────────
                                Planned Profit (Revenue − Cost) ₹347,000
                                Planned Margin                  66.1%
```

### 3.5 New: `ProjectHoursPlanLine` — one row per (taskType + assignee + billable flag)

Mirrors your Excel sheet 1-for-1, with `billable` as the new column that flips the line between revenue-generating and overhead.

```js
{
  _id, planId, teamspaceId,
  taskType,                         // "Support" | "Maintenance" | "Design" | … (from §3.6)
  billable,                         // BOOLEAN — billable line (revenue+cost) vs non-billable (cost-only)
  assigneeUserId,                   // FK to User (or null if it's an expense bucket — then assigneeBucketId is set)
  assigneeBucketId,                 // FK to RateBucket (used for expense lines AND for snapshotting frozen rate)
  frozenRateCents,                  // FROZEN cost rate at submission time = line.assignee.bucket.ratePerHourCents
  frozenBillRateCents,              // FROZEN bill rate at submission time = project.defaultBillRateCents (or override)
                                    //   Only meaningful when `billable: true`. 0 for non-billable lines.
  billRateOverrideCents,            // optional — set if Owner overrode the project's default bill rate for this line
  startDate, targetDate,            // YYYY-MM-DD; constrained to within the plan's periodMonth
  plannedHours,                     // integer
  actualHours,                      // recomputed from approved TimeEntries linked to this line
  distributionType,                 // 'Continuous' | 'Distributed' | 'Open'
  perDayDistribution,               // hours/day; null when 'Open'. Spread across Mon–Fri only (Sat/Sun excluded).
  perDayOverrides,                  // { 'YYYY-MM-DD': hours } — used when 'Distributed'; weekend dates rejected
  status,                           // 'Yet-To-Start' | 'In-Progress' | 'On-hold' | 'Completed' | 'Cancelled'
  ragStatus,                        // computed per row (see §6.4)
  costCents,                        // plannedHours * frozenRateCents — auto-computed
  revenueCents,                     // billable ? plannedHours * frozenBillRateCents : 0 — auto-computed
  actualCostCents,                  // SUM(TimeEntry.costCents) for entries on this line — auto-computed
  actualRevenueCents,               // billable ? SUM(approved entries hours * frozenBillRateCents) : 0
  notes,
  taskId,                           // populated AFTER allocation; the Task doc spawned from this line
}
```
Validation:
- `assigneeUserId` XOR `assigneeBucketId` (an expense line has no user).
- `targetDate <= plan.periodEnd`.
- For `billable: true` lines, either project must have `defaultBillRateCents > 0` OR `billRateOverrideCents > 0` — otherwise the plan can't be submitted.
- Expense buckets (no time logged against them) can be billable too — admin sometimes bills licenses/subscriptions to clients with markup.

### 3.6 New: `TaskType` — the picklist used everywhere

A small editable list (admin-managed). Seeded with your sheet:
`Analysis & Documentation, Deployment, Design, Development, Digital Marketing, Maintenance, Project Management, Sales, Support, Testing, Training, UAT`.

Stored as `{ teamspaceId, name, sortOrder, active }`. Used by:
- Plan line picker
- Task `taskType` field (existing — currently free-form `[String]`; we'll constrain it via the picklist).

### 3.7 New: `Allocation` — Stage 2 output, per user per **week**

When the Owner clicks "Allocate" after a plan is approved, the system creates one Allocation row per (user, plan-line, ISO-week within the plan's month). **Bucket is always `week`** since the user said "split into weekly approval".

```js
{
  _id, teamspaceId, planId, planLineId,
  userId, projectId, taskId,        // taskId = the Task auto-created from the plan line
  bucket: 'week',                   // fixed for v1
  weekStart, weekEnd,               // YYYY-MM-DD; weekStart is always a Monday, weekEnd is Friday
                                    //   (Sat/Sun excluded — no working hours possible)
  allocatedHours,                   // hours the user can log against this task in this week
  consumedHours,                    // recomputed sum of TimeEntries
  remainingHours,                   // = allocatedHours - consumedHours; cannot go negative (hard cap)
  billable,                         // copied from planLine.billable
  frozenRateCents,                  // copied from planLine.frozenRateCents (cost rate)
  frozenBillRateCents,              // copied from planLine.frozenBillRateCents (bill rate; 0 for non-billable)
  status,                           // 'active' | 'closed' (manual close by Owner)
}
```
Indexes: `(userId, weekStart)`, `(projectId, weekStart)`, `(planLineId)`.

### 3.8 `TimeEntry` (with allocation guard + per-project-slice approval)

```js
{
  _id, teamspaceId, userId,
  date,                             // YYYY-MM-DD; weekend dates are REJECTED (Mon–Fri only)
  projectId, taskId,                // taskId is REQUIRED — no ad-hoc time without an allocated task
  allocationId,                     // FK to Allocation; this is what the entry decrements
  minutes,                          // integer
  notes,
  billable,                         // copied from allocation.billable (which came from planLine.billable)
  costCents,                        // (minutes/60) * allocation.frozenRateCents — what the company spends
  revenueCents,                     // billable ? (minutes/60) * allocation.frozenBillRateCents : 0 — what we'll bill the client
  periodId,                         // FK to TimesheetPeriod (the user's week)
  sliceId,                          // FK to TimesheetSlice (per-project slice that this entry belongs to)
  status,                           // 'draft' | 'submitted' | 'approved' | 'rejected'
  createdAt, updatedAt, createdBy, updatedBy,
}
```
Server enforces on POST/PUT: `(allocation.consumedHours + delta) <= allocation.allocatedHours`. Otherwise 400.

### 3.9 New: `TimesheetSlice` — per-project slice of a user's week (the unit of approval)

The user's week is split into one slice per project they touched. Each slice is approved/rejected independently by **that project's owner**.

```js
{
  _id, teamspaceId, userId, periodId,
  projectId, projectOwnerId,        // routing target; snapshot from project.ownerId at submit time
  weekStart, weekEnd,               // mirrors the period's week
  totalMinutes, totalCostCents,
  status,                           // 'open' | 'submitted' | 'approved' | 'rejected'
  submittedAt, approvedAt, rejectedAt, rejectedReason,
  approverId,                       // who approved/rejected
}
```
Indexes: unique `(userId, projectId, weekStart)`, `(projectOwnerId, status)` for the approval queue.

### 3.10 `TimesheetPeriod` (now an aggregate of slices)

```js
{
  _id, teamspaceId, userId,
  weekStart, weekEnd,               // Monday–Friday
  status,                           // 'open' | 'submitted' | 'partially_approved' | 'approved' | 'rejected'
  totalMinutes, totalCostCents,
  sliceCount, approvedSliceCount,
  ...timestamps
}
```
The period is **fully approved** only when `approvedSliceCount === sliceCount` and no slice is `rejected`.

### 3.9 `TimesheetPeriod`, `TimesheetAudit`
Same as draft v1 (Mon–Sun period; submit/approve flow). See §5 of the original draft for fields.

---

## 4. Stage 1 — Project Hours Plan (the Excel-style approval)

### 4.1 Owner builds the plan

Sidebar → **Time** → **Project Plans** → **+ New Plan**.

Each plan opens in a grid that mirrors your Excel exactly — same columns, same colors, same layout:

```
Plan: "May 2026 — Marketing"           Project: Marketing             [Draft] [Submit for Approval]
─────────────────────────────────────────────────────────────────────────────────────────────────
Task Type    │ Assigned To     │ Start    │ Target   │ Planned │ Actual │ Distrib   │ Per Day │ Status        │ RAG │ Total Cost
─────────────┼─────────────────┼──────────┼──────────┼─────────┼────────┼───────────┼─────────┼───────────────┼─────┼──────────
Support      │ Pooja.S         │ 01/05/26 │ 31/05/26 │   176   │   0    │ Continuous│   8     │ Yet-To-Start  │  -  │  ₹122,496
Support      │ Thaghanazeer.S  │ 01/05/26 │ 31/05/26 │     4   │   0    │ Continuous│   2     │ Yet-To-Start  │  -  │    ₹4,160
Maintenance  │ Venkatesh.P     │ 01/05/26 │ 31/05/26 │    18   │   0    │ Continuous│   4     │ Not Yet Start │  -  │    ₹6,228
Maintenance  │ Thaghanazeer.S  │ 01/05/26 │ 31/05/26 │     4   │   0    │ Continuous│   1     │ Not Yet Start │  -  │    ₹4,160
[+ Add Row]
─────────────────────────────────────────────────────────────────────────────────────────────────
                                                                            TOTAL PROJECT COST  ₹137,044
```

- Every cell is inline-editable.
- `Total Cost` = `plannedHours × bucket.ratePerHourCents / 100` (computed live, not editable).
- Adding a row: Task Type from the picklist, Assigned To from the user list (filtered to the project's team), or pick an Expense bucket for non-labor lines.
- `Distribution Type` = **Continuous** (Per Day spread evenly across working days) | **Distributed** (Owner sets per-day overrides) | **Open** (no daily limit, just a total).
- Validation on submit: every row must have plannedHours > 0, valid dates (target ≥ start), and an assignee.

### 4.2 Optional: Excel upload

A **Upload Excel** button on a draft plan. Accepts the exact `.xlsx` format from your screenshot (sheet 1 = lines, sheet 2 = master picklists). Server-side parse via `xlsx` (already installed). Shows a diff preview before applying. The original file is stored as an Attachment (uses the new `/api/uploads` endpoint) and linked via `plan.attachmentId` for traceability.

### 4.3 Submit / approve / reject

- **Submit** flips `status: draft → pending` and emits a notification to every teamspace admin: *"<Owner> submitted '<plan title>' for approval — ₹137,044, 5 lines"*. Workflow trigger `plan_submitted` fires.
- **Admin queue** (sidebar → **Approvals**) lists pending plans. Each row: project, owner, total cost, line count, submitted date. Clicking opens the plan read-only with **Approve** + **Reject** buttons. Reject requires a reason ≥ 10 chars.
- **Approve** flips `status: approved`, snapshots the approver, locks all line edits (Owner has to create a new revision to change anything), notifies Owner. Trigger `plan_approved`.
- **Reject** flips `status: rejected`, notifies Owner with reason. Owner can edit and resubmit (`reopen` → `draft`).

### 4.4 No time logging until approved

Server-side guard in `POST /api/timesheets/entries`:
```
if (plan.status !== 'approved') → 403 "Plan not yet approved"
if (no Allocation exists for (userId, taskId, dateBucket)) → 403 "Not allocated"
```

---

## 5. Stage 2 — Allocation (Owner distributes the approved hours)

### 5.1 Auto-allocate from plan

Once a plan is approved, the Owner sees an **Allocate** button on the plan. Click → server walks every line:

- Creates a `Task` for each line (`taskId` saved back on the line) — title = `<TaskType> — <ProjectName>` (Owner can rename).
- For each line, creates `Allocation` rows depending on `distributionType`:
  - **Continuous** + `perDayDistribution: 8` → one Allocation per ISO-week between start and target dates. Each weekly bucket = `perDayDistribution × workingDays(week) ` hours.
  - **Distributed** → uses `perDayOverrides`; one Allocation per *month* with `allocatedHours = sum(daily overrides in that month)`.
  - **Open** → one single Allocation covering the whole period with `allocatedHours = plannedHours`.
- `consumedHours = 0`, `remainingHours = allocatedHours`.

### 5.2 Manual allocation tweak

Owner can edit individual Allocation rows in a per-user view: **Allocations → Pooja → May 2026** shows weekly buckets. Owner can move 5 hrs from week 1 → week 2 etc. Total still has to equal the plan-line's `plannedHours` (warning if not).

### 5.3 Re-allocation after re-approval

If a plan is rejected → edited → resubmitted → re-approved, the Owner re-runs Allocate. The system reconciles: existing Allocations stay if their identifiers match; mismatched ones become `status: closed` (kept for history) and new ones are created.

---

## 6. Stage 3 — Time logging (Member side)

### 6.1 Member's Timesheet page

Sidebar → **Time** → **My Timesheet**. Default = current week.

Same Notion-style grid I described in the original draft, but rows are **NOT free-pick**. Rows are pre-populated from the Member's **active Allocations** in this week. No allocations = empty page with the message:
> *"No tasks allocated to you this week. Talk to a Project Owner to get hours allocated."*

For each allocated row:
- Cell editable per day, capped at the daily distribution (warn if user types more than `perDayDistribution`; hard-cap at the weekly Allocation `remainingHours`).
- A small **`<consumed>/<allocated>h`** chip shows budget burn per row.

### 6.2 Submit weekly time

Same as my v1 §6 — `submit` flips `period.status: open → submitted`, routes to OrgChart manager, manager approves/rejects with reason. On approval, `task.actualHours` updates and the plan-line's `actualHours` updates (so the Excel-style grid in Stage 1 stays current).

### 6.3 Cap behavior — HARD (locked by user)

Server returns `400 { error: 'Allocation exceeded', allocated, consumed, requested }` if the new/updated entry would push `consumedHours > allocatedHours`. The grid blocks the keystroke client-side too — the input flashes red and the value snaps back. No "soft warn" mode in v1.

### 6.4 Weekly approval (Project Owner — Friday EOD)

The user submits the whole week with one click → the backend automatically splits the week into per-project `TimesheetSlice` records → each slice goes to that project's `ownerId`.

- The Project Owner sees a queue at `/t/:tsId/time/approvals/weeks` filtered to slices they own.
- Each slice can be approved or rejected independently. Rejecting requires a reason (≥10 chars). The user fixes only the rejected slice and resubmits.
- A scheduled trigger every **Friday 18:00** local emails Project Owners the pending slices for the just-finished week (workflow trigger `time_pending_friday`).
- The user's overall `period.status` rolls up: `submitted` if all slices submitted; `partially_approved` while some are still pending; `approved` only when every slice is approved.

### 6.4 RAG status (computed nightly + on every entry write)

Per plan-line / per plan:
- `actualHours / plannedHours × elapsed%`:
  - 0–80% utilization vs elapsed time → **Green**
  - 80–110% → **Amber**
  - >110% → **Red**
- Plan RAG = worst of its lines.
- Surfaced in: plan grid (RAG column), Project list, Owner dashboard.

---

## 7. UI screens (final list)

| Screen | Route | Who |
|---|---|---|
| My Timesheet (weekly grid) | `/t/:tsId/time` | All |
| Project Plans list | `/t/:tsId/time/plans` | Owner / Admin |
| Project Plan editor | `/t/:tsId/time/plans/:planId` | Owner (edit) / Admin (review) |
| Plan approvals queue | `/t/:tsId/time/approvals/plans` | Admin |
| Time approvals queue | `/t/:tsId/time/approvals/weeks` | Manager / Admin |
| Allocations editor | `/t/:tsId/time/allocations/:planId` | Owner |
| User-level allocation view | `/t/:tsId/time/allocations/user/:userId` | Owner / Admin |
| Reports — utilization & cost | `/t/:tsId/time/reports` | Owner / Admin |
| Rate buckets settings | `/t/:tsId/time/settings/buckets` | Admin |
| Task types settings | `/t/:tsId/time/settings/task-types` | Admin |

Sidebar grouping under **Time**: My Timesheet · Plans · Allocations · Approvals · Reports · ⚙ Settings.

---

## 8. API surface (`/api/time/*`)

| Method | Path | Who | Purpose |
|---|---|---|---|
| **Buckets & lookups** |
| GET    | `/api/time/buckets` | any auth'd | List rate buckets |
| POST/PUT/DEL | `/api/time/buckets[/:id]` | admin | Manage rate buckets |
| GET    | `/api/time/task-types` | any | List task types |
| POST/PUT/DEL | `/api/time/task-types[/:id]` | admin | Manage task types |
| **Plans (Stage 1)** |
| GET    | `/api/time/plans?projectId=&status=` | owner / admin | List plans |
| GET    | `/api/time/plans/:id` | owner / admin | Plan + lines + audit |
| POST   | `/api/time/plans` | owner | Create draft |
| PUT    | `/api/time/plans/:id` | owner (draft only) | Update plan header |
| POST   | `/api/time/plans/:id/lines` | owner | Add line |
| PUT    | `/api/time/plans/:id/lines/:lineId` | owner | Edit line |
| DELETE | `/api/time/plans/:id/lines/:lineId` | owner | Remove line |
| POST   | `/api/time/plans/:id/upload` | owner | Excel upload (parses, returns diff preview) |
| POST   | `/api/time/plans/:id/upload/apply` | owner | Apply previewed diff |
| POST   | `/api/time/plans/:id/submit` | owner | draft → pending |
| POST   | `/api/time/plans/:id/approve` | admin | pending → approved |
| POST   | `/api/time/plans/:id/reject` | admin | pending → rejected (body: `{reason}`) |
| POST   | `/api/time/plans/:id/reopen` | owner / admin | rejected → draft |
| **Allocations (Stage 2)** |
| POST   | `/api/time/plans/:id/allocate` | owner (after approved) | Auto-create Allocations + Tasks from lines |
| GET    | `/api/time/allocations?userId=&projectId=&from=&to=` | owner / admin / self | List |
| PUT    | `/api/time/allocations/:id` | owner / admin | Adjust hours |
| **Time entries (Stage 3)** |
| GET    | `/api/time/entries?userId=&from=&to=` | self / manager / admin | List |
| POST   | `/api/time/entries` | self (allocated only) | Create |
| POST   | `/api/time/entries/bulk` | self | Save whole week |
| PUT    | `/api/time/entries/:id` | self / admin | |
| DELETE | `/api/time/entries/:id` | self / admin | |
| POST   | `/api/time/periods/:id/submit` | self | open → submitted |
| POST   | `/api/time/periods/:id/approve` | manager / admin | submitted → approved |
| POST   | `/api/time/periods/:id/reject` | manager / admin | submitted → rejected (`{reason}`) |
| **Reports** |
| GET    | `/api/time/reports/utilization?from=&to=&groupBy=` | owner / admin | |
| GET    | `/api/time/reports/cost?projectId=&from=&to=` | owner / admin | Spend vs plan |
| GET    | `/api/time/reports/rag?projectId=` | owner / admin | RAG snapshot |

All routes are teamspace-scoped (existing middleware) plus new `requireProjectOwner` / `requireApprover` guards in `middleware/timeAccess.js`.

---

## 9. Notifications & workflow triggers (new types)

Notifications:
- `plan_submitted` → all admins
- `plan_approved` → plan owner
- `plan_rejected` → plan owner (with reason)
- `allocation_created` → each allocated user
- `time_submitted` → manager
- `time_approved` → member
- `time_rejected` → member (with reason)
- `time_overdue` → member (Monday morning if previous week still `open`)

Workflow-engine triggers (extends the existing engine):
- `plan_submitted`, `plan_approved`, `plan_rejected`
- `allocation_changed`
- `time_submitted`, `time_approved`, `time_rejected`, `time_overdue`
- `budget_exceeded` (when consumedHours > allocatedHours on any allocation)

---

## 10. Phasing (revised)

1. **Phase 1 — Foundations**
   - Models: `RateBucket`, `TaskType`, `ProjectHoursPlan`, `ProjectHoursPlanLine`, `Allocation`, `TimeEntry`, `TimesheetPeriod`, `TimesheetAudit`.
   - User additions: `rateBucketId`. Project additions: `ownerId`, `trackTime`.
   - Seed scripts: `seedRateBuckets.js` (the 11 buckets above), `seedTaskTypes.js` (12 task types), `assignUserBuckets.js` (interactive map of name → bucket).
   - APIs: buckets, task-types, plan CRUD (no submit/approve yet).

2. **Phase 2 — Plan editor (Stage 1)**
   - Excel-style plan grid with live total cost.
   - Submit / approve / reject flow with notifications.
   - Admin approvals queue.

3. **Phase 3 — Allocation (Stage 2)**
   - "Allocate" button → auto-creates Tasks + Allocation rows.
   - Per-user allocation view with manual tweak.
   - "No allocation = no time logging" guard on the entry endpoint.

4. **Phase 4 — Member time logging (Stage 3)**
   - Weekly grid populated from active Allocations.
   - Soft/hard cap per teamspace setting.
   - Period submit → manager approval (re-uses the OrgChart manager chain we already built).

5. **Phase 5 — Reports & Excel I/O**
   - Cost report (spend vs plan).
   - Utilization report (per user, per project).
   - RAG dashboard.
   - Excel upload (Stage 1.b) + Excel export (download any plan back to the original Excel format).

6. **Phase 6 — Polish (later)**
   - Start/stop timer.
   - Mobile-responsive grid.
   - Bulk approve in the queue.
   - Re-allocation history viewer.

---

## 11. Dashboard — Cost, P&L, Pipeline

The existing `/dashboard` (DashboardPage) gets new widgets, fed by new API endpoints under `/api/time/reports/*` and `/api/time/dashboard/*`. All numbers in INR.

### 11.1 Top KPI cards (this month, all approved plans)

| Card | Formula | Color rule |
|---|---|---|
| **Planned Revenue** | `SUM(plan.totalRevenueCents)` | neutral |
| **Planned Cost** | `SUM(plan.totalCostCents)` (billable cost + non-billable cost) | neutral |
| **Planned Profit / Margin** | `Planned Revenue − Planned Cost` and margin % | green if margin ≥ target (configurable, default 30%), amber 15–30%, red < 15% |
| **Actual Revenue (MTD)** | `SUM(plan.totalActualRevenueCents)` from approved entries | neutral |
| **Actual Cost (MTD)** | `SUM(plan.totalActualCostCents)` | neutral |
| **Actual Profit / Margin** | `Actual Revenue − Actual Cost` | same green/amber/red as Planned |
| **Loss This Month** | `SUM(MAX(0, plan.totalActualCostCents − plan.totalRevenueCents))` for billable projects, plus `SUM(plan.nonBillableActualCostCents)` for internal projects | red |
| **Pending Approvals** | count of `plan.status='pending'` + `slice.status='submitted'` (split as two pills inside one card) | neutral |

Two endpoints feed all of these: `GET /api/time/dashboard/totals?month=YYYY-MM` and `GET /api/time/dashboard/pipeline`.

### 11.2 Charts (recharts — already in deps)

1. **P&L by Project (Grouped Bar)** — for each project active this month, three bars side by side: **Revenue** (green), **Cost** (red), **Profit** (blue if positive, dark-red if negative). Sorted by Profit desc. Click → drills to per-project P&L (§11.3).

2. **Billable vs Non-billable Cost (Stacked Bar)** — per project, stacked bars showing the split. Helps spot projects where overhead is eating margin.

3. **Monthly P&L Trend (LineChart)** — last 6 months of three lines: Planned Revenue (blue dashed), Actual Revenue (blue solid), Actual Cost (red solid). Profit area is shaded between Revenue and Cost lines.

4. **Cost by Bucket (PieChart)** — pie of actual cost split by `RateBucket` (Trainee / Junior / Associate / … / Expense buckets) for the current month. Shows where the money goes.

5. **Top 5 Most Profitable Projects (HorizontalBar)** — sorted by `actualProfitCents` desc. Each bar labeled with margin %.

6. **Top 5 Loss-Making Projects (HorizontalBar)** — projects with `actualProfitCents < 0` OR `actualCost > totalRevenue × 1.0`. Each bar shows the loss in ₹. Includes purely-internal projects (revenue = 0) ranked by absolute non-billable cost.

7. **Utilization Heatmap (custom)** — 5-column (Mon–Fri) × N-row (users) grid for the current week. Each cell shaded by `consumedHours / allocatedHours` for that day. Hover shows split between billable and non-billable hours.

8. **Approval Pipeline Funnel (HorizontalBar)** — three bars: `Plans Pending → Plans Approved`, `Slices Submitted → Slices Approved`, `Time Logged → Time Approved`. Surfaces bottlenecks.

### 11.3 P&L per project (drill-down)

`/t/:tsId/time/projects/:projectId/pnl` — opened from any project bar in the dashboard.

```
Project: Marketing                                            Owner: Murali
Period: May 2026                                              Status: Approved
Default bill rate: ₹ 2,500 / hr

                                BILLABLE      NON-BILLABLE      TOTAL
─────────────────────────────────────────────────────────────────────────
Planned hours                   210 h          40 h             250 h
Actual hours                    198 h          47 h             245 h     ← non-billable creeping up

Planned Revenue                 ₹ 525,000      —                ₹ 525,000
Actual Revenue                  ₹ 495,000      —                ₹ 495,000

Planned Cost                    ₹ 150,000      ₹  28,000        ₹ 178,000
Actual Cost                     ₹ 142,800      ₹  35,520        ₹ 178,320  ← +₹320 overrun

─────────────────────────────────────────────────────────────────────────
Planned Profit                                                  ₹ 347,000     Margin 66.1%
Actual Profit                                                   ₹ 316,680     Margin 64.0%
                                                                ──────────
Variance vs plan                                                −₹  30,320    📉 Loss

Cost breakdown by bucket:
  Associate (Pooja.S, Kumuthamani.G)         88h    ₹ 61,248      [B]
  Lead (Thaghanazeer.S)                      35h    ₹ 36,400      [B]
  Trainee (Suha.A)                           12h    ₹  4,152      [B]
  Manager (internal review hours)            18h    ₹ 25,164      [N]
  Junior (training/ramp-up)                  29h    ₹ 14,529      [N]
  ExpensesBucket1 (license)                         ₹ 24,000      [B]
  ExpensesBucket2 (subscription)                    ₹ 19,400      [N]
                                                   ─────────────
                                                   ₹ 178,320

[ Export P&L ]   [ Open plan ]   [ Open allocations ]
```

When the project has `defaultBillRateCents = 0` (a purely **internal** project — no revenue), the layout collapses: Revenue rows disappear and the page shows only Cost and a banner *"Internal project — cost only, no revenue"*. The "Loss" then equals total actual cost (since there's nothing offsetting it).

### 11.4 Loss tracking workflow triggers

Two new triggers in the workflow engine:

- **`budget_overrun`** — fires when any plan's `totalActualCostCents` crosses `totalCostCents × 1.0`. Default action: notify the project owner + admin.
- **`margin_below_threshold`** — fires when any plan's `actualMarginPct` drops below the configured target (default 15%). Default action: notify the project owner + admin. Frequency-throttled to once per plan-month.

Both can be customized / extended via the existing Workflows page.

---

## 12. Remaining open questions

The big decisions are locked (see §0). Three smaller items to confirm before Phase 1:

1. **Bill rate location** — `Project.defaultBillRateCents` (one rate per project, my plan) **or** per-bucket bill rate (e.g. Associate billed at ₹1,500/hr regardless of project)? Per-project is simpler; per-bucket is closer to a true rate card. *Default: per-project, with per-line override.*
2. **Excel upload format** — exact mirror of your screenshot (sheet 1 = lines, sheet 2 = master picklists), or accept any `.xlsx` whose first sheet has column headers we recognize? *Default: tolerant — parse sheet 1 by column name, store the original file as a Plan attachment.*
3. **Backfill of `User.rateBucketId`** — assign every existing user a bucket from the names in your Excel screenshot. For new users, default bucket on signup? *Default: backfill via interactive script (matches names from screenshot); new users default to `Junior` and admins promote them.*

**Reply with "go with defaults"** (or override 1–3) and I'll start **Phase 1**:

- Phase 1 PR scope: `RateBucket` + `TaskType` + `Project.ownerId` + `Project.defaultBillRateCents` + `User.rateBucketId` schema changes; seed scripts (11 buckets, 12 task types, name→bucket map); the `ProjectHoursPlan` / `ProjectHoursPlanLine` / `Allocation` / `TimeEntry` / `TimesheetSlice` / `TimesheetPeriod` / `TimesheetAudit` models with the billable/non-billable + revenue/cost fields; basic CRUD endpoints (no submit/approve UI yet — that's Phase 2).

---

## 13. Changelog — additions since the original spec (2026-05-10)

The flow described in §0–§12 is in place. This section documents enhancements added on the same day after the original spec was committed (14:48). Schema & semantics from the body of this doc remain authoritative; this is purely additive.

### 13.1 Multi-plan per project per month

- **Decision change**: the unique index `(teamspaceId, projectId, periodMonth)` on `ProjectHoursPlan` was **dropped**. Owners can now create multiple plans for the same project/month (e.g. one plan for the original budget, another for a follow-up scope add-on).
- **Auto-disambiguation**: `formatPlanTitle()` produces `"<ProjectName> <MonthName> <Year> Approval"`. If a plan with that exact title already exists, the new one gets a `(#2)`, `(#3)`, … suffix.
- **Custom name**: New Plan modal now has an optional **Plan name** field. Backend uses the user-supplied title verbatim; only the auto-generated path runs through the suffix logic.

### 13.2 Allocation gate on task creation

- **`POST /api/tasks` is gated**: an assignee must have an active `Allocation` row for the chosen project. Admin role no longer bypasses (the early "admin escape hatch" was removed at the user's request).
- **Frontend (TasksPage `New Task` modal)**:
  - Project dropdown lists only projects where the assignee can be allocated.
  - Assignee dropdown shows split remaining hours: `💰 Xh B · 🛠 Yh NB`.
  - "Hours type" pill toggle: **💰 Billable** vs **🛠 Non-billable**. The gate uses this flag — `Allocation.exists({ userId, projectId, status: 'active', billable })`.
  - Estimate hint reflects the chosen bucket's remaining hours.

### 13.3 Billable / non-billable on the task itself

- New field on `Task`: `billable: Boolean` (default `true`).
- Time entries inherit billable from the chosen allocation (already in §0); the task's own flag drives which allocation type is requested + how the entry contributes to dashboards/score.
- **Score impact** (Overview Dashboard): performance score now deducts up to **20 points** based on the share of completed actual hours that were non-billable. `score = max(0, base - round(nonBillableShare × 20))`. Card shows a `−N extra hrs` chip and a green/orange "Hours mix" bar split between billable and non-billable.

### 13.4 Project contract value + billing type (loss model expanded)

Adds the **standard PSA loss model** on top of the existing margin = revenue − cost.

**New fields on `Project`:**

- `billingType: 'tm' | 'fixed'` (default `'tm'`).
- `contractValueCents: Number` (default `0`; `0` means "no ceiling / open / internal").

**Loss interpretation by billing type:**

| Billing | Revenue source | Loss = … |
|---|---|---|
| `tm` (Time & Materials) | `billable hours × bill rate` (current behaviour) | `cost > revenue` (margin loss). Contract value is an *advisory ceiling* — if committed cost exceeds contract, that's a "forecast overrun" warning but not a real margin loss yet. |
| `fixed` (Fixed bid) | `contractValueCents` (flat) | `cost > contract`. Overrun directly eats margin. |

**Backend helper**: `computeProjectFinancials(projectId, { extraPlanId?, extraPlanCostCents? })` returns `{ contractValueCents, billingType, committedCostCents, committedRevenueCents, actualCostCents, actualRevenueCents, contractRemainingCents, forecastProfitCents, actualProfitCents, forecastLossCents, actualLossCents, status }`. The `extraPlan*` args let the Plan Editor preview "what if I approve this draft now" before the admin commits.

**Surfaced in the UI:**

- **`GET /api/time/plans/:id`** returns `projectFinancials` (with this plan's cost folded in) so the Plan Editor can show a live banner.
- **Plan Editor banner**: `Contract: ₹X committed of ₹Y (NN%) — ₹Z remaining` with green/orange/red progress bar. Goes red on overrun.
- **Approve action**: if approving the plan would push committed cost past contract, the confirmation dialog shows the overrun amount before the admin commits.
- **Project P&L page** (`/t/:teamspaceId/time/projects/:projectId/pnl`): new "Contract" panel above the existing P&L grid. Tiles: Contract value · Committed · Spent · Forecast profit · Actual profit · Contract remaining (or Forecast loss) · Realized loss. Status badge: `Healthy` / `Forecast overrun` / `Realized loss` / `Open`.
- **New Project modal**: Billing type pills + Contract value (₹) field added.

### 13.5 Smarter Loss this month KPI + Non-billable overhead KPI

The Time Dashboard's "Loss this month" calculation is now the **worst of four buckets**:

1. **`plannedDeficit`** — `plannedCost > plannedRevenue` (forecast loss baked into a plan).
2. **`actualDeficit`** — `actualCost > actualRevenue` (realized loss from logged time).
3. **`overrun`** — `actualCost > plannedCost` (burning faster than planned).
4. **`contractOverrun`** — sum across projects with `contractValueCents > 0` of `(committed cost - contract value)`.

The headline value = `max` of the four (they overlap, so we don't add). Sublabel reports the breakdown so the user knows *why* the number is what it is. When 0, sublabel shows the planned profit buffer ("Buffer: ₹X after ₹Y NB overhead").

**New KPI**: **"Non-billable overhead"** — surfaces planned non-billable cost with sublabel "NN% of billable revenue absorbed as overhead". This addresses the common confusion of "I logged non-billable hours, why isn't there a loss?" — the answer is "billable revenue covers it; you can see how much overhead you're absorbing here."

### 13.6 Combined dashboard with tabs

- The legacy two-page split (Overview at `/dashboard`, Finance at `/t/:tsId/time/dashboard`) is merged into a single tabbed page at `/dashboard`.
- Tabs (modern underline style): **Overview** (Tasks · Sprints · Team Performance) and **Finance & Time** (Plans · P&L · Budget vs Actual).
- Legacy URL `/t/:tsId/time/dashboard` redirects to `/dashboard?tab=finance` to preserve old links/notifications.
- Wrapper has a `1280px` max-width centered, so both tab contents share consistent width with the rest of the app.

### 13.7 Notifications

- New full page at `/notifications` with filter pills (All / Unread / Tasks / Time / Budget), grouped by day, mark-all-read, per-row delete.
- Bell dropdown CSS rewritten to match its JSX class names (was a broken-CSS regression).

### 13.8 Modal layout fix

- Bootstrap globally forces `.modal { height: 100%; }`. Fixed via a one-line override (`height: auto`) in `index.css` so modals shrink-wrap to content.

### 13.9 Organization Members page (cross-link to ERP)

`/organization/members` (covered fully in **PRD.md §21**) ties into the ERP module: each member row shows their **rate bucket + cost-per-hour**, plus the current month's allocated hours, consumed hours, billable/non-billable split, projects touched, and cost MTD — all derived from `Allocation` + `TimeEntry`. Useful as the "who is being billed at what rate, doing what, this month" admin view.

### 13.10 Org chart V2 loaded

- 44 unique people + 19 division header nodes, 71 edges (`backend/loadOrgChartV3.js`).
- Members API filters out `orgRole='Division'` nodes so structural headers don't appear as fake employees.
- Existing User accounts auto-link by case-insensitive name match at load time.

---

> **What's NOT yet implemented (open items)**:
> - ~~**Friday EOD auto-submit** of weekly periods/slices~~ — **DONE in §14.5 below.**
> - **Per-bucket bill rate** (open question #1 in §12) — still on per-project model. Revisit if Finance asks for a true rate card.
> - **Excel upload of plans** (open question #2) — not built; only Excel *export* of approved plans exists today.

---

## 14. Changelog — Late evening additions (2026-05-10)

After §13, the timesheet/ERP module picked up these enhancements:

### 14.1 Friday EOD auto-submit (closes §13's open item)

- New `fridayAutoSubmitTick` runs hourly (boot + every 60 min).
- Active window: **Friday 21:00 onwards through end of Sunday**.
- Behavior: finds every still-`open` `TimesheetPeriod` for the current week. For each:
  - If it has zero slices with logged hours → skip (don't submit empty timesheets).
  - Otherwise, flip every slice → `submitted` (with `submittedAt = now()`), then flip the period → `submitted`.
  - Resolve each slice's `projectOwnerId` from the project (or skip if no owner).
  - Send a `time_submitted` notification to each project owner: *"X's week on Y was auto-submitted at Friday EOD."*
- The existing `fridayReminderTick` (sends nag notifications at 17:00–18:59 Friday) is preserved — just runs first.

### 14.2 PDF export of project P&L

- `GET /api/time/reports/project/:projectId/pnl/pdf?month=YYYY-MM` — A4 one-pager via `pdfkit`.
- Layout: title + period; contract panel (billing type, contract value, committed cost, spent, status); P&L grid (planned/actual hours, planned/actual cost, planned/actual revenue split B/NB); planned + actual profit row; plan list; footer.
- Surfaced as **📥 PDF** button on the P&L page (`pages/ProjectPnLPage.jsx`).

### 14.3 CSV / JSON exports

- `GET /api/time/export/entries?from=&to=&format=csv|json` — flat per-time-entry table (date, user, email, project, task, hours, billable, cost_rupees, revenue_rupees, status, notes).
- `GET /api/time/export/plans?month=&format=csv|json` — per-plan table (title, project, period, status, planned/actual hours, planned/actual cost, planned revenue, planned profit, submitted_by, approved_by).
- Both surfaced as toolbar buttons on the **Time Dashboard** (Finance & Time tab): **📊 Entries CSV** + **📋 Plans CSV**.

### 14.4 Audit log UI

- Backend: `GET /api/time/audit?entityType=&entityId=&action=&from=&to=&limit=` — already-existing `TimesheetAudit` collection finally has a UI.
- Frontend: `pages/AuditLogPage.jsx` at `/t/<ts>/time/audit`.
- Filters: entity type, action, date-range, search (matches actorName / action / reason / entityType).
- Each row expands to show a field-by-field diff of `before` vs `after` (red ↔ green columns).
- Use case: finance/audit signoff at month-end.

### 14.5 Activity feed (cross-source timeline)

- New `GET /api/activity?days=14&limit=200` (mounted on `/api`, scoped to the active teamspace).
- Merges three sources:
  - `TimesheetAudit` — every plan/line/allocation/entry/period/slice state change
  - `WorkflowLog` (success only) — workflow rule executions
  - `Notification` — system + custom alerts
- Frontend: `pages/ActivityPage.jsx` at `/t/<ts>/activity`. Day-grouped, source filter (📜 audit / ⚡ workflow / 🔔 notification), search, days dropdown (24h / 7d / 14d / 30d / 90d).

### 14.6 Notification preferences integration with timesheets

- `Notification.createIfAllowed()` static method (added on the Notification model) reads `User.notificationPrefs[type]` and silently skips muted types.
- All `Notification.create()` callers in `routes/timesheets.js` migrated:
  - Plan submit/approve/reject notifications
  - Friday EOD reminder
  - Friday auto-submit notifications
  - Budget overrun (admins + owner)
- Each user can mute any timesheet notification type via **Profile → Notification preferences**.

### 14.7 Weekly digest email

- Friday 18:00 cron sends each user (with email + not muted) a one-page digest: completed tasks this week + in-flight tasks + unread notification count + link to app.
- Hooks into the existing nodemailer transporter — no new config required.
- De-duped via a sentinel `Notification(type: 'weekly_digest_sent')` so re-runs in the same hour don't double-send.

### 14.8 Plan editor + Project page polish

- **📊 P&L** button on Plan Editor toolbar — jumps to project P&L scoped to the plan's month.
- **Project edit modal** — pencil icon on every project card / row reuses the New Project modal in edit mode. Lets admins change billing type / contract value on existing projects.
- **📊 P&L button on every project card** — instant nav to current-month P&L.

### 14.9 Members page — rate bucket editing

- Admin-only "✏️ Change cost rate" dropdown on each user-with-login card, with a purple-bordered treatment so it's hard to miss.
- Saves via `PUT /api/users/:id` with `{ rateBucketId }`. The change reflects in **NEW** plans only — existing approved plans keep their frozen rates (per the rate-freeze policy in §0).

### 14.10 Timezone-aware "today"

- New `User.timezone` field (default `Asia/Kolkata`). Editable from Profile.
- Frontend `todayInTz(tz)` helper uses `Intl.DateTimeFormat` to compute "today" in the user's tz.
- `MyTimesheetPage` uses it so a user logging at 23:00 JST doesn't accidentally land on tomorrow's UTC date.
- Backend stores `TimeEntry.date` as `'YYYY-MM-DD'` strings — already neutral, so this fix is purely a frontend computation issue.

---

> **Updated open items** (§12 #1–#3 reassessed):
> 1. **Per-bucket bill rate** — still per-project. No customer pressure yet.
> 2. **Excel upload of plans** — not built. Plan creation is form-driven; bulk import would be a separate ingestion script.
> 3. **`User.rateBucketId` backfill** — done via `assignUserBuckets.js` script. Admins can now also adjust per user via the Members page (§14.9).
>
> See **PRD.md §22** for non-ERP-specific items shipped in the same wave (security hardening, command palette, comments, profile fields, backup script, rate limiting).
