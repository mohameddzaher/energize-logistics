/**
 * إسكاتُ تنبيهٍ — «رأيناه، ولا داعيَ لتكراره».
 *
 * ── لماذا سجلٌّ للإسكات لا حقلٌ على التنبيه ───────────────────────────────
 * التنبيهاتُ لا تُخزَّن: «اقترب من حدّه» و«يستحقّ بعد يومين» تُحسبان من الرصيد
 * والتواريخ في كلّ مرّةٍ تُفتح فيها الصفحة — وهو الصواب، فالتنبيهُ المخزَّن
 * يصدق يومَ كُتب ويكذب غدًا.
 *
 * فما يُخزَّن هو القرارُ البشريُّ وحدَه: أنّ فلانًا رأى هذا التنبيهَ بعينه
 * وأغلقه. ويُقيَّد بما يجعله يعود إذا تغيّر الحال — فإسكاتُ تنبيهِ حدٍّ عند
 * مديونيّةِ ٩٠٪ لا يُسكته حين تبلغ ١٢٠٪.
 */
const mongoose = require('mongoose');

const creditAlertAckSchema = new mongoose.Schema({
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', required: true, index: true },
  // 'limit' اقترابٌ من حدّ الائتمان · 'due' اقترابُ موعد الاستحقاق
  kind: { type: String, enum: ['limit', 'due'], required: true },
  // ما أُسكت عليه: للحدِّ رصيدُه لحظةَ الإسكات، وللاستحقاق رقمُ الفاتورة.
  atOutstanding: { type: Number, default: 0 },
  invoiceNumber: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  ackedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ackedAt: { type: Date, default: Date.now },
}, { timestamps: true });

creditAlertAckSchema.index({ party: 1, kind: 1, invoiceNumber: 1 });

module.exports = mongoose.models.CreditAlertAck
  || mongoose.model('CreditAlertAck', creditAlertAckSchema);
