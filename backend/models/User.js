const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Simple plain text for mock purposes
  role: { type: String, enum: ['Admin', 'Member'], default: 'Member' },
  // Super Admin is a single workspace-owner user. They get every Admin
  // privilege plus the ability to create / delete other users and change any
  // user's role. A SuperAdmin always also has `role === 'Admin'`, so existing
  // role checks throughout the codebase still pass for them.
  isSuperAdmin: { type: Boolean, default: false },
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
  // Master kill switch for email notifications. When false, all notification
  // emails are suppressed for this user (in-app + push still fire so they
  // don't miss anything; just no inbox spam). Per-type prefs above are AND-ed
  // with this — easiest way to "go quiet" without flipping every type.
  emailNotificationsEnabled: { type: Boolean, default: true },
});

module.exports = mongoose.model('User', userSchema);
