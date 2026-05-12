const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#6c5ce7' },
  icon: { type: String, default: '📁' },
  createdBy: { type: String },
  createdDate: { type: Date, default: Date.now },
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  // `scope` controls visibility:
  //   'teamspace' (default, legacy) → visible only within the parent teamspace
  //   'org'                         → visible across every shared teamspace; tasks underneath
  //                                   can belong to any department/teamspace. Used for a
  //                                   project like "Seyo" where Design, Dev, and Testing
  //                                   each contribute their own tasks and have their own
  //                                   budget approval (per-department ProjectHoursPlan rows).
  scope: { type: String, enum: ['teamspace', 'org'], default: 'teamspace', index: true },
  status: { type: String, default: 'Active' },
  notionId: { type: String, index: true },
  // ── ERP / Timesheet additions (Phase 1) ──
  ownerId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // approves the monthly plan & weekly time slices for this project
  defaultBillRateCents:  { type: Number, default: 0 },                                       // 0 = internal project (no revenue)
  trackTime:             { type: Boolean, default: true },

  // ── Contract & billing model ──
  // billingType:
  //   'tm'    — Time & Materials. Revenue = billable hours × bill rate (current behaviour).
  //   'fixed' — Fixed bid. Client pays contractValueCents flat regardless of hours.
  // contractValueCents: client-approved budget ceiling. 0 = no ceiling (open / internal).
  billingType:           { type: String, enum: ['tm', 'fixed'], default: 'tm' },
  contractValueCents:    { type: Number, default: 0 },
});

projectSchema.query.byTeamspace = function (teamspaceId) {
  return this.where({ teamspaceId });
};

module.exports = mongoose.model('Project', projectSchema);
