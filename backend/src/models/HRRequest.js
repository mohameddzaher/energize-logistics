const mongoose = require('mongoose');

// A general (non-leave) request an employee sends to HR: salary certificate,
// official letter, document, complaint, etc. It's a small two-way thread so HR
// and the employee can go back and forth, with a simple received/resolved flow.
const threadMessageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, trim: true },
    link: { type: String, trim: true }, // HR can attach a link to a document
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
