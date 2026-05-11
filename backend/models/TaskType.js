const mongoose = require('mongoose');

const taskTypeSchema = new mongoose.Schema({
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  name:        { type: String, required: true },                     // 'Support', 'Maintenance', 'Design', …
  sortOrder:   { type: Number, default: 0 },
  active:      { type: Boolean, default: true },
}, { timestamps: true });

taskTypeSchema.index({ teamspaceId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('TaskType', taskTypeSchema);
