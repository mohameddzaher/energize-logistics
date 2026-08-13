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
  // المفوَّض بالقيادة كما هو في ملف المركبات (٩١ مركبة). هذا غير تفاويض القسم
  // المسجَّلة على الموظفين — تلك سجل حركة، وهذا لقطة من الملف.
  authorizedPerson: {
    name: { type: String, default: '' },
    iqamaNumber: { type: String, default: '' },
    jobTitleAr: { type: String, default: '' },
  },
  // نواقص منصّة لوجستي: ما الذي يمنع هذه المركبة من استيفاء شروط المنصّة، مكتوبًا
  // شرطًا شرطًا. قائمة عمل لا وصفًا: كل سطر فيها بند يُغلَق.
  logistiGaps: { type: [String], default: [], index: true },
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
    cost: { type: Number, default: null },
    reference: { type: String, default: '' },     // رقم الوثيقة/الإيصال الجديد
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  }],

  accidentCount: { type: Number, default: 0, index: true },

  notesAr: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// (تواريخ انتهاء المستندات مفهرسة عبر index:true على حقولها أعلاه.)

// ── إعدادات القسم: عتبات التنبيه لكل مستند ─────────────────────────────────────
// المستخدم يحدد: أنبهني قبل انتهاء التأمين بـ 60 يوم، بطاقة التشغيل بـ 30 يوم … إلخ.
const vehicleRegistryConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'vehicle-registry', unique: true },
  // عتبة التنبيه لكل مستند: «نبّهني قبل انتهاء التأمين بـ ٦٠ يوم». المستخدم
  // بيغيّرها من صفحة الإعدادات، و`critical` هي العتبة الحمرا اللي بعدها الموضوع
  // مستعجل مش تنبيه.
  alerts: {
    insurance: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 15 } },
    operatingCard: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 } },
    vehicleLicense: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 } },
    inspection: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 } },
    gps: { enabled: { type: Boolean, default: false }, warnDays: { type: Number, default: 30 }, criticalDays: { type: Number, default: 7 } },
    corporatePolicy: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 }, criticalDays: { type: Number, default: 30 } },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── وثائق التأمين على مستوى الشركة ──────────────────────────────────────────
// مش مربوطة بمركبة (تأمين بضائع، خيانة أمانة). ليها تاريخ انتهاء زي أي مستند
// تاني، فبتظهر في نفس شاشة الانتهاءات — انتهاؤها بيوقّف الشغل كله مش عربية.
const corporatePolicySchema = new mongoose.Schema({
  scopeAr: { type: String, default: '', index: true },
  policyholderAr: { type: String, default: '' },
  policyNumbers: { type: [String], default: [] },
  companyAr: { type: String, default: '' },
  expiryDate: { type: Date, default: null, index: true },
  premiumSar: { type: Number, default: null },
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
};
