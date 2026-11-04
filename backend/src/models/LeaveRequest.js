const mongoose = require('mongoose');

// A leave request follows the chain in utils/leaveChain: pending_manager, pending_finance, pending_hr, pending_executive, pending_chairman, approved
// (or rejected/cancelled at any stage). Without a direct manager it starts at pending_finance.
// Attachment: sick leave needs a report and exceptional leave a justifying paper. Sent over WhatsApp they got lost and could not be found months later. The attachment lives with the request, is backed up with it and stays downloadable from the employee file.
const attachmentSchema = new mongoose.Schema({
  title: { type: String, trim: true, default: '' },
  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

const decisionSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date },
    decision: { type: String, enum: ['approved', 'rejected'] },
    note: { type: String, trim: true },
    // Optional signature (base64 PNG) the approver applied when deciding.
    signature: { type: String, default: '' },
    // Manager or HR paper when the decision has a basis.
    attachments: [attachmentSchema],
  },
  { _id: false }
);

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalised copy of requester.manager at creation time → fast team lookup.
    // For a request a manager filed for his team, this is that manager.
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Filed by a manager on behalf of someone under him (utils/leaveTeam): his own stage is stamped approved at creation.
    filedByManager: { type: Boolean, default: false },
    filedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    filedByName: { type: String, default: '' },

    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    leaveTypeCode: { type: String }, // snapshot for display/export
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true }, // YYYY-MM-DD
    days: { type: Number, required: true },
    reason: { type: String, trim: true },
    // Requester attachments: medical report, emergency paper and similar.
    attachments: [attachmentSchema],

    // Leave that happened and is recorded afterwards. Many leaves were taken before the system existed or agreed verbally, and balances cannot be right unless recorded; otherwise the employee is owed thirty days on paper after taking twelve.
    // Recorded as approved from the start, skipping the manager and the notice period (the past is not approved), but marked `backdated` with who recorded it and when, so a reader knows it was recorded, not requested.
    backdated: { type: Boolean, default: false, index: true },
    // Recorded by HR from the leave register (no request; e.g. an employee without a login).
    manual: { type: Boolean, default: false, index: true },

    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedByName: { type: String, default: '' },
    recordedAt: { type: Date },

    // Return from leave (utils/leaveReturn). The end date and day count follow
    // what actually happened, so the live balance refunds an early return and
    // charges an extension without separate arithmetic.
    plannedEndDate: { type: String, default: '' },              // end date as approved, before any change
    returnState: { type: String, enum: ['', 'returned', 'no_show'], default: '', index: true },
    returnedOn: { type: String, default: '' },                  // YYYY-MM-DD the employee came back
    workStartsOn: { type: String, default: '' },                // first working day
    returnCountsAsWork: { type: Boolean, default: false },      // the return day itself is a working day
    returnAuto: { type: Boolean, default: false },              // recorded by the daily sync, not by HR
    returnRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnRecordedByName: { type: String, default: '' },
    returnRecordedAt: { type: Date },
    extensions: [{
      fromEnd: String, toEnd: String, days: Number, note: { type: String, default: '' },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, at: { type: Date, default: Date.now },
    }],
    noShow: {
      since: { type: String, default: '' },                     // first day he should have been back
      note: { type: String, default: '' },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, at: Date,
    },

    // Stages, in order: direct manager, finance, HR, top management, chairman of the board.
    // An ask for clarification is not a rejection; the owner's reply restarts the chain, since what was approved changed.
    status: {
      type: String,
      enum: [
        'pending_manager', 'pending_hr', 'pending_finance', 'pending_executive', 'pending_chairman',
        'info_requested', 'approved', 'rejected', 'cancelled',
      ],
      default: 'pending_manager',
    },
    currentStage: {
      type: String,
      enum: ['manager', 'hr', 'finance', 'executive', 'chairman', 'employee', 'done'],
      default: 'manager',
    },

    // HR's explicit choice at its stage: true = days come off the balance, false = leave without deduction.
    // Null on older records, where the leave type decides (utils/leaveBalance.leaveDeducts).
    deductsBalance: { type: Boolean, default: null },

    managerDecision: decisionSchema,
    hrDecision: decisionSchema,
    financeDecision: decisionSchema,
    executiveDecision: decisionSchema,
    chairmanDecision: decisionSchema,

    // What passed between the requester and reviewers: a question asked and a reply written stay on the request, so why it was delayed and what was answered is readable later. Nothing is erased.
    thread: [{
      at: { type: Date, default: Date.now },
      kind: { type: String, enum: ['question', 'reply'], required: true },
      stage: { type: String, default: '' },        // Who asked: hr / finance / ...
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, default: '' },
      text: { type: String, trim: true, default: '' },
      // Attachment the employee sends with his reply (base64), for example a payment receipt.
      attachment: { type: String, default: '' },
      attachmentName: { type: String, default: '' },
    }],

    // The requester's signature (base64 PNG) applied at submission time.
    employeeSignature: { type: String, default: '' },

    // Snapshot of the balance at request time so reviewers see whether the
    // requested days exceed what the employee had accrued.
    balanceSnapshot: {
      accrued: Number,
      requested: Number,
      remainingAfter: Number,
    },

    // Advance-notice policy snapshot. `daysAhead` is how many days before the start date this was actually filed; `requiredDays` is what the leave type demanded. A request failing the rule is rejected at creation unless HR overrode it, in which case `overridden` records who and why, so the exception stays visible on the request.
    advanceNotice: {
      required: { type: Boolean, default: false },
      requiredDays: { type: Number, default: 0 },
      daysAhead: { type: Number, default: 0 },
      satisfied: { type: Boolean, default: true },
      overridden: { type: Boolean, default: false },
      overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      overrideReason: { type: String, trim: true, default: '' },
    },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ employee: 1, createdAt: -1 });
leaveRequestSchema.index({ requester: 1, createdAt: -1 });
leaveRequestSchema.index({ manager: 1, status: 1 });
leaveRequestSchema.index({ status: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
