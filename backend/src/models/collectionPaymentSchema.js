/**
 * دفعةُ تحصيل — يشترك فيها دفترُ الفواتير (الضريبيّ) وكشفُ التشغيل (الكاش).
 *
 * ليست مجموعةً بذاتها: الدفعةُ لا تعيش بلا فاتورتها، وتُقرأ معها في الصفّ نفسِه.
 * ولكلّ دفعةٍ معرّفٌ فتُعدَّل أو تُرفَع وحدَها، وكاتبُها باسمه كما كان يومَ كتبها.
 */
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  // يومُ القبض كما يكتبه زرُّ التحصيل: `new Date('YYYY-MM-DD')`.
  date: { type: Date, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  // 'partial' دفعةٌ جزئيّة، و'full' ما أتمّ القيمة (الباقي كلُّه).
  mode: { type: String, enum: ['partial', 'full'], default: 'partial' },
  at: { type: Date, default: Date.now },
}, { _id: true });

module.exports = { paymentSchema };
