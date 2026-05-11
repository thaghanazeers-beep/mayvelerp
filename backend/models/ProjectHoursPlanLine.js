const mongoose = require('mongoose');

const planLineSchema = new mongoose.Schema({
  planId:               { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectHoursPlan', required: true, index: true },
  teamspaceId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace',         required: true, index: true },

  taskType:             { type: String, required: true },           // 'Support', 'Maintenance', …
  billable:             { type: Boolean, default: true },           // true = revenue-generating, false = overhead

  assigneeUserId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User'   },
  assigneeBucketId:     { type: mongoose.Schema.Types.ObjectId, ref: 'RateBucket', required: true },

  // Frozen at plan submission — subsequent rate changes don't ripple back
  frozenRateCents:      { type: Number, default: 0 },               // cost rate (what we pay)
  frozenBillRateCents:  { type: Number, default: 0 },               // bill rate (what client pays); 0 for non-billable
  billRateOverrideCents:{ type: Number },                           // optional per-line override

  startDate:            { type: Date, required: true },
  targetDate:           { type: Date, required: true },
  plannedHours:         { type: Number, required: true, min: 0 },
  actualHours:          { type: Number, default: 0 },

  distributionType:     { type: String, enum: ['Continuous','Distributed','Open'], default: 'Continuous' },
  perDayDistribution:   { type: Number, default: 0 },               // hours/day, Mon–Fri only
  perDayOverrides:      { type: Object, default: {} },              // { 'YYYY-MM-DD': hours }

  status:               { type: String, enum: ['Yet-To-Start','In-Progress','On-hold','Completed','Cancelled'], default: 'Yet-To-Start' },
  ragStatus:            { type: String, enum: ['green','amber','red','grey'], default: 'grey' },

  costCents:            { type: Number, default: 0 },               // plannedHours * frozenRateCents
  revenueCents:         { type: Number, default: 0 },               // billable ? plannedHours * frozenBillRateCents : 0
  actualCostCents:      { type: Number, default: 0 },
  actualRevenueCents:   { type: Number, default: 0 },

  notes:                { type: String, default: '' },
  taskId:               { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },   // populated after Stage-2 allocation
}, { timestamps: true });

module.exports = mongoose.model('ProjectHoursPlanLine', planLineSchema);
