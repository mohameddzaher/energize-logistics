/**
 * تأجيرُ اليوزرات — حسابُ توصيلٍ (يوزر) على أحد مشاريعنا يُؤجَّر لشركةٍ أو
 * لشخص. يُعَدّ في لوحة قسم الأفراد مع المناديب: «إجماليُّ المناديب» = على
 * الكفالة + فري لانسر + يوزرات (طلبُ صاحب الشركة ٢٠٢٦/١٠/١٩).
 *
 * المؤجَّرُ له يُعرَف برقم إقامته (أو هويّته). وتاريخُ التأجير يُكتب تلقائيًّا
 * يومَ التسجيل بتوقيت الشركة. والتأجيرُ يُنهى ولا يُمحى: «كم يوزرًا كان مؤجَّرًا
 * في سبتمبر؟» سؤالٌ يُسأل بعد شهور.
 */
const mongoose = require('mongoose');

const ltUserRentalSchema = new mongoose.Schema({
  // المشروع — من قائمة مشاريع القسم (lt_project).
  projectAr: { type: String, trim: true, required: true, index: true },
  renterType: { type: String, enum: ['company', 'person'], required: true },
  renterName: { type: String, trim: true, required: true, maxlength: 200 },
  idNumber: { type: String, trim: true, required: true, index: true },
  phone: { type: String, trim: true, default: '' },
  // اسمُ اليوزر أو رقمُه على تطبيق التوصيل — اختياريّ.
  userAccount: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '', maxlength: 1000 },
  // «YYYY-MM-DD» بتوقيت الشركة — يُكتب تلقائيًّا ولا يُختار.
  startDate: { type: String, required: true, index: true },
  status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
  endDate: { type: String, default: '' },
  endedByName: { type: String, default: '' },
  // ── صفُّ اليوزر في «موظفي النقل الخفيف» — الرابطُ بالكروت (٢٠٢٦/١٠/٢٢) ──
  // التأجيرُ الساري المربوطُ هو تعريفُ «اليوزر المؤجَّر» — راجع utils/ltRental.
  ltEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', default: null, index: true },
  // نوعُ عقده قبل التأجير — يُعاد إليه حين يُنهى التأجير.
  prevContractTypeAr: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });
ltUserRentalSchema.index({ ltEmployee: 1, status: 1 });

module.exports = mongoose.models.LtUserRental || mongoose.model('LtUserRental', ltUserRentalSchema);
