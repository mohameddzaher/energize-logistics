/**
 * بطاقاتُ السائقين — سجلٌّ في قسم المركبات.
 *
 * ── لماذا سجلٌّ مستقلّ ──────────────────────────────────────────────────────
 * بطاقةُ السائق وثيقةٌ تنتهي ويُطالَب بتجديدها، لها رقمُها ونوعُها وسجلُّها
 * اللوجستيّ — والسجلُّ اللوجستيّ هو الذي تُصدَر البطاقةُ تحته، فمركباتُ سجلٍّ
 * لا يقودها إلّا مَن بطاقتُه منه. وهذا الربطُ لا موضعَ له في ملفّ الموظّف.
 *
 * ولقطةُ رقم البطاقة تبقى على الموظّف كما هي (`driverCardNumber` وأخواتها) —
 * تقرؤها شاشاتُ الموارد البشريّة — وهذا هو السجلُّ الذي يُدار ويُجدَّد منه.
 */
const mongoose = require('mongoose');

const driverCardSchema = new mongoose.Schema({
  // رقمُ الهويّة هو المفتاح: هو ما في الشيت وما يُبحَث به.
  idNumber: { type: String, required: true, trim: true, unique: true, index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
  name: { type: String, trim: true, default: '', index: true },
  dateOfBirth: { type: String, default: '' },        // YYYY-MM-DD
  absherPhone: { type: String, trim: true, default: '' },
  // السجلُّ اللوجستيّ الذي صدرت تحته البطاقة — رقمٌ تُجمَّع به البطاقاتُ
  // وتُطابَق بسجلّات المركبات التجاريّة.
  logisticRegister: { type: String, trim: true, default: '', index: true },
  cardNumber: { type: String, trim: true, default: '', index: true },
  cardType: { type: String, trim: true, default: '' },   // سنوية / مقيدة
  /**
   * ── نوعُ النقل الذي تُخوِّله هذه البطاقة ────────────────────────────────────
   * كان يُشتَقّ من نوع تسجيل المركبات المفوَّضة له وحدَه — وهو اشتقاقٌ صحيحٌ لمن
   * بيده مركبة، لكنّه لا يقول شيئًا عمّن أُصدرت بطاقتُه ولم يُسنَد إليه بعد:
   * يُنشَأ الصفُّ فيُقرأ «بلا تفويض» وهو سائقُ نقلٍ ثقيلٍ بالورقة.
   *
   * فصار يُكتب عند الإنشاء، والمشتقُّ يملأ الفارغَ ولا يغلب المكتوب: ما على
   * الورقة أصدقُ من استنتاجٍ عن مركبةٍ قد تُبدَّل غدًا.
   */
  transportTypeAr: { type: String, trim: true, default: '', index: true },
  expiryDate: { type: String, default: '', index: true }, // YYYY-MM-DD
  notes: { type: String, trim: true, default: '' },

  /**
   * ── سجلُّ تجديداتِ البطاقة ────────────────────────────────────────────────
   * نافذةُ التجديد واحدةٌ لكلّ مستندات القسم، وتسأل عن التكلفة ورقم الإيصال
   * وملاحظة. ومستنداتُ المركبة تحفظها في `VehicleMaster.renewals`، أمّا صفوفُ
   * بطاقات السائقين فلم يكن لها موضعٌ تُحفَظ فيه: يُقرأ `newExpiry` ويُرمى
   * الباقي بلا خبر. فكانت الشاشةُ تسأل عمّا لا يمكن حفظُه.
   *
   * وهو سجلٌّ لازمٌ في ذاته: البطاقةُ تُجدَّد كلَّ سنةٍ برقمٍ جديدٍ أحيانًا،
   * والرقمُ القديم يبقى مذكورًا في أوراقٍ سابقة — فالسلسلةُ تُقرأ إلى الوراء
   * كما تُقرأ في المركبات.
   */
  renewals: [{
    previousExpiry: { type: String, default: '' },
    newExpiry: { type: String, default: '' },
    previousNumber: { type: String, default: '' },
    newNumber: { type: String, default: '' },
    cost: { type: Number, default: null },
    reference: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],

  /**
   * ── خيانة الأمانة ─────────────────────────────────────────────────────────
   *
   * وثيقةُ تأمينٍ تغطّي ما يسرقه السائق ممّا في عهدته. وهي وثيقةٌ واحدةٌ على
   * مستوى الشركة (`CorporatePolicy` باسم «تأمين خيانة الأمانة») — فرقمُها
   * وتاريخُ انتهائها هناك لا هنا، ولا يُنسَخان على كلّ سائقٍ فيفترقان عند أوّل
   * تجديد. الذي يخصّ السائق سؤالٌ واحد: **أهو مشمولٌ بها أم مطلوبٌ ضمُّه؟**
   *
   * وكان الجوابُ في اسم الوثيقة: «تأمين خيانة الأمانة ل 58 سائق». عددٌ في
   * اسمٍ لا يُسأل: أيُّ ثمانيةٍ وخمسين؟ ومَن الذي دخل الشهرَ الماضي وليس فيهم؟
   * فصار العددُ يُعَدُّ من السائقين أنفسِهم.
   *
   *   covered  = «موجود» في الشيت — مشمولٌ بالوثيقة
   *   required = «مطلوب» — يعمل ولم يُضَمّ بعد، وهذا هو الخطر المكشوف
   *   ''       = لم يُسأل عنه بعد
   */
  fidelity: {
    status: { type: String, enum: ['covered', 'required', ''], default: '', index: true },
    // يُملأ فقط إن كان هذا السائقُ على وثيقةٍ غير وثيقة الشركة.
    policyNumber: { type: String, trim: true, default: '' },
    addedDate: { type: String, default: '' },     // YYYY-MM-DD — متى ضُمّ
    notes: { type: String, trim: true, default: '' },
  },

  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/**
 * الأيّامُ حتى الانتهاء — تُحسب ولا تُخزَّن.
 *
 * الشيتُ يحمل عمودًا اسمُه «الأيام المتبقية»، وهو رقمٌ صحيحٌ يومَ كُتب وحدَه:
 * يقلُّ يومًا كلَّ يومٍ ولا يعلم الملفُّ بذلك. فيُحسب عند القراءة من تاريخ
 * الانتهاء، ويبقى صحيحًا بلا تحديث.
 */
driverCardSchema.virtual('daysLeft').get(function daysLeft() {
  if (!this.expiryDate) return null;
  const { startOfDay, todayKey } = require('../utils/companyDay');
  const a = startOfDay(todayKey()); const b = startOfDay(this.expiryDate);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
});
driverCardSchema.set('toJSON', { virtuals: true });
driverCardSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.DriverCard || mongoose.model('DriverCard', driverCardSchema);
