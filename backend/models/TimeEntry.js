const mongoose = require('mongoose');

const timeEntrySchema = new mongoose.Schema({
  teamspaceId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace',  required: true, index: true },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',       required: true, index: true },
  date:         { type: String, required: true },                  // 'YYYY-MM-DD'; weekend dates rejected at write
  projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project',    required: true, index: true },
  taskId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Task',       required: true },   // no ad-hoc time without an allocated task
  allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Allocation', required: true, index: true },

  minutes:      { type: Number, required: true, min: 0 },
  notes:        { type: String, default: '' },

  billable:     { type: Boolean, default: true },                  // copied from allocation.billable
  costCents:    { type: Number, default: 0 },                      // (minutes/60) * allocation.frozenRateCents
  revenueCents: { type: Number, default: 0 },                      // billable ? (minutes/60) * allocation.frozenBillRateCents : 0

  periodId:     { type: mongoose.Schema.Types.ObjectId, ref: 'TimesheetPeriod', index: true },
  sliceId:      { type: mongoose.Schema.Types.ObjectId, ref: 'TimesheetSlice',  index: true },
  status:       { type: String, enum: ['draft','submitted','approved','rejected'], default: 'draft' },

  createdBy:    { type: String },
  updatedBy:    { type: String },
}, { timestamps: true });

timeEntrySchema.index({ userId: 1, date: 1 });
timeEntrySchema.index({ projectId: 1, date: 1 });

module.exports = mongoose.model('TimeEntry', timeEntrySchema);
