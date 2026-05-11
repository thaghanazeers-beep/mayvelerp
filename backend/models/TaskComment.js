const mongoose = require('mongoose');

// Threaded comments on a task. `taskId` mirrors Task.id (string id) for join-free lookups.
// `mentions` is the resolved list of names extracted from `@name` tokens at post time.
const taskCommentSchema = new mongoose.Schema({
  teamspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teamspace', required: true, index: true },
  taskId:      { type: String, required: true, index: true },
  authorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName:  { type: String, required: true },
  body:        { type: String, required: true },
  mentions:    [{ type: String }],            // user names mentioned in the body
  createdAt:   { type: Date, default: Date.now, index: true },
  updatedAt:   { type: Date },
});

taskCommentSchema.index({ taskId: 1, createdAt: 1 });

module.exports = mongoose.model('TaskComment', taskCommentSchema);
