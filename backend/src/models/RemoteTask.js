const mongoose = require('mongoose');

const remoteTaskSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // assignee
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    dueDate: { type: String }, // YYYY-MM-DD (optional)
    done: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

remoteTaskSchema.index({ user: 1, done: 1, createdAt: -1 });

module.exports = mongoose.model('RemoteTask', remoteTaskSchema);
