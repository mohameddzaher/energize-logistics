const mongoose = require('mongoose');

/**
 * إعدادات قسم الموارد البشريّة — صفٌّ واحد.
 *
 * ── عتباتُ التنبيه ──────────────────────────────────────────────────────────
 * «نبّهني قبل انتهاء الإقامة بكم يومًا؟» كان الجوابُ رقمًا مكتوبًا في الشيفرة،
 * فمن أراد ستّين بدل ثلاثين انتظر نشرةً برمجيّة. والعتبةُ تختلف بطبيعتها:
 * الإقامةُ تُجدَّد في أسبوع فيكفيها ثلاثون، ورخصةُ العمل تحتاج شهرين.
 *
 * وتُخزَّن Map لا حقولًا مسمّاة: المستنداتُ تُزاد (شهادةٌ صحّيّة، بطاقةُ سائق،
 * ما يأتي بعدها)، وإضافةُ حقلٍ للمخطّط في كلّ مرّة نشرةٌ أخرى.
 */
const hrConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'hr', unique: true },
  alerts: { type: Map, of: Number, default: () => ({}) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.models.HrConfig || mongoose.model('HrConfig', hrConfigSchema);

/** العتباتُ الافتراضيّة — تُستعمل ما لم يُحفظ غيرُها. */
module.exports.DEFAULT_ALERTS = {
  iqama: 30,
  passport: 60,
  workPermit: 30,
  healthCertificate: 30,
  driverCard: 30,
  drivingLicense: 30,
  medicalInsurance: 30,
  contract: 30,
};
