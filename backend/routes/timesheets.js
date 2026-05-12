/**
 * Timesheet (ERP v1) — Phase 1 routes
 * Mounted at /api/time/* in server.js (after authenticate + extractTeamspaceId middleware).
 *
 * Phase 1 scope:
 *   - RateBucket CRUD       (admin)
 *   - TaskType CRUD         (admin)
 *   - ProjectHoursPlan CRUD (owner / admin) — no submit/approve here, that's Phase 2
 *   - PlanLine CRUD         (owner)
 *   - TimeEntry CRUD        (self) — with allocation hard-cap guard
 *
 * Approval workflow, allocation auto-create, slice routing, dashboard, reports — Phase 2+.
 */

const express = require('express');
const XLSX    = require('xlsx');
const router  = express.Router();

const RateBucket            = require('../models/RateBucket');
const TaskType              = require('../models/TaskType');
const ProjectHoursPlan      = require('../models/ProjectHoursPlan');
const ProjectHoursPlanLine  = require('../models/ProjectHoursPlanLine');
const Allocation            = require('../models/Allocation');
const TimeEntry             = require('../models/TimeEntry');
const TimesheetPeriod       = require('../models/TimesheetPeriod');
const TimesheetSlice        = require('../models/TimesheetSlice');
const TimesheetAudit        = require('../models/TimesheetAudit');
const Project               = require('../models/Project');
const User                  = require('../models/User');
const Notification          = require('../models/Notification');
const workflowEngine        = require('../workflowEngine');
const TeamspaceMembership   = require('../models/TeamspaceMembership');

// ─── tiny helpers ─────────────────────────────────────────────────────────────
const ok       = (res, data, code = 200) => res.status(code).json(data);
const fail     = (res, msg, code = 400)   => res.status(code).json({ error: msg });
const isAdmin  = (req) => req.user?.role === 'Admin';
const tsId     = (req) => req.body?.teamspaceId || req.teamspaceId;
const isWeekend = (yyyymmdd) => { const d = new Date(yyyymmdd + 'T00:00:00'); const w = d.getDay(); return w === 0 || w === 6; };

// First+last day of a 'YYYY-MM' string, in UTC for comparison stability.
function monthBounds(periodMonth) {
  const [y, m] = periodMonth.split('-').map(Number);
  return { periodStart: new Date(Date.UTC(y, m - 1, 1)), periodEnd: new Date(Date.UTC(y, m, 0)) };
}

// Standard plan title: "<ProjectName> <MonthName> <Year> Approval"
function formatPlanTitle(projectName, periodMonth) {
  if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) return projectName || 'Plan';
  const [y, m] = periodMonth.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long' });
  return `${projectName} ${monthName} ${y} Approval`;
}

// Recompute plan totals from its lines. Called after any line write.
async function recomputePlanTotals(planId) {
  const plan = await ProjectHoursPlan.findById(planId);
  if (!plan) return;
  const lines = await ProjectHoursPlanLine.find({ planId });
  const sum = (pred, mapper) => lines.filter(pred).reduce((a, l) => a + (mapper(l) || 0), 0);

  plan.totalPlannedHours       = sum(() => true,        l => l.plannedHours);
  plan.billablePlannedHours    = sum(l => l.billable,    l => l.plannedHours);
  plan.nonBillablePlannedHours = sum(l => !l.billable,   l => l.plannedHours);
  plan.totalCostCents          = sum(() => true,        l => l.costCents);
  plan.billableCostCents       = sum(l => l.billable,    l => l.costCents);
  plan.nonBillableCostCents    = sum(l => !l.billable,   l => l.costCents);
  plan.totalRevenueCents       = sum(l => l.billable,    l => l.revenueCents);
  plan.totalActualHours        = sum(() => true,        l => l.actualHours);
  plan.billableActualHours     = sum(l => l.billable,    l => l.actualHours);
  plan.nonBillableActualHours  = sum(l => !l.billable,   l => l.actualHours);
  plan.totalActualCostCents    = sum(() => true,        l => l.actualCostCents);
  plan.billableActualCostCents = sum(l => l.billable,    l => l.actualCostCents);
  plan.nonBillableActualCostCents = sum(l => !l.billable, l => l.actualCostCents);
  plan.totalActualRevenueCents = sum(l => l.billable,    l => l.actualRevenueCents);

  plan.plannedProfitCents   = plan.totalRevenueCents - plan.totalCostCents;
  plan.actualProfitCents    = plan.totalActualRevenueCents - plan.totalActualCostCents;
  plan.plannedMarginPct     = plan.totalRevenueCents > 0 ? (plan.plannedProfitCents / plan.totalRevenueCents) : 0;
  plan.actualMarginPct      = plan.totalActualRevenueCents > 0 ? (plan.actualProfitCents / plan.totalActualRevenueCents) : 0;
  plan.variancePctCached    = plan.totalCostCents > 0 ? ((plan.totalActualCostCents - plan.totalCostCents) / plan.totalCostCents) : 0;
  await plan.save();
}

