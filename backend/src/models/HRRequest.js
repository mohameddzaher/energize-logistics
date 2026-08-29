const mongoose = require('mongoose');

// A general (non-leave) request an employee sends to HR: salary certificate,
// official letter, document, complaint, etc. It's a small two-way thread so HR
// and the employee can go back and forth, with a simple received/resolved flow.
const threadMessageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, trim: true },
    // ── الرابط لا يكفي، والملفّ هو المطلوب ─────────────────────────────────
    // كانت الموارد البشرية تردّ برابطٍ إلى ملفٍّ على درايف أو واتساب: يعيش خارج
    // النظام، ويُحذف أو تُسحب صلاحيتُه فيبقى في السجلّ سطرٌ يقول «أُرسلت الشهادة»
    // ورابطٌ لا يفتح. والمرفق يعيش مع الطلب: يُنسخ معه احتياطيًّا، ويبقى مقروءًا
    // بعد سنة.
    //
    // والرابط يبقى مقبولًا — بعضُ ما يُشارَك رابطٌ بطبعه — لكنّه لم يعد الخيار
    // الوحيد. وأكثرُ من ملفٍّ في الرسالة الواحدة: الشهادةُ ووجهُ الإقامة ورقةٌ
    // واحدة في ذهن من يطلبها.
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
