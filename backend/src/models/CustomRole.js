const mongoose = require('mongoose');

/**
 * نوعُ مستخدمٍ صنعه صاحبُ النظام — دورٌ لا وجودَ له في `config/roles.js`.
 *
 * ── لماذا لا يكفي ما في الشيفرة ────────────────────────────────────────────
 * `config/roles.js` هو الهيكلُ الوظيفيُّ للشركة: لكلّ قسمٍ مديرٌ وموظّف. وهو
 * صحيحٌ ولا يكفي — يجيء من يحتاج «مراجعًا يرى المالَ ولا يكتب فيه»، أو
 * «مشرفًا على المركبات وحدَها»، فلا يجد إلّا أن يُلبَس دورًا يوسّعه أكثرَ ممّا
 * يريد. فيُصنَع الدورُ من الشاشة.
 *
 * ── وكيف يعيش الاثنان معًا ──────────────────────────────────────────────────
 * المفاتيحُ المكتوبةُ في الشيفرة تبقى مرجعًا لمنطقٍ يقرؤها بالاسم (اجتماعاتُ
 * الإدارة تقرأ لاحقةَ `_manager`، والتقاريرُ لها قائمتُها). والدورُ المصنوع
 * **لا يرث شيئًا**: لا قائمةَ `authorize` قديمةً تعرفه، ولا قسمَ افتراضيًّا له.
 * فكلُّ ما يملكه يأتي من مصفوفة الصلاحيّات صراحةً — وهذا هو الأمان: دورٌ
 * جديدٌ يُولَد لا يملك شيئًا، لا يُولَد يملك كلَّ شيء.
 *
 * ولذلك تُمنَع لاحقةُ `_manager` على المفتاح: تقرؤها `businessReview` حرفيًّا
 * فتُجلس صاحبَها مع مجلس الإدارة بلا أن يقصد أحد. راجع config/roles.js.
 */
const customRoleSchema = new mongoose.Schema(
  {
    // مفتاحٌ لاتينيٌّ صغير — هو ما يُخزَّن على المستخدم وما يُقرأ في الشيفرة.
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    // وصفٌ اختياريٌّ يُقرأ في شاشة الصلاحيّات: «لماذا صُنع هذا الدور».
    description: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CustomRole', customRoleSchema);
