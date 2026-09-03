const mongoose = require('mongoose');

// ── سجل المركبات الرئيسي (Vehicle Registry) ────────────────────────────────────
// مصدره ماستر Vehicles_2026 — 326 مركبة بهويتها وتصنيفها وكل مستنداتها ذات تاريخ
// الانتهاء (تأمين، بطاقة تشغيل، رخصة سير، فحص، شريحة وقود، GPS). الأيام المتبقية
// وحالة المستند تُحسب runtime من تاريخ الانتهاء — لا تُخزَّن (تبور مع الوقت).
const vehicleMasterSchema = new mongoose.Schema({
  source_row: Number,

  // الهوية
  plateNumber: { type: String, required: true, unique: true, trim: true, index: true },
  // اللوحة بعد توحيد الهمزات وإزالة المسافات — مفتاح الربط بالحوادث، لأن نفس
  // اللوحة بتتكتب «أ س ي» و«ا س ي» في ملفات مختلفة.
  plateKey: { type: String, default: '', index: true },
  plateLettersAr: { type: String, default: '' },
  plateDigits: { type: String, default: '' },
  chassisNumber: { type: String, trim: true, index: true },
  serialNumber: { type: String, default: '' },

  // التصنيف
  sectorAr: { type: String, default: '' },
  sectorCode: { type: String, default: '', index: true }, // heavy_transport / light_transport / …
  registrationTypeAr: { type: String, default: '' },
  registrationTypeCode: { type: String, default: '', index: true },
  brandAr: { type: String, default: '', index: true },
  modelAr: { type: String, default: '' },
  modelYear: { type: Number, default: null, index: true },
  colorAr: { type: String, default: '' },
  colorCode: { type: String, default: '' },

  // الملكية
  ownerNameAr: { type: String, default: '', index: true },
  commercialRegistration: { type: String, default: '' },
  // ── حقول جاءت مع تحديث ملفات القسم ─────────────────────────────────────────
  // الإدارة والمدينة: التصنيف كان بالقطاع وحده، والملف الجديد يفصّل المركبة إلى
  // إدارة (١٣ إدارة) ومدينة — وهما ما يُسأل عنهما فعلًا: «مركبات كيتا في مكة».
  departmentAr: { type: String, default: '', index: true },
  cityAr: { type: String, default: '', index: true },
  // حالة الحيازة: مالك أم مستخدم. شرط من شروط منصّة لوجستي، فلا يصحّ دفنه في نص.
  possessionStatusAr: { type: String, default: '', index: true },
  // ── وهل المركبة تعمل أصلًا؟ ────────────────────────────────────────────────
  // الماستر يقول ذلك في خانتين مختلفتين: «غير مستخدم» مكانَ اسم الإدارة (٦١
  // مركبة)، و«مسروق» مكانَ القطاع (١٥). فيضيع الجوابُ بين عمودين لا يُسأل عنهما
  // بهذا المعنى، ولا تجد الإدارةُ سؤالها الأول — «كم مركبة لا تعمل؟» — في أي
  // شاشة. ستٌّ وسبعون من ثلاثمئة وخمس وثلاثين مركبةً واقفة، ورقمٌ بهذا الحجم
  // لا يجوز أن يُستخرج بقراءة عمودٍ نصّيّ بالعين.
  serviceStatusAr: { type: String, default: '', index: true },
  serviceStatusCode: { type: String, default: '', index: true }, // in_service / idle / stolen
  // المفوَّض بالقيادة كما هو في ملف المركبات (٩١ مركبة). هذا غير تفاويض القسم
  // المسجَّلة على الموظفين — تلك سجل حركة، وهذا لقطة من الملف.
  authorizedPerson: {
    name: { type: String, default: '' },
    iqamaNumber: { type: String, default: '' },
    jobTitleAr: { type: String, default: '' },
    // ── والتفويض ورقةٌ لها رقمٌ ومدّة، لا اسمُ سائقٍ فحسب ────────────────────
    // كان يُحفَظ الاسم وحده، فلا يُعرَف بأيّ تفويضٍ يقود ولا إلى متى. ونهايته
    // هي بيت القصيد: بعدها يقود السائق بلا صفة، فتُقيَّد المخالفة على الشركة
    // وتُنازِع شركةُ التأمين في التغطية. ولهذا صار `expiryDate` مستندًا كامل
    // الحقوق في config/vehicleDocuments — له عتبة تنبيه وشاشة انتهاءات وتجديد.
    authorizationNumber: { type: String, default: '' },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null, index: true },
    // سببُ غياب التفويض حين لا تاريخ له: مطلوب / غير مطلوب / لا يوجد.
    statusCode: { type: String, default: '', index: true },
  },
  // نواقص منصّة لوجستي: ما الذي يمنع هذه المركبة من استيفاء شروط المنصّة، مكتوبًا
  // شرطًا شرطًا. قائمة عمل لا وصفًا: كل سطر فيها بند يُغلَق.
  logistiGaps: { type: [String], default: [], index: true },
  // ── نواقص البيانات، بندًا بندًا وبسببه ──────────────────────────────────────
  // «لا يوجد» و«مطلوب» و«لدى البنك» ثلاثة أوضاع مختلفة تمامًا: الأول نقص،
  // والثاني عملٌ مطلوب، والثالث ليس نقصًا أصلًا — الورقة موجودة عند المموِّل.
  // خلطُها في «ناقص» واحد يجعل الرقم الذي ينظر إليه المدير بلا معنى.
  missingItems: [{
    item: { type: String, default: '' },      // «بطاقة التشغيل»
    docKey: { type: String, default: '' },    // operatingCard
    reason: { type: String, default: '' },    // none | required | with_bank | …
  }],
  // الوثيقة التي تؤمِّن هذه المركبة — سجلّ واحد تشير إليه مئات المركبات.
  insurancePolicy: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleInsurancePolicy', default: null, index: true },
  tamStatusAr: { type: String, default: '' },
  tamStatusCode: { type: String, default: '' }, // owner / user / none

  // ── المستندات ذات تاريخ انتهاء ────────────────────────────────────────────
  // كل مستند له، غير التاريخ، حالتين مختلفتين تمامًا وبيتخلط بينهم:
  //   `statusCode`   ليه مفيش تاريخ؟  none | required | not_required | unknown |
  //                  held_by_third_party  — ده وضع إداري بيتسجّل يدويًا.
  //   `documentState` التاريخ ده معناه إيه دلوقتي؟ valid | warning | critical |
  //                  expired | missing | not_applicable — **محسوبة** من التاريخ
  //                  وعتبة التنبيه، مش مخزّنة، لأنها بتتغيّر كل يوم لوحدها.
  // «غير مطلوب» مش نقص بيانات — دي حالة سليمة، ولازم تتعدّ لوحدها.
  insurance: {
    policyNumber: { type: String, default: '' },
    companyAr: { type: String, default: '', index: true },
    coverageTypeAr: { type: String, default: '' },
    coverageTypeCode: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    premiumSar: { type: Number, default: null },
    // ── ولا قيمةَ قسطٍ ليست بالضرورة نقصًا ──────────────────────────────────
    // الماستر يكتب مكان الرقم أحيانًا «ملكية بنك الراجحي» أو «ملكية شركة الجبر»:
    // القسط موجود ويدفعه المموِّل، لا قسط مجهول. تفريغُ الخانة وحده يجعل المركبة
    // تُعدّ «بلا تأمين» في تقرير المدير المالي وهي مؤمَّنة، فالنصّ يبقى هنا.
    premiumStatusAr: { type: String, default: '', index: true },
    status: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true },
  },

  // شريحة الوقود (بترو اب)
  fuelCard: {
    // اللوحة كما تظهر على فاتورة الوقود — تختلف كتابتها عن لوحة المركبة، وهي
    // المفتاح الوحيد لمطابقة الفاتورة بالمركبة.
    plateOnInvoiceAr: { type: String, default: '' },
    provider: { type: String, default: '' },
    cardNumber: { type: String, default: '' },
    statusAr: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true }, // active / inactive / …
    consumptionTypeAr: { type: String, default: '' },
    consumptionTypeCode: { type: String, default: '' },
    limitSar: { type: Number, default: null },
    limitStatus: { type: String, default: '' }, // open = بدون سقف
  },

  // GPS (الهيكل موجود، البيانات غالبًا فاضية)
  gps: {
    // حالة الجهاز نفسه (نشط / غير نشط / مسروق) — غير حالة الاشتراك.
    deviceStatusAr: { type: String, default: '', index: true },
    deviceId: { type: String, default: '' },
    deviceModel: { type: String, default: '' },
    simNumber: { type: String, default: '' },
    serialImei: { type: String, default: '' },
    provider: { type: String, default: '', index: true },
    status: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true }, // active/inactive/required/not_required/stolen
    expiryDate: { type: Date, default: null, index: true }, // انتهاء الاشتراك
  },

  // بطاقة التشغيل
  operatingCard: {
    cardNumber: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    statusCode: { type: String, default: '', index: true },
  },

  // رخصة السير
  vehicleLicense: {
    expiryDateHijri: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    statusCode: { type: String, default: '', index: true },
  },

  // الفحص الدوري
  inspection: {
    expiryDateHijri: { type: String, default: '' },
    statusAr: { type: String, default: '' },
    statusCode: { type: String, default: '', index: true }, // passed / none / with_bank / …
    expiryDate: { type: Date, default: null, index: true },
  },

  // ── سجل التجديدات ─────────────────────────────────────────────────────────
  // «جدّدتها لغاية امتى وبكام؟» سؤال بيتسأل كتير، والإجابة لازم تفضل موجودة حتى
  // بعد التجديد اللي بعده. كل تجديد بيتقيّد هنا بالتاريخ القديم والجديد ومين عمله.
  renewals: [{
    document: { type: String, required: true },   // insurance | operatingCard | …
    previousExpiry: { type: Date, default: null },
    newExpiry: { type: Date, required: true },
    // ── ورقمُ المستند نفسه، قبلَ التجديد وبعده ────────────────────────────
    // بطاقة التشغيل تخرج من التجديد برقمٍ جديد، وكذلك التفويض أحيانًا. وحين
    // يُستبدل الرقم في خانته لا يبقى للرقم القديم أثر في أي مكان — فالمخالفة
    // المقيَّدة على البطاقة السابقة، والفاتورة المحرَّرة باسمها، يصيران بلا
    // مركبةٍ يُنسبان إليها. القيد هنا هو ما يجعل السلسلة تُقرأ إلى الوراء.
    previousNumber: { type: String, default: '' },
    newNumber: { type: String, default: '' },
    // بدايةُ المستند حين يكون له بداية (التفويض): تُجدَّد معه، والسجلّ يحمل
    // القديمة والجديدة كما يحمل تاريخَي الانتهاء.
    previousStart: { type: Date, default: null },
    newStart: { type: Date, default: null },
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },     // رقم الإيصال/سند الصرف
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],

  accidentCount: { type: Number, default: 0, index: true },

  notesAr: { type: String, default: '' },
  // ── متى لمسها الاستيراد آخر مرة ────────────────────────────────────────────
  // بها وحدها يُعرَف عملُ الإنسان من عمل الملف: `updatedAt` أحدثُ من هذه يعني
  // أن أحدًا فتح المركبة على الشاشة بعد آخر استيراد. وحينئذٍ لا يجوز لخانةٍ
  // فارغة في الشيت أن تمحو ما كتبه — الشيت لقطةٌ من ورق، ومن فتح الشاشة كان
  // ينظر إلى المركبة. بدونها يدوس كل استيرادٍ على كل تصحيحٍ يدويّ في صمت.
  lastImportAt: { type: Date, default: null },
  sourceFile: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// (تواريخ انتهاء المستندات مفهرسة عبر index:true على حقولها أعلاه.)

