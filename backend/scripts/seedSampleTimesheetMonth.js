/**
 * Seed a realistic month of timesheet data so the dashboard has something to render.
 * Creates 3 plans (different projects), submits + approves + allocates each, logs
 * partial time entries across the month, submits & approves a couple of weekly slices.
 *
 *   Usage: node scripts/seedSampleTimesheetMonth.js [TEAMSPACE_ID] [YYYY-MM]
 *   Default: Product Design teamspace, current calendar month
 *   Idempotent — won't duplicate plans for (project, month).
 */
const mongoose = require('mongoose');
const Project              = require('../models/Project');
const RateBucket           = require('../models/RateBucket');
const User                 = require('../models/User');
const ProjectHoursPlan     = require('../models/ProjectHoursPlan');
const ProjectHoursPlanLine = require('../models/ProjectHoursPlanLine');
const Allocation           = require('../models/Allocation');
const TimeEntry            = require('../models/TimeEntry');
const TimesheetPeriod      = require('../models/TimesheetPeriod');
const TimesheetSlice       = require('../models/TimesheetSlice');
const { Task }             = require('../models/Task');

const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.argv[2] || process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';
const PERIOD_MONTH = process.argv[3] || new Date().toISOString().slice(0, 7);

function monthBounds(periodMonth) {
  const [y, m] = periodMonth.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}
function workingDays(start, end) {
  const days = []; const d = new Date(start);
  while (d <= end) { const w = d.getUTCDay(); if (w >= 1 && w <= 5) days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return days;
}
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z'); const w = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w)); return d;
}
function fridayOf(monday) { const f = new Date(monday); f.setUTCDate(monday.getUTCDate() + 4); return f; }