// ────────────────────────────────────────────────────────────────────────────
// PROJECT CONTRACT FINANCIALS
// ────────────────────────────────────────────────────────────────────────────
//
// Loss model:
//   • T&M projects     — loss = (cost − revenue) > 0. Contract value (if set) is just an
//                         advisory ceiling: when committed cost exceeds it, the project is
//                         "over-budget vs client" but not yet a real margin loss.
//   • Fixed-bid        — revenue is the contract value. Profit = contract − cost.
//                         If cost > contract, that's a real loss (overrun eats margin).
//
// Returned shape (cents-everywhere):
//   {
//     contractValueCents, billingType,
//     committedCostCents,  committedRevenueCents,   // approved + pending plans
//     actualCostCents,     actualRevenueCents,      // from time entries
//     contractRemainingCents,                       // contract − committed
//     forecastProfitCents, actualProfitCents,
//     forecastLossCents,  actualLossCents,          // 0 if profitable
//     status: 'healthy' | 'forecast_overrun' | 'realized_loss' | 'open'
//   }
async function computeProjectFinancials(projectId, { extraPlanId = null, extraPlanCostCents = 0 } = {}) {
  const project = await Project.findById(projectId).lean();
  if (!project) return null;

  const contractValueCents = project.contractValueCents || 0;
  const billingType        = project.billingType        || 'tm';

  // All plans for this project that are at least submitted (so committed cost is meaningful).
  // We include 'pending' alongside 'approved' because pending plans represent owner-committed
  // intent; an admin should know about them when forecasting.
  const plans = await ProjectHoursPlan.find({
    projectId,
    status: { $in: ['pending', 'approved'] },
  }).lean();

  let committedCostCents    = plans.reduce((s, p) => s + (p.totalCostCents    || 0), 0);
  let committedRevenueCents = plans.reduce((s, p) => s + (p.totalRevenueCents || 0), 0);
  const actualCostCents     = plans.reduce((s, p) => s + (p.totalActualCostCents    || 0), 0);
  const actualRevenueCents  = plans.reduce((s, p) => s + (p.totalActualRevenueCents || 0), 0);

  // If a caller is testing "what if we approved this draft plan?", fold its cost in.
  if (extraPlanId && !plans.find(p => String(p._id) === String(extraPlanId))) {
    committedCostCents += extraPlanCostCents;
  }

  // Effective revenue depends on billing model.
  const effectiveContractRevenueCents = billingType === 'fixed' ? contractValueCents : committedRevenueCents;

  const forecastProfitCents = effectiveContractRevenueCents - committedCostCents;
  const actualProfitCents   = (billingType === 'fixed' ? contractValueCents : actualRevenueCents) - actualCostCents;

  const contractRemainingCents = contractValueCents > 0 ? (contractValueCents - committedCostCents) : null;

  let status = 'healthy';
  if (actualProfitCents < 0)                                           status = 'realized_loss';
  else if (contractValueCents > 0 && committedCostCents > contractValueCents) status = 'forecast_overrun';
  else if (forecastProfitCents < 0)                                    status = 'forecast_overrun';
  if (committedCostCents === 0 && actualCostCents === 0)               status = 'open';

  return {
    contractValueCents, billingType,
    committedCostCents, committedRevenueCents,
    actualCostCents, actualRevenueCents,
    contractRemainingCents,
    forecastProfitCents,
    actualProfitCents,
    forecastLossCents: Math.max(0, -forecastProfitCents),
    actualLossCents:   Math.max(0, -actualProfitCents),
    status,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// RATE BUCKETS
// ────────────────────────────────────────────────────────────────────────────
router.get('/buckets', async (req, res) => {
  const buckets = await RateBucket.find({ teamspaceId: tsId(req) }).sort({ kind: 1, ratePerHourCents: 1 });
  ok(res, buckets);
});
router.post('/buckets', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  try { ok(res, await RateBucket.create({ ...req.body, teamspaceId: tsId(req) }), 201); }
  catch (e) { fail(res, e.message, 400); }
});
router.put('/buckets/:id', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  ok(res, await RateBucket.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});
router.delete('/buckets/:id', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  await RateBucket.findByIdAndDelete(req.params.id);
  ok(res, { success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// TASK TYPES
// ────────────────────────────────────────────────────────────────────────────
router.get('/task-types', async (req, res) => {
  const types = await TaskType.find({ teamspaceId: tsId(req), active: true }).sort({ sortOrder: 1, name: 1 });
  ok(res, types);
});
router.post('/task-types', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  try { ok(res, await TaskType.create({ ...req.body, teamspaceId: tsId(req) }), 201); }
  catch (e) { fail(res, e.message, 400); }
});
router.put('/task-types/:id', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  ok(res, await TaskType.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});
router.delete('/task-types/:id', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  await TaskType.findByIdAndDelete(req.params.id);
  ok(res, { success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// PLANS  — owner creates draft; admin approves (Phase 2)
// ────────────────────────────────────────────────────────────────────────────
router.get('/plans', async (req, res) => {
  const filter = { teamspaceId: tsId(req) };
  if (req.query.projectId) filter.projectId = req.query.projectId;
  if (req.query.status)    filter.status    = req.query.status;
  // ?mine=1 → only plans created by the requesting user.
  // ?awaitingMyApproval=1 → only plans pending approval on projects where the
  // requester is the project owner (ProjectHoursPlan.createdBy stores the
  // user's name, but approval routes use Project.ownerId).
  if (req.query.mine === '1' || req.query.mine === 'true') {
    const me = await User.findById(req.user.userId).select('name').lean();
    if (me?.name) filter.createdBy = me.name;
    else return ok(res, []);
  }
  if (req.query.awaitingMyApproval === '1' || req.query.awaitingMyApproval === 'true') {
    filter.status = 'pending';
    const myProjects = await Project.find({ ownerId: req.user.userId }).select('_id').lean();
    filter.projectId = { $in: myProjects.map(p => p._id) };
    if (myProjects.length === 0) return ok(res, []);
  }
  ok(res, await ProjectHoursPlan.find(filter).sort({ periodMonth: -1, createdAt: -1 }));
});
router.get('/plans/:id', async (req, res) => {
  const plan  = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  const lines = await ProjectHoursPlanLine.find({ planId: plan._id }).sort({ createdAt: 1 });
  // Forecast: what would the project look like if THIS plan's cost were committed?
  const projectFinancials = await computeProjectFinancials(plan.projectId, {
    extraPlanId: plan._id,
    extraPlanCostCents: plan.totalCostCents || 0,
  });
  ok(res, { plan, lines, projectFinancials });
});
router.post('/plans', async (req, res) => {
  try {
    const { projectId, periodMonth, title } = req.body;
    if (!projectId || !periodMonth) return fail(res, 'projectId + periodMonth required');
    if (!/^\d{4}-\d{2}$/.test(periodMonth)) return fail(res, 'periodMonth must be YYYY-MM');
    const project = await Project.findById(projectId);
    if (!project) return fail(res, 'Project not found', 404);
    const { periodStart, periodEnd } = monthBounds(periodMonth);

    // Auto-disambiguate title when multiple plans exist for the same project + month
    let finalTitle = title || formatPlanTitle(project.name, periodMonth);
    if (!title) {
      const existing = await ProjectHoursPlan.countDocuments({
        teamspaceId: tsId(req), projectId, periodMonth,
      });
      if (existing > 0) finalTitle = `${finalTitle} (#${existing + 1})`;
    }

    const plan = await ProjectHoursPlan.create({
      teamspaceId: tsId(req),
      projectId,
      title: finalTitle,
      periodMonth, periodStart, periodEnd,
      status: 'draft',
      createdBy: req.user?.email || 'system',
    });
    ok(res, plan, 201);
  } catch (e) {
    fail(res, e.message, 500);
  }
});
router.put('/plans/:id', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'draft' && !isAdmin(req)) return fail(res, 'Only drafts are editable', 403);
  // Allow updating only safe fields here
  ['title', 'attachmentId'].forEach(k => { if (k in req.body) plan[k] = req.body[k]; });
  plan.updatedBy = req.user?.email || plan.updatedBy;
  await plan.save();
  ok(res, plan);
});
router.delete('/plans/:id', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status === 'approved' && !isAdmin(req)) return fail(res, 'Cannot delete an approved plan', 403);
  await ProjectHoursPlanLine.deleteMany({ planId: plan._id });
  await ProjectHoursPlan.findByIdAndDelete(plan._id);
  ok(res, { success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// PLAN LINES
// ────────────────────────────────────────────────────────────────────────────
router.post('/plans/:planId/lines', async (req, res) => {
  try {
    const plan = await ProjectHoursPlan.findById(req.params.planId);
    if (!plan) return fail(res, 'Plan not found', 404);
    if (plan.status !== 'draft' && !isAdmin(req)) return fail(res, 'Plan is locked', 403);

    const body = req.body;
    if (!body.taskType || !body.assigneeBucketId || !body.startDate || !body.targetDate || body.plannedHours == null) {
      return fail(res, 'taskType, assigneeBucketId, startDate, targetDate, plannedHours are required');
    }
    if (!body.assigneeUserId && !body.assigneeBucketId) return fail(res, 'assigneeUserId or assigneeBucketId required');

    const bucket = await RateBucket.findById(body.assigneeBucketId);
    if (!bucket) return fail(res, 'RateBucket not found', 400);

    // Snapshot frozen rates IF the plan is already past draft. For drafts, we re-snapshot at submit time.
    const frozenRateCents     = bucket.ratePerHourCents;
    const project             = await Project.findById(plan.projectId);
    const billable            = body.billable !== undefined ? !!body.billable : true;
    const billRateOverride    = body.billRateOverrideCents != null ? Number(body.billRateOverrideCents) : null;
    const frozenBillRateCents = billable ? (billRateOverride ?? project?.defaultBillRateCents ?? 0) : 0;

    if (billable && !frozenBillRateCents) {
      return fail(res, 'Billable line needs project.defaultBillRateCents > 0 or billRateOverrideCents', 400);
    }

    const plannedHours = Number(body.plannedHours);
    const line = await ProjectHoursPlanLine.create({
      planId: plan._id,
      teamspaceId: plan.teamspaceId,
      taskType: body.taskType,
      billable,
      assigneeUserId: body.assigneeUserId || null,
      assigneeBucketId: body.assigneeBucketId,
      frozenRateCents,
      frozenBillRateCents,
      billRateOverrideCents: billRateOverride,
      startDate: body.startDate,
      targetDate: body.targetDate,
      plannedHours,
      distributionType: body.distributionType || 'Continuous',
      perDayDistribution: body.perDayDistribution || 0,
      perDayOverrides: body.perDayOverrides || {},
      status: body.status || 'Yet-To-Start',
      costCents: plannedHours * frozenRateCents,
      revenueCents: billable ? plannedHours * frozenBillRateCents : 0,
      notes: body.notes || '',
    });

    await recomputePlanTotals(plan._id);
    ok(res, line, 201);
  } catch (e) { fail(res, e.message, 500); }
});

router.put('/plans/:planId/lines/:lineId', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.planId);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'draft' && !isAdmin(req)) return fail(res, 'Plan is locked', 403);

  const line = await ProjectHoursPlanLine.findById(req.params.lineId);
  if (!line || String(line.planId) !== String(plan._id)) return fail(res, 'Line not found', 404);

  // Allow editing safe fields. Frozen rates only re-snapshot if bucket is changing.
  const editable = ['taskType','billable','startDate','targetDate','plannedHours','distributionType','perDayDistribution','perDayOverrides','status','notes','assigneeUserId'];
  editable.forEach(k => { if (k in req.body) line[k] = req.body[k]; });

  if (req.body.assigneeBucketId && String(req.body.assigneeBucketId) !== String(line.assigneeBucketId)) {
    const bucket = await RateBucket.findById(req.body.assigneeBucketId);
    if (!bucket) return fail(res, 'RateBucket not found', 400);
    line.assigneeBucketId = bucket._id;
    line.frozenRateCents  = bucket.ratePerHourCents;
  }

  if (req.body.billRateOverrideCents !== undefined) {
    line.billRateOverrideCents = req.body.billRateOverrideCents != null ? Number(req.body.billRateOverrideCents) : null;
  }

  // Recompute frozen bill rate from line.billable + project default + override
  const project = await Project.findById(plan.projectId);
  line.frozenBillRateCents = line.billable
    ? (line.billRateOverrideCents ?? project?.defaultBillRateCents ?? 0)
    : 0;

  // Re-derive cached cost / revenue
  line.costCents    = (line.plannedHours || 0) * (line.frozenRateCents || 0);
  line.revenueCents = line.billable ? ((line.plannedHours || 0) * (line.frozenBillRateCents || 0)) : 0;

  await line.save();
  await recomputePlanTotals(plan._id);
  ok(res, line);
});

router.delete('/plans/:planId/lines/:lineId', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.planId);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'draft' && !isAdmin(req)) return fail(res, 'Plan is locked', 403);
  await ProjectHoursPlanLine.findOneAndDelete({ _id: req.params.lineId, planId: plan._id });
  await recomputePlanTotals(plan._id);
  ok(res, { success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// TIME ENTRIES — basic CRUD with hard-cap allocation guard
// ────────────────────────────────────────────────────────────────────────────
router.get('/entries', async (req, res) => {
  const filter = { teamspaceId: tsId(req) };
  if (req.query.userId)    filter.userId    = req.query.userId;
  else if (!isAdmin(req))  filter.userId    = req.user.userId;       // members see only their own
  if (req.query.projectId) filter.projectId = req.query.projectId;
  if (req.query.from)      filter.date      = { ...filter.date, $gte: req.query.from };
  if (req.query.to)        filter.date      = { ...filter.date, $lte: req.query.to };
  ok(res, await TimeEntry.find(filter).sort({ date: -1, createdAt: -1 }).limit(2000));
});

router.post('/entries', async (req, res) => {
  try {
    const { date, projectId, taskId, allocationId, minutes, notes } = req.body;
    if (!date || !projectId || !taskId || !allocationId || minutes == null) {
      return fail(res, 'date, projectId, taskId, allocationId, minutes are required');
    }
    if (isWeekend(date)) return fail(res, 'Weekend dates are not allowed (Mon–Fri only)');
    if (Number(minutes) < 0) return fail(res, 'minutes must be >= 0');

    const allocation = await Allocation.findById(allocationId);
    if (!allocation) return fail(res, 'Allocation not found', 404);
    if (String(allocation.userId) !== String(req.user.userId) && !isAdmin(req)) {
      return fail(res, 'Cannot log time on someone else\'s allocation', 403);
    }
    if (allocation.status === 'closed') return fail(res, 'Allocation is closed', 400);

    // Hard cap: consumed + new minutes (in hours) <= allocatedHours
    const newHours = Number(minutes) / 60;
    if (allocation.consumedHours + newHours > allocation.allocatedHours + 1e-6) {
      return fail(res, `Allocation exceeded — allocated ${allocation.allocatedHours}h, already consumed ${allocation.consumedHours.toFixed(2)}h, requested +${newHours.toFixed(2)}h`, 400);
    }

    const billable     = allocation.billable;
    const costCents    = Math.round((Number(minutes) / 60) * (allocation.frozenRateCents || 0));
    const revenueCents = billable ? Math.round((Number(minutes) / 60) * (allocation.frozenBillRateCents || 0)) : 0;

    const entry = await TimeEntry.create({
      teamspaceId: tsId(req),
      userId: req.user.userId,
      date, projectId, taskId, allocationId,
      minutes: Number(minutes), notes: notes || '',
      billable, costCents, revenueCents,
      createdBy: req.user.email,
    });

    // Update allocation rollups
    allocation.consumedHours = +(allocation.consumedHours + newHours).toFixed(4);
    allocation.remainingHours = +(allocation.allocatedHours - allocation.consumedHours).toFixed(4);
    await allocation.save();

    ok(res, entry, 201);
  } catch (e) { fail(res, e.message, 500); }
});

router.put('/entries/:id', async (req, res) => {
  const entry = await TimeEntry.findById(req.params.id);
  if (!entry) return fail(res, 'Entry not found', 404);
  if (String(entry.userId) !== String(req.user.userId) && !isAdmin(req)) return fail(res, 'Forbidden', 403);
  if (entry.status !== 'draft' && !isAdmin(req)) return fail(res, 'Entry is locked', 403);

  // Only allow minutes/notes updates here. Re-cap against allocation.
  const allocation = await Allocation.findById(entry.allocationId);
  if (!allocation) return fail(res, 'Allocation gone', 404);

  const newMinutes = req.body.minutes != null ? Number(req.body.minutes) : entry.minutes;
  if (newMinutes < 0) return fail(res, 'minutes must be >= 0');
  const oldHours = entry.minutes / 60;
  const newHours = newMinutes / 60;
  const projected = allocation.consumedHours - oldHours + newHours;
  if (projected > allocation.allocatedHours + 1e-6) {
    return fail(res, `Allocation exceeded — limit ${allocation.allocatedHours}h, would become ${projected.toFixed(2)}h`, 400);
  }

  entry.minutes      = newMinutes;
  entry.notes        = req.body.notes ?? entry.notes;
  entry.costCents    = Math.round(newHours * (allocation.frozenRateCents || 0));
  entry.revenueCents = entry.billable ? Math.round(newHours * (allocation.frozenBillRateCents || 0)) : 0;
  entry.updatedBy    = req.user.email;
  await entry.save();

  allocation.consumedHours  = +(projected).toFixed(4);
  allocation.remainingHours = +(allocation.allocatedHours - allocation.consumedHours).toFixed(4);
  await allocation.save();

  ok(res, entry);
});

router.delete('/entries/:id', async (req, res) => {
  const entry = await TimeEntry.findById(req.params.id);
  if (!entry) return fail(res, 'Entry not found', 404);
  if (String(entry.userId) !== String(req.user.userId) && !isAdmin(req)) return fail(res, 'Forbidden', 403);

  const allocation = await Allocation.findById(entry.allocationId);
  await TimeEntry.findByIdAndDelete(entry._id);
  if (allocation) {
    allocation.consumedHours  = +(allocation.consumedHours - entry.minutes / 60).toFixed(4);
    allocation.remainingHours = +(allocation.allocatedHours - allocation.consumedHours).toFixed(4);
    await allocation.save();
  }
  ok(res, { success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// PLAN WORKFLOW — submit / approve / reject / reopen   (Phase 2)
// ────────────────────────────────────────────────────────────────────────────

// Audit-log helper. Append-only; never throws.
async function audit({ teamspaceId, entityType, entityId, action, before, after, req, reason }) {
  try {
    await TimesheetAudit.create({
      teamspaceId, entityType, entityId, action, before, after,
      actorId: req.user?.userId, actorName: req.user?.name, actorRole: req.user?.role,
      reason,
    });
  } catch (e) { console.error('audit log failed', e.message); }
}

// Notification helper for plan transitions. Always carry teamspaceId so the
// per-team sidebar bell can count it; the override of createIfAllowed in
// server.js sends push + email too.
async function notify({ type, title, message, taskId, taskTitle, userId, actorName, teamspaceId }) {
  try { await Notification.createIfAllowed({ type, title, message, taskId, taskTitle, userId, actorName, teamspaceId }); }
  catch (e) { console.error('notify failed', e.message); }
}

// Re-snapshot frozen rates onto every line at submission time. After this,
// rate-bucket changes don't ripple back into this plan.
async function refreezeRates(plan) {
  const lines = await ProjectHoursPlanLine.find({ planId: plan._id });
  const project = await Project.findById(plan.projectId);
  for (const line of lines) {
    const bucket = await RateBucket.findById(line.assigneeBucketId);
    if (!bucket) continue;
    line.frozenRateCents     = bucket.ratePerHourCents;
    line.frozenBillRateCents = line.billable
      ? (line.billRateOverrideCents ?? project?.defaultBillRateCents ?? 0)
      : 0;
    line.costCents    = (line.plannedHours || 0) * line.frozenRateCents;
    line.revenueCents = line.billable ? (line.plannedHours || 0) * line.frozenBillRateCents : 0;
    await line.save();
  }
  await recomputePlanTotals(plan._id);
}

// POST /api/time/plans/:id/submit  — owner only, draft → pending
router.post('/plans/:id/submit', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'draft' && plan.status !== 'rejected') return fail(res, `Cannot submit a ${plan.status} plan`, 400);

  const project = await Project.findById(plan.projectId);
  const isOwner = project && String(project.ownerId) === String(req.user.userId);
  if (!isOwner && !isAdmin(req)) return fail(res, 'Only the project owner can submit', 403);

  const lines = await ProjectHoursPlanLine.find({ planId: plan._id });
  if (lines.length === 0) return fail(res, 'Cannot submit an empty plan — add at least one line', 400);

  // Refreeze every line's rates and recompute totals
  await refreezeRates(plan);

  // Validate every billable line has a bill rate
  const reread = await ProjectHoursPlanLine.find({ planId: plan._id });
  const badBillable = reread.find(l => l.billable && !l.frozenBillRateCents);
  if (badBillable) return fail(res, `Billable line "${badBillable.taskType}" has no bill rate — set project.defaultBillRateCents or a per-line override`, 400);

  const before = { status: plan.status };
  plan.status      = 'pending';
  plan.submittedAt = new Date();
  plan.submittedBy = req.user?.email || req.user?.name;
  await plan.save();

  await audit({ teamspaceId: plan.teamspaceId, entityType: 'plan', entityId: plan._id, action: 'submit', before, after: { status: 'pending' }, req });

  // Notify every admin in the teamspace
  const admins = await TeamspaceMembership.find({ teamspaceId: plan.teamspaceId, role: 'admin', status: 'active' }).populate('userId', 'name');
  for (const m of admins) {
    if (!m.userId?.name) continue;
    await notify({
      type: 'plan_submitted',
      title: 'New project hours plan awaiting approval',
      message: `${req.user?.name || 'Owner'} submitted "${plan.title}" — total ₹${(plan.totalCostCents/100).toLocaleString('en-IN')} across ${lines.length} line${lines.length===1?'':'s'}`,
      userId: m.userId.name,
      actorName: req.user?.name,
      teamspaceId: plan.teamspaceId,
    });
  }
  // Fire workflow trigger so user-defined automations run too
  workflowEngine.fire('plan_submitted', plan.toObject(), { actor: req.user?.name });
  ok(res, plan);
});

// POST /api/time/plans/:id/approve  — admin only, pending → approved
router.post('/plans/:id/approve', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'pending') return fail(res, `Cannot approve a ${plan.status} plan`, 400);

  const before = { status: plan.status };
  plan.status     = 'approved';
  plan.approvedAt = new Date();
  plan.approvedBy = req.user?.email || req.user?.name;
  await plan.save();
  await audit({ teamspaceId: plan.teamspaceId, entityType: 'plan', entityId: plan._id, action: 'approve', before, after: { status: 'approved' }, req });

  if (plan.submittedBy) {
    const owner = await User.findOne({ email: plan.submittedBy });
    if (owner?.name) {
      await notify({
        type: 'plan_approved',
        title: 'Project hours plan approved ✅',
        message: `Your plan "${plan.title}" was approved by ${req.user?.name || 'Admin'}. You can now allocate hours to users.`,
        userId: owner.name,
        actorName: req.user?.name,
        teamspaceId: plan.teamspaceId,
      });
    }
  }
  workflowEngine.fire('plan_approved', plan.toObject(), { actor: req.user?.name });
  ok(res, plan);
});

// POST /api/time/plans/:id/reject  — admin only, pending → rejected, body: {reason}
router.post('/plans/:id/reject', async (req, res) => {
  if (!isAdmin(req)) return fail(res, 'Admin only', 403);
  const reason = (req.body?.reason || '').trim();
  if (reason.length < 10) return fail(res, 'Rejection reason must be at least 10 characters', 400);

  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'pending') return fail(res, `Cannot reject a ${plan.status} plan`, 400);

  const before = { status: plan.status };
  plan.status          = 'rejected';
  plan.rejectedAt      = new Date();
  plan.rejectedBy      = req.user?.email || req.user?.name;
  plan.rejectionReason = reason;
  await plan.save();
  await audit({ teamspaceId: plan.teamspaceId, entityType: 'plan', entityId: plan._id, action: 'reject', before, after: { status: 'rejected', reason }, req, reason });

  if (plan.submittedBy) {
    const owner = await User.findOne({ email: plan.submittedBy });
    if (owner?.name) {
      await notify({
        type: 'plan_rejected',
        title: 'Project hours plan rejected ❌',
        message: `Your plan "${plan.title}" was rejected by ${req.user?.name || 'Admin'}. Reason: ${reason}`,
        userId: owner.name,
        actorName: req.user?.name,
        teamspaceId: plan.teamspaceId,
      });
    }
  }
  workflowEngine.fire('plan_rejected', plan.toObject(), { actor: req.user?.name, reason });
  ok(res, plan);
});

// POST /api/time/plans/:id/reopen  — owner / admin, rejected → draft
router.post('/plans/:id/reopen', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'rejected') return fail(res, `Can only reopen a rejected plan (current: ${plan.status})`, 400);

  const project = await Project.findById(plan.projectId);
  const isOwner = project && String(project.ownerId) === String(req.user.userId);
  if (!isOwner && !isAdmin(req)) return fail(res, 'Only owner or admin can reopen', 403);

  const before = { status: plan.status };
  plan.status          = 'draft';
  plan.rejectionReason = '';
  await plan.save();
  await audit({ teamspaceId: plan.teamspaceId, entityType: 'plan', entityId: plan._id, action: 'reopen', before, after: { status: 'draft' }, req });
  ok(res, plan);
});

// GET /api/time/plans/:id/audit  — full audit trail for one plan
router.get('/plans/:id/audit', async (req, res) => {
  const log = await TimesheetAudit.find({ entityType: 'plan', entityId: req.params.id }).sort({ at: -1 }).limit(200);
  ok(res, log);
});

// ────────────────────────────────────────────────────────────────────────────
// ALLOCATIONS  (Phase 3)
// ────────────────────────────────────────────────────────────────────────────
const Task = require('../models/Task').Task;

// Mon-Fri YYYY-MM-DD strings between start and end (inclusive)
function workingDayList(start, end) {
  const days = [];
  const d = new Date(start);
  d.setUTCHours(0,0,0,0);
  const last = new Date(end);
  last.setUTCHours(0,0,0,0);
  while (d <= last) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

// Group working days into ISO-week buckets keyed by Monday.
function weekBuckets(start, end) {
  const days = workingDayList(start, end);
  const groups = new Map();
  for (const day of days) {
    const d = new Date(day + 'T00:00:00Z');
    const dayIdx = d.getUTCDay();          // 0=Sun … 6=Sat
    const offset = dayIdx === 0 ? -6 : 1 - dayIdx;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + offset);
    const key = monday.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  }
  const out = [];
  for (const key of [...groups.keys()].sort()) {
    const monday = new Date(key + 'T00:00:00Z');
    const friday = new Date(monday); friday.setUTCDate(monday.getUTCDate() + 4);
    out.push({ weekStart: monday, weekEnd: friday, days: groups.get(key) });
  }
  return out;
}

// Distribute total hours across weeks, weighted by working-days-per-week.
// Rounded to 0.25h, with the remainder swept into the first week so totals match exactly.
function distributeHours(totalHours, weeks) {
  if (!weeks.length) return [];
  const totalDays = weeks.reduce((s, w) => s + w.days.length, 0) || 1;
  const raw = weeks.map(w => (totalHours * w.days.length) / totalDays);
  const rounded = raw.map(h => Math.round(h * 4) / 4);
  const drift = +(totalHours - rounded.reduce((s,h) => s + h, 0)).toFixed(4);
  if (rounded.length) rounded[0] = +(rounded[0] + drift).toFixed(2);
  return rounded;
}

// POST /api/time/plans/:id/allocate
//   Creates a Task per plan-line and one Allocation per (week, line) bucket.
//   Idempotent on lines that have a taskId set already (skips them).
router.post('/plans/:id/allocate', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  if (plan.status !== 'approved') return fail(res, 'Plan must be approved before allocating', 400);

  const project = await Project.findById(plan.projectId);
  const isOwner = project && String(project.ownerId) === String(req.user.userId);
  if (!isOwner && !isAdmin(req)) return fail(res, 'Only owner / admin can allocate', 403);

  const lines = await ProjectHoursPlanLine.find({ planId: plan._id });
  if (!lines.length) return fail(res, 'Plan has no lines to allocate', 400);

  const created = [], skipped = [], allocCreated = [];

  for (const line of lines) {
    if (line.taskId) { skipped.push({ lineId: line._id, reason: 'already allocated' }); continue; }

    // Resolve assignee name (for the Task.assignee string field used by existing UI)
    let assigneeName = '';
    if (line.assigneeUserId) {
      const u = await User.findById(line.assigneeUserId);
      assigneeName = u?.name || '';
    } else if (line.assigneeBucketId) {
      const b = await RateBucket.findById(line.assigneeBucketId);
      assigneeName = b?.name || '(expense)';
    }

    // Create a Task in the existing tasks collection
    const taskDoc = new Task({
      id: `plan_${plan._id.toString().slice(-6)}_${line._id.toString().slice(-6)}`,
      title: `${line.taskType} — ${project.name}`,
      description: line.notes || '',
      status: 'Not Yet Started',
      priority: '',
      assignee: assigneeName,
      dueDate: line.targetDate,
      startDate: line.startDate,
      estimatedHours: line.plannedHours || 0,
      actualHours: 0,
      taskType: [line.taskType],
      projectId: plan.projectId.toString(),
      teamspaceId: plan.teamspaceId,
      customProperties: [{ definitionId: 'plan', value: plan.title }],
      attachments: [],
    });
    await taskDoc.save();
    line.taskId = taskDoc._id;
    await line.save();
    created.push({ lineId: line._id, taskId: taskDoc._id, title: taskDoc.title });

    // Create per-week allocations only when there's a real user (not an expense bucket)
    if (line.assigneeUserId) {
      const weeks = weekBuckets(line.startDate, line.targetDate);
      const hoursPerWeek = distributeHours(line.plannedHours || 0, weeks);
      for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        const allocated = hoursPerWeek[i];
        if (allocated <= 0) continue;
        const a = await Allocation.create({
          teamspaceId:         plan.teamspaceId,
          planId:              plan._id,
          planLineId:          line._id,
          userId:              line.assigneeUserId,
          projectId:           plan.projectId,
          taskId:              taskDoc._id,
          bucket:              'week',
          weekStart:           w.weekStart,
          weekEnd:             w.weekEnd,
          allocatedHours:      allocated,
          consumedHours:       0,
          remainingHours:      allocated,
          billable:            line.billable,
          frozenRateCents:     line.frozenRateCents,
          frozenBillRateCents: line.frozenBillRateCents,
          status:              'active',
        });
        allocCreated.push({ allocationId: a._id, weekStart: w.weekStart, allocatedHours: a.allocatedHours });
      }
    }

    // Notify the assigned user
    if (line.assigneeUserId) {
      const u = await User.findById(line.assigneeUserId);
      if (u?.name) {
        await notify({
          type: 'allocation_created',
          title: 'New time allocation',
          message: `You have ${line.plannedHours}h on "${taskDoc.title}" for ${plan.periodMonth}.`,
          taskId: taskDoc.id,
          taskTitle: taskDoc.title,
          userId: u.name,
          actorName: req.user?.name,
          teamspaceId: plan.teamspaceId,
        });
      }
    }
  }

  await audit({
    teamspaceId: plan.teamspaceId, entityType: 'plan', entityId: plan._id, action: 'allocate',
    after: { tasksCreated: created.length, allocations: allocCreated.length, skipped: skipped.length }, req,
  });

  ok(res, { tasksCreated: created, allocationsCreated: allocCreated, skipped });
});

