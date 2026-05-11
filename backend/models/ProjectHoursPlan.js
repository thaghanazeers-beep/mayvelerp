const mongoose = require('mongoose');

const projectHoursPlanSchema = new mongoose.Schema({
  teamspaceId:                { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  projectId:                  { type: mongoose.Schema.Types.ObjectId, ref: 'Project',   required: true, index: true },
  title:                      { type: String, required: true },
  periodMonth:                { type: String, required: true },     // 'YYYY-MM'
  periodStart:                { type: Date,   required: true },     // first calendar day of periodMonth
  periodEnd:                  { type: Date,   required: true },     // last calendar day
  status:                     { type: String, enum: ['draft','pending','approved','rejected'], default: 'draft', index: true },

  // Hours
  totalPlannedHours:          { type: Number, default: 0 },
  billablePlannedHours:       { type: Number, default: 0 },
  nonBillablePlannedHours:    { type: Number, default: 0 },

  // Cost (every hour costs the company)
  totalCostCents:             { type: Number, default: 0 },
  billableCostCents:          { type: Number, default: 0 },
  nonBillableCostCents:       { type: Number, default: 0 },

  // Revenue (only billable hours generate revenue)
  totalRevenueCents:          { type: Number, default: 0 },

  // Actuals (recomputed from approved TimeEntries)
  totalActualHours:           { type: Number, default: 0 },
  billableActualHours:        { type: Number, default: 0 },
  nonBillableActualHours:     { type: Number, default: 0 },
  totalActualCostCents:       { type: Number, default: 0 },
  billableActualCostCents:    { type: Number, default: 0 },
  nonBillableActualCostCents: { type: Number, default: 0 },
  totalActualRevenueCents:    { type: Number, default: 0 },

  // P&L (derived, cached for fast dashboards)
  plannedProfitCents:         { type: Number, default: 0 },
  actualProfitCents:          { type: Number, default: 0 },
  plannedMarginPct:           { type: Number, default: 0 },
  actualMarginPct:            { type: Number, default: 0 },
  variancePctCached:          { type: Number, default: 0 },

  ragStatus:                  { type: String, enum: ['green','amber','red','grey'], default: 'grey' },

  submittedAt:                { type: Date },
  submittedBy:                { type: String },
  approvedAt:                 { type: Date },
  approvedBy:                 { type: String },
  rejectedAt:                 { type: Date },
  rejectedBy:                 { type: String },
  rejectionReason:            { type: String },
  attachmentId:               { type: String },                     // optional original Excel upload (file name in /uploads)

  createdBy:                  { type: String },
  updatedBy:                  { type: String },
}, { timestamps: true });

// Non-unique compound index for fast lookup by (project, month).
// Multiple plans per project+month are allowed (e.g., supplementary budget approvals).
projectHoursPlanSchema.index({ teamspaceId: 1, projectId: 1, periodMonth: 1 });

module.exports = mongoose.model('ProjectHoursPlan', projectHoursPlanSchema);