// ── أرقامٌ لا تتكرّر ─────────────────────────────────────────────────────────
//
// بطاقة التشغيل ورقة رسميّة لها رقمٌ واحد لا يحمله غيرها؛ وكذلك رقم الهيكل
// والرقم التسلسلي وسريال جهاز التتبّع وشريحة الوقود ورقم التفويض. وإدخالُ
// الرقم نفسه على مركبتين لا يكون إلّا خطأً — نسخًا من صفٍّ سابق أو إدخالًا
// مزدوجًا — ثم لا يُكتشف: تنتهي البطاقة فيظهر تنبيهٌ على مركبتين إحداهما لا
// بطاقة لها أصلًا، ويُجدَّد ما لا يحتاج تجديدًا.
//
// و**رقم وثيقة التأمين ليس منها**: وثيقةٌ واحدة تغطّي أسطولًا كاملًا — ١٩٨
// مركبةً تحمل الرقم نفسه اليوم — فجعلُه فريدًا يمنع إدخال الحقيقة.
//
// والفهرس جزئيّ (`$gt: ''`) كي لا تتصادم الخانات الفارغة: مئةُ مركبةٍ بلا
// بطاقة تشغيلٍ بعد ليست مئةَ تكرار.
const NON_EMPTY = (field) => ({ [field]: { $gt: '' } });
for (const f of [
  'chassisNumber', 'serialNumber',
  'operatingCard.cardNumber', 'gps.serialImei',
  'fuelCard.cardNumber', 'authorizedPerson.authorizationNumber',
]) {
  vehicleMasterSchema.index({ [f]: 1 }, { unique: true, partialFilterExpression: NON_EMPTY(f) });
}

