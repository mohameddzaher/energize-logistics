/**
 * شيتُ أوردرات مشروع — ملفُّ جوجل شيت لكلّ مشروع، فيه ورقةٌ لكلّ شهر:
 * رقمُ الإقامة، واسمُ المندوب، والمشرف، ثمّ عمودٌ لكلّ يوم.
 *
 * يُقرأ كلَّ دقيقة (services/b2cOrderSheetSync) ويُكتب ما تغيّر فيه في
 * «مدخلات الأوردرات». والقراءةُ بالرابط العامّ (من معه الرابط يستطيع العرض)،
 * باختيار صاحب الشركة (٢٠٢٦/١٠/٢٠).
 *
 * `B2COrderSheetCell` لقطةُ آخر ما قُرئ من كلّ خانة: بها يُعرَف ما **تغيّر** في
 * الشيت — فخانةٌ لم يمسّها أحدٌ لا تدهس رقمًا عُدِّل على النظام بعدها
 * (آخرُ تعديلٍ هو المعتمد).
 */
const mongoose = require('mongoose');

const b2cOrderSheetSchema = new mongoose.Schema({
  projectAr: { type: String, trim: true, required: true },
  sheetId: { type: String, trim: true, required: true },
  url: { type: String, trim: true, default: '' },
  enabled: { type: Boolean, default: true },
  lastSyncAt: { type: Date, default: null },
  lastOkAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  lastChanges: { type: Number, default: 0 },
  // صفوفٌ في الشيت برقم إقامةٍ لا يعرفه النظام — تُعرض ليُصحَّح الرقم أو يُسجَّل المندوب.
  unknownIds: [{ type: String }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
b2cOrderSheetSchema.index({ sheetId: 1 }, { unique: true });

const cellSchema = new mongoose.Schema({
  sheet: { type: mongoose.Schema.Types.ObjectId, ref: 'B2COrderSheet', required: true },
  lt: { type: mongoose.Schema.Types.ObjectId, required: true },
  dateKey: { type: String, required: true },
  value: { type: Number, default: null },
}, { timestamps: true });
cellSchema.index({ sheet: 1, lt: 1, dateKey: 1 }, { unique: true });

const B2COrderSheet = mongoose.models.B2COrderSheet || mongoose.model('B2COrderSheet', b2cOrderSheetSchema);
const B2COrderSheetCell = mongoose.models.B2COrderSheetCell || mongoose.model('B2COrderSheetCell', cellSchema);
module.exports = { B2COrderSheet, B2COrderSheetCell };

/**
 * مفتاحُ سكربت جوجل — يُولَّد في الخادم مرّةً ويُحفظ هنا، ولا يُكتب بيد أحد.
 * يصل السكربتَ مضمَّنًا فيه حين يُحمَّل من «شيتات جوجل» (لمدير القسم ونائبه).
 */
const keySchema = new mongoose.Schema({ _id: { type: String, default: 'main' }, token: { type: String, required: true } }, { timestamps: true });
const B2CSheetsKey = mongoose.models.B2CSheetsKey || mongoose.model('B2CSheetsKey', keySchema);
let keyCache = { token: '', at: 0 };
async function sheetsToken() {
  if (keyCache.token && Date.now() - keyCache.at < 60000) return keyCache.token;
  let doc = await B2CSheetsKey.findById('main').lean();
  if (!doc) {
    const token = require('crypto').randomBytes(24).toString('hex');
    await B2CSheetsKey.updateOne({ _id: 'main' }, { $setOnInsert: { token } }, { upsert: true });
    doc = await B2CSheetsKey.findById('main').lean();
  }
  keyCache = { token: doc.token, at: Date.now() };
  return doc.token;
}
module.exports.B2CSheetsKey = B2CSheetsKey;
module.exports.sheetsToken = sheetsToken;