(async () => {
  await mongoose.connect(MONGO_URI);
  const tsId = new mongoose.Types.ObjectId(TEAMSPACE_ID);

  const admin = await User.findOne({ email: 'thaghanazeer.s@mayvel.ai' });
  if (!admin) throw new Error('Admin user not found');

  // Pick three real projects to seed against
  const candidateProjects = await Project.find({ teamspaceId: tsId, name: { $in: ['Bhagya Cookware', 'Seyo Product and Design', 'Mayvel Brand'] } }).limit(3);
  const fallback = await Project.find({ teamspaceId: tsId }).limit(3);
  const projects = candidateProjects.length >= 3 ? candidateProjects : fallback;
  if (projects.length === 0) throw new Error('No projects to seed against');

  // Bucket lookup
  const buckets = Object.fromEntries((await RateBucket.find({ teamspaceId: tsId })).map(b => [b.name, b]));
  const users = await User.find({ rateBucketId: { $exists: true } }).populate('rateBucketId');
  if (users.length === 0) throw new Error('Run assignUserBuckets.js first');

  // Fixture lines per project: a mix of billable + non-billable across different buckets
  const fixtures = [
    {
      projectIndex: 0, defaultBillRateCents: 250000,
      lines: [
        { taskType: 'Support',        billable: true,  bucketName: 'Associate', plannedHours: 80, perDay: 4, userPickerName: 'Pooja' },
        { taskType: 'Maintenance',    billable: true,  bucketName: 'Lead',      plannedHours: 40, perDay: 2, userPickerName: 'Thagha' },
        { taskType: 'Project Management', billable: false, bucketName: 'Manager', plannedHours: 20, perDay: 1, userPickerName: 'Sahadevan' },
      ],
    },
    {
      projectIndex: 1, defaultBillRateCents: 200000,
      lines: [
        { taskType: 'Design',         billable: true,  bucketName: 'Lead',     plannedHours: 60, perDay: 3, userPickerName: 'Nazeer' },
        { taskType: 'Development',    billable: true,  bucketName: 'Associate', plannedHours: 96, perDay: 5, userPickerName: 'Suha' },
        { taskType: 'Training',       billable: false, bucketName: 'Junior',   plannedHours: 16, perDay: 1, userPickerName: 'Karthick' },
      ],
    },
    {
      projectIndex: 2, defaultBillRateCents: 300000,
      lines: [
        { taskType: 'Digital Marketing', billable: true, bucketName: 'Manager',  plannedHours: 30, perDay: 2, userPickerName: 'Saravanakumar' },
        { taskType: 'Sales',             billable: true, bucketName: 'Lead',     plannedHours: 24, perDay: 1, userPickerName: 'Vijay' },
      ],
    },
  ].slice(0, projects.length);

  console.log(`📋 Seeding ${PERIOD_MONTH} for ${fixtures.length} project(s)…`);
  const { start: periodStart, end: periodEnd } = monthBounds(PERIOD_MONTH);

  for (const f of fixtures) {
    const project = projects[f.projectIndex];
    if (!project) continue;

    // Ensure project has owner + bill rate
    if (!project.ownerId) project.ownerId = admin._id;
    project.defaultBillRateCents = f.defaultBillRateCents;
    await project.save();

    // Idempotent: skip if a plan already exists for (project, month)
    let plan = await ProjectHoursPlan.findOne({ teamspaceId: tsId, projectId: project._id, periodMonth: PERIOD_MONTH });
    if (plan) { console.log(`  ↻ Plan already exists for ${project.name} ${PERIOD_MONTH} — leaving alone`); continue; }

    const monthName = new Date(Date.UTC(+PERIOD_MONTH.slice(0,4), +PERIOD_MONTH.slice(5,7)-1, 1)).toLocaleString('en-US', { month: 'long' });
    plan = await ProjectHoursPlan.create({
      teamspaceId: tsId, projectId: project._id,
      title: `${project.name} ${monthName} ${PERIOD_MONTH.slice(0,4)} Approval`,
      periodMonth: PERIOD_MONTH, periodStart, periodEnd,
      status: 'draft', createdBy: admin.email,
    });

    // Build lines
    let lineCount = 0;
    for (const ln of f.lines) {
      const bucket = buckets[ln.bucketName];
      if (!bucket) continue;
      const user = users.find(u => (u.name || '').toLowerCase().includes(ln.userPickerName.toLowerCase()));
      if (!user) continue;

      const frozenRateCents     = bucket.ratePerHourCents;
      const frozenBillRateCents = ln.billable ? f.defaultBillRateCents : 0;
      const plannedHours        = ln.plannedHours;

      await ProjectHoursPlanLine.create({
        planId: plan._id, teamspaceId: tsId,
        taskType: ln.taskType, billable: ln.billable,
        assigneeUserId: user._id, assigneeBucketId: bucket._id,
        frozenRateCents, frozenBillRateCents,
        startDate: periodStart, targetDate: periodEnd,
        plannedHours,
        distributionType: 'Continuous', perDayDistribution: ln.perDay,
        status: 'In-Progress',
        costCents: plannedHours * frozenRateCents,
        revenueCents: ln.billable ? plannedHours * frozenBillRateCents : 0,
      });
      lineCount++;
    }

    // Submit + approve as admin
    plan.status = 'pending';      plan.submittedBy = admin.email; plan.submittedAt = new Date();
    plan.status = 'approved';     plan.approvedBy  = admin.email; plan.approvedAt  = new Date();
    await plan.save();

    // Recompute totals from lines
    const lines = await ProjectHoursPlanLine.find({ planId: plan._id });
    const sum = (pred, mapper) => lines.filter(pred).reduce((a, l) => a + (mapper(l) || 0), 0);
    plan.totalPlannedHours       = sum(() => true,         l => l.plannedHours);
    plan.billablePlannedHours    = sum(l => l.billable,     l => l.plannedHours);
    plan.nonBillablePlannedHours = sum(l => !l.billable,    l => l.plannedHours);
    plan.totalCostCents          = sum(() => true,         l => l.costCents);
    plan.billableCostCents       = sum(l => l.billable,     l => l.costCents);
    plan.nonBillableCostCents    = sum(l => !l.billable,    l => l.costCents);
    plan.totalRevenueCents       = sum(l => l.billable,     l => l.revenueCents);
    plan.plannedProfitCents      = plan.totalRevenueCents - plan.totalCostCents;
    plan.plannedMarginPct        = plan.totalRevenueCents > 0 ? plan.plannedProfitCents / plan.totalRevenueCents : 0;
    await plan.save();
    console.log(`  ✅ ${project.name}: ${lineCount} lines, planned ₹${(plan.totalCostCents/100).toLocaleString('en-IN')}, revenue ₹${(plan.totalRevenueCents/100).toLocaleString('en-IN')}`);

    // Allocate: create one Task per line + per-week Allocations
    for (const line of lines) {
      const task = await Task.create({
        id: `seed_${plan._id.toString().slice(-6)}_${line._id.toString().slice(-6)}`,
        title: `${line.taskType} — ${project.name}`,
        description: '', status: 'In Progress', priority: '',
        assignee: (await User.findById(line.assigneeUserId))?.name || '',
        dueDate: line.targetDate, startDate: line.startDate,
        estimatedHours: line.plannedHours, actualHours: 0,
        taskType: [line.taskType], projectId: project._id.toString(),
        teamspaceId: tsId, attachments: [],
      });
      line.taskId = task._id; await line.save();

      // Build week buckets within periodStart..periodEnd
      const days = workingDays(periodStart, periodEnd);
      const groups = new Map();
      for (const d of days) {
        const key = mondayOf(d).toISOString().slice(0, 10);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
      }
      const weeks = [...groups.entries()].sort(([a],[b]) => a.localeCompare(b));
      const totalDays = days.length;
      let drift = line.plannedHours;
      const allocs = [];
      for (let i = 0; i < weeks.length; i++) {
        const [mondayKey, weekDays] = weeks[i];
        const monday = new Date(mondayKey + 'T00:00:00Z');
        const friday = fridayOf(monday);
        let allocated = Math.round((line.plannedHours * weekDays.length / totalDays) * 4) / 4;
        if (i === 0) allocated += +(drift - allocated * weeks.length).toFixed(2);
        // Recompute drift for first-week sweep
        const a = await Allocation.create({
          teamspaceId: tsId, planId: plan._id, planLineId: line._id,
          userId: line.assigneeUserId, projectId: project._id, taskId: task._id,
          bucket: 'week', weekStart: monday, weekEnd: friday,
          allocatedHours: allocated, consumedHours: 0, remainingHours: allocated,
          billable: line.billable,
          frozenRateCents: line.frozenRateCents, frozenBillRateCents: line.frozenBillRateCents,
          status: 'active',
        });
        allocs.push({ alloc: a, weekDays });
      }

      // Log ~70-80% of allocated time (so we get realistic actuals for the dashboard)
      let totalLogged = 0;
      for (const { alloc, weekDays } of allocs) {
        const targetHrs = alloc.allocatedHours * (0.6 + Math.random() * 0.3); // 60-90%
        let remaining = targetHrs;
        const perDay = Math.max(0.25, +(targetHrs / weekDays.length).toFixed(2));
        for (const day of weekDays) {
          if (remaining <= 0) break;
          const hrs = Math.min(perDay + (Math.random() * 0.5 - 0.25), remaining);
          if (hrs <= 0) continue;
          const minutes = Math.max(15, Math.round(hrs * 60));
          // Period + slice
          const periodMon = mondayOf(day);
          let period = await TimesheetPeriod.findOne({ userId: line.assigneeUserId, weekStart: periodMon });
          if (!period) period = await TimesheetPeriod.create({ teamspaceId: tsId, userId: line.assigneeUserId, weekStart: periodMon, weekEnd: fridayOf(periodMon) });
          let slice = await TimesheetSlice.findOne({ userId: line.assigneeUserId, projectId: project._id, weekStart: periodMon });
          if (!slice) slice = await TimesheetSlice.create({ teamspaceId: tsId, userId: line.assigneeUserId, periodId: period._id, projectId: project._id, projectOwnerId: project.ownerId, weekStart: periodMon, weekEnd: fridayOf(periodMon) });

          const costCents    = Math.round((minutes / 60) * line.frozenRateCents);
          const revenueCents = line.billable ? Math.round((minutes / 60) * line.frozenBillRateCents) : 0;
          await TimeEntry.create({
            teamspaceId: tsId, userId: line.assigneeUserId,
            date: day, projectId: project._id, taskId: task._id, allocationId: alloc._id,
            minutes, billable: line.billable, costCents, revenueCents,
            periodId: period._id, sliceId: slice._id, status: 'approved',
          });
          alloc.consumedHours  = +(alloc.consumedHours + minutes / 60).toFixed(2);
          alloc.remainingHours = +(alloc.allocatedHours - alloc.consumedHours).toFixed(2);
          await alloc.save();
          totalLogged += minutes / 60;
          remaining   -= minutes / 60;
        }
      }
      // Roll up actuals onto the line
      line.actualHours        = +(totalLogged).toFixed(2);
      line.actualCostCents    = Math.round(totalLogged * line.frozenRateCents);
      line.actualRevenueCents = line.billable ? Math.round(totalLogged * line.frozenBillRateCents) : 0;
      await line.save();
    }

    // Recompute plan actuals
    const lines2 = await ProjectHoursPlanLine.find({ planId: plan._id });
    const s = (pred, mapper) => lines2.filter(pred).reduce((a, l) => a + (mapper(l) || 0), 0);
    plan.totalActualHours        = s(() => true,        l => l.actualHours);
    plan.billableActualHours     = s(l => l.billable,    l => l.actualHours);
    plan.nonBillableActualHours  = s(l => !l.billable,   l => l.actualHours);
    plan.totalActualCostCents    = s(() => true,        l => l.actualCostCents);
    plan.billableActualCostCents = s(l => l.billable,    l => l.actualCostCents);
    plan.nonBillableActualCostCents = s(l => !l.billable, l => l.actualCostCents);
    plan.totalActualRevenueCents = s(l => l.billable,    l => l.actualRevenueCents);
    plan.actualProfitCents       = plan.totalActualRevenueCents - plan.totalActualCostCents;
    plan.actualMarginPct         = plan.totalActualRevenueCents > 0 ? plan.actualProfitCents / plan.totalActualRevenueCents : 0;
    plan.variancePctCached       = plan.totalCostCents > 0 ? (plan.totalActualCostCents - plan.totalCostCents) / plan.totalCostCents : 0;
    plan.ragStatus               = plan.variancePctCached < 0.10 ? 'green' : plan.variancePctCached < 0.20 ? 'amber' : 'red';
    await plan.save();

    console.log(`     actuals ₹${(plan.totalActualCostCents/100).toLocaleString('en-IN')} (${plan.totalActualHours}h) · profit ₹${(plan.actualProfitCents/100).toLocaleString('en-IN')} · margin ${Math.round((plan.actualMarginPct||0)*100)}%`);
  }

  // Summary
  const allPlans = await ProjectHoursPlan.find({ teamspaceId: tsId, periodMonth: PERIOD_MONTH }).lean();
  const totalCost    = allPlans.reduce((s, p) => s + (p.totalCostCents       || 0), 0);
  const totalRevenue = allPlans.reduce((s, p) => s + (p.totalRevenueCents    || 0), 0);
  const totalActual  = allPlans.reduce((s, p) => s + (p.totalActualCostCents || 0), 0);
  console.log(`\n✅ Seed complete for ${PERIOD_MONTH} — ${allPlans.length} plan(s)`);
  console.log(`   Planned cost   ₹${(totalCost/100).toLocaleString('en-IN')}`);
  console.log(`   Planned revenue ₹${(totalRevenue/100).toLocaleString('en-IN')}`);
  console.log(`   Actual cost    ₹${(totalActual/100).toLocaleString('en-IN')}`);

  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
