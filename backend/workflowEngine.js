/**
 * Workflow Execution Engine
 * Evaluates triggers, checks conditions, and executes actions on tasks.
 */

const { Workflow, WorkflowLog } = require('./models/Workflow');
const { Task } = require('./models/Task');

class WorkflowEngine {
  constructor() {
    this.actionHandlers = {
      change_status: this._actionChangeStatus.bind(this),
      assign_to: this._actionAssignTo.bind(this),
      move_to_project: this._actionMoveToProject.bind(this),
      create_subtask: this._actionCreateSubtask.bind(this),
      set_due_date: this._actionSetDueDate.bind(this),
      add_label: this._actionAddLabel.bind(this),
      send_notification: this._actionSendNotification.bind(this),
      duplicate_task: this._actionDuplicateTask.bind(this),
    };
  }

  // Trigger types that operate on a Plan (not a Task). Engine routes these through
  // the plan-aware path: only generic actions (send_notification) are allowed,
  // and field resolution uses plan fields.
  static PLAN_TRIGGERS = new Set([
    'plan_submitted', 'plan_approved', 'plan_rejected',
    'budget_overrun', 'margin_below_threshold',
  ]);

  async fire(triggerType, entity, context = {}) {
    const isPlan = WorkflowEngine.PLAN_TRIGGERS.has(triggerType);
    try {
      // Workflows are teamspace-scoped: only run workflows whose teamspaceId
      // matches the entity's teamspaceId. Pre-fix, a Product Design workflow
      // would fire on a Marketing task because the find ignored teamspace.
      const baseFilter = { enabled: true, 'trigger.type': triggerType };
      if (entity?.teamspaceId) baseFilter.teamspaceId = entity.teamspaceId;
      const workflows = await Workflow.find(baseFilter);
      for (const workflow of workflows) {
        try {
          if (!this._matchTriggerConfig(workflow.trigger, entity, context, isPlan)) continue;
          if (!this._evaluateConditions(workflow.conditions, entity, isPlan)) continue;
          const actionsExecuted = await this._executeActions(workflow.actions, entity, context, isPlan);
          await WorkflowLog.create({
            workflowId: workflow._id.toString(),
            taskId: isPlan ? `plan:${entity._id}` : entity.id,
            taskTitle: isPlan ? (entity.title || 'Plan') : entity.title,
            trigger: triggerType, actionsExecuted, status: 'success',
          });
          await Workflow.findByIdAndUpdate(workflow._id, { $inc: { executionCount: 1 }, lastExecuted: new Date() });
          console.log(`[Workflow] ✓ "${workflow.name}" executed on "${isPlan ? entity.title : entity.title}"`);
        } catch (err) {
          console.error(`[Workflow] ✗ "${workflow.name}" failed:`, err.message);
          await WorkflowLog.create({
            workflowId: workflow._id.toString(),
            taskId: isPlan ? `plan:${entity._id}` : entity.id,
            taskTitle: isPlan ? (entity.title || 'Plan') : entity.title,
            trigger: triggerType, actionsExecuted: [], status: 'failed', error: err.message,
          });
        }
      }
    } catch (err) { console.error('[WorkflowEngine] Fatal error:', err); }
  }

