const mongoose = require('mongoose');

// A support issue IT resolved or is working on.
// The point is the `signature` field: a normalized key from category plus a slug of the title. Tickets describing the same underlying problem share a signature, which is how the recurring-problems report tells IT this keeps coming back and the root cause needs fixing, not the symptom.
const itTicketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true, index: true },

    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        'hardware', 'software', 'network', 'email', 'printer',
        'account_access', 'erp_system', 'phone', 'security', 'other',
      ],
      default: 'other',
    },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed', 'reopened'],
      default: 'open',
    },

    // Who reported it. `requester` is optional because plenty of walk-in
    // requests never map to an Employee doc — the plain-text names carry those.
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    requesterName: { type: String, trim: true },
    requesterDepartment: { type: String, trim: true },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedToName: { type: String, trim: true },

    reportedAt: { type: String }, // YYYY-MM-DD
    // Resolution day as entered by whoever closed the ticket. Needed because `resolvedAt` was stamped at save time, and most tickets are logged days after the fix, so resolution time measured data-entry lag instead of repair time.
    resolvedDate: { type: String }, // YYYY-MM-DD
    resolvedAt: { type: Date },
    // In minutes, but always whole-day multiples: the ticket date has no time, so any finer precision would be an invented number.
    resolutionMinutes: { type: Number },

    description: { type: String, trim: true },
    resolution: { type: String, trim: true },       // what IT actually did
    rootCause: { type: String, trim: true },
    preventiveAction: { type: String, trim: true },

    relatedAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset' },
    device: { type: String, trim: true },

    isRecurring: { type: Boolean, default: false },
    // Normalized repeat key — see buildSignature() in itController.
    signature: { type: String, default: '', trim: true },

    notes: { type: String, trim: true },
    // Its mirror task in the IT plan's «Tickets & Issues» project (services/itTicketJp). Pairs linked by hand have none and are not synced.
    jpTask: { type: mongoose.Schema.Types.ObjectId, ref: 'JpTask', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

itTicketSchema.index({ status: 1 });
itTicketSchema.index({ category: 1 });
itTicketSchema.index({ signature: 1 });
itTicketSchema.index({ reportedAt: -1 });

// Auto ticket number: IT-00001, IT-00002, ...
itTicketSchema.pre('save', async function (next) {
  if (this.isNew && !this.ticketNumber) {
    try {
      const last = await this.constructor.findOne({}).sort({ createdAt: -1 }).select('ticketNumber').lean();
      let n = 1;
      if (last && last.ticketNumber) {
        const m = String(last.ticketNumber).match(/(\d+)$/);
        if (m) n = parseInt(m[1], 10) + 1;
      }
      this.ticketNumber = 'IT-' + String(n).padStart(5, '0');
    } catch (e) {
      this.ticketNumber = 'IT-' + Date.now();
    }
  }
  next();
});

module.exports = mongoose.models.ItTicket || mongoose.model('ItTicket', itTicketSchema);
