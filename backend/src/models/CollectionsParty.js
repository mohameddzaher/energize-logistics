/**
 * أطرافُ التحصيل — العملاءُ الذين نحصّل منهم، والموردون الذين نسدّد لهم.
 *
 * ── لماذا سجلٌّ لا اسمٌ في الكشف ───────────────────────────────────────────
 * اسمُ العميل ومالكِ السيارة مكتوبان نصًّا في كلّ كشفٍ من كشوف التشغيل. فمن
 * أراد أن يعرف «كم لنا عند هذا العميل» جمعَ صفوفَه بعينه، ومن كُتب اسمُه
 * بصيغتين صار طرفين لا يجتمعان — و«شركة تنشيط للخدمات اللوجستية» و«…اللوچستية»
 * موردٌ واحدٌ في ٦٤٨٨ كشفًا يُقرأ ٤٥٢٨ و١٩٦٠.
 *
 * فالسجلُّ هنا هو ما يجمع صفوفَ الطرف الواحد، ويحمل ما لا موضعَ له في الكشف
 * أصلًا: شروطُ السداد، وحالةُ التحصيل، ومسؤولُ المتابعة، وبيانُ التواصل الذي
 * يُتَّصل به فعلًا.
 *
 * ── والنوعان في مجموعةٍ واحدة ──────────────────────────────────────────────
 * البنيةُ واحدة (اسمٌ، تواصلٌ، شروطُ سدادٍ، رصيد) والفرقُ اتّجاهُ المال: العميل
 * يدفع لنا والموردُ ندفع له. ومجموعتان بحقولٍ متطابقةٍ تعني كتابةَ كلّ شيءٍ
 * مرّتين ثمّ إصلاحَ العطل في إحداهما ونسيانَ الأخرى.
 */
const mongoose = require('mongoose');

/**
 * الاسمُ مطويًّا — وهو مفتاحُ الربط بكشوف التشغيل.
 *
 * الحروفُ المعرَّبةُ (چ گ ڤ پ) مطويّةٌ هنا عن قصد: كُتبت في البيانات الحقيقيّة
 * مكانَ نظائرها العربيّة، وبدونها يبقى المورّدُ الأكبرُ عندنا مقسومًا صفّين.
 */
