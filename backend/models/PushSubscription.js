const mongoose = require('mongoose');

// One row per (browser, user) — a single user can have multiple subscriptions
// (work laptop, phone, etc). Endpoint is globally unique so we use it as the
// dedup key.
const pushSubscriptionSchema = new mongoose.Schema({
  userId:   { type: String, required: true, index: true },  // mirrors Notification.userId — the user's NAME
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true },
  },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
