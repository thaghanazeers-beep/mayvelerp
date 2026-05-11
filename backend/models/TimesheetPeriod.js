const mongoose = require('mongoose');

// One period per (user × week) — aggregates the user's per-project slices.
const timesheetPeriodSchema = new mongoose.Schema({
  teamspaceId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  userId:              { type: mongoose.Schema.Types.ObjectId, ref: 'User',      required: true, index: true },

  weekStart:           { type: Date, required: true },             // Monday
  weekEnd:             { type: Date, required: true },             // Friday

  // Rollup status: 'open' (still drafting) → 'submitted' (all slices submitted) →
  // 'partially_approved' (some slices approved) → 'approved' (all slices approved) | 'rejected' (any slice rejected)
  status:              { type: String, enum: ['open','submitted','partially_approved','approved','rejected'], default: 'open' },

  totalMinutes:        { type: Number, default: 0 },
  totalCostCents:      { type: Number, default: 0 },
  sliceCount:          { type: Number, default: 0 },
  approvedSliceCount:  { type: Number, default: 0 },

  submittedAt:         { type: Date },
}, { timestamps: true });

timesheetPeriodSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('TimesheetPeriod', timesheetPeriodSchema);
