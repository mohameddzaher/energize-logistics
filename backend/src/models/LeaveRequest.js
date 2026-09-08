const mongoose = require('mongoose');

// A leave request follows a two-step approval chain:
//   pending_manager → pending_hr → approved   (or rejected/cancelled anywhere)
// If the requester has no direct manager, it starts at pending_hr directly.
// ── المرفق ───────────────────────────────────────────────────────────────────
// الإجازة المرضيّة تُطلب بتقرير، والاستثنائيّة بورقةٍ تُبرّرها. وكانت تُرسَل
// على الواتساب فتضيع، ثمّ يُسأل بعد شهرين «أين تقرير فلان؟» فلا يُوجد. يعيش
// المرفقُ مع الطلب نفسِه: يُنسخ معه احتياطيًّا، ويبقى يُحمَّل من ملفّ الموظّف.
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
    // ورقةُ المدير أو الموارد البشريّة حين يكون للقرار سند.
    attachments: [attachmentSchema],
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
    // مرفقاتُ مقدّم الطلب: التقرير الطبّيّ، ورقةُ الظرف الطارئ، وما إليها.
    attachments: [attachmentSchema],

    // ── إجازةٌ وقعت ثمّ سُجّلت ────────────────────────────────────────────
    // كثيرٌ من الإجازات تُؤخذ قبل أن يوجد النظام، أو تُتّفق شفاهةً ثمّ تُقيَّد.
    // ولا سبيلَ إلى رصيدٍ صحيحٍ إن لم تُسجَّل: يبقى الموظّف في الورق مستحقًّا
    // ثلاثين يومًا وقد أخذ اثنَي عشر.
    //
    // فتُسجَّل معتمَدةً من أوّلها — لا تمرّ بمديرٍ ولا بمهلة إخطارٍ، فالماضي
    // لا يُوافَق عليه — لكنّها تُوسَم `backdated` ويُسجَّل من قيّدها ومتى.
    // فمن يقرأ السجلَّ بعدها يعرف أنّ هذه لم تُطلب بل قُيّدت.
    backdated: { type: Boolean, default: false, index: true },

    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedByName: { type: String, default: '' },
    recordedAt: { type: Date },

    // ── سلسلةُ الموافقات أربعُ محطّات ────────────────────────────────────
    //
    // المديرُ المباشر ← الموارد البشريّة ← الحسابات ← الإدارة العليا. وكانت
    // محطّتين، فما يخصّ المالَ (سلفةٌ على الموظّف، أو مستحقّاتٌ قبل السفر) لم
    // يكن يمرّ على الحسابات أصلًا، والإدارةُ العليا تعلم بالسفر بعد وقوعه.
    //
    // و«طلبُ إيضاح» ليس رفضًا: قد تقول الحساباتُ «عليه مبلغٌ يُسدَّد أوّلًا»
    // فيردّ الموظّفُ أو يعدّل طلبَه. وحين يردّ تعود السلسلةُ من أوّلها —
    // لأنّ الطلبَ الذي وافق عليه المديرُ لم يعد هو الطلبَ نفسَه.
    status: {
      type: String,
      enum: [
        'pending_manager', 'pending_hr', 'pending_finance', 'pending_executive',
        'info_requested', 'approved', 'rejected', 'cancelled',
      ],
      default: 'pending_manager',
    },
    currentStage: {
      type: String,
      enum: ['manager', 'hr', 'finance', 'executive', 'employee', 'done'],
      default: 'manager',
    },

    managerDecision: decisionSchema,
    hrDecision: decisionSchema,
    financeDecision: decisionSchema,
    executiveDecision: decisionSchema,

    // ── ما دار بين الطالب والمراجعين ────────────────────────────────────
    // سؤالٌ يُطرح وردٌّ يُكتب — يبقيان على الطلب فيُقرأ بعد شهرٍ لماذا تأخّر
    // وبم أُجيب. ولا يُمحى شيءٌ منهما.
    thread: [{
      at: { type: Date, default: Date.now },
      kind: { type: String, enum: ['question', 'reply'], required: true },
      stage: { type: String, default: '' },        // مَن سأل: hr / finance / …
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, default: '' },
      text: { type: String, trim: true, default: '' },
      // مرفقٌ يرسله الموظّف مع ردّه (base64) — إيصالُ سدادٍ مثلًا.
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

    // Advance-notice policy snapshot (سياسة الإخطار المسبق). `daysAhead` is how
    // many days before the start date this was actually filed; `requiredDays` is
    // what the leave type demanded. A request that fails the rule is rejected at
    // creation UNLESS HR overrode it — then `overridden` records who and why, so
    // the exception is visible on the request forever.
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
