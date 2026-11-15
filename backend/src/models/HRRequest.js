const mongoose = require('mongoose');

// A general (non-leave) request an employee sends: salary certificate, letter, complaint, ... It goes to his direct
// manager first, who handles it or sends it to a department or top management (utils/requestRouting). A small
// two-way thread carries the conversation; `history` records every hand-over and decision.
const threadMessageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, trim: true },
    // A link is not enough; the file is the goal. HR used to reply with a Drive or WhatsApp link that lives outside the system and can be deleted or revoked, leaving a record that says the certificate was sent and a dead link. The attachment lives with the request, is backed up with it and stays readable. A link is still accepted since some things are links by nature, and one message can carry several files.
    link: { type: String, trim: true },
    attachments: [{
      title: { type: String, trim: true },
      fileUrl: { type: String, required: true },
      fileName: { type: String, trim: true },
      mimeType: { type: String, trim: true },
      size: { type: Number, default: 0 },
    }],
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const hrRequestSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // denormalised

    category: {
      type: String,
      enum: ['salary_certificate', 'letter', 'document', 'data_update', 'complaint', 'other'],
      default: 'other',
    },
    subject: { type: String, required: true, trim: true },
    thread: [threadMessageSchema],

    status: {
      type: String,
      enum: ['open', 'in_progress', 'received', 'resolved', 'closed', 'rejected', 'cancelled'],
      default: 'open',
    },
    // manager: waiting on the direct manager · department: with `targetSection` (a section key or 'Top Management') · done.
    stage: { type: String, enum: ['manager', 'department', 'done'] },
    targetSection: { type: String, trim: true },
    // Everyone who acted on it keeps seeing it after it moves on.
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    history: [{
      _id: false,
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, trim: true },
      action: { type: String, enum: ['created', 'forwarded', 'in_progress', 'resolved', 'rejected', 'closed', 'cancelled', 'reopened', 'status', 'manager_changed'] },
      fromSection: { type: String, trim: true },
      toSection: { type: String, trim: true },
      status: { type: String, trim: true },
      note: { type: String, trim: true },
    }],
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Unread flags so each side sees a badge when the other replies.
    readByRequester: { type: Boolean, default: true },
    readByHR: { type: Boolean, default: false },
  },
  { timestamps: true }
);

hrRequestSchema.index({ requester: 1, createdAt: -1 });
hrRequestSchema.index({ status: 1, createdAt: -1 });
hrRequestSchema.index({ employee: 1 });
hrRequestSchema.index({ manager: 1, stage: 1 });
hrRequestSchema.index({ targetSection: 1, stage: 1 });

module.exports = mongoose.model('HRRequest', hrRequestSchema);