// GET /api/time/plans/:planId/allocations  — line × week grid for the editor
router.get('/plans/:planId/allocations', async (req, res) => {
  const allocs = await Allocation.find({ planId: req.params.planId }).sort({ weekStart: 1 });
  ok(res, allocs);
});

// GET /api/time/allocations  — generic; filterable by user/project/from/to
router.get('/allocations', async (req, res) => {
  const filter = { teamspaceId: tsId(req) };
  if (req.query.userId)    filter.userId    = req.query.userId;
  if (req.query.projectId) filter.projectId = req.query.projectId;
  if (req.query.planId)    filter.planId    = req.query.planId;
  if (req.query.from)      filter.weekStart = { ...filter.weekStart, $gte: new Date(req.query.from) };
  if (req.query.to)        filter.weekStart = { ...filter.weekStart, $lte: new Date(req.query.to) };
  ok(res, await Allocation.find(filter).sort({ weekStart: 1 }));
});

// PUT /api/time/allocations/:id  — adjust allocatedHours; cannot drop below consumedHours
router.put('/allocations/:id', async (req, res) => {
  const a = await Allocation.findById(req.params.id);
  if (!a) return fail(res, 'Allocation not found', 404);

  if (req.body.allocatedHours != null) {
    const newAllocated = Number(req.body.allocatedHours);
    if (newAllocated < 0) return fail(res, 'allocatedHours must be >= 0', 400);
    if (newAllocated < a.consumedHours - 1e-6) {
      return fail(res, `Cannot reduce allocation below already-consumed ${a.consumedHours}h`, 400);
    }
    a.allocatedHours = newAllocated;
    a.remainingHours = +(newAllocated - a.consumedHours).toFixed(4);
  }
  if (req.body.status && ['active','closed'].includes(req.body.status)) a.status = req.body.status;
  await a.save();
  ok(res, a);
});

