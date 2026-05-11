const mongoose = require('mongoose');

// Append-only log of every state change on plans / periods / slices / entries — for traceability.
const timesheetAuditSchema = new mongoose.Schema({
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },

  entityType:  { type: String, enum: ['plan','planLine','allocation','timeEntry','period','slice'], required: true },
  entityId:    { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

  action:      { type: String, required: true },                   // 'create','update','delete','submit','approve','reject','reopen','admin_override'
  before:      { type: Object },
  after:       { type: Object },

  actorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName:   { type: String },
  actorRole:   { type: String },
  reason:      { type: String },                                   // required for 'reject' and 'admin_override'

  at:          { type: Date, default: Date.now, index: true },
}, { timestamps: false });

timesheetAuditSchema.index({ entityType: 1, entityId: 1, at: -1 });

module.exports = mongoose.model('TimesheetAudit', timesheetAuditSchema);
