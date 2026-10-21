const mongoose = require('mongoose');

/**
 * ── سطرُ فاتورةٍ رُفع من ورقة المبيعات ───────────────────────────────────────
 *
 * «رفع بيانات فواتير» يكتب ما في الورقة على كشوفه ثمّ ينسى الورقة. فما لا كشفَ
 * له يُقال مرّةً في المعاينة ثمّ يضيع، وفاتورةٌ تقول ورقتُها ٤٠٢٥ ومجموعُ كشوفها
 * ٣٥٠٠ لا يعرفها أحدٌ بعد إغلاق النافذة.
 *
 * فيُحفظ كلُّ سطرٍ كما جاء في الورقة — رقمُ الفاتورة، والكشفُ الذي يذكره،
 * وقيمتُه، واسمُ العميل كما كتبه المحاسب — ومَن رفعه ومتى. ومنه تُحسب بطاقاتُ
 * سير العمل الثلاث (كشفٌ غير موجود · فرقُ قيمة · اسمُ عميلٍ مختلف) حيّةً: يُصحَّح
 * الكشفُ فيسقط السطرُ من البطاقة بلا رفعٍ جديد.
 *
 * والسطرُ الواحد = (فاتورة، كشف): الورقةُ التالية التي تذكره تكتب فوقه (الأحدثُ
 * هو الأصحّ — القاعدةُ نفسُها التي يكتب بها الرفعُ على الكشف).
 */
const invoiceUploadLineSchema = new mongoose.Schema({
  invoiceNumber: { type: String, trim: true, required: true },
  reportNumber: { type: String, trim: true, required: true },
  // ما في الورقة: صافي السطر وضريبتُه وإجماليُّه. `total` هو ما يُقارَن.
  net: { type: Number, default: null },
  tax: { type: Number, default: null },
  total: { type: Number, default: null },
  customerName: { type: String, trim: true, default: '' },
  invoiceDate: { type: Date, default: null },

  // الدفعةُ: رفعةٌ واحدة = معرّفٌ واحد، ومعه الملفُّ ومَن رفعه.
  batchId: { type: String, trim: true, index: true },
  fileName: { type: String, trim: true, default: '' },
  sheet: { type: String, trim: true, default: '' },
  sheetRow: { type: Number, default: null },
  uploadedAt: { type: Date, default: Date.now, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

invoiceUploadLineSchema.index({ invoiceNumber: 1, reportNumber: 1 }, { unique: true });
invoiceUploadLineSchema.index({ reportNumber: 1 });

module.exports = mongoose.model('InvoiceUploadLine', invoiceUploadLineSchema);