// DELETE /api/time/allocations/:id  — soft-close (does not remove if any time is logged)
router.delete('/allocations/:id', async (req, res) => {
  const a = await Allocation.findById(req.params.id);
  if (!a) return fail(res, 'Allocation not found', 404);
  if (a.consumedHours > 0) return fail(res, `Cannot delete — ${a.consumedHours}h already logged. Close instead.`, 400);
  await Allocation.findByIdAndDelete(a._id);
  ok(res, { success: true });
});

// ────────────────────────────────────────────────────────────────────────────
// MEMBER TIMESHEET   (Phase 4)
// ────────────────────────────────────────────────────────────────────────────

// Monday of the ISO week containing date (UTC-stable).
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const w = d.getUTCDay();                     // 0=Sun..6=Sat
  const offset = w === 0 ? -6 : 1 - w;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}
function fridayOf(monday) { const f = new Date(monday); f.setUTCDate(monday.getUTCDate() + 4); return f; }

// Find-or-create the user's TimesheetPeriod for the week containing `dateStr`.
async function ensurePeriod({ teamspaceId, userId, dateStr }) {
  const weekStart = mondayOf(dateStr);
  const weekEnd   = fridayOf(weekStart);
  let period = await TimesheetPeriod.findOne({ userId, weekStart });
  if (!period) {
    period = await TimesheetPeriod.create({ teamspaceId, userId, weekStart, weekEnd });
  }
  return period;
}

// Find-or-create the per-project slice for this week.
async function ensureSlice({ teamspaceId, userId, projectId, periodId, weekStart, weekEnd }) {
  let slice = await TimesheetSlice.findOne({ userId, projectId, weekStart });
  if (!slice) {
    const proj = await Project.findById(projectId);
    if (!proj) throw new Error('Project not found');
    slice = await TimesheetSlice.create({
      teamspaceId, userId, periodId, projectId,
      projectOwnerId: proj.ownerId || null,
      weekStart, weekEnd,
    });
  }
  return slice;
}

// Recompute slice + period totals from all entries in scope.
async function recomputeSliceAndPeriod({ userId, periodId }) {
  const period = await TimesheetPeriod.findById(periodId);
  if (!period) return;
  const slices = await TimesheetSlice.find({ periodId });
  for (const s of slices) {
    const entries = await TimeEntry.find({ sliceId: s._id });
    s.totalMinutes   = entries.reduce((a, e) => a + (e.minutes  || 0), 0);
    s.totalCostCents = entries.reduce((a, e) => a + (e.costCents|| 0), 0);
    await s.save();
  }
  const allEntries = await TimeEntry.find({ periodId });
  period.totalMinutes   = allEntries.reduce((a, e) => a + (e.minutes  || 0), 0);
  period.totalCostCents = allEntries.reduce((a, e) => a + (e.costCents|| 0), 0);
  period.sliceCount     = slices.length;
  period.approvedSliceCount = slices.filter(s => s.status === 'approved').length;
  // Period status rollup
  if (slices.length === 0)                                            period.status = 'open';
  else if (slices.every(s => s.status === 'approved'))                period.status = 'approved';
  else if (slices.some(s => s.status === 'rejected'))                 period.status = 'rejected';
  else if (slices.some(s => s.status === 'approved'))                 period.status = 'partially_approved';
  else if (slices.every(s => s.status === 'submitted'))               period.status = 'submitted';
  else                                                                period.status = 'open';
  await period.save();
}

// Backfill periodId/sliceId on the entry. Returns the populated entry doc.
async function linkEntryToPeriod(entry, teamspaceId, userId) {
  const period = await ensurePeriod({ teamspaceId, userId, dateStr: entry.date });
  const slice  = await ensureSlice({
    teamspaceId, userId, projectId: entry.projectId, periodId: period._id,
    weekStart: period.weekStart, weekEnd: period.weekEnd,
  });
  entry.periodId = period._id;
  entry.sliceId  = slice._id;
  await entry.save();
  return { period, slice };
}

// Patch the existing POST /entries to also link period/slice + recompute slice
// (already exists earlier; here we add a wrapper for the bulk + the missing linking).
async function postEntryAndLink({ teamspaceId, userId, body }) {
  const allocation = await Allocation.findById(body.allocationId);
  if (!allocation) throw Object.assign(new Error('Allocation not found'), { code: 404 });
  if (String(allocation.userId) !== String(userId)) throw Object.assign(new Error('Wrong user for this allocation'), { code: 403 });

  const newHours = Number(body.minutes) / 60;
  if (allocation.consumedHours + newHours > allocation.allocatedHours + 1e-6) {
    throw Object.assign(new Error(`Allocation exceeded — allocated ${allocation.allocatedHours}h, consumed ${allocation.consumedHours.toFixed(2)}h, +${newHours.toFixed(2)}h`), { code: 400 });
  }
  const billable     = allocation.billable;
  const costCents    = Math.round((Number(body.minutes) / 60) * (allocation.frozenRateCents || 0));
  const revenueCents = billable ? Math.round((Number(body.minutes) / 60) * (allocation.frozenBillRateCents || 0)) : 0;

  const entry = await TimeEntry.create({
    teamspaceId, userId,
    date: body.date, projectId: body.projectId, taskId: body.taskId, allocationId: body.allocationId,
    minutes: Number(body.minutes), notes: body.notes || '',
    billable, costCents, revenueCents,
  });
  await linkEntryToPeriod(entry, teamspaceId, userId);
  allocation.consumedHours = +(allocation.consumedHours + newHours).toFixed(4);
  allocation.remainingHours = +(allocation.allocatedHours - allocation.consumedHours).toFixed(4);
  await allocation.save();
  return entry;
}

