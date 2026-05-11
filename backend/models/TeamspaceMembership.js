const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  role: { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' },
  status: { type: String, enum: ['active', 'pending', 'removed'], default: 'active' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  joinedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

membershipSchema.index({ userId: 1, teamspaceId: 1 }, { unique: true });

module.exports = mongoose.model('TeamspaceMembership', membershipSchema);
