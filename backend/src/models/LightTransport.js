/**
 * النقلُ الخفيف — موظّفوه وسكنُهم وأوامرُ تشغيلهم.
 *
 * ── لماذا سجلٌّ هنا وفي الموارد البشريّة معًا ────────────────────────────────
 * موظّفو هذا القسم موجودون في الموارد البشريّة: كلُّ التسعةِ ومئةٍ الذين على
 * كفالتنا، وأربعون من اثنين وخمسين فري لانسر — أي مئةٌ وتسعةٌ وأربعون من مئةٍ
 * وواحدٍ وستّين. فلا يُنشأ سجلٌّ موازٍ للإنسان: الاسمُ والهويّةُ والجنسيّةُ
 * وتاريخُ التعيين **وحالةُ الخدمة** تُقرأ من ملفّه هناك، فمن أنهت الموارد
 * البشريّةُ خدمتَه يُقرأ هنا خارجَ العمل في اللحظة نفسها بلا أن يُخبِر أحدٌ أحدًا.
 *
 * وما يخصّ هذا القسمَ وحدَه لا موضعَ له هناك: المشروعُ الذي يعمل فيه، والمدينةُ،
 * ومشرفُه، ونوعُ مركبته ولوحتُها، والسجلُ التجاريُّ الذي هو على كفالته، وسكنُه
 * وغرفتُه. فهذا السجلُّ يحمل ذلك ويشير إلى ملفّ الموارد البشريّة.
 *
 * والاثنا عشر الباقون — فري لانسر لا ملفَّ لهم هناك — يملكهم هذا القسمُ كاملًا
 * (`employee: null`). فلا يسقط أحدٌ من القائمة لأنّ قسمًا آخرَ لم يسجّله.
 *
 * ── ولا سجلَّ مركباتٍ ثانيًا ────────────────────────────────────────────────
 * المركباتُ الأربعَ عشرةَ ومئتان كلُّها في سجلّ المركبات (طابقت مئةً بالمئة
 * باللوحة وبالرقم التسلسليّ معًا). فالمركبةُ تُشار إليها ولا تُنسَخ، والتفويضُ
 * يُكتب في موضعه هناك (`VehicleMaster.authorizedPerson`) — وإلّا قرأ قسمٌ أنّ
 * المركبة بيد فلان وقرأ الآخرُ أنّها بيد غيره.
 */
const mongoose = require('mongoose');

/** أثرٌ لا يُمحى: كلُّ نقلٍ أو تغييرِ حالةٍ يُقيَّد بصاحبه ووقته. */
const historyEntrySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, default: '' },
  // ما تغيّر: project | city | supervisor | vehicle | housing | status | created | order
  kind: { type: String, default: '' },
  fromValue: { type: String, default: '' },
  toValue: { type: String, default: '' },
  note: { type: String, trim: true, default: '' },
}, { _id: true });

// ── السكن ───────────────────────────────────────────────────────────────────
/**
 * ولماذا غرفٌ لا سعةٌ واحدة: غرفةُ المناديب تسع ثمانيةً وغرفةُ المشرفين ثلاثة.
 * فالسعةُ الكليّةُ مجموعُ الغرف لا رقمٌ يُكتب، ومن يُسكَن يُسكَن في غرفةٍ من
 * نوعه — وإلّا قيل «السكنُ فيه متّسع» وليس فيه متّسعٌ لمشرف.
 */
const housingRoomSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true },     // «غرفة ١»
  // لمن هذه الغرفة: مناديب | إداريّون | للجميع
  kind: { type: String, enum: ['rep', 'admin', 'any'], default: 'any' },
  capacity: { type: Number, default: 0, min: 0 },
  notes: { type: String, trim: true, default: '' },
}, { _id: true });

const housingSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true, unique: true },
  cityAr: { type: String, trim: true, default: '' },
  addressAr: { type: String, trim: true, default: '' },
  /**
   * سعةٌ مكتوبةٌ تُستعمل حين لا غرفَ مسجَّلةٌ بعد. ومتى سُجّلت الغرفُ صارت
   * السعةُ مجموعَها — راجع `totalCapacity`.
   */
  declaredCapacity: { type: Number, default: 0, min: 0 },
  rooms: [housingRoomSchema],
  isActive: { type: Boolean, default: true, index: true },
  notes: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/** السعةُ الحقيقيّة: مجموعُ الغرف، وإلّا المكتوبة. */
