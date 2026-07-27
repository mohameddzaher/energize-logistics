const mongoose = require('mongoose');

// الشؤون الإدارية (السكرتارية) — a Trello-style task board, deliberately tiny:
// four fixed columns, one assignee, a comment thread and an activity trail.
// The people using it are non-technical, so the model carries denormalized
// names (assigneeName, byName) — the UI must never need a second request to
// render a card.

const STATUSES = ['new', 'in_progress', 'follow_up', 'done'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const adminTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    status: { type: String, enum: STATUSES, default: 'new' },
    // Position inside its column so a drag-reorder survives a refresh.
    order: { type: Number, default: 0 },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    dueDate: { type: Date, default: null },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assigneeName: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
    completedAt: { type: Date, default: null },
    comments: [
      {
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byName: { type: String, default: '' },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        at: { type: Date, default: Date.now },
      },
    ],
    // Human-readable فصحى lines ("نقل المهمة إلى «قيد التنفيذ»") written by the
    // controller — the trail is for the office team, not for machines.
    activity: [
      {
        byName: { type: String, default: '' },
        text: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

adminTaskSchema.index({ status: 1, order: 1 });
adminTaskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminTask', adminTaskSchema);
module.exports.STATUSES = STATUSES;
module.exports.PRIORITIES = PRIORITIES;