// ── إعدادات القسم: عتبات التنبيه لكل مستند ─────────────────────────────────────
// المستخدم يحدد: أنبهني قبل انتهاء التأمين بـ 60 يوم، بطاقة التشغيل بـ 30 يوم … إلخ.
const vehicleRegistryConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'vehicle-registry', unique: true },
  // عتبة التنبيه لكل مستند: «نبّهني قبل انتهاء التأمين بـ ٦٠ يوم». المستخدم
  // بيغيّرها من صفحة الإعدادات، و`critical` هي العتبة الحمرا اللي بعدها الموضوع
  // مستعجل مش تنبيه.
  alerts: {
    insurance: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 15 }, soonDays: { type: Number, default: 90 } },
    operatingCard: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    vehicleLicense: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    inspection: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    gps: { enabled: { type: Boolean, default: false }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 }, soonDays: { type: Number, default: 90 } },
    // التفويض ينتهي فجأةً ولا يُستخرج بديلُه في يوم — فعتبته أوسع من بطاقة التشغيل.
    authorization: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 45 }, criticalDays: { type: Number, default: 15 }, soonDays: { type: Number, default: 90 } },
    corporatePolicy: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 30 }, soonDays: { type: Number, default: 90 } },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── وثائق التأمين على مستوى الشركة ──────────────────────────────────────────
