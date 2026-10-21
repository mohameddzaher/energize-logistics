const mongoose = require('mongoose');

/**
 * دفعُ رسوم تجديد الإقامة أو رخصة العمل — لا التجديدُ نفسُه.
 *
 * ── لماذا مفتاحُه (الموظّف، المستند، تاريخُ الانتهاء) ───────────────────────
 * المالُ يُدفع عن **دورةٍ** من المستند: إقامةٌ تنتهي في ٢٠٢٦/١١/٠٥ تُدفع رسومُ
 * تجديدها مرّةً. ثمّ تجدّدها الموارد البشريّة من ملفّ الموظّف فيتغيّر تاريخُ
 * الانتهاء — وتلك دورةٌ جديدةٌ لم تُدفع رسومُها بعد. فلو كان المفتاحُ الموظّفَ
 * والمستندَ وحدَهما لبقي «مدفوعًا» إلى الأبد بعد أوّل دفعة، ولقرأت الماليّةُ
 * إقامةَ السنة القادمة مدفوعةً وهي لم تُدفع.
 *
 * فالتاريخُ جزءٌ من المفتاح: التجديدُ يبدأ دورةً غيرَ مدفوعةٍ تلقائيًّا، والدفعةُ
 * القديمةُ تبقى سجلًّا كما هي — لا تُمحى ولا تُنقل.
 *
 * ── والتراجعُ إلغاءٌ لا حذف ─────────────────────────────────────────────────
 * من سجّل دفعةً خطأً يلغيها (`voided`)، فتبقى في القاعدة بمن ألغاها ومتى ولماذا.
 * والفهرسُ الفريدُ على الدفعات السارية وحدَها، فتُسجَّل الدورةُ نفسُها مدفوعةً
 * من جديدٍ بعد الإلغاء.
 */
const DOC_TYPES = ['iqama', 'workPermit'];

const fileSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const hrDocPaymentSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  docType: { type: String, enum: DOC_TYPES, required: true },
  // تاريخُ انتهاء الدورة المدفوعة (YYYY-MM-DD) كما كان في الملفّ ساعةَ الدفع.
  expiryDate: { type: String, required: true, trim: true },

  // لقطةٌ تبقى وإن تغيّر الملفّ — الدفعةُ وثيقةٌ تُقرأ بعد سنة.
  snapshot: {
    name: { type: String, trim: true, default: '' },
    employeeNumber: { type: String, trim: true, default: '' },
    idNumber: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
  },

  // المبلغُ اختياريّ: كثيرٌ من الرسوم تُدفع دفعةً واحدةً عن عدّة موظّفين.
  amount: { type: Number, default: null, min: 0 },
  note: { type: String, trim: true, default: '' },
  files: [fileSchema],

  paidAt: { type: Date, default: Date.now },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidByName: { type: String, trim: true, default: '' },

  voided: { type: Boolean, default: false, index: true },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  voidedByName: { type: String, trim: true, default: '' },
  voidNote: { type: String, trim: true, default: '' },
}, { timestamps: true });

// دفعةٌ ساريةٌ واحدةٌ لكلّ دورة.
hrDocPaymentSchema.index(
  { employee: 1, docType: 1, expiryDate: 1 },
  { unique: true, partialFilterExpression: { voided: false } },
);
hrDocPaymentSchema.index({ paidAt: -1 });

module.exports = mongoose.models.HrDocPayment || mongoose.model('HrDocPayment', hrDocPaymentSchema);
module.exports.DOC_TYPES = DOC_TYPES;
