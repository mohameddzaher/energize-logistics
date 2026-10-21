/**
 * دفترُ العهدة — حقولُ القيد مكتوبةٌ مرّةً هنا، وتبني منها العهدتان سجلَّيهما:
 * عهدةُ النقل الخفيف (models/LtCustody) وعهدةُ النقل الثقيل (models/HtCustody).
 * والقواعدُ نفسُها: ثلاثةُ حسابات، ومصادرُ الوارد، والتحويلُ قيدان — راجع
 * شرحَها في models/LtCustody.
 *
 * والثقيلُ يزيد على القيد سيّارتَه: أيُّ شاحنةٍ من أسطول لوكيشن سوليوشن صُرف
 * عليها أو جاء منها المال (`vehicles: true`). اختياريّة، ورقمُ الوحدة واللوحةُ
 * يُلقَطان وقتَ القيد كما يُلقَط المندوب.
 */
const mongoose = require('mongoose');

const ACCOUNTS = ['cash', 'card', 'workshop'];
// مصادرُ الوارد المسموحةُ لكلّ حساب.
const IN_SOURCES = { cash: ['card', 'workshop', 'bank', 'rep'], card: ['bank'], workshop: ['maintenance'] };
// الحساباتُ التي تصرف إلى الكاش.
const TO_CASH = ['card', 'workshop'];

function buildCustodySchema({ vehicles = false } = {}) {
  const schema = new mongoose.Schema({
    account: { type: String, enum: ACCOUNTS, required: true, index: true },
    direction: { type: String, enum: ['in', 'out'], required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    // يومُ الحركة «YYYY-MM-DD» بتوقيت الشركة — به تُفلتَر وتُرتَّب.
    date: { type: String, required: true, index: true },

    // الوارد: من أين.
    source: { type: String, enum: ['card', 'workshop', 'bank', 'maintenance', 'rep', 'opening', ''], default: '' },

    // الصادر: إلى مَن. `cash` تحويلٌ إلى حساب الكاش، وغيرُه متحمِّل.
    target: { type: String, enum: ['rep', 'company', 'cash', ''], default: '' },
    // المتحمِّلُ مندوب: رقمُ إقامته، وبياناتُه ملقوطةً وقتَ القيد.
    repIdNumber: { type: String, trim: true, default: '' },
    repName: { type: String, trim: true, default: '' },
    repNationality: { type: String, trim: true, default: '' },
    repProject: { type: String, trim: true, default: '' },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    // البيان: ما الصرف (للشركة يُكتب دائمًا، وللمندوب اختياريّ).
    detail: { type: String, trim: true, default: '', maxlength: 500 },

    // مرفقاتُ القيد — فاتورةٌ أو إيصالٌ أو صورةُ تحويل. اختياريّة، وقد تتعدّد.
    attachments: {
      type: [{
        title: { type: String, trim: true, default: '' },
        fileUrl: { type: String, required: true },
        fileName: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
        uploadedByName: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    // آخرُ تعديلٍ على قيدٍ مسجَّل — لأهل المال ومدير النظام وحدَهم.
    editedByName: { type: String, default: '' },
    editedAt: { type: Date, default: null },

    // قيدا التحويل يحملان المعرّفَ نفسَه.
    transferId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  }, { timestamps: true });
  if (vehicles) {
    schema.add({
      // السيّارةُ من أسطول لوكيشن سوليوشن (Ls2Vehicle.unitId) — ولوحتُها واسمُها ملقوطان.
      vehicleUnitId: { type: Number, default: null, index: true },
      vehiclePlate: { type: String, trim: true, default: '' },
      vehicleName: { type: String, trim: true, default: '' },
      // ومركبتُها في سجلّ المركبات — تُحلّ من الوحدة (Ls2Vehicle.vehicleMaster).
      vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
    });
  }
  schema.index({ account: 1, date: -1, createdAt: -1 });
  return schema;
}

module.exports = { ACCOUNTS, IN_SOURCES, TO_CASH, buildCustodySchema };
