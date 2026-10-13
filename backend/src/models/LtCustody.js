/**
 * عهدةُ النقل الخفيف — ثلاثةُ حسابات: الكاش، وكارت المشتريات، والورشة.
 *
 * كلُّ قيدٍ واردٌ أو صادرٌ على حسابٍ واحد، ورصيدُ الحساب مجموعُ وارده ناقصَ صادره —
 * يُحسَب عند القراءة ولا يُخزَّن، فلا يختلف رقمٌ عن قيوده.
 *
 * ── من أين يأتي الوارد ──────────────────────────────────────────────────────
 *   الكاش    ← الكارت · الورشة · البنك · مندوب (يردّ مالًا: برقم إقامته كالصادر)
 *   الكارت   ← البنك
 *   الورشة   ← الصيانة
 *
 * ── وإلى أين يذهب الصادر ────────────────────────────────────────────────────
 *   متحمِّل: مندوبٌ (برقم إقامته — وبياناتُه تُقرأ من الموارد البشريّة وتُلقَط
 *   هنا) أو الشركة (ويُكتب البيان: ماء، كهرباء، صيانة…).
 *   والكارتُ والورشةُ يصرفان إلى الكاش أيضًا.
 *
 * ── والتحويلُ قيدان بضغطة ──────────────────────────────────────────────────
 * «من الكارت إلى الكاش» صادرٌ على الكارت وواردٌ على الكاش بالمبلغ نفسِه. يُكتبان
 * معًا ويحملان `transferId` واحدًا — فلا يُسجَّل طرفٌ ويُنسى الآخر، ولا يُحذَف
 * أحدُهما ويبقى أخوه فيختلّ الرصيدان.
 */
const mongoose = require('mongoose');

const ACCOUNTS = ['cash', 'card', 'workshop'];
// مصادرُ الوارد المسموحةُ لكلّ حساب.
const IN_SOURCES = { cash: ['card', 'workshop', 'bank', 'rep'], card: ['bank'], workshop: ['maintenance'] };
// الحساباتُ التي تصرف إلى الكاش.
const TO_CASH = ['card', 'workshop'];

const ltCustodySchema = new mongoose.Schema({
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

ltCustodySchema.index({ account: 1, date: -1, createdAt: -1 });

module.exports = mongoose.models.LtCustodyEntry || mongoose.model('LtCustodyEntry', ltCustodySchema);
module.exports.ACCOUNTS = ACCOUNTS;
module.exports.IN_SOURCES = IN_SOURCES;
module.exports.TO_CASH = TO_CASH;
