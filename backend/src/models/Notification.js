const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // To one person or a whole section.
  // A notification used to need one mandatory recipient, so section news became a row per person (one upload = 13 rows) and the recipient list was hand-written at each call site, leaving new roles with no notifications.
  // Now it is either `recipient` (a specific person) or `section`: one row seen by everyone whose permissions include that section. One of the two is required.
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  /** Section key as in config/sections (e.g. 'Operations'). */
  section: { type: String, default: null, index: true },
  type: {
    type: String,
    enum: [
      'invoice_due_soon',
      'invoice_overdue',
      'payment_received',
      'risk_updated',
      'dispute_opened',
      'dispute_resolved',
      'credit_term_changed',
      'follow_up_reminder',
      'system_alert',
      // Cross-section (general):
      'task_assigned',
      'complaint_assigned',
      'approval_needed',
      'status_changed',
      'shipment_update',
      'general',
    ],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  relatedEntity: { type: String },
  relatedEntityId: { type: mongoose.Schema.Types.ObjectId },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  // Per-reader read state for section notifications.
  // One row seen by many cannot use a single `isRead`; readers are recorded here and unread is computed by absence of the user's id.
  readBy: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  // Activity feed item: "someone edited X", written from the audit log (services/activityFeed). `actor` is who acted; they are not shown their own action.
  activity: { type: Boolean, default: false },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
});

// A notification needs a destination: a row with neither `recipient` nor `section` would be written and never seen, so failing at write time is better.
notificationSchema.pre('validate', function requireAudience(next) {
  if (!this.recipient && !this.section) {
    return next(new Error('Notification needs a recipient or a section'));
  }
  next();
});

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ section: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
