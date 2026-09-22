/**
 * سعرُ البيع الحقيقيّ — عندنا وحدَنا.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * الكشفُ يأتي من منصّة التشغيل وفيه «سعرُ بيع» يساوي سعرَ الشراء: فريقُ
 * العمليّات هناك لا يعرف ما نأخذه من العميل ولا يجوز أن يعرفه. فالرقمُ الذي
 * تقرؤه إدارتُنا في سير عمل التشغيل ليس بيعَنا — هو شراؤنا مكتوبًا مرّتين.
 *
 * وتصحيحُه في الكشف نفسِه ممنوعٌ من جهتين: المزامنةُ تكتب قيمةَ المنصّة فوقه
 * في كلّ مرور، **وأيُّ تعديلٍ عندنا قد يُدفَع إليها** — فيرى فريقُ منصّةٍ
 * ليست لنا هامشَنا على كلّ حمولة.
 *
 * فالسعرُ الحقيقيّ يُحفَظ هنا: جدولٌ صغيرٌ لا تقرؤه المزامنةُ ولا يُرسَل إلى
 * أحد، مفتاحُه الكشفُ نفسُه. وصفحةُ «التشغيل — خاصّ» تعرض كشوفَ التشغيل كما
 * هي وتستبدل عمودَ البيع بهذا. لا نسخةَ ثانيةً من الكشوف: صفٌّ لرقمٍ واحد.
 *
 * ── ومن أين يأتي الرقم ──────────────────────────────────────────────────────
 *   • تقريرُ الفروع (استيرادٌ لمرّة) — سعرُ البيع الحقيقيّ لما مضى.
 *   • ملفُّ العميل: سعرُ مساره الأحدث، يُطبَّق على كلّ كشفٍ جديدٍ تلقائيًّا.
 *   • ويدُ الموظّف في الصفحة — وهي الأحدث، وتُعلّم ملفَّ العميل بدورها.
 */
const mongoose = require('mongoose');

const privateSellingPriceSchema = new mongoose.Schema({
  // الكشفُ في سير عمل التشغيل. المفتاحُ الحقيقيُّ للصفّ.
  workflow: {
    type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow', required: true, unique: true, index: true,
  },
  // ورقمُه مكتوبٌ كذلك: يُبحَث به ويُقرأ في التصدير بلا ربطٍ ثانٍ.
  reportNumber: { type: String, trim: true, default: '', index: true },

  sellingValue: { type: Number, default: 0 },
  // من أين جاء هذا الرقم: sheet | route | manual
  source: { type: String, trim: true, default: '' },
  // ملاحظةُ من عدّله — «اتُّفق مع العميل على كذا».
  note: { type: String, trim: true, default: '' },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.PrivateSellingPrice
  || mongoose.model('PrivateSellingPrice', privateSellingPriceSchema);
