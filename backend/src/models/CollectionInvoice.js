/**
 * فاتورةُ التحصيل — سجلُّ الفواتير الذي يعمل عليه قسمُ التحصيل.
 *
 * ── ولماذا مجموعةٌ بذاتها لا اشتقاقٌ من كشوف التشغيل ──────────────────────
 * بُنيت صفحاتُ التحصيل أوّلًا على كشوف التشغيل: الكشفُ هو المستند، والفاتورةُ
 * خانةٌ فيه. وقِيس ذلك على دفتر التحصيل الحقيقيّ فبان أنّه لا يكفي:
 *
 *   في دفترهم ٩٣٧٥ رقمَ فاتورةٍ ترجع إلى ٢٠٢٢، وفي كشوفنا ٥٦٠ منها فقط.
 *
 * ستّةٌ في المئة. فالفاتورةُ تعيش قبل الكشف وبعده وبدونه — فواتيرُ سنواتٍ لا
 * كشوفَ لها عندنا، وفواتيرُ تجمع كشوفًا عدّة. واشتقاقُها من الكشوف يعني أن
 * أربعةً وتسعين في المئة من عمل التحصيل لا مكانَ له في النظام.
 *
 * فالفاتورةُ مستندٌ قائمٌ بنفسه، والكشفُ يُنسَب إليها حين يوجد — لا العكس.
 *
 * ── والأيّامُ تُحسب ولا تُخزَّن ─────────────────────────────────────────────
 * «كم يومًا من الفوترة إلى التسليم» و«من التسليم إلى التحصيل» و«كم بقي على
 * الاستحقاق» كلُّها فروقُ تواريخَ. تُحسب عند القراءة من التواريخ نفسِها، فلا
 * يبقى في القاعدة رقمٌ يصدق يومَ كُتب ويكذب في اليوم التالي.
 */
const mongoose = require('mongoose');

const collectionInvoiceSchema = new mongoose.Schema({
  // ── الهويّة ───────────────────────────────────────────────────────────────
  invoiceNumber: { type: String, trim: true, required: true, index: true },
  // نقديّةٌ أم ضريبيّة — وهي صفةُ العميل تنعكس على فاتورته.
  kind: { type: String, enum: ['tax', 'cash'], default: 'tax', index: true },

  // ── صاحبُها ───────────────────────────────────────────────────────────────
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', index: true },
  partyCode: { type: String, trim: true, default: '', index: true },
  partyName: { type: String, trim: true, default: '' },

  // ── المال ────────────────────────────────────────────────────────────────
  total: { type: Number, default: 0 },

  // ── التواريخُ الثلاثة التي عليها يقوم كلُّ تحليل ──────────────────────────
  // متى فُوتِرت، ومتى وصلت العميلَ، ومتى حُصّلت. والمدّةُ المتّفق عليها تُعَدّ
  // من التسليم لا من الإصدار.
  invoiceDate: { type: Date, index: true },
  deliveryDate: { type: Date, index: true },
  collectionDate: { type: Date, index: true },
  exitDate: { type: Date },

  status: { type: String, trim: true, default: '', index: true }, // Collected / Delivered / ''
  comments: { type: String, trim: true, default: '' },

  // ── وكشوفُ التشغيل التي تحتها ────────────────────────────────────────────
  // فاتورةٌ واحدةٌ قد تجمع كشوفًا عدّة. تُملأ من رقم الفاتورة المكتوب على
  // الكشف، وتبقى فارغةً لفواتيرِ ما قبل النظام — وهو أكثرُها.
  reportNumbers: [{ type: String, trim: true }],

  source: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// فاتورةٌ واحدةٌ بالرقم الواحد لكلّ نوع: الضريبيُّ والنقديُّ سلسلتان مختلفتان.
collectionInvoiceSchema.index({ kind: 1, invoiceNumber: 1 }, { unique: true });
collectionInvoiceSchema.index({ party: 1, status: 1 });
collectionInvoiceSchema.index({ status: 1, deliveryDate: -1 });
collectionInvoiceSchema.index({ partyCode: 1, invoiceDate: -1 });

module.exports = mongoose.models.CollectionInvoice
  || mongoose.model('CollectionInvoice', collectionInvoiceSchema);
