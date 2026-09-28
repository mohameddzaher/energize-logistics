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
  /**
   * ── ومَن كان يقود مركبتَنا ──────────────────────────────────────────────
   * السجلُّ كان يحمل الطرفَ الآخرَ وحدَه، ولا يقول مَن كان خلف المقود عندنا.
   * وهو أوّلُ ما يُسأل عنه: تُقيَّد المخالفةُ على السائق، ويُخصَم منه، ويُسأل
   * عن روايته، وتُراجَع رخصتُه. وكان الجوابُ يُبحَث عنه في التفويض وفي جدول
   * الإسناد وفي ذاكرة المشرف — وثلاثتُها قد تختلف.
   *
   * ويُقترَح تلقائيًّا من مفوَّض المركبة أو قائدها الفعليّ في قسم النقل الخفيف
   * (راجع `suggestDriver`)، ويُصحَّح باليد: المفوَّضُ ليس دائمًا الراكب.
   */
  driverNameAr: { type: String, default: '' },
  driverIdNumber: { type: String, default: '', index: true },

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

  // ── وردودُ شركة التأمين كثيرة، لا واحد ────────────────────────────────
  //
  // كان الردُّ خانةَ ملاحظاتٍ واحدة (`claim.notesAr`) يُكتَب فوقها في كلّ
  // مرّة. وشركةُ التأمين تردّ مرّاتٍ على المطالبة الواحدة: تطلب مستندًا، ثمّ
  // تقدّر، ثمّ تعرض مبلغًا. فكتابةُ الردّ الجديد فوق القديم تمحو تاريخَ
  // المفاوضة — وهو ما يُحتَجّ به عند الخلاف.
  //
  // فصارت سجلًّا يُضاف إليه ولا يُمحى، ويُقرأ الأحدثُ أوّلًا.
  insurerReplies: [{
    at: { type: Date, default: Date.now },
    text: { type: String, trim: true, default: '' },
    amountSar: { type: Number, default: null },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true, default: '' },
  }],

  // نصُّ الحالة — لم يعد يُخزَّن ولا يُقرأ: الحالةُ تُشتقُّ من `statusCode`
  // وتُعرَض بلغة الشاشة. أُبقي الحقلُ لبيانات قديمة ولا يُكتَب فيه.
  statusAr: { type: String, default: '' },
  statusCode: { type: String, default: '', index: true }, // pending / closed / …

  /**
   * ── مرفقاتُ المطالبة ──────────────────────────────────────────────────────
   * المطالبةُ ورقٌ قبل أن تكون رقمًا: تقريرُ نجم، وصورُ الضرر، وعرضُ الورشة،
   * وخطابُ الشركة. وكانت تُدار بالأرقام وحدَها — التقديرُ والمتحصَّلُ والفارق —
   * وأمّا الورقُ الذي تُبنى عليه هذه الأرقام فيبقى في بريدٍ أو هاتفٍ عند مَن
   * تابعها، فإن سُئلت عن الحجّة بعد سنةٍ لم تجدها.
   *
   * ولكلّ مرفقٍ اسمٌ يكتبه صاحبُه: «تقرير نجم» و«عرض الورشة» و«خطاب الرفض» لا
   * `IMG_20260114.jpg` ثلاثَ مرّات. والاسمُ هو ما يُقرأ في القائمة.
   */
  attachments: [{
    title: { type: String, trim: true, default: '' },
    fileUrl: { type: String, required: true },
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, trim: true, default: '' },
    size: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  }],

  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

vehicleClaimSchema.index({ accidentDate: -1 });
vehicleClaimSchema.index({ statusCode: 1, accidentDate: -1 });

module.exports = mongoose.models.VehicleClaim || mongoose.model('VehicleClaim', vehicleClaimSchema);
