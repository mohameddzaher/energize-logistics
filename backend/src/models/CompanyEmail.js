const mongoose = require('mongoose');

/**
 * بريد الشركة — صناديق البريد المُنشأة على هوستنجر (@energize-logistics.com).
 *
 * ⚠️ ده **مش** حساب الدخول للسيستم. حساب السيستم في `User` وباسووردته hash
 * ومحدش يقدر يقراها. الحاجة دي حاجة تانية خالص: صندوق بريد بيتعمل يدويًا على
 * هوستنجر عشان الموظف يراسل بيه العملاء برّه، وتقنية المعلومات محتاجة تفضل
 * عارفة كلمة مروره عشان تسلّمها له أو تظبط له البرنامج. الاتنين ممكن يكونوا
 * لنفس الشخص وبكلمتين مرور مختلفتين تمامًا، ومحدش منهم بيأثر على التاني.
 *
 * الربط بالموظف اختياري عن قصد: الإيميل بيتعمل أول ما الموظف يستلم، وممكن يبقى
 * لسه مش متسجّل في الموارد البشرية. بيتسجّل من غير ربط ويتربط بعدين.
 */
const companyEmailSchema = new mongoose.Schema({
  email: {
    type: String, required: true, unique: true, trim: true, lowercase: true, index: true,
  },
  localPart: { type: String, default: '', trim: true },   // الجزء قبل @
  domain: { type: String, default: 'energize-logistics.com', trim: true, lowercase: true, index: true },

  // الاسم زي ما هو مكتوب في قائمة البريد (ممكن يكون عربي ومختصر: «أ. سامح حسن»).
  displayName: { type: String, default: '', trim: true, index: true },

  // ── الربط بالموارد البشرية (اختياري) ────────────────────────────────────────
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
  employeeNumber: { type: String, default: '', trim: true, index: true }, // لقطة وقت الربط
  employeeName: { type: String, default: '', trim: true },
  department: { type: String, default: '', trim: true },

  // شخصي (لموظف) أو وظيفي (info@ / sales@ … مش لشخص بعينه).
  mailboxType: { type: String, enum: ['personal', 'functional'], default: 'personal', index: true },
  functionAr: { type: String, default: '', trim: true },  // وظيفة الصندوق لو functional

  status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active', index: true },

  // ── كلمة المرور ─────────────────────────────────────────────────────────────
  // مشفّرة بـ AES-256-GCM (utils/secretVault) — لازم تكون قابلة للاسترجاع لأن
  // تقنية المعلومات بتسلّمها للموظف، فالهاش مش هيفيد. `select: false` عشان أي
  // استعلام عادي ما يجيبهاش بالغلط.
  passwordEnc: { type: String, default: '', select: false },
  passwordSetAt: { type: Date, default: null },
  passwordSetByName: { type: String, default: '', trim: true },

  notes: { type: String, default: '', trim: true },
  createdByName: { type: String, default: '', trim: true },
  updatedByName: { type: String, default: '', trim: true },

  // مين شاف كلمة المرور وامتى — الكشف حدث يتسجّل، مش استعلام عادي.
  lastRevealedAt: { type: Date, default: null },
  lastRevealedByName: { type: String, default: '', trim: true },
  revealCount: { type: Number, default: 0 },
}, { timestamps: true });

companyEmailSchema.index({ displayName: 1, email: 1 });
companyEmailSchema.index({ employee: 1, status: 1 });

// الدومين والجزء المحلي مشتقّين من الإيميل — نحسبهم مرة واحدة هنا بدل ما كل
// استدعاء يفصل السلسلة بنفسه ويختلف عن التاني.
companyEmailSchema.pre('save', function normalise(next) {
  if (this.email) {
    this.email = String(this.email).trim().toLowerCase();
    const at = this.email.lastIndexOf('@');
    if (at > 0) {
      this.localPart = this.email.slice(0, at);
      this.domain = this.email.slice(at + 1);
    }
  }
  next();
});

module.exports = mongoose.models.CompanyEmail || mongoose.model('CompanyEmail', companyEmailSchema);
