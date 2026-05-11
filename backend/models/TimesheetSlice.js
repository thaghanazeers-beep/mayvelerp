const mongoose = require('mongoose');

// One slice per (user × project × week). The unit of weekly approval — routed to project owner.
const timesheetSliceSchema = new mongoose.Schema({
  teamspaceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace',       required: true, index: true },
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User',            required: true, index: true },
  periodId:        { type: mongoose.Schema.Types.ObjectId, ref: 'TimesheetPeriod', required: true, index: true },
  projectId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Project',         required: true, index: true },
  projectOwnerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',            required: true, index: true },

  weekStart:       { type: Date, required: true },                 // Monday
  weekEnd:         { type: Date, required: true },                 // Friday

  totalMinutes:    { type: Number, default: 0 },
  totalCostCents:  { type: Number, default: 0 },

  status:          { type: String, enum: ['open','submitted','approved','rejected'], default: 'open', index: true },
  submittedAt:     { type: Date },
  approvedAt:      { type: Date },
  rejectedAt:      { type: Date },
  rejectionReason: { type: String },
  approverId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

timesheetSliceSchema.index({ userId: 1, projectId: 1, weekStart: 1 }, { unique: true });
timesheetSliceSchema.index({ projectOwnerId: 1, status: 1 });

module.exports = mongoose.model('TimesheetSlice', timesheetSliceSchema);
