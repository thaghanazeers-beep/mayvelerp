const mongoose = require('mongoose');

const teamspaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '🏢' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  isPersonal: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Teamspace', teamspaceSchema);