// POST /api/time/entries/bulk  — diff-save the whole week
//   body: { weekStart: 'YYYY-MM-DD', entries: [{date, projectId, taskId, allocationId, minutes, notes}, ...] }
//   The endpoint replaces the user's entries in [weekStart..weekStart+4] with the supplied list.
router.post('/entries/bulk', async (req, res) => {
  try {
    const userId = req.user.userId;
    const teamspace = tsId(req);
    const { weekStart, entries = [] } = req.body;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return fail(res, 'weekStart YYYY-MM-DD required');
    const monday = mondayOf(weekStart);
    const friday = fridayOf(monday);
    const fri = friday.toISOString().slice(0, 10);
    const mon = monday.toISOString().slice(0, 10);

    // Reject weekend dates and validate basics
    for (const e of entries) {
      if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return fail(res, `Bad date ${e.date}`);
      if (e.date < mon || e.date > fri)                   return fail(res, `Entry ${e.date} outside week ${mon}…${fri}`);
      if (isWeekend(e.date))                              return fail(res, `Entry on weekend ${e.date}`);
      if (e.minutes == null || Number(e.minutes) < 0)     return fail(res, `Bad minutes for ${e.date}`);
      if (!e.allocationId || !e.projectId || !e.taskId)   return fail(res, 'allocationId, projectId, taskId required for each entry');
    }

    // Period must be editable
    const period = await ensurePeriod({ teamspaceId: teamspace, userId, dateStr: mon });
    if (!['open', 'rejected'].includes(period.status)) {
      return fail(res, `Cannot edit a ${period.status} period`, 400);
    }

    // ── Pre-validate against allocation caps BEFORE touching any data. ──
    // The new total hours per allocation (within this week) come from `entries`.
    // The check: for each allocation referenced, the *new* week-total must not exceed
    // (allocation.allocatedHours - hoursConsumedOutsideThisWeek).
    const newHoursByAlloc = {};
    for (const e of entries) {
      if (Number(e.minutes) === 0) continue;
      newHoursByAlloc[e.allocationId] = (newHoursByAlloc[e.allocationId] || 0) + Number(e.minutes) / 60;
    }
    for (const [aid, newWeekHours] of Object.entries(newHoursByAlloc)) {
      const a = await Allocation.findById(aid);
      if (!a) return fail(res, `Allocation ${aid} not found`, 404);
      if (String(a.userId) !== String(userId)) return fail(res, `Allocation ${aid} belongs to another user`, 403);
      if (a.status === 'closed') return fail(res, `Allocation for week of ${a.weekStart.toISOString().slice(0,10)} is closed`, 400);
      // Hours already logged against this allocation OUTSIDE this week (rare, but possible if dates drift)
      const outside = await TimeEntry.find({ allocationId: aid, $or: [{ date: { $lt: mon } }, { date: { $gt: fri } }] });
      const outsideHours = outside.reduce((s, e) => s + (e.minutes || 0), 0) / 60;
      if (outsideHours + newWeekHours > a.allocatedHours + 1e-6) {
        return fail(res, `Allocation exceeded — limit ${a.allocatedHours}h, requesting ${(outsideHours + newWeekHours).toFixed(2)}h`, 400);
      }
    }

    // ── All-clear. Now wipe + recreate. ──
    const existing = await TimeEntry.find({ userId, date: { $gte: mon, $lte: fri } });
    const allocIdsTouched = new Set(existing.map(e => String(e.allocationId)));
    if (existing.length) await TimeEntry.deleteMany({ _id: { $in: existing.map(e => e._id) } });

    const created = [];
    for (const e of entries) {
      if (Number(e.minutes) === 0) continue;
      const newEntry = await postEntryAndLink({ teamspaceId: teamspace, userId, body: e });
      created.push(newEntry);
      allocIdsTouched.add(String(newEntry.allocationId));
    }

    // Rebuild consumedHours on every touched allocation
    for (const aid of allocIdsTouched) {
      const a = await Allocation.findById(aid);
      if (!a) continue;
      const totalMins = (await TimeEntry.find({ allocationId: a._id })).reduce((s, e) => s + (e.minutes || 0), 0);
      a.consumedHours  = +(totalMins / 60).toFixed(4);
      a.remainingHours = +(a.allocatedHours - a.consumedHours).toFixed(4);
      await a.save();
    }

    // Recompute slice/period totals
    await recomputeSliceAndPeriod({ userId, periodId: period._id });

    // Refresh plan-line + plan actuals for any plan whose lines were touched.
    // Fire budget_overrun if applicable.
    const planLineIds = new Set();
    for (const aid of allocIdsTouched) {
      const a = await Allocation.findById(aid);
      if (a?.planLineId) planLineIds.add(String(a.planLineId));
    }
    await refreshActualsForLines([...planLineIds]);
    ok(res, { period, count: created.length });
  } catch (e) { fail(res, e.message, e.code || 500); }
});

// GET /api/time/periods/me?weekStart=YYYY-MM-DD
//   Returns: { period, slices[], allocations[], entries[] } for the requested week.
router.get('/periods/me', async (req, res) => {
  const userId = req.query.userId || req.user.userId;
  const teamspace = tsId(req);
  const weekStartStr = req.query.weekStart || new Date().toISOString().slice(0, 10);
  const monday = mondayOf(weekStartStr);
  const friday = fridayOf(monday);
  const mon = monday.toISOString().slice(0, 10);
  const fri = friday.toISOString().slice(0, 10);

  const period = await ensurePeriod({ teamspaceId: teamspace, userId, dateStr: mon });
  const slices = await TimesheetSlice.find({ periodId: period._id });
  // Allocations active for this week (weekStart === Monday of requested week)
  const allocations = await Allocation.find({ userId, weekStart: monday }).populate('projectId', 'name icon defaultBillRateCents ownerId').populate('taskId', 'title id _id');
  const entries = await TimeEntry.find({ userId, date: { $gte: mon, $lte: fri } });

  ok(res, { weekStart: mon, weekEnd: fri, period, slices, allocations, entries });
});

// POST /api/time/periods/:id/submit  — splits into per-project slices, routes each to project owner
router.post('/periods/:id/submit', async (req, res) => {
  const period = await TimesheetPeriod.findById(req.params.id);
  if (!period) return fail(res, 'Period not found', 404);
  if (String(period.userId) !== String(req.user.userId) && !isAdmin(req)) return fail(res, 'Cannot submit someone else\'s week', 403);
  if (!['open', 'rejected'].includes(period.status)) return fail(res, `Cannot submit a ${period.status} period`, 400);

  const slices = await TimesheetSlice.find({ periodId: period._id });
  if (!slices.length) return fail(res, 'No entries to submit — log at least one hour first', 400);

  // Make sure each slice has an approver and is set to 'submitted'
  for (const s of slices) {
    if (!s.projectOwnerId) {
      const proj = await Project.findById(s.projectId);
      if (proj?.ownerId) { s.projectOwnerId = proj.ownerId; }
      else { return fail(res, `Project ${s.projectId} has no owner — ask an admin to set one before submitting`, 400); }
    }
    s.status      = 'submitted';
    s.submittedAt = new Date();
    s.rejectionReason = '';
    await s.save();

    // Notify the project owner
    const owner = await User.findById(s.projectOwnerId);
    if (owner?.name) {
      const proj = await Project.findById(s.projectId);
      await notify({
        type: 'time_submitted',
        title: 'Weekly time submitted for your approval',
        message: `${req.user?.name || 'A user'} submitted ${(s.totalMinutes/60).toFixed(1)}h on ${proj?.name || 'a project'} for week of ${period.weekStart.toISOString().slice(0,10)}`,
        userId: owner.name,
        actorName: req.user?.name,
        teamspaceId: s.teamspaceId || period.teamspaceId,
      });
    }
  }
  await recomputeSliceAndPeriod({ userId: period.userId, periodId: period._id });
  await audit({ teamspaceId: period.teamspaceId, entityType: 'period', entityId: period._id, action: 'submit', after: { sliceCount: slices.length }, req });
  ok(res, await TimesheetPeriod.findById(period._id));
});

// GET /api/time/queue/weeks  — slices submitted to me (project owner) for approval
router.get('/queue/weeks', async (req, res) => {
  const filter = { teamspaceId: tsId(req), status: 'submitted' };
  if (!isAdmin(req)) filter.projectOwnerId = req.user.userId;
  const slices = await TimesheetSlice.find(filter)
    .sort({ weekStart: -1, submittedAt: 1 })
    .populate('userId', 'name email')
    .populate('projectId', 'name icon');
  ok(res, slices);
});

// POST /api/time/slices/:id/approve
router.post('/slices/:id/approve', async (req, res) => {
  const s = await TimesheetSlice.findById(req.params.id);
  if (!s) return fail(res, 'Slice not found', 404);
  if (s.status !== 'submitted') return fail(res, `Cannot approve a ${s.status} slice`, 400);
  if (String(s.projectOwnerId) !== String(req.user.userId) && !isAdmin(req)) return fail(res, 'Only project owner / admin can approve', 403);

  s.status     = 'approved';
  s.approverId = req.user.userId;
  s.approvedAt = new Date();
  await s.save();

  // Mark its entries approved
  const entries = await TimeEntry.find({ sliceId: s._id });
  await TimeEntry.updateMany({ sliceId: s._id }, { $set: { status: 'approved' } });

  await recomputeSliceAndPeriod({ userId: s.userId, periodId: s.periodId });
  // Refresh plan actuals + budget-overrun trigger
  const planLineIds = new Set();
  for (const e of entries) {
    const a = await Allocation.findById(e.allocationId);
    if (a?.planLineId) planLineIds.add(String(a.planLineId));
  }
  await refreshActualsForLines([...planLineIds]);
  await audit({ teamspaceId: s.teamspaceId, entityType: 'slice', entityId: s._id, action: 'approve', req });

  // Notify the user
  const u = await User.findById(s.userId);
  if (u?.name) {
    const proj = await Project.findById(s.projectId);
    await notify({
      type: 'time_approved',
      title: 'Weekly time approved ✅',
      message: `Your ${(s.totalMinutes/60).toFixed(1)}h on ${proj?.name || 'a project'} for week of ${s.weekStart.toISOString().slice(0,10)} was approved by ${req.user?.name || 'Owner'}`,
      userId: u.name,
      actorName: req.user?.name,
      teamspaceId: s.teamspaceId,
    });
  }
  ok(res, s);
});

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD / REPORTS  (Phase 5)
// ────────────────────────────────────────────────────────────────────────────

// "YYYY-MM" → Date bounds (UTC)
function monthRange(periodMonth) {
  const [y, m] = periodMonth.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0, 23, 59, 59)) };
}
function isoMonth(d = new Date()) { return d.toISOString().slice(0, 7); }

// GET /api/time/dashboard/totals?month=YYYY-MM&projectId=&status=
router.get('/dashboard/totals', async (req, res) => {
  const month = req.query.month || isoMonth();
  const filter = { teamspaceId: tsId(req), periodMonth: month };
  filter.status    = req.query.status || 'approved';
  if (req.query.projectId) filter.projectId = req.query.projectId;
  const plans = await ProjectHoursPlan.find(filter);
  const sum = (k) => plans.reduce((s, p) => s + (p[k] || 0), 0);

  // Per-plan loss = the WORST of three deficits (don't add them — they overlap):
  //   • plannedDeficit — planned cost > planned revenue (forecast loss baked into the plan itself)
  //   • actualDeficit  — actual cost > actual revenue   (realized loss from logged time)
  //   • overrun        — actual cost > planned cost     (we burned more than planned)
  let plannedDeficitPaise = 0, actualDeficitPaise = 0, overrunPaise = 0;
  for (const p of plans) {
    plannedDeficitPaise += Math.max(0, (p.totalCostCents || 0) - (p.totalRevenueCents || 0));
    actualDeficitPaise  += Math.max(0, (p.totalActualCostCents || 0) - (p.totalActualRevenueCents || 0));
    overrunPaise        += Math.max(0, (p.totalActualCostCents || 0) - (p.totalCostCents || 0));
  }

  // Contract overrun: per project, sum of (committed cost across this month's plans − contract value).
  // A non-zero value means we promised the team more than the client agreed to pay for.
  const projectIds = [...new Set(plans.map(p => String(p.projectId)))];
  const projectsWithContract = projectIds.length
    ? await Project.find({ _id: { $in: projectIds }, contractValueCents: { $gt: 0 } }).select('_id contractValueCents').lean()
    : [];
  let contractOverrunPaise = 0;
  for (const proj of projectsWithContract) {
    const committed = plans
      .filter(p => String(p.projectId) === String(proj._id))
      .reduce((s, p) => s + (p.totalCostCents || 0), 0);
    if (committed > proj.contractValueCents) contractOverrunPaise += (committed - proj.contractValueCents);
  }

  // Headline loss — the biggest signal (so the user's eye lands on it).
  const lossPaise = Math.max(plannedDeficitPaise, actualDeficitPaise, overrunPaise, contractOverrunPaise);

  ok(res, {
    month,
    plansCount:               plans.length,
    plannedHours:             sum('totalPlannedHours'),
    actualHours:              sum('totalActualHours'),
    plannedCostCents:         sum('totalCostCents'),
    actualCostCents:          sum('totalActualCostCents'),
    plannedRevenueCents:      sum('totalRevenueCents'),
    actualRevenueCents:       sum('totalActualRevenueCents'),
    plannedProfitCents:       sum('plannedProfitCents'),
    actualProfitCents:        sum('actualProfitCents'),
    lossCents:                lossPaise,
    lossBreakdown: {
      plannedDeficitCents:    plannedDeficitPaise,
      actualDeficitCents:     actualDeficitPaise,
      overrunCents:           overrunPaise,
      contractOverrunCents:   contractOverrunPaise,
    },
    plannedMarginPct:         sum('totalRevenueCents') > 0 ? sum('plannedProfitCents') / sum('totalRevenueCents') : 0,
    actualMarginPct:          sum('totalActualRevenueCents') > 0 ? sum('actualProfitCents') / sum('totalActualRevenueCents') : 0,
    billableActualHours:      sum('billableActualHours'),
    nonBillableActualHours:   sum('nonBillableActualHours'),
    billableCostCents:        sum('billableCostCents'),
    nonBillableCostCents:     sum('nonBillableCostCents'),
  });
});

