const mongoose = require('mongoose');

/**
 * صفٌّ من «تقرير الفروع» — دفترُ مدير التشغيل اليوميّ.
 *
 * ── لماذا يدخل النظامَ سجلًّا ───────────────────────────────────────────────
 * هذا التقريرُ هو الذي يُبنى عليه كلُّ تحليلٍ يُطلَب في القسم، وفيه أعمدةٌ
 * **لا وجودَ لها في كشوف التشغيل عندنا**:
 *   · سببُ عدم التحقيق (السائقُ وجد حمولةً أخرى، الحمولةُ غير جاهزة…)
 *   · نوعُ الإيجار (تحويل آجل / كاش آجل / كاش قدّام)
 *   · نوعُ المورد (مورد / سائقٌ فرديّ / شركةُ تنشيط)
 *   · مندوبُ المبيعات ومندوبُ التشغيل لكلّ حمولة
 *   · وسعرُ البيع الحقيقيّ (منصّةُ التشغيل تكتب البيعَ مساويًا للشراء)
 *
 * وكانت تُقرأ في إكسل فقط. فما لم يكن في النظام لم يكن في أيّ لوحة.
 *
 * ── وصفُّه ليس حمولةً واحدة ────────────────────────────────────────────────
 * `trips` عددُ الطلبات في الصفّ: العميلُ طلب خمسَ عربات على المسار نفسِه في
 * اليوم نفسِه، فسعرُ البيع سعرُ **العربة الواحدة** و`sellTotal` المضروبُ.
 * فمن جمع `sell` بلا ضربٍ أخطأ، ومن عدَّ الصفوفَ رحلاتٍ أخطأ.
 *
 * ── والمصدرُ يُستبدَل كاملًا ────────────────────────────────────────────────
 * الملفُّ يُحدَّث ويُعاد استيرادُه؛ ولا يكتب النظامُ في هذا السجلّ شيئًا. فلا
 * دمجَ ولا مزامنة: يُمسح ويُكتب، ومعه اسمُ الملفّ وتاريخُ الاستيراد.
 */
const branchReportRowSchema = new mongoose.Schema({
  day: { type: String, trim: true, default: '', index: true },   // YYYY-MM-DD
  date: { type: Date, default: null, index: true },
  month: { type: String, trim: true, default: '', index: true }, // YYYY-MM

  branch: { type: String, trim: true, default: '', index: true },
  clientName: { type: String, trim: true, default: '', index: true },
  vendorName: { type: String, trim: true, default: '', index: true },
  vendorType: { type: String, trim: true, default: '', index: true },
  opsRep: { type: String, trim: true, default: '', index: true },
  salesRep: { type: String, trim: true, default: '', index: true },
  rentType: { type: String, trim: true, default: '', index: true },
  payType: { type: String, trim: true, default: '', index: true },  // دفع العميل: ضريبي/كاش
  fromCity: { type: String, trim: true, default: '' },
  toCity: { type: String, trim: true, default: '' },

  trips: { type: Number, default: 0 },      // عدد الطلبات في الصفّ
  achieved: { type: Number, default: 0 },   // عدد المحقق
  failed: { type: Number, default: 0 },     // عدد غير المحقق
  failReason: { type: String, trim: true, default: '', index: true },

  sell: { type: Number, default: 0 },       // سعرُ البيع للعربة الواحدة
  buy: { type: Number, default: 0 },        // سعرُ الشراء للعربة الواحدة
  sellTotal: { type: Number, default: 0 },  // اجمالي البيع كما في الورقة
  buyTotal: { type: Number, default: 0 },   // اجمالي الشراء
  gp: { type: Number, default: 0 },         // الهامش كما في الورقة

  seq: { type: Number, default: 0 },        // تسلسلُ الصفّ في الورقة
  sourceFile: { type: String, trim: true, default: '' },
  importedAt: { type: Date, default: Date.now },
}, { timestamps: false });

branchReportRowSchema.index({ month: 1, branch: 1 });
branchReportRowSchema.index({ date: -1 });

module.exports = mongoose.models.BranchReportRow
  || mongoose.model('BranchReportRow', branchReportRowSchema);
