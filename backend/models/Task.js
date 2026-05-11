const mongoose = require('mongoose');

const propertyDefinitionSchema = new mongoose.Schema({
  id: String,
  name: String,
  type: { type: String, enum: ['text', 'number', 'date', 'select', 'multiSelect', 'checkbox', 'url', 'email', 'phone'] },
  options: [String],
});

const customPropertySchema = new mongoose.Schema({
  definitionId: String,
  value: mongoose.Schema.Types.Mixed,
});

const attachmentSchema = new mongoose.Schema({
  id: String,
  name: String,
  path: String,
  sizeBytes: Number,
  addedAt: Date,
});

const taskSchema = new mongoose.Schema({
  id:             { type: String, required: true, unique: true },
  notionId:       { type: String },
  title:          { type: String, required: true },
  description:    { type: String, default: '' },
  status:         { type: String, default: 'Not Yet Started' },
  priority:       { type: String, default: '' },
  assignee:       { type: String, default: '' },
  dueDate:        { type: Date },
  startDate:      { type: Date },
  createdDate:    { type: Date, default: Date.now },
  customProperties: [customPropertySchema],
  attachments:    [attachmentSchema],
  parentId:       { type: String },
  projectId:      { type: String },
  pageId:         { type: String }, // Links to the parent Page database
  sprintId:       { type: String },
  notionProjectId:{ type: String },
  notionSprintId: { type: String },
  estimatedHours: { type: Number, default: 0 },
  actualHours:    { type: Number, default: 0 },
  // Whether the task draws from billable budget (revenue-bearing) or non-billable
  // (overhead). Drives time-entry billable + a small score penalty for the assignee.
  billable:       { type: Boolean, default: true },
  taskType:       { type: [String], default: [] },
  updatedBy:      { type: String },
  teamspaceId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  // child tasks are fetched by finding tasks with `parentId` === this task's id
});

taskSchema.query.byTeamspace = function (teamspaceId) {
  return this.where({ teamspaceId });
};

module.exports = {
  Task: mongoose.model('Task', taskSchema),
  PropertyDefinition: mongoose.model('PropertyDefinition', propertyDefinitionSchema)
};