// GET /api/time/dashboard/pipeline
router.get('/dashboard/pipeline', async (req, res) => {
  const teamspace = tsId(req);
  const [pendingPlans, submittedSlices, openPeriods, draftPlans] = await Promise.all([
    ProjectHoursPlan.countDocuments({ teamspaceId: teamspace, status: 'pending' }),
    TimesheetSlice.countDocuments({ teamspaceId: teamspace, status: 'submitted' }),
    TimesheetPeriod.countDocuments({ teamspaceId: teamspace, status: 'open' }),
    ProjectHoursPlan.countDocuments({ teamspaceId: teamspace, status: 'draft' }),
  ]);
  ok(res, { pendingPlans, submittedSlices, openPeriods, draftPlans });
});

// GET /api/time/reports/projects?month=YYYY-MM&projectId=&status=
router.get('/reports/projects', async (req, res) => {
  const month = req.query.month || isoMonth();
  const filter = { teamspaceId: tsId(req), periodMonth: month, status: req.query.status || 'approved' };
  if (req.query.projectId) filter.projectId = req.query.projectId;
  const plans = await ProjectHoursPlan.find(filter).lean();
  const projectIds = [...new Set(plans.map(p => String(p.projectId)))];
  const projects = await Project.find({ _id: { $in: projectIds } }).select('name icon defaultBillRateCents ownerId').lean();
  const projectMap = Object.fromEntries(projects.map(p => [String(p._id), p]));
  const rows = plans.map(p => {
    const proj = projectMap[String(p.projectId)] || {};
    const variance = (p.totalActualCostCents || 0) - (p.totalCostCents || 0);
    const isLoss   = variance > 0;
    return {
      planId:               p._id,
      projectId:            p.projectId,
      projectName:          proj.name || '(unknown)',
      projectIcon:          proj.icon || '📁',
      plannedHours:         p.totalPlannedHours,
      actualHours:          p.totalActualHours,
      billableHours:        p.billablePlannedHours,
      nonBillableHours:     p.nonBillablePlannedHours,
      plannedCostCents:     p.totalCostCents,
      actualCostCents:      p.totalActualCostCents,
      plannedRevenueCents:  p.totalRevenueCents,
      actualRevenueCents:   p.totalActualRevenueCents,
      plannedProfitCents:   p.plannedProfitCents,
      actualProfitCents:    p.actualProfitCents,
      varianceCents:        variance,
      isLoss,
      plannedMarginPct:     p.plannedMarginPct,
      actualMarginPct:      p.actualMarginPct,
      ragStatus:            p.ragStatus,
    };
  }).sort((a, b) => (b.plannedCostCents || 0) - (a.plannedCostCents || 0));
  ok(res, rows);
});

// GET /api/time/reports/cost-by-bucket?month=YYYY-MM&projectId=
router.get('/reports/cost-by-bucket', async (req, res) => {
  const month = req.query.month || isoMonth();
  const { start, end } = monthRange(month);
  const entryFilter = { teamspaceId: tsId(req), date: { $gte: start.toISOString().slice(0,10), $lte: end.toISOString().slice(0,10) } };
  if (req.query.projectId) entryFilter.projectId = req.query.projectId;
  const entries = await TimeEntry.find(entryFilter).lean();
  const allocations = await Allocation.find({ _id: { $in: [...new Set(entries.map(e => String(e.allocationId)))] } }).lean();
  const allocMap = Object.fromEntries(allocations.map(a => [String(a._id), a]));
  // group by frozenRateCents — proxy for bucket since we already snapshotted the rate
  const bucketSums = {};
  for (const e of entries) {
    const a = allocMap[String(e.allocationId)];
    if (!a) continue;
    const key = String(a.frozenRateCents);
    if (!bucketSums[key]) bucketSums[key] = { ratePerHourCents: a.frozenRateCents, hours: 0, costCents: 0 };
    bucketSums[key].hours    += (e.minutes || 0) / 60;
    bucketSums[key].costCents += (e.costCents || 0);
  }
  // Resolve bucket names
  const buckets = await RateBucket.find({ teamspaceId: tsId(req) }).lean();
  const out = Object.values(bucketSums).map(row => {
    const matched = buckets.find(b => b.ratePerHourCents === row.ratePerHourCents);
    return { ...row, bucketName: matched?.name || `${row.ratePerHourCents/100} ₹/hr` };
  }).sort((a, b) => b.costCents - a.costCents);
  ok(res, out);
});

// GET /api/time/reports/monthly-trend?months=6&projectId=
router.get('/reports/monthly-trend', async (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months || 6)));
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const month = isoMonth(dt);
    const filter = { teamspaceId: tsId(req), periodMonth: month, status: 'approved' };
    if (req.query.projectId) filter.projectId = req.query.projectId;
    const plans = await ProjectHoursPlan.find(filter).lean();
    const sum = (k) => plans.reduce((s, p) => s + (p[k] || 0), 0);
    out.push({
      month,
      plannedRevenueCents: sum('totalRevenueCents'),
      actualRevenueCents:  sum('totalActualRevenueCents'),
      plannedCostCents:    sum('totalCostCents'),
      actualCostCents:     sum('totalActualCostCents'),
      plannedProfitCents:  sum('plannedProfitCents'),
      actualProfitCents:   sum('actualProfitCents'),
    });
  }
  ok(res, out);
});

// GET /api/time/reports/utilization?weekStart=YYYY-MM-DD
//   Returns matrix [{ user, days: { 'YYYY-MM-DD': { allocated, consumed, billable } } }]
router.get('/reports/utilization', async (req, res) => {
  const weekStartStr = req.query.weekStart || new Date().toISOString().slice(0,10);
  const monday = mondayOf(weekStartStr);
  const friday = fridayOf(monday);
  const mon = monday.toISOString().slice(0,10);
  const fri = friday.toISOString().slice(0,10);
  const days = [0,1,2,3,4].map(i => {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate()+i); return d.toISOString().slice(0,10);
  });

  const allocs = await Allocation.find({ teamspaceId: tsId(req), weekStart: monday }).lean();
  const entries = await TimeEntry.find({ teamspaceId: tsId(req), date: { $gte: mon, $lte: fri } }).lean();
  const userIds = [...new Set([...allocs.map(a=>String(a.userId)), ...entries.map(e=>String(e.userId))])];
  const users = await User.find({ _id: { $in: userIds } }).select('name email').lean();
  const userMap = Object.fromEntries(users.map(u => [String(u._id), u]));

  // Aggregate per user × day
  const allocByUser = {};
  for (const a of allocs) {
    if (!allocByUser[a.userId]) allocByUser[a.userId] = 0;
    allocByUser[a.userId] += a.allocatedHours || 0;
  }
  const consumedByUserDay = {};
  const billableByUserDay = {};
  for (const e of entries) {
    const k = `${e.userId}::${e.date}`;
    consumedByUserDay[k] = (consumedByUserDay[k] || 0) + (e.minutes || 0) / 60;
    if (e.billable) billableByUserDay[k] = (billableByUserDay[k] || 0) + (e.minutes || 0) / 60;
  }

  const rows = userIds.map(uid => {
    const user = userMap[uid] || { name: '(unknown)', email: '' };
    const dayMap = {};
    for (const d of days) {
      dayMap[d] = {
        consumed: +(consumedByUserDay[`${uid}::${d}`] || 0).toFixed(2),
        billable: +(billableByUserDay[`${uid}::${d}`] || 0).toFixed(2),
      };
    }
    return { userId: uid, userName: user.name, weeklyAllocated: +allocByUser[uid] || 0, days: dayMap };
  }).sort((a, b) => b.weeklyAllocated - a.weeklyAllocated);

  ok(res, { weekStart: mon, weekEnd: fri, days, rows });
});

