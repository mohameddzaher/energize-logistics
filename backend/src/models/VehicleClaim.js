const mongoose = require('mongoose');

/**
 * سجل الحوادث والمطالبات التأمينية — مصدره شيت Accidents في ماستر المركبات.
 *
 * ⚠️ ده **مش** `VehicleAccident`. الموديل التاني بيسجّل الحادث من ناحية التشغيل
 * (أي سائق، بأي تفويض، وقع له إيه) وبيتربط بالموظف والتفويض. الموديل ده بيتابع
 * الحادث من ناحية **المطالبة التأمينية**: نسبة الخطأ، رقم نجم، شركة التأمين،
 * المبلغ المقدَّر، المتوقع استرداده، والفجوة بينهم — وده اللي صاحب الشركة بيسأل
 * عنه: «فلوسنا فين؟». الاتنين ممكن يوصفوا نفس الواقعة من زاويتين مختلفتين.
 */
const vehicleClaimSchema = new mongoose.Schema({
  claimId: { type: String, required: true, unique: true, trim: true, index: true }, // ACC-001
  sourceRow: Number,

  // الواقعة ممكن تكون على مركبة أو على حاجة تانية (مخزن مثلاً) — الفلاج بيفرّق.
  isVehicleIncident: { type: Boolean, default: true, index: true },
  incidentSubjectAr: { type: String, default: '' },
  vehiclePlate: { type: String, default: '', index: true },
  vehiclePlateKey: { type: String, default: '', index: true }, // للربط بعد توحيد الهمزات
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  vehicleSectorAr: { type: String, default: '', index: true },
  vehicleTypeAr: { type: String, default: '' },
  vehicleCategoryAr: { type: String, default: '' },
  vehicleBrandAr: { type: String, default: '' },
  ownerRegistrationAr: { type: String, default: '' },

  // الطرف الآخر
  counterpartyNameAr: { type: String, default: '' },
  counterpartyNationalId: { type: String, default: '' },

  // نسبة الخطأ: 0 = الطرف الآخر غلطان، 100 = إحنا. بتحدد نتوقع نسترد كام.
  faultRatio: { type: Number, default: null },
  faultPercent: { type: Number, default: null, index: true },

  accidentDate: { type: Date, default: null, index: true },
  reportedViaAr: { type: String, default: '' },
  reportedViaCode: { type: String, default: '', index: true }, // najm / …
  accidentNumber: { type: String, default: '' },
  reportOrEstimateNumber: { type: String, default: '' },

  claim: {
    insurerAr: { type: String, default: '', index: true },
    claimNumber: { type: String, default: '' },
    claimNumberStatus: { type: String, default: '' },   // none = لسه مفتحش مطالبة
    notesAr: { type: String, default: '' },
    lastNoteDate: { type: Date, default: null },
    lastInsurerUpdateDate: { type: Date, default: null, index: true },
    estimatedAmountSar: { type: Number, default: null },
    expectedRecoverySar: { type: Number, default: null },
    // الفرق بين المقدَّر والمتوقع استرداده — الخسارة الصافية المتوقعة.
    recoveryGapSar: { type: Number, default: null },
  },

  statusAr: { type: String, default: '' },
  statusCode: { type: String, default: '', index: true }, // pending / closed / …

  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

vehicleClaimSchema.index({ accidentDate: -1 });
vehicleClaimSchema.index({ statusCode: 1, accidentDate: -1 });

module.exports = mongoose.models.VehicleClaim || mongoose.model('VehicleClaim', vehicleClaimSchema);
