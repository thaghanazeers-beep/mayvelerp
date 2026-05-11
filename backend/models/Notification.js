const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true }, // task_created, task_assigned, status_changed, task_completed, task_rejected, review_requested
  title: { type: String, required: true },
  message: { type: String, required: true },
  taskId: { type: String },
  taskTitle: { type: String },
  userId: { type: String }, // recipient user ID (empty = broadcast to all)
  actorName: { type: String }, // who triggered the notification
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Auto-expire notifications after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Pref-aware factory. Use this instead of Notification.create() in routes so
// muted recipients are silently skipped. Returns the saved doc OR null if muted.
notificationSchema.statics.createIfAllowed = async function (doc) {
  try {
    if (doc?.userId) {
      const User = mongoose.model('User');
      const target = await User.findOne({ name: doc.userId }).select('notificationPrefs').lean();
      if (target?.notificationPrefs && target.notificationPrefs[doc.type] === false) {
        return null;     // muted
      }
    }
    return await this.create(doc);
  } catch (err) {
    console.error('createIfAllowed failed:', err.message);
    return null;
  }
};

module.exports = mongoose.model('Notification', notificationSchema);