// GET /api/time/reports/project/:projectId/pnl?month=YYYY-MM
//   Aggregates across ALL approved plans for this project + month
//   (multiple budget approvals per project are now allowed).
router.get('/reports/project/:projectId/pnl', async (req, res) => {
  const month = req.query.month || isoMonth();
  const plans = await ProjectHoursPlan.find({ teamspaceId: tsId(req), projectId: req.params.projectId, periodMonth: month }).lean();
  if (!plans.length) return fail(res, `No plans for project ${req.params.projectId} in ${month}`, 404);

  // Roll up the per-plan totals into one synthetic "plan-summary" object that
  // the FE already knows how to render.
  const sumK = (k) => plans.reduce((s, p) => s + (p[k] || 0), 0);
  const planSummary = {
    _id:                        plans[0]._id,                  // first plan id used as the canonical ref
    title:                      plans.length === 1 ? plans[0].title : `${plans.length} plans (rolled-up)`,
    periodMonth:                month,
    status:                     plans.length === 1 ? plans[0].status : 'multi',
    totalPlannedHours:          sumK('totalPlannedHours'),
    billablePlannedHours:       sumK('billablePlannedHours'),
    nonBillablePlannedHours:    sumK('nonBillablePlannedHours'),
    totalCostCents:             sumK('totalCostCents'),
    billableCostCents:          sumK('billableCostCents'),
    nonBillableCostCents:       sumK('nonBillableCostCents'),
    totalRevenueCents:          sumK('totalRevenueCents'),
    totalActualHours:           sumK('totalActualHours'),
    billableActualHours:        sumK('billableActualHours'),
    nonBillableActualHours:     sumK('nonBillableActualHours'),
    totalActualCostCents:       sumK('totalActualCostCents'),
    billableActualCostCents:    sumK('billableActualCostCents'),
    nonBillableActualCostCents: sumK('nonBillableActualCostCents'),
    totalActualRevenueCents:    sumK('totalActualRevenueCents'),
  };
  planSummary.plannedProfitCents = planSummary.totalRevenueCents - planSummary.totalCostCents;
  planSummary.actualProfitCents  = planSummary.totalActualRevenueCents - planSummary.totalActualCostCents;
  planSummary.plannedMarginPct   = planSummary.totalRevenueCents > 0 ? planSummary.plannedProfitCents / planSummary.totalRevenueCents : 0;
  planSummary.actualMarginPct    = planSummary.totalActualRevenueCents > 0 ? planSummary.actualProfitCents / planSummary.totalActualRevenueCents : 0;

  // Aggregate lines and per-bucket breakdown across all plans
  const lines   = await ProjectHoursPlanLine.find({ planId: { $in: plans.map(p => p._id) } }).lean();
  const project = await Project.findById(req.params.projectId).select('name icon defaultBillRateCents ownerId contractValueCents billingType').lean();
  const projectFinancials = await computeProjectFinancials(req.params.projectId);
  const buckets = await RateBucket.find({ teamspaceId: tsId(req) }).lean();
  const bucketMap = Object.fromEntries(buckets.map(b => [String(b._id), b]));
  const byBucket = {};
  for (const l of lines) {
    const b = bucketMap[String(l.assigneeBucketId)] || { name: '(unknown)' };
    const key = b.name;
    if (!byBucket[key]) byBucket[key] = { bucketName: b.name, kind: b.kind || 'labor', plannedHours: 0, actualHours: 0, costCents: 0, actualCostCents: 0, billable: 0, nonBillable: 0 };
    byBucket[key].plannedHours    += l.plannedHours || 0;
    byBucket[key].actualHours     += l.actualHours || 0;
    byBucket[key].costCents       += l.costCents || 0;
    byBucket[key].actualCostCents += l.actualCostCents || 0;
    if (l.billable) byBucket[key].billable += l.costCents || 0; else byBucket[key].nonBillable += l.costCents || 0;
  }
  ok(res, {
    plan: planSummary,
    plans,                                               // include the raw list so the UI can show "3 plans rolled up"
    project,
    projectFinancials,
    lines,
    byBucket: Object.values(byBucket).sort((a, b) => b.actualCostCents - a.actualCostCents),
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CSV / JSON EXPORTS
// ────────────────────────────────────────────────────────────────────────────
// GET /api/time/export/entries?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
//   Streams a flat per-time-entry export. Useful for payroll / analytics ingest.
router.get('/export/entries', async (req, res) => {
  const { from, to } = req.query;
  const format = (req.query.format || 'csv').toLowerCase();
  if (!from || !to) return fail(res, 'from + to (YYYY-MM-DD) required', 400);

  const filter = { teamspaceId: tsId(req), date: { $gte: from, $lte: to } };
  const entries = await TimeEntry.find(filter)
    .populate('userId', 'name email')
    .populate('projectId', 'name')
    .populate('taskId', 'title')
    .lean();

  const rows = entries.map(e => ({
    date: e.date,
    user: e.userId?.name || '',
    email: e.userId?.email || '',
    project: e.projectId?.name || '',
    task: e.taskId?.title || '',
    hours: ((e.minutes || 0) / 60).toFixed(2),
    billable: e.billable ? 'Yes' : 'No',
    cost_rupees: Math.round((e.costCents || 0) / 100),
    revenue_rupees: Math.round((e.revenueCents || 0) / 100),
    status: e.status || '',
    notes: (e.notes || '').replace(/[\r\n]+/g, ' '),
  }));

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="time-entries-${from}-to-${to}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  }

  // CSV
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = ['date', 'user', 'email', 'project', 'task', 'hours', 'billable', 'cost_rupees', 'revenue_rupees', 'status', 'notes'];
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => escape(r[c])).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="time-entries-${from}-to-${to}.csv"`);
  res.send(csv);
});

// GET /api/time/export/plans?month=YYYY-MM&format=csv|json
router.get('/export/plans', async (req, res) => {
  const month = req.query.month || isoMonth();
  const format = (req.query.format || 'csv').toLowerCase();
  const plans = await ProjectHoursPlan.find({ teamspaceId: tsId(req), periodMonth: month }).lean();
  const projects = plans.length
    ? await Project.find({ _id: { $in: [...new Set(plans.map(p => p.projectId))] } }).select('name').lean()
    : [];
  const projById = Object.fromEntries(projects.map(p => [String(p._id), p.name]));

  const rows = plans.map(p => ({
    title: p.title,
    project: projById[String(p.projectId)] || '',
    period: p.periodMonth,
    status: p.status,
    planned_hours: p.totalPlannedHours || 0,
    actual_hours: p.totalActualHours || 0,
    planned_cost_rupees: Math.round((p.totalCostCents || 0) / 100),
    actual_cost_rupees: Math.round((p.totalActualCostCents || 0) / 100),
    planned_revenue_rupees: Math.round((p.totalRevenueCents || 0) / 100),
    planned_profit_rupees: Math.round((p.plannedProfitCents || 0) / 100),
    submitted_by: p.submittedBy || '',
    approved_by: p.approvedBy || '',
  }));

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="plans-${month}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  }
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = Object.keys(rows[0] || { period: '' });
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => escape(r[c])).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plans-${month}.csv"`);
  res.send(csv);
});

// ────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ────────────────────────────────────────────────────────────────────────────
// GET /api/time/audit?entityType=&entityId=&action=&from=&to=&limit=
//   Returns recent audit events scoped to the active teamspace.
router.get('/audit', async (req, res) => {
  const filter = { teamspaceId: tsId(req) };
  if (req.query.entityType) filter.entityType = req.query.entityType;
  if (req.query.entityId)   filter.entityId   = req.query.entityId;
  if (req.query.action)     filter.action     = req.query.action;
  if (req.query.from || req.query.to) {
    filter.at = {};
    if (req.query.from) filter.at.$gte = new Date(req.query.from);
    if (req.query.to)   filter.at.$lte = new Date(req.query.to + 'T23:59:59');
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const events = await TimesheetAudit.find(filter).sort({ at: -1 }).limit(limit).lean();
  ok(res, { count: events.length, events });
});

// ────────────────────────────────────────────────────────────────────────────
// PDF EXPORT — project P&L summary
// ────────────────────────────────────────────────────────────────────────────
// GET /api/time/reports/project/:projectId/pnl/pdf?month=YYYY-MM
//   Streams a one-page PDF with the same data the on-screen P&L panel shows.
router.get('/reports/project/:projectId/pnl/pdf', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const month = req.query.month || isoMonth();
    const teamspace = tsId(req);
    const plans = await ProjectHoursPlan.find({ teamspaceId: teamspace, projectId: req.params.projectId, periodMonth: month }).lean();
    if (!plans.length) return fail(res, `No plans for project in ${month}`, 404);
    const project = await Project.findById(req.params.projectId).select('name icon billingType contractValueCents').lean();
    const financials = await computeProjectFinancials(req.params.projectId);
    const sumK = (k) => plans.reduce((s, p) => s + (p[k] || 0), 0);
    const fmt = (cents) => '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
    const fmtH = (h) => (h || 0).toFixed(1) + 'h';

    const safeName = (project?.name || 'project').replace(/[^a-z0-9]+/gi, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-pnl-${month}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text(`${project?.icon || ''} ${project?.name || 'Project'} — P&L`, { align: 'left' });
    doc.fontSize(11).font('Helvetica').fillColor('#666').text(`Period: ${month}  ·  Plans rolled up: ${plans.length}  ·  Generated ${new Date().toLocaleString('en-IN')}`);
    doc.moveDown(1);
    doc.fillColor('#000');

    // Contract / billing
    if (project?.contractValueCents > 0 || project?.billingType === 'fixed') {
      doc.fontSize(13).font('Helvetica-Bold').text('Contract');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Billing type:  ${project.billingType === 'fixed' ? 'Fixed bid' : 'Time & Materials'}`);
      doc.text(`Contract value: ${fmt(project.contractValueCents)}`);
      if (financials) {
        doc.text(`Committed cost: ${fmt(financials.committedCostCents)}  (${financials.contractValueCents > 0 ? Math.round((financials.committedCostCents / financials.contractValueCents) * 100) : 0}% of contract)`);
        doc.text(`Spent so far:   ${fmt(financials.actualCostCents)}`);
        doc.text(`Status:         ${financials.status}`);
      }
      doc.moveDown(0.6);
    }

    // P&L grid
    doc.fontSize(13).font('Helvetica-Bold').text('P&L Summary');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    const rows = [
      ['',                  'Billable',                                      'Non-Billable',                                  'Total'],
      ['Planned hours',     fmtH(sumK('billablePlannedHours')),               fmtH(sumK('nonBillablePlannedHours')),           fmtH(sumK('totalPlannedHours'))],
      ['Actual hours',      fmtH(sumK('billableActualHours')),                fmtH(sumK('nonBillableActualHours')),            fmtH(sumK('totalActualHours'))],
      ['Planned cost',      fmt(sumK('billableCostCents')),                   fmt(sumK('nonBillableCostCents')),               fmt(sumK('totalCostCents'))],
      ['Actual cost',       fmt(sumK('billableActualCostCents')),             fmt(sumK('nonBillableActualCostCents')),         fmt(sumK('totalActualCostCents'))],
      ['Planned revenue',   fmt(sumK('totalRevenueCents')),                   '—',                                             fmt(sumK('totalRevenueCents'))],
      ['Actual revenue',    fmt(sumK('totalActualRevenueCents')),             '—',                                             fmt(sumK('totalActualRevenueCents'))],
    ];
    const colX = [50, 220, 320, 430];
    rows.forEach((row, i) => {
      const y = doc.y;
      if (i === 0) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');
      row.forEach((cell, j) => doc.text(cell, colX[j], y, { width: 100, lineBreak: false }));
      doc.moveDown(0.5);
    });
    doc.moveDown(0.6);

    // Profit row
    doc.fontSize(12).font('Helvetica-Bold');
    const plannedProfit = sumK('plannedProfitCents');
    const actualProfit  = sumK('actualProfitCents');
    doc.text(`Planned profit: ${fmt(plannedProfit)}    ·    Actual profit: ${fmt(actualProfit)}`);
    doc.moveDown(0.5);

    // Plan list
    doc.fontSize(13).font('Helvetica-Bold').text('Plans included');
    doc.fontSize(9).font('Helvetica').fillColor('#444');
    plans.forEach(p => {
      doc.text(`• ${p.title}  ·  ${p.status}  ·  cost ${fmt(p.totalCostCents)}  ·  revenue ${fmt(p.totalRevenueCents)}`);
    });

    doc.moveDown(2).fontSize(8).fillColor('#999').text('Mayvel Task — generated automatically. Numbers reflect approved plans rolled up.', { align: 'center' });
    doc.end();
  } catch (e) {
    console.error('[pdf-export] error', e);
    fail(res, 'PDF generation failed: ' + e.message, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// EXCEL EXPORT
// ────────────────────────────────────────────────────────────────────────────

// GET /api/time/plans/:id/export  → .xlsx mirroring the screenshot format
router.get('/plans/:id/export', async (req, res) => {
  const plan = await ProjectHoursPlan.findById(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  const lines    = await ProjectHoursPlanLine.find({ planId: plan._id }).lean();
  const project  = await Project.findById(plan.projectId).select('name').lean();
  const users    = await User.find({ _id: { $in: lines.map(l => l.assigneeUserId).filter(Boolean) } }).select('name').lean();
  const buckets  = await RateBucket.find({ _id: { $in: lines.map(l => l.assigneeBucketId).filter(Boolean) } }).select('name').lean();
  const userMap   = Object.fromEntries(users.map(u => [String(u._id), u.name]));
  const bucketMap = Object.fromEntries(buckets.map(b => [String(b._id), b.name]));

  // Sheet 1: Plan lines (matches the screenshot column order)
  const rows = lines.map(l => ({
    'Project Name':          project?.name || '',
    'Task Type':             l.taskType,
    'Billable':              l.billable ? 'Yes' : 'No',
    'Assigned To':           userMap[String(l.assigneeUserId)] || bucketMap[String(l.assigneeBucketId)] || '',
    'Bucket':                bucketMap[String(l.assigneeBucketId)] || '',
    'Start Date':            l.startDate ? new Date(l.startDate).toISOString().slice(0,10) : '',
    'Target Date':           l.targetDate ? new Date(l.targetDate).toISOString().slice(0,10) : '',
    'Planned Hours':         l.plannedHours || 0,
    'Actual Hours':          l.actualHours  || 0,
    'Distribution Type':     l.distributionType,
    'Per Day Distribution':  l.perDayDistribution || 0,
    'Status':                l.status,
    'RAG':                   l.ragStatus === 'grey' ? '' : l.ragStatus,
    'Cost Rate (₹/hr)':      Math.round((l.frozenRateCents     || 0) / 100),
    'Bill Rate (₹/hr)':      Math.round((l.frozenBillRateCents || 0) / 100),
    'Total Cost (₹)':        Math.round((l.costCents     || 0) / 100),
    'Total Revenue (₹)':     Math.round((l.revenueCents  || 0) / 100),
    'Notes':                 l.notes || '',
  }));
  // Append a totals row
  rows.push({});
  rows.push({
    'Project Name':       'TOTAL',
    'Planned Hours':      plan.totalPlannedHours || 0,
    'Actual Hours':       plan.totalActualHours  || 0,
    'Total Cost (₹)':     Math.round((plan.totalCostCents    || 0) / 100),
    'Total Revenue (₹)':  Math.round((plan.totalRevenueCents || 0) / 100),
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // Pretty column widths
  ws['!cols'] = [
    { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 8 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plan');

  // Sheet 2: lookups (mirrors the screenshot's reference sheet)
  const taskTypes = await TaskType.find({ teamspaceId: plan.teamspaceId }).select('name').lean();
  const allBuckets = await RateBucket.find({ teamspaceId: plan.teamspaceId }).lean();
  const refRows = [];
  const max = Math.max(taskTypes.length, allBuckets.length);
  for (let i = 0; i < max; i++) {
    refRows.push({
      'Task Type':      taskTypes[i]?.name || '',
      'Distribution':   ['Continuous','Distributed','Open'][i] || '',
      'Status':         ['Yet-To-Start','In-Progress','On-hold','Completed','Cancelled'][i] || '',
      'Bucket':         allBuckets[i]?.name || '',
      'Rate (₹/hr)':    allBuckets[i] ? Math.round(allBuckets[i].ratePerHourCents / 100) : '',
    });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(refRows), 'Lookups');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const safeTitle = (plan.title || 'plan').replace(/[^a-zA-Z0-9._-]+/g, '-');
  res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.xlsx"`);
  res.send(buf);
});

// ────────────────────────────────────────────────────────────────────────────
// FRIDAY EOD REMINDER + BUDGET-OVERRUN TRIGGER
// ────────────────────────────────────────────────────────────────────────────

// Run every hour. On Friday 17:00–18:59 local, scan teamspaces and notify users
// whose current-week period is still 'open'.
async function fridayReminderTick() {
  try {
    const now = new Date();
    if (now.getDay() !== 5) return;                              // 5 = Friday
    if (now.getHours() < 17 || now.getHours() > 18) return;
    // Find all 'open' periods whose weekStart is the Monday of this week
    const monday = (() => {
      const d = new Date(now); d.setHours(0,0,0,0);
      const w = d.getDay();
      d.setDate(d.getDate() + (w === 0 ? -6 : 1 - w));
      return d;
    })();
    const periods = await TimesheetPeriod.find({ status: 'open', weekStart: monday });
    for (const p of periods) {
      const u = await User.findById(p.userId).select('name');
      if (!u?.name) continue;
      // De-dupe — don't spam
      const already = await Notification.findOne({
        type: 'time_overdue', userId: u.name,
        createdAt: { $gte: new Date(now.getTime() - 6 * 60 * 60 * 1000) },
      });
      if (already) continue;
      await Notification.createIfAllowed({
        type: 'time_overdue',
        title: 'Friday EOD reminder — submit your week',
        message: 'Your timesheet for this week is still open. Submit it before end of day so your project owner can approve.',
        userId: u.name,
        actorName: 'System',
      });
    }
  } catch (e) { console.error('fridayReminderTick failed', e.message); }
}
setInterval(fridayReminderTick, 60 * 60 * 1000);                 // hourly
setTimeout(fridayReminderTick, 30 * 1000);                       // also on boot (after 30s)

// Friday EOD auto-submit. Runs hourly. On Friday 21:00–23:59 (after the
// reminder window), find every still-'open' period for THIS week and
// auto-submit it: flip period → 'submitted' and every slice → 'submitted',
// notify project owners. Also covers Saturday/Sunday catch-up — if the prior
// week's period is still 'open' on Sat/Sun, submit it.
async function fridayAutoSubmitTick() {
  try {
    const now = new Date();
    const dow = now.getDay();   // 0 Sun, 5 Fri, 6 Sat
    const isLateFriday = dow === 5 && now.getHours() >= 21;
    const isWeekendCatchup = (dow === 6 || dow === 0);
    if (!isLateFriday && !isWeekendCatchup) return;

    // Monday of THIS week's Friday
    const friday = new Date(now); friday.setHours(0,0,0,0);
    if (dow === 6)        friday.setDate(friday.getDate() - 1);
    else if (dow === 0)   friday.setDate(friday.getDate() - 2);
    const monday = new Date(friday); monday.setDate(friday.getDate() - 4);

    const periods = await TimesheetPeriod.find({ status: 'open', weekStart: monday });
    for (const period of periods) {
      const slices = await TimesheetSlice.find({ periodId: period._id });
      if (!slices.length) {
        // Nothing logged — skip auto-submit (don't push empty timesheets).
        continue;
      }
      for (const s of slices) {
        if (!s.projectOwnerId) {
          const proj = await Project.findById(s.projectId);
          if (proj?.ownerId) s.projectOwnerId = proj.ownerId;
          else continue;                     // can't submit a slice without an owner; admin needs to assign one
        }
        s.status = 'submitted';
        s.submittedAt = new Date();
        s.rejectionReason = '';
        await s.save();
        // Notify project owner
        const owner = await User.findById(s.projectOwnerId).select('name');
        const proj  = await Project.findById(s.projectId).select('name icon');
        const u     = await User.findById(s.userId).select('name');
        if (owner?.name) {
          await Notification.createIfAllowed({
            type: 'time_submitted',
            title: 'Auto-submitted week (Friday EOD)',
            message: `${u?.name || 'A user'}'s week on ${proj?.name || 'project'} was auto-submitted at Friday EOD. Please review and approve.`,
            taskId: String(s._id),
            userId: owner.name,
            actorName: 'System',
          });
        }
      }
      period.status = 'submitted';
      period.submittedAt = new Date();
      await period.save();
    }
    if (periods.length) console.log(`[fridayAutoSubmit] Auto-submitted ${periods.length} period(s) for week of ${monday.toISOString().slice(0, 10)}`);
  } catch (e) { console.error('fridayAutoSubmitTick failed', e.message); }
}
setInterval(fridayAutoSubmitTick, 60 * 60 * 1000);
setTimeout(fridayAutoSubmitTick, 45 * 1000);                     // also on boot

// Recompute actuals for a set of plan lines, then plan totals, then fire
// budget_overrun notifications (de-duped). Call from any entry-write path.
async function refreshActualsForLines(planLineIds = []) {
  const planIds = new Set();
  for (const lid of planLineIds) {
    const line = await ProjectHoursPlanLine.findById(lid);
    if (!line) continue;
    const allocs  = await Allocation.find({ planLineId: lid }).select('_id');
    const entries = await TimeEntry.find({ allocationId: { $in: allocs.map(a => a._id) } });
    line.actualHours        = +(entries.reduce((s,e) => s + (e.minutes || 0), 0) / 60).toFixed(2);
    line.actualCostCents    = entries.reduce((s,e) => s + (e.costCents || 0), 0);
    line.actualRevenueCents = line.billable ? entries.reduce((s,e) => s + (e.revenueCents || 0), 0) : 0;
    await line.save();
    planIds.add(String(line.planId));
  }
  for (const pid of planIds) {
    await recomputePlanTotals(pid);
    const plan = await ProjectHoursPlan.findById(pid);
    if (!plan || plan.status !== 'approved') continue;
    if (!(plan.totalCostCents > 0 && plan.totalActualCostCents > plan.totalCostCents)) continue;

    // De-dupe: only one budget_overrun notification per plan per 24h
    const exists = await Notification.findOne({
      type: 'budget_overrun', taskId: String(plan._id),
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (exists) continue;

    const project = await Project.findById(plan.projectId);
    const recipients = new Set();
    if (project?.ownerId) {
      const owner = await User.findById(project.ownerId).select('name');
      if (owner?.name) recipients.add(owner.name);
    }
    const admins = await TeamspaceMembership.find({ teamspaceId: plan.teamspaceId, role: 'admin', status: 'active' }).populate('userId', 'name');
    for (const m of admins) if (m.userId?.name) recipients.add(m.userId.name);
    for (const userName of recipients) {
      await Notification.createIfAllowed({
        type: 'budget_overrun',
        title: 'Budget overrun ⚠️',
        message: `Project "${project?.name || 'Unknown'}" actual cost ₹${(plan.totalActualCostCents/100).toLocaleString('en-IN')} exceeded plan ₹${(plan.totalCostCents/100).toLocaleString('en-IN')} for ${plan.periodMonth}.`,
        taskId: String(plan._id),
        userId: userName,
        actorName: 'System',
      });
    }
    // Also fire workflow trigger so user-defined automations run
    workflowEngine.fire('budget_overrun', plan.toObject ? plan.toObject() : plan, {
      projectName: project?.name,
      overrunCents: (plan.totalActualCostCents || 0) - (plan.totalCostCents || 0),
    });
  }
}

// POST /api/time/slices/:id/reject  body: { reason }
router.post('/slices/:id/reject', async (req, res) => {
  const reason = (req.body?.reason || '').trim();
  if (reason.length < 10) return fail(res, 'Rejection reason must be at least 10 characters', 400);

  const s = await TimesheetSlice.findById(req.params.id);
  if (!s) return fail(res, 'Slice not found', 404);
  if (s.status !== 'submitted') return fail(res, `Cannot reject a ${s.status} slice`, 400);
  if (String(s.projectOwnerId) !== String(req.user.userId) && !isAdmin(req)) return fail(res, 'Only project owner / admin can reject', 403);

  s.status          = 'rejected';
  s.approverId      = req.user.userId;
  s.rejectedAt      = new Date();
  s.rejectionReason = reason;
  await s.save();

  // Flip entries back to draft so user can edit them
  await TimeEntry.updateMany({ sliceId: s._id }, { $set: { status: 'draft' } });

  await recomputeSliceAndPeriod({ userId: s.userId, periodId: s.periodId });
  await audit({ teamspaceId: s.teamspaceId, entityType: 'slice', entityId: s._id, action: 'reject', reason, req });

  const u = await User.findById(s.userId);
  if (u?.name) {
    const proj = await Project.findById(s.projectId);
    await notify({
      type: 'time_rejected',
      title: 'Weekly time rejected ❌',
      message: `Your ${(s.totalMinutes/60).toFixed(1)}h on ${proj?.name || 'a project'} for week of ${s.weekStart.toISOString().slice(0,10)} was rejected by ${req.user?.name || 'Owner'}. Reason: ${reason}`,
      userId: u.name,
      actorName: req.user?.name,
      teamspaceId: s.teamspaceId,
    });
  }
  ok(res, s);
});

module.exports = router;