  _matchTriggerConfig(trigger, entity, context, isPlan = false) {
    const cfg = trigger.config || {};
    switch (trigger.type) {
      case 'status_changed':
        if (cfg.fromStatus && cfg.fromStatus !== context.fromStatus) return false;
        if (cfg.toStatus && cfg.toStatus !== context.toStatus) return false;
        return true;
      case 'task_moved_to_project':
        if (cfg.projectId && cfg.projectId !== entity.projectId) return false;
        return true;
      case 'assignee_changed':
        return true;
      case 'due_date_approaching':
        if (!entity.dueDate) return false;
        const daysLeft = Math.ceil((new Date(entity.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
        return daysLeft <= (cfg.daysBefore || 1) && daysLeft >= 0;
      case 'task_created':
      case 'task_updated':
      case 'plan_submitted':
      case 'plan_approved':
      case 'plan_rejected':
      case 'budget_overrun':
      case 'margin_below_threshold':
        return true;
      default:
        return true;
    }
  }

  _evaluateConditions(conditions, entity, isPlan = false) {
    if (!conditions || conditions.length === 0) return true;
    const resolver = isPlan ? this._getPlanFieldValue : this._getFieldValue;
    return conditions.every(cond => {
      const fieldValue = resolver.call(this, entity, cond.field);
      switch (cond.operator) {
        case 'equals': return String(fieldValue) === String(cond.value);
        case 'not_equals': return String(fieldValue) !== String(cond.value);
        case 'contains': return String(fieldValue || '').toLowerCase().includes(String(cond.value || '').toLowerCase());
        case 'not_contains': return !String(fieldValue || '').toLowerCase().includes(String(cond.value || '').toLowerCase());
        case 'is_empty': return !fieldValue || fieldValue === '';
        case 'is_not_empty': return fieldValue && fieldValue !== '';
        case 'before': return fieldValue && new Date(fieldValue) < new Date(cond.value);
        case 'after': return fieldValue && new Date(fieldValue) > new Date(cond.value);
        case 'gt': return Number(fieldValue) > Number(cond.value);
        case 'lt': return Number(fieldValue) < Number(cond.value);
        default: return true;
      }
    });
  }

  _getFieldValue(task, field) {
    switch (field) {
      case 'status': return task.status;
      case 'assignee': return task.assignee;
      case 'project': return task.projectId;
      case 'title': return task.title;
      case 'dueDate': return task.dueDate;
      case 'description': return task.description;
      case 'estimatedHours': return task.estimatedHours;
      case 'actualHours': return task.actualHours;
      case 'billable': return task.billable;
      default: return task[field];
    }
  }

  _getPlanFieldValue(plan, field) {
    switch (field) {
      case 'status':              return plan.status;
      case 'title':               return plan.title;
      case 'periodMonth':         return plan.periodMonth;
      case 'totalCostCents':      return plan.totalCostCents;
      case 'totalRevenueCents':   return plan.totalRevenueCents;
      case 'plannedProfitCents':  return plan.plannedProfitCents;
      case 'plannedMarginPct':    return plan.plannedMarginPct;
      case 'totalActualCostCents':return plan.totalActualCostCents;
      case 'submittedBy':         return plan.submittedBy;
      case 'project':             return plan.projectId;
      default:                    return plan[field];
    }
  }

  async _executeActions(actions, entity, context = {}, isPlan = false) {
    const sorted = [...actions].sort((a, b) => (a.order || 0) - (b.order || 0));
    const executed = [];
    for (const action of sorted) {
      // For plan triggers, only generic actions make sense. Task-mutating actions
      // are silently skipped — the workflow author shouldn't have picked them, but
      // we don't want a misconfigured rule to crash the whole engine.
      if (isPlan && action.type !== 'send_notification') continue;
      const handler = this.actionHandlers[action.type];
      if (handler) {
        await handler(entity, action.config || {}, context, isPlan);
        executed.push(action.type);
      }
    }
    return executed;
  }

  async _actionChangeStatus(task, config) {
    if (config.status) await Task.findOneAndUpdate({ id: task.id }, { status: config.status });
  }

  async _actionAssignTo(task, config) {
    if (config.assignee) await Task.findOneAndUpdate({ id: task.id }, { assignee: config.assignee });
  }

  async _actionMoveToProject(task, config) {
    if (config.projectId) await Task.findOneAndUpdate({ id: task.id }, { projectId: config.projectId });
  }

  async _actionCreateSubtask(task, config) {
    const subtask = new Task({
      id: `task_auto_${Date.now()}`, title: config.title || 'Auto-created subtask',
      description: config.description || '', status: config.status || 'Not Yet Started',
      assignee: config.assignee || task.assignee || '', parentId: task.id,
      projectId: task.projectId, createdDate: new Date(), customProperties: [], attachments: [],
    });
    await subtask.save();
  }

  async _actionSetDueDate(task, config) {
    let dueDate;
    if (config.mode === 'relative') { dueDate = new Date(); dueDate.setDate(dueDate.getDate() + (config.daysFromNow || 7)); }
    else if (config.date) { dueDate = new Date(config.date); }
    if (dueDate) await Task.findOneAndUpdate({ id: task.id }, { dueDate });
  }

  async _actionAddLabel(task, config) {
    if (config.label) await Task.findOneAndUpdate({ id: task.id }, { $addToSet: { customProperties: { definitionId: 'label', value: config.label } } });
  }

  async _actionSendNotification(entity, config, context = {}, isPlan = false) {
    // Create real targeted notifications in the database. Recipient set depends
    // on the entity kind: tasks support assignee/admins/all/specific; plans add
    // project_owner (the project's ownerId) and plan_submitter (whoever sent it for approval).
    const Notification = require('./models/Notification');
    const User = require('./models/User');
    const Project = require('./models/Project');

    let targetUsers = [];
    if (config.sendTo === 'admins') {
      // Scope admins to the entity's teamspace — used to be a global
      // `User.find({ role: 'Admin' })` which fanned notifications out to
      // every Admin in the org regardless of which teamspace owned the entity.
      const TeamspaceMembership = require('./models/TeamspaceMembership');
      if (entity?.teamspaceId) {
        const mems = await TeamspaceMembership.find({
          teamspaceId: entity.teamspaceId, role: 'admin', status: 'active',
        }).populate('userId', 'name');
        targetUsers = mems.map(m => m.userId?.name).filter(Boolean);
      } else {
        const admins = await User.find({ role: 'Admin' }, 'name');
        targetUsers = admins.map(a => a.name);
      }
    } else if (config.sendTo === 'specific' && config.targetUser) {
      targetUsers = [config.targetUser];
    } else if (config.sendTo === 'all') {
      // 'all' was previously every user org-wide. Scope to the entity's
      // teamspace members so cross-tenant fan-out doesn't happen.
      const TeamspaceMembership = require('./models/TeamspaceMembership');
      if (entity?.teamspaceId) {
        const mems = await TeamspaceMembership.find({
          teamspaceId: entity.teamspaceId, status: 'active',
        }).populate('userId', 'name');
        targetUsers = mems.map(m => m.userId?.name).filter(Boolean);
      } else {
        const allUsers = await User.find({}, 'name');
        targetUsers = allUsers.map(u => u.name);
      }
    } else if (!isPlan) {
      // Task-only recipients
      if (config.sendTo === 'assignee' && entity.assignee) targetUsers = [entity.assignee];
    } else {
      // Plan-only recipients
      if (config.sendTo === 'project_owner') {
        const proj = await Project.findById(entity.projectId).select('ownerId');
        if (proj?.ownerId) {
          const owner = await User.findById(proj.ownerId).select('name');
          if (owner?.name) targetUsers = [owner.name];
        }
      } else if (config.sendTo === 'plan_submitter') {
        if (entity.submittedBy) {
          const sub = await User.findOne({ email: entity.submittedBy }).select('name');
          if (sub?.name) targetUsers = [sub.name];
        }
      }
    }

    // Token replacement varies by entity kind
    const tokens = isPlan
      ? {
          plan: entity.title || 'Plan',
          status: entity.status || '',
          submitter: entity.submittedBy || '',
          month: entity.periodMonth || '',
          cost: '₹' + Math.round((entity.totalCostCents || 0) / 100).toLocaleString('en-IN'),
          revenue: '₹' + Math.round((entity.totalRevenueCents || 0) / 100).toLocaleString('en-IN'),
          reason: context.reason || '',
        }
      : {
          task: entity.title || '',
          assignee: entity.assignee || 'Unassigned',
          status: entity.status || '',
        };
    let msg = config.message || (isPlan ? 'Plan "{plan}" updated' : 'Task "{task}" updated');
    for (const [k, v] of Object.entries(tokens)) {
      msg = msg.replaceAll(`{${k}}`, String(v));
    }

    const notifType = isPlan ? `workflow_plan_${entity.status || 'updated'}` : 'workflow_notification';
    const taskId    = isPlan ? null : entity.id;
    const taskTitle = isPlan ? entity.title : entity.title;
    for (const userName of targetUsers) {
      await Notification.createIfAllowed({
        type: notifType,
        title: config.title || 'Workflow Alert',
        message: msg,
        taskId, taskTitle,
        userId: userName,
        actorName: 'Workflow',
      });
    }
    console.log(`[Workflow Notification] Sent to [${targetUsers.join(', ')}]: ${msg}`);
  }

  async _actionDuplicateTask(task, config) {
    const dupe = new Task({
      id: `task_dup_${Date.now()}`,
      title: config.titlePrefix ? `${config.titlePrefix} ${task.title}` : `Copy of ${task.title}`,
      description: task.description, status: config.status || 'Not Yet Started',
      assignee: config.assignee || task.assignee || '', projectId: config.projectId || task.projectId,
      dueDate: task.dueDate, createdDate: new Date(), customProperties: [], attachments: [],
    });
    await dupe.save();
  }

  async runScheduledChecks() {
    const workflows = await Workflow.find({ enabled: true, 'trigger.type': 'due_date_approaching' });
    if (workflows.length === 0) return;
    const tasks = await Task.find({ dueDate: { $ne: null }, status: { $nin: ['Completed', 'Rejected'] } });
    for (const task of tasks) { await this.fire('due_date_approaching', task); }
  }
}

module.exports = new WorkflowEngine();
