/**
 * متابعةُ تحصيل — مكالمةٌ أو زيارةٌ أو وعدٌ بالسداد، مقيَّدةٌ على طرفٍ بعينه.
 *
 * ── لماذا انتقلت إلى هنا ───────────────────────────────────────────────────
 * كانت «متابعات التحصيل» صفحةً تحت قسم العملاء والمالية، تُقيَّد على `Customer`
 * وتُربَط بـ`Invoice` — وكلاهما من ورك فلو لم يعد يجري. فكانت المتابعةُ تُسجَّل
 * في قسمٍ لا يملك التحصيل، على عميلٍ لا مصدرَ له، وفاتورةٍ لا تُنشَأ.
 *
 * فصارت تُقيَّد على `CollectionsParty` — الطرفُ الذي يعرفه قسمُ التحصيل — وعلى
 * `OperationsWorkflow` حين تخصّ كشفًا بعينه، وهو المستندُ الحيّ الذي منه تُقرأ
 * الأرقام. ومَن يلاحق فاتورةً يلاحق كشفًا في الحقيقة.
 *
 * ── والوعدُ بالسداد ليس ملاحظة ─────────────────────────────────────────────
 * «قال يسدّد الخميس» بندٌ له تاريخٌ ومبلغٌ ويُسأل عنه بعد الخميس. فله حقولُه،
 * ويُقرأ في «المتابعات المستحقّة» — لا يُدفَن في نصّ ملاحظة.
 */
const mongoose = require('mongoose');

const collectionsFollowUpSchema = new mongoose.Schema(
  {
    party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', required: true, index: true },
    // الكشفُ الذي تخصّه المتابعة، إن خصّت واحدًا بعينه.
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow' },
    collector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    type: {
      type: String,
      enum: ['call', 'whatsapp', 'email', 'visit', 'promise', 'note'],
      required: true,
    },
    status: { type: String, enum: ['done', 'postponed', 'cancelled'], default: 'done' },
    notes: { type: String, required: true, trim: true },

    // ما حُصِّل في هذه المتابعة — إن حُصِّل شيء.
    amountCollected: { type: Number, default: 0 },

    // الوعدُ ومصيرُه.
    promiseDate: { type: Date },
    promiseAmount: { type: Number },
    promiseFulfilled: { type: Boolean },

    nextFollowUpAt: { type: Date, index: true },
    // تُقفَل حين يُنجَز ما وُعد به أو يُصرَف النظرُ عنه — فلا تبقى في المستحقّ.
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

collectionsFollowUpSchema.index({ party: 1, createdAt: -1 });
collectionsFollowUpSchema.index({ closedAt: 1, nextFollowUpAt: 1 });

module.exports = mongoose.models.CollectionsFollowUp
  || mongoose.model('CollectionsFollowUp', collectionsFollowUpSchema);
