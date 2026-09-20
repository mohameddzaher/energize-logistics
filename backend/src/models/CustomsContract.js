/**
 * عقودُ التخليص — عقدُنا مع عميلٍ أو وكيلِ شحنٍ أو ناقل.
 *
 * ── لماذا هنا لا في قسم العقود ──────────────────────────────────────────────
 * قسمُ «إدارة العقود» يعمل على موردي النقل البرّيّ (3PL) وعملائهم؛ وعقودُ
 * التخليص تخصّ أطرافَ التخليص نفسَها — يُسأل عنها في ملفّ الطرف وفي المعاملة،
 * لا في شاشةٍ أخرى. فتُحفظ هنا ويُقرأ أثرُها في ملفّ الطرف مباشرةً.
 *
 * ── والعقدُ ورقةٌ قبل أن يكون صفًّا ──────────────────────────────────────────
 * فله مرفقاته: الموقَّعُ نفسُه والملاحقُ والسجلّ. والمرفقُ يُخزَّن كما يُخزَّن
 * مرفقُ المعاملة (utils/fileStore) — اسمُه ونوعُه وحجمُه ومَن رفعه.
 */
const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  title: { type: String, default: '' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

const customsContractSchema = new mongoose.Schema({
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', required: true, index: true },
  // دورُ الطرف يُنسَخ هنا ليُفلتَر العقدُ بلا قراءةِ كلّ طرف.
  partyKind: { type: String, enum: ['customer', 'agent', 'carrier'], required: true, index: true },
  partyName: { type: String, trim: true, default: '' },

  title: { type: String, trim: true, required: true },     // «عقد تخليص سنويّ»
  contractNumber: { type: String, trim: true, default: '' },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null, index: true },
  // ── والقيمةُ تُقرأ مع وحدتها ────────────────────────────────────────────
  // «٥٠٠» لا تعني شيئًا وحدَها: أهي للحاوية أم للشهر أم للعقد كلِّه؟
  value: { type: Number, default: null },
  valueBasis: { type: String, enum: ['', 'total', 'per_container', 'per_month', 'per_shipment'], default: '' },
  paymentTermDays: { type: Number, default: 0 },
  autoRenew: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'active', 'expired', 'terminated'], default: 'active', index: true },
  scope: { type: String, trim: true, default: '' },        // ما يغطّيه العقد
  notes: { type: String, trim: true, default: '' },
  attachments: [attachmentSchema],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

customsContractSchema.index({ partyKind: 1, status: 1 });

module.exports = mongoose.models.CustomsContract || mongoose.model('CustomsContract', customsContractSchema);