const fold = (v) => String(v || '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/چ/g, 'ج').replace(/گ/g, 'ك').replace(/ڤ/g, 'ف').replace(/پ/g, 'ب')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const collectionsPartySchema = new mongoose.Schema({
  kind: { type: String, enum: ['customer', 'supplier'], required: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  nameKey: { type: String, index: true },

  // ── التواصل ───────────────────────────────────────────────────────────────
  // مَن يُتَّصل به في شأن فاتورة ليس بالضرورة مَن وقّع العقد. الحقولُ الثلاثة
  // مفصولةٌ لأنّ الاتّصال بالمالك في شأن سندٍ يضيّع يومًا.
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  contactPerson: { type: String, trim: true, default: '' },
  contactPhone: { type: String, trim: true, default: '' },
  accountantName: { type: String, trim: true, default: '' },
  accountantPhone: { type: String, trim: true, default: '' },

  // ── الهويّة التجاريّة ─────────────────────────────────────────────────────
  commercialRegister: { type: String, trim: true, default: '' },
  taxNumber: { type: String, trim: true, default: '' },
  iban: { type: String, trim: true, default: '' },
  bankName: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  partyType: { type: String, trim: true, default: '' },

  // ── الكودُ المحاسبيُّ — هويّةُ الحساب ──────────────────────────────────────
  // الاسمُ يُكتب بصورٍ شتّى وتتغيّر صيغتُه الرسميّة، والكودُ لا يتغيّر. وهو ما
  // يُقرأ به الحسابُ في دفاتر المحاسبة، فصار هو المفتاح لا الاسم.
  //
  // وسياقتُه من الواقع: الضريبيُّ رقمٌ من سلسلة `1104xxxx`، والنقديُّ `C####`.
  // فمَن أُضيف جديدًا يأخذ التاليَ في سلسلة نوعِه من نفسِه.
  code: { type: String, trim: true, default: '' },

  // ── وأسماؤه الأخرى ────────────────────────────────────────────────────────
  // اسمُ الحساب في المحاسبة غيرُ الاسم الذي يُكتب في كشف التشغيل: «شركة صليهم
  // سعيد الهاجري للنقليات» و«شركه صليهم الهاجري» حسابٌ واحد. فتُحفظ الصيغُ
  // الأخرى هنا مطويّةً، ويُقرأ بها الكشفُ إلى حسابه بدل أن يصير حسابين.
  aliases: [{ type: String, trim: true }],
  aliasKeys: [{ type: String, index: true }],

  // ── بياناتُ الحساب في سجلّ التحصيل ────────────────────────────────────────
  collectionOfficer: { type: String, trim: true, default: '', index: true }, // موظّفُ التحصيل المسؤول
  officer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },            // حين يُربط باسمٍ في النظام
  hoLocation: { type: String, trim: true, default: '', index: true },        // فرعُ العميل
  grade: { type: String, trim: true, default: '', index: true },             // A1 … C3
  salesManagers: [{ type: String, trim: true }],                             // قد يتعامل معه أكثرُ من مندوب
  department: { type: String, trim: true, default: '', index: true },        // Branches / Fleet / Customs Clearance
  region: { type: String, trim: true, default: '' },                         // Central / Western / …
  // ── مدّةُ السداد المتّفق عليها ────────────────────────────────────────────
  // تُعَدّ **من تاريخ تسليم الفاتورة** لا من تاريخ إصدارها: العميلُ لا يبدأ
  // عدَّ أيّامه قبل أن تصله الفاتورة.
  creditDays: { type: Number, default: 0 },

  // ── نوعُ حساب العميل — لا قاعدةٌ على شحناته ───────────────────────────────
  //
  // يقول في أيّ دفترٍ يجلس هذا **الحساب**: النقديُّ في سجلّ الكاش بكودٍ `C####`،
  // والضريبيُّ في سجلّ الضريبيّ بكودٍ `1104####`. ومنه يُولَّد الكودُ ويُفلتَر
  // سجلُّ الأعمار.
  //
  // ولا يُستنتَج منه نوعُ دفعِ كشفٍ بعينه. جُرِّب ذلك فبان خطؤه: العميلُ الواحد
  // يقول في حمولةٍ «حاسبوني كاش» وفي أخرى «افتحوا فاتورة» — فالنوعُ صفةُ
  // الشحنة لا صفةُ الطرف. والاستنتاجُ كان يكتب على الكشف ما لم يقله أحد.
  //
  // والدليلُ في البيانات نفسِها: سبعةَ عشرَ عميلًا تقول عنهم ورقةُ «نوع الدفع»
  // ضريبيّون ويجلسون في دفتر الكاش بأكوادِ `C` — وكلا القولين صحيح، لأنّهم
  // يتعاملون بالوجهين.
  //
  // ونوعُ الكشف مكتوبٌ على الكشف نفسِه، فيُعرَف بعد سنةٍ أيُّ حمولاتِ هذا
  // العميل كانت نقدًا وأيُّها فاتورة.
  paymentType: { type: String, enum: ['', 'cash', 'tax'], default: '' },

  // ── شروطُ التحصيل ────────────────────────────────────────────────────────
  paymentTerms: { type: String, trim: true, default: '' },
  creditLimit: { type: Number, default: 0 },
  // حالةُ التحصيل قرارٌ بشريٌّ لا مشتقٌّ من الأرقام: عميلٌ متأخّرٌ اتُّفق معه
  // على جدولةٍ ليس متعثّرًا، والرقمُ وحدَه لا يعرف الفرق.
  status: { type: String, trim: true, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastContactAt: { type: Date },
  nextFollowUpAt: { type: Date },
  notes: { type: String, trim: true, default: '' },

  isActive: { type: Boolean, default: true, index: true },
  // مِن أين جاء السجلّ أوّلَ مرّة — كشوفُ التشغيل أم أحدُ السجلّات القائمة.
  // يُقرأ حين يُسأل «ومن أضاف هذا؟» بعد شهر.
  source: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

collectionsPartySchema.pre('save', function preSave(next) {
  this.nameKey = fold(this.name);
  // الصيغُ الأخرى تُطوى مثلَ الاسم، فيُقرأ بها الكشفُ إلى حسابه.
  if (Array.isArray(this.aliases)) {
    this.aliasKeys = [...new Set(this.aliases.map(fold).filter(Boolean))];
  }
  next();
});
collectionsPartySchema.pre('findOneAndUpdate', function preUpd(next) {
  const u = this.getUpdate() || {};
  const name = (u.$set && u.$set.name) || u.name;
  if (name) { u.$set = u.$set || {}; u.$set.nameKey = fold(name); this.setUpdate(u); }
  next();
});

// ── طرفٌ واحدٌ بالاسم الواحد — إلّا أن يكونا حسابين ────────────────────────
// كان الشرطُ (الجهة + الاسم)، وهو صوابٌ ما دام الاسمُ هو الهويّة. ثمّ دخل
// الكود، وبان في الدفتر أنّ الشركة الواحدة قد تحمل حسابين: «شركة المنشور
// الذهبي» لها ١١٠٤٠٢٢٦ ضريبيٌّ وC0011 نقديّ — تتعامل معنا بالوجهين، ولكلٍّ
// رصيدُه ومدّةُ سداده.
//
// فالشرطُ صار (الجهة + الاسم + الكود): حسابان بالاسم نفسِه يجتمعان إن اختلف
// كوداهما، ومَن لا كودَ له يبقى محكومًا بالقديم تمامًا — كودُه الفارغ يساوي
// الفارغ، فلا يدخل عميلان بلا كودٍ بالاسم الواحد كما كان.
collectionsPartySchema.index({ kind: 1, nameKey: 1, code: 1 }, { unique: true });
collectionsPartySchema.index({ kind: 1, isActive: 1, name: 1 });
// كودُ الحساب فريدٌ حيث وُجد — ولا يُفرَض على من لا كودَ له بعد.
collectionsPartySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string', $gt: '' } } });
collectionsPartySchema.index({ collectionOfficer: 1, kind: 1 });

module.exports = mongoose.models.CollectionsParty
  || mongoose.model('CollectionsParty', collectionsPartySchema);
module.exports.fold = fold;
