const mongoose = require('mongoose');

const rateBucketSchema = new mongoose.Schema({
  teamspaceId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  name:             { type: String, required: true },                // 'Trainee', 'Junior', 'Associate', 'Lead', 'Manager', 'Management', 'Senior', 'ExpensesBucket1'…
  ratePerHourCents: { type: Number, required: true, min: 0 },        // store paise to avoid float drift (501 ₹/hr → 50100)
  kind:             { type: String, enum: ['labor', 'expense'], default: 'labor' },
  active:           { type: Boolean, default: true },
}, { timestamps: true });

rateBucketSchema.index({ teamspaceId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('RateBucket', rateBucketSchema);
