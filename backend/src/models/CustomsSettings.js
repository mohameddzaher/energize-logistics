/**
 * إعداداتُ قسم التخليص — مستندٌ واحدٌ لا أكثر.
 *
 * قوائمُ القسم (الموانئ والمراحل والمدن) تُدار في `Lookup`، وهي قوائمُ قيم.
 * وما ليس قيمةً في قائمةٍ يحتاج موضعًا: «قبل كم يومٍ يُنبَّه على المعاملة
 * القادمة؟» رقمٌ واحدٌ يحكم شارةَ التنبيه كلَّها.
 *
 * وكتابتُه في الشيفرة تجعل تغييرَه نشرًا جديدًا — والقسمُ يريده اليومَ يومين
 * وغدًا ثلاثة. فهو هنا، يُقرأ في كلّ نداءٍ للتنبيه، فيسري أثرُه في اللحظة.
 */
const mongoose = require('mongoose');

const customsSettingsSchema = new mongoose.Schema({
  // مفتاحٌ ثابتٌ يضمن مستندًا واحدًا مهما تكرّرت الكتابة.
  key: { type: String, default: 'customs', unique: true, index: true },
  // قبل كم يومٍ تظهر المعاملةُ القادمة في التنبيه.
  upcomingAlertDays: { type: Number, default: 2, min: 0, max: 60 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

/** يُعيد المستندَ الواحد — ويُنشئه بقيمه الافتراضيّة إن لم يكن. */
customsSettingsSchema.statics.get = async function get() {
  const found = await this.findOne({ key: 'customs' }).lean();
  if (found) return found;
  const created = await this.create({ key: 'customs' });
  return created.toObject();
};

module.exports = mongoose.model('CustomsSettings', customsSettingsSchema);