housingSchema.virtual('totalCapacity').get(function () {
  const rooms = (this.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0);
  return rooms || Number(this.declaredCapacity) || 0;
});
housingSchema.set('toJSON', { virtuals: true });
housingSchema.set('toObject', { virtuals: true });

// ── الموظّف ─────────────────────────────────────────────────────────────────
const employeeSchema = new mongoose.Schema({
  /**
   * رقمُ الهويّة هو المفتاح — لا الاسم. أسماءُ الشيت مكتوبةٌ بصيغٍ («إسلام
   * سرور» في خانة المشرف و«اسلام وحيد محمد ثروت سرور» في الموارد البشريّة)،
   * فالربطُ بالاسم يُخطئ. والهويّةُ واحدةٌ في السجلّين.
   */
  idNumber: { type: String, trim: true, required: true, unique: true, index: true },
  /** ملفُّه في الموارد البشريّة — `null` لمن لا ملفَّ له (فري لانسر). */
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },

  // ما يُقرأ من الموارد البشريّة حين تكون مربوطةً، ويُكتب هنا حين لا تكون.
  name: { type: String, trim: true, required: true },
  nationalityAr: { type: String, trim: true, default: '' },
  hireDate: { type: Date, default: null },
  phone: { type: String, trim: true, default: '' },

  // ما يخصّ هذا القسمَ وحدَه — كلُّها قوائمُ مُدارةٌ من إعدادات القسم.
  cityAr: { type: String, trim: true, default: '', index: true },       // الفرع
  projectAr: { type: String, trim: true, default: '', index: true },    // المشروع
  jobTitleAr: { type: String, trim: true, default: '', index: true },   // مندوب / مشرف / ميكانيكي…
  contractTypeAr: { type: String, trim: true, default: '', index: true }, // كفاله / فري لانسر
  registerNumber: { type: String, trim: true, default: '', index: true }, // على كفالة أيّ سجلّ
  vehicleTypeAr: { type: String, trim: true, default: '', index: true },  // دراجة نارية / فان / كيا…

  /**
   * ── مندوبٌ أو إداريّ ──────────────────────────────────────────────────────
   * القسمُ يُدار على هذا الفرق: المندوبُ يوصّل ويُقاس بطلباته، وكلُّ من سواه —
   * مشرفًا كان أو ميكانيكيًّا أو عاملَ نظافة — إداريٌّ يخدم التشغيل. وهو مشتقٌّ
   * من الوظيفة لا يُكتب مرّتين، فلا يختلف الاثنان.
   */
  staffKind: { type: String, enum: ['rep', 'admin'], default: 'rep', index: true },

  /**
   * ── المشرفُ المسؤول: حسابٌ على النظام، لا اسمٌ في قائمة ────────────────────
   *
   * كان اسمًا يُختار من قائمةٍ مُدارة: «خالد عباس»، «إسلام سرور». والقائمةُ
   * تُكتب بيدٍ فتُكتب بصيغتين («أحمد الشرقاوي» و«احمد الشرقاوي») ولا تعرف أنّ
   * صاحبَ الاسم له حسابٌ على النظام يدخل به كلَّ صباح. فالمشرفُ في السجلّ
   * شيءٌ، والمشرفُ الذي يفتح شاشةَ التفقّد شيءٌ آخر — ولا يعرف أحدُهما الآخر.
   *
   * فصار `supervisorUser` هو الأصل: حسابٌ نشطٌ بدورٍ من أدوار الإشراف في القسم
   * (مشرف مناديب · مدير مشروع · مدير القطاع). ومتى أُسند إليه رجلٌ هنا، رآه في
   * تفقّد بداية الدوام — وهذا هو الربطُ كلُّه.
   *
   * ويبقى معه الاثنان الآخران ولا يُكتبان بيد:
   *   `supervisorName` — لقطةُ الاسم: تُقرأ في الجداول والتصدير والسجلّ، وتبقى
   *     صحيحةً في التاريخ ولو تغيّر الحسابُ أو زال.
   *   `supervisor` — ملفُّه في الموارد البشريّة، يُشتَقّ من الحساب لا يُختار.
   */
  supervisorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '', index: true },
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

  /**
   * حالةُ العمل. تُقرأ من الموارد البشريّة متى كان مربوطًا — فإنهاءُ الخدمة
   * هناك يظهر هنا بلا خطوةٍ ثانية. وتُكتب هنا لمن لا ملفَّ له.
   */
  workStatusAr: { type: String, trim: true, default: '', index: true },

  // المركبةُ التي يعمل عليها الآن — إشارةٌ إلى سجلّ المركبات لا نسخةٌ منه.
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  vehiclePlate: { type: String, trim: true, default: '' },

  housing: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportHousing', default: null, index: true },
  housingRoom: { type: String, trim: true, default: '' },

  notesAr: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true, index: true },

  history: [historyEntrySchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

employeeSchema.index({ projectAr: 1, cityAr: 1 });
employeeSchema.index({ staffKind: 1, workStatusAr: 1 });
employeeSchema.index({ name: 'text' });

/** «مندوب» وحدَه مندوب؛ وما سواه إداريّ. يُحسَب قبل كلّ حفظ. */
const REP_TITLES = ['مندوب', 'مندوب توصيل', 'rep', 'delivery rep'];
employeeSchema.pre('save', function (next) {
  const j = String(this.jobTitleAr || '').trim().toLowerCase();
  this.staffKind = REP_TITLES.some((t) => j === t.toLowerCase()) ? 'rep' : 'admin';
  next();
});

// ── أمرُ التشغيل ────────────────────────────────────────────────────────────
/**
 * «هذا الموظّفُ يعمل على هذه المركبة، في هذا المشروع، بهذا الفرع، تحت هذا
 * المشرف، ويسكن هنا.» أمرٌ واحدٌ سارٍ لكلّ موظّف، وما قبله يُغلَق ولا يُمحى —
 * فتاريخُ من رَكِبَ ماذا ومتى يُقرأ إلى الوراء.
 *
 * وإنشاؤه يكتب الحالةَ الحاضرة على الموظّف (مركبتُه ومشروعُه وسكنُه) ويُقيّد
 * النقلَ في سجلّه؛ ونقلُ التفويض يكتب في سجلّ المركبات نفسِه.
 */
const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, trim: true, unique: true, index: true },
  ltEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', required: true, index: true },
  employeeName: { type: String, trim: true, default: '' },
  employeeIdNumber: { type: String, trim: true, default: '' },

  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  vehiclePlate: { type: String, trim: true, default: '' },
  vehicleTypeAr: { type: String, trim: true, default: '' },

  projectAr: { type: String, trim: true, default: '', index: true },
  cityAr: { type: String, trim: true, default: '', index: true },
  // المشرفُ ساعةَ الإسناد — حسابُه واسمُه وملفُّه. راجع `supervisorUser` أعلاه.
  supervisorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorName: { type: String, trim: true, default: '' },
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

  housing: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportHousing', default: null },
  housingRoom: { type: String, trim: true, default: '' },

  startDate: { type: Date, default: Date.now, index: true },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
  endReasonAr: { type: String, trim: true, default: '' },

  /**
   * هل نُقل تفويضُ المركبة مع هذا الأمر؟ والكتابةُ الفعليّةُ في سجلّ المركبات،
   * وهذا قيدُ ما حدث لا مصدرُه.
   */
  authorizationMoved: { type: Boolean, default: false },
  authorizationNumber: { type: String, trim: true, default: '' },
  authorizationStart: { type: Date, default: null },
  authorizationEnd: { type: Date, default: null },

  notesAr: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

orderSchema.index({ status: 1, startDate: -1 });
orderSchema.index({ ltEmployee: 1, startDate: -1 });

module.exports = {
  LightTransportEmployee: mongoose.models.LightTransportEmployee
    || mongoose.model('LightTransportEmployee', employeeSchema),
  LightTransportHousing: mongoose.models.LightTransportHousing
    || mongoose.model('LightTransportHousing', housingSchema),
  LightTransportOrder: mongoose.models.LightTransportOrder
    || mongoose.model('LightTransportOrder', orderSchema),
};
