const mongoose = require('mongoose');

// A leave request follows a two-step approval chain:
//   pending_manager → pending_hr → approved   (or rejected/cancelled anywhere)
// If the requester has no direct manager, it starts at pending_hr directly.
const decisionSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date },
    decision: { type: String, enum: ['approved', 'rejected'] },
    note: { type: String, trim: true },
    // Optional signature (base64 PNG) the approver applied when deciding.
    signature: { type: String, default: '' },
  },
  { _id: false }
);

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalised copy of requester.manager at creation time → fast team lookup.
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    leaveTypeCode: { type: String }, // snapshot for display/export
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true }, // YYYY-MM-DD
    days: { type: Number, required: true },
    reason: { type: String, trim: true },

    status: {
      type: String,
      enum: ['pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled'],
      default: 'pending_manager',
    },
    currentStage: { type: String, enum: ['manager', 'hr', 'done'], default: 'manager' },

    managerDecision: decisionSchema,
    hrDecision: decisionSchema,

    // The requester's signature (base64 PNG) applied at submission time.
    employeeSignature: { type: String, default: '' },

    // Snapshot of the balance at request time so reviewers see whether the
    // requested days exceed what the employee had accrued.
    balanceSnapshot: {
      accrued: Number,
      requested: Number,
      remainingAfter: Number,
    },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ employee: 1, createdAt: -1 });
leaveRequestSchema.index({ requester: 1, createdAt: -1 });
leaveRequestSchema.index({ manager: 1, status: 1 });
leaveRequestSchema.index({ status: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
