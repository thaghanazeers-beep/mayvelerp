const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Simple plain text for mock purposes
  role: { type: String, enum: ['Admin', 'Member'], default: 'Member' },
  profilePictureUrl: { type: String },
  passwordResetToken: { type: String, index: true },
  passwordResetExpires: { type: Date },
  rateBucketId: { type: mongoose.Schema.Types.ObjectId, ref: 'RateBucket', index: true },   // resource cost-rate bucket; used by Timesheet/ERP module

  // ── Optional profile fields ──
  phone:        { type: String, default: '' },
  slackHandle:  { type: String, default: '' },                  // '@username' or full URL
  timezone:     { type: String, default: 'Asia/Kolkata' },      // IANA TZ name
  workingHours: {                                                // for "available now?" indicators + auto-scheduling
    start:  { type: String, default: '09:00' },                 // HH:mm 24h
    end:    { type: String, default: '18:00' },
    weekdaysOnly: { type: Boolean, default: true },
  },
  bio:          { type: String, default: '' },

  // Notification preferences — keys are notification `type` strings.
  // Missing key = enabled (default-on); explicit `false` = muted.
  notificationPrefs: { type: Object, default: {} },
});

module.exports = mongoose.model('User', userSchema);
