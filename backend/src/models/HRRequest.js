const mongoose = require('mongoose');

// A general (non-leave) request an employee sends to HR: salary certificate,
// official letter, document, complaint, etc. It's a small two-way thread so HR
// and the employee can go back and forth, with a simple received/resolved flow.
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
      enum: ['open', 'in_progress', 'received', 'resolved', 'closed'],
      default: 'open',
    },
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

module.exports = mongoose.model('HRRequest', hrRequestSchema);
