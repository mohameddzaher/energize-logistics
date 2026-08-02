const mongoose = require('mongoose');

// ── سجل المركبات الرئيسي (Vehicle Registry) ────────────────────────────────────
// مصدره ماستر Vehicles_2026 — 326 مركبة بهويتها وتصنيفها وكل مستنداتها ذات تاريخ
// الانتهاء (تأمين، بطاقة تشغيل، رخصة سير، فحص، شريحة وقود، GPS). الأيام المتبقية
// وحالة المستند تُحسب runtime من تاريخ الانتهاء — لا تُخزَّن (تبور مع الوقت).
const vehicleMasterSchema = new mongoose.Schema({
  source_row: Number,

  // الهوية
  plateNumber: { type: String, required: true, unique: true, trim: true, index: true },
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
  tamStatusAr: { type: String, default: '' },
  tamStatusCode: { type: String, default: '' }, // owner / user / none

  // التأمين
  insurance: {
    policyNumber: { type: String, default: '' },
    companyAr: { type: String, default: '', index: true },
    coverageTypeAr: { type: String, default: '' },
    coverageTypeCode: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
    premiumSar: { type: Number, default: null },
    status: { type: String, default: '' },
  },

  // شريحة الوقود (بترو اب)
  fuelCard: {
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
    deviceId: { type: String, default: '' },
    simNumber: { type: String, default: '' },
    provider: { type: String, default: '' },
    status: { type: String, default: '' },
    expiryDate: { type: Date, default: null },
  },

  // بطاقة التشغيل
  operatingCard: {
    cardNumber: { type: String, default: '' },
    expiryDate: { type: Date, default: null, index: true },
  },

  // رخصة السير
  vehicleLicense: {
    expiryDate: { type: Date, default: null, index: true },
  },

  // الفحص الدوري
  inspection: {
    statusAr: { type: String, default: '' },
    statusCode: { type: String, default: '' }, // passed / none / …
    expiryDate: { type: Date, default: null, index: true },
  },

  notesAr: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// (تواريخ انتهاء المستندات مفهرسة عبر index:true على حقولها أعلاه.)

// ── إعدادات القسم: عتبات التنبيه لكل مستند ─────────────────────────────────────
// المستخدم يحدد: أنبهني قبل انتهاء التأمين بـ 60 يوم، بطاقة التشغيل بـ 30 يوم … إلخ.
const vehicleRegistryConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'vehicle-registry', unique: true },
  alerts: {
    insurance: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 60 } },
    operatingCard: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 } },
    vehicleLicense: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 } },
    inspection: { enabled: { type: Boolean, default: true }, warnDays: { type: Number, default: 30 } },
    gps: { enabled: { type: Boolean, default: false }, warnDays: { type: Number, default: 30 } },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = {
  VehicleMaster: mongoose.models.VehicleMaster || mongoose.model('VehicleMaster', vehicleMasterSchema),
  VehicleRegistryConfig: mongoose.models.VehicleRegistryConfig || mongoose.model('VehicleRegistryConfig', vehicleRegistryConfigSchema),
};
