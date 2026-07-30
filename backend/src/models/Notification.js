const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
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
      // عامة عبر الأقسام:
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
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
