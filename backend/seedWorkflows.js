/**
 * Seed default workflows that cover BOTH the task lifecycle and the project-approval
 * (plan) lifecycle. Idempotent — re-running upserts by `name` per teamspace, so it
 * won't create duplicates or stomp on user-edited workflows that have a different name.
 *
 * Usage:  node seedWorkflows.js   [--ts <teamspaceId>]
 */
const mongoose = require('mongoose');
const { Workflow } = require('./models/Workflow');
const Teamspace = require('./models/Teamspace');

const argTs = (() => {
  const i = process.argv.indexOf('--ts');
  return i > -1 ? process.argv[i + 1] : null;
})();

// Each entry is a complete workflow — one trigger, optional conditions, one or
// more actions. Names are unique per teamspace (used as the upsert key).
const TEMPLATES = [
  // ─────────── TASK LIFECYCLE ───────────
  {
    name:        'Task — notify assignee on creation',
    description: 'When any task is created, ping the assignee so they see it immediately.',
    icon: '✨', color: '#6c5ce7',
    trigger:    { type: 'task_created', config: {} },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'assignee',
        title:  'New task assigned to you',
        message: 'You\'ve been assigned to "{task}" — current status: {status}.',
      },
      order: 0,
    }],
  },
  {
    name:        'Task — notify reviewer when status → In Review',
    description: 'Heads-up to admins whenever a task moves into review (so it doesn\'t sit idle).',
    icon: '🔍', color: '#74b9ff',
    trigger:    { type: 'status_changed', config: { toStatus: 'In Review' } },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'admins',
        title:  'Task ready for review',
        message: '"{task}" by {assignee} is awaiting review.',
      },
      order: 0,
    }],
  },
  {
    name:        'Task — celebrate completion',
    description: 'When a task moves to Completed, notify all admins so the team sees what\'s shipping.',
    icon: '🎉', color: '#00b894',
    trigger:    { type: 'status_changed', config: { toStatus: 'Completed' } },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'admins',
        title:  'Task completed ✅',
        message: '{assignee} completed "{task}".',
      },
      order: 0,
    }],
  },
  {
    name:        'Task — alert assignee on rejection',
    description: 'When a task is rejected, ping the assignee so they can rework and resubmit.',
    icon: '🚫', color: '#ff6b6b',
    trigger:    { type: 'status_changed', config: { toStatus: 'Rejected' } },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'assignee',
        title:  'Your task was rejected',
        message: '"{task}" was rejected — please review and resubmit. Open the task to see comments.',
      },
      order: 0,
    }],
  },
  {
    name:        'Task — notify on reassignment',
    description: 'When the assignee changes, ping the new owner so it doesn\'t get lost.',
    icon: '🔁', color: '#a29bfe',
    trigger:    { type: 'assignee_changed', config: {} },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'assignee',
        title:  'Task reassigned to you',
        message: 'You\'re now the assignee for "{task}" — current status: {status}.',
      },
      order: 0,
    }],
  },
  {
    name:        'Task — escalate when due date is near',
    description: 'When a task\'s due date is one day away, notify both the assignee and admins so it doesn\'t slip.',
    icon: '⏰', color: '#ff9800',
    trigger:    { type: 'due_date_approaching', config: { daysBefore: 1 } },
    conditions: [
      { field: 'status', operator: 'not_equals', value: 'Completed' },
    ],
    actions: [
      {
        type: 'send_notification',
        config: {
          sendTo: 'assignee',
          title:  'Task due tomorrow ⏰',
          message: '"{task}" is due tomorrow — current status: {status}.',
        },
        order: 0,
      },
      {
        type: 'send_notification',
        config: {
          sendTo: 'admins',
          title:  'At-risk task',
          message: '"{task}" assigned to {assignee} is due tomorrow and not yet complete.',
        },
        order: 1,
      },
    ],
  },

  // ─────────── PROJECT / PLAN APPROVAL LIFECYCLE ───────────
  {
    name:        'Plan — notify admins when submitted',
    description: 'When an owner submits a monthly plan, every admin gets a notification so the approval queue doesn\'t go unnoticed.',
    icon: '📤', color: '#fdcb6e',
    trigger:    { type: 'plan_submitted', config: {} },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'admins',
        title:  'Project plan awaiting approval',
        message: '"{plan}" submitted by {submitter} for {month} — planned cost {cost}, revenue {revenue}.',
      },
      order: 0,
    }],
  },
  {
    name:        'Plan — confirm approval to submitter',
    description: 'When admin approves a plan, the owner who submitted it gets a confirmation so they can start allocating hours.',
    icon: '✅', color: '#00b894',
    trigger:    { type: 'plan_approved', config: {} },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'plan_submitter',
        title:  'Your plan was approved',
        message: 'Plan "{plan}" for {month} is approved — you can now allocate hours to your team.',
      },
      order: 0,
    }],
  },
  {
    name:        'Plan — explain rejection to submitter',
    description: 'When a plan is rejected, send the rejection reason to the owner so they can fix and resubmit.',
    icon: '❌', color: '#ff6b6b',
    trigger:    { type: 'plan_rejected', config: {} },
    conditions: [],
    actions: [{
      type: 'send_notification',
      config: {
        sendTo: 'plan_submitter',
        title:  'Plan rejected — needs revision',
        message: 'Plan "{plan}" for {month} was rejected. Reason: {reason}',
      },
      order: 0,
    }],
  },
  {
    name:        'Budget — alert admins on overrun',
    description: 'When a project\'s actual cost exceeds the planned budget, notify admins so they can investigate.',
    icon: '💸', color: '#ff4d4d',
    trigger:    { type: 'budget_overrun', config: {} },
    conditions: [],
    actions: [
      {
        type: 'send_notification',
        config: {
          sendTo: 'admins',
          title:  'Budget overrun ⚠️',
          message: 'Plan "{plan}" for {month} has actual cost exceeding the planned {cost}. Investigate before approving more allocations.',
        },
        order: 0,
      },
      {
        type: 'send_notification',
        config: {
          sendTo: 'project_owner',
          title:  'Your project is over budget',
          message: 'Plan "{plan}" has crossed its planned cost ({cost}). Review the P&L page and either reduce remaining allocations or seek admin approval for a new plan.',
        },
        order: 1,
      },
    ],
  },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task');

  // Pick teamspace(s) to seed into. If --ts <id> given, only that one.
  // Otherwise seed into every teamspace (so a fresh deploy has working defaults
  // for every workspace).
  const teamspaces = argTs
    ? await Teamspace.find({ _id: argTs })
    : await Teamspace.find({});
  if (!teamspaces.length) {
    console.error('No teamspaces found. Create one first or pass --ts <id>.');
    process.exit(1);
  }

  let createdTotal = 0, updatedTotal = 0, skippedTotal = 0;
  for (const ts of teamspaces) {
    console.log(`\n→ Teamspace: ${ts.name} (${ts._id})`);
    for (const tpl of TEMPLATES) {
      const existing = await Workflow.findOne({ teamspaceId: ts._id, name: tpl.name });
      if (existing && existing.executionCount > 0) {
        // Don't overwrite a workflow that has already run — the user may have
        // tweaked it. Just report and move on.
        console.log(`   · skip "${tpl.name}" (has ${existing.executionCount} executions, leaving it alone)`);
        skippedTotal++;
        continue;
      }
      if (existing) {
        Object.assign(existing, { ...tpl, teamspaceId: ts._id, enabled: true });
        await existing.save();
        console.log(`   ↻ updated "${tpl.name}"`);
        updatedTotal++;
      } else {
        await Workflow.create({ ...tpl, teamspaceId: ts._id, enabled: true, createdBy: 'seed' });
        console.log(`   + created "${tpl.name}"`);
        createdTotal++;
      }
    }
  }
  console.log(`\nDone. Created ${createdTotal}, updated ${updatedTotal}, skipped (already in use) ${skippedTotal}.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
