const mongoose = require('mongoose');

// Per-user, per-week budget that authorizes time entries.
// One row per (user × plan-line × ISO-week within the plan's month).
const allocationSchema = new mongoose.Schema({
  teamspaceId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace',         required: true, index: true },
  planId:              { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectHoursPlan',  required: true, index: true },
  planLineId:          { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectHoursPlanLine', required: true, index: true },
  userId:              { type: mongoose.Schema.Types.ObjectId, ref: 'User',              required: true, index: true },
  projectId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Project',           required: true, index: true },
  taskId:              { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },

  bucket:              { type: String, default: 'week' },          // fixed for v1
  weekStart:           { type: Date, required: true },             // Monday
  weekEnd:             { type: Date, required: true },             // Friday (Mon–Fri only)

  allocatedHours:      { type: Number, required: true, min: 0 },
  consumedHours:       { type: Number, default: 0 },
  remainingHours:      { type: Number, default: 0 },               // = allocatedHours - consumedHours; non-negative (hard cap)

  billable:            { type: Boolean, default: true },
  frozenRateCents:     { type: Number, default: 0 },
  frozenBillRateCents: { type: Number, default: 0 },

  status:              { type: String, enum: ['active','closed'], default: 'active' },
}, { timestamps: true });

allocationSchema.index({ userId: 1, weekStart: 1 });
allocationSchema.index({ projectId: 1, weekStart: 1 });

module.exports = mongoose.model('Allocation', allocationSchema);