// مش مربوطة بمركبة (تأمين بضائع، خيانة أمانة). ليها تاريخ انتهاء زي أي مستند
// تاني، فبتظهر في نفس شاشة الانتهاءات — انتهاؤها بيوقّف الشغل كله مش عربية.
// ── وثيقة تأمين تغطّي عدة مركبات ─────────────────────────────────────────────
//
// ٤٩ وثيقة تغطّي ٣٣٥ مركبة: وثيقة واحدة قد تحمل ٢٣٩ مركبة. كانت مخزَّنة نسخةً
// على كل مركبة، فتجديدها يعني فتح ٢٣٩ مركبة واحدةً واحدة — وأي مركبة تُنسى
// تبقى في الشاشة «منتهية» وهي مؤمَّنة فعلًا.
//
// هنا الوثيقة سجلّ واحد، والمركبات تشير إليه. تجديدها يمسّ الجميع دفعة واحدة،
// ويبقى على كل مركبة تاريخها لأن الشاشات والتنبيهات تقرأ من المركبة.
const vehicleInsurancePolicySchema = new mongoose.Schema({
  policyNumber: { type: String, required: true, unique: true, trim: true, index: true },
  companyAr: { type: String, default: '', index: true },
  coverageTypeAr: { type: String, default: '' },
  expiryDate: { type: Date, default: null, index: true },
  // إجمالي قسط الوثيقة كما في الملف — لا مجموع أقساط المركبات، فقد يختلفان.
  totalPremiumSar: { type: Number, default: null },
  vehicleCount: { type: Number, default: 0 },
  notesAr: { type: String, default: '' },
  renewals: [{
    previousExpiry: { type: Date, default: null },
    newExpiry: { type: Date, required: true },
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    vehiclesUpdated: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

const corporatePolicySchema = new mongoose.Schema({
  scopeAr: { type: String, default: '', index: true },
  policyholderAr: { type: String, default: '' },
  policyNumbers: { type: [String], default: [] },
  companyAr: { type: String, default: '' },
  startDate: { type: Date, default: null },
  expiryDate: { type: Date, default: null, index: true },
  premiumSar: { type: Number, default: null },

  // ── ووثيقةٌ تُشترى بالرأس ──────────────────────────────────────────────────
  //
  // خيانةُ الأمانة تُسعَّر لكلّ سائقٍ سنويًّا (١١٨٦٫٥٠)، والمكتوبُ في الوثيقة
  // إجماليٌّ صحيحٌ يومَ كُتب ويكذب في اليوم التالي: يدخل سائقٌ فيزيد، ويخرج
  // فينقص. وكان اسمُ الوثيقة نفسُه «تأمين خيانة الأمانة ل 58 سائق» — عددٌ في
  // اسمٍ لا يُسأل: أيُّ ثمانيةٍ وخمسين؟ ومَن دخل الشهرَ الماضي وليس فيهم؟
  //
  // فيُخزَّن السعرُ للرأس، ويُحسب الإجماليُّ من عدد المشمولين فعلًا. ومَن أراد
  // إجماليًّا مقطوعًا يكتبه في `premiumSar` ويبقى هو المعروض.
  premiumPerPersonSar: { type: Number, default: null },

  // ── ومَن تغطّيهم ──────────────────────────────────────────────────────────
  // لا تُنسَخ قائمةُ السائقين هنا: هي في `DriverCard.fidelity.status`، ونسخُها
  // يعني سجلَّين يفترقان عند أوّل إضافة. هذا العَلَم يقول للشاشة فقط: اعرض
  // لهذه الوثيقة لوحةَ السائقين المشمولين، والإضافةُ والحذفُ يكتبان في البطاقة.
  coversDrivers: { type: Boolean, default: false },
  notesAr2: { type: String, default: '' },
  statusAr: { type: String, default: '' },
  statusCode: { type: String, default: '' },
  notesAr: { type: String, default: '' },
  renewals: [{
    previousExpiry: { type: Date, default: null },
    newExpiry: { type: Date, required: true },
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = {
  VehicleMaster: mongoose.models.VehicleMaster || mongoose.model('VehicleMaster', vehicleMasterSchema),
  VehicleRegistryConfig: mongoose.models.VehicleRegistryConfig || mongoose.model('VehicleRegistryConfig', vehicleRegistryConfigSchema),
  CorporatePolicy: mongoose.models.CorporatePolicy || mongoose.model('CorporatePolicy', corporatePolicySchema),
  VehicleInsurancePolicy: mongoose.models.VehicleInsurancePolicy
    || mongoose.model('VehicleInsurancePolicy', vehicleInsurancePolicySchema),
};
