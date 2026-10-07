const mongoose = require('mongoose');

/**
 * سطرٌ في فاتورة: كشفُ تخريجٍ واحدٌ بمبلغه وحالته.
 *
 * ── ما لم يكن يُجيبه النظام ────────────────────────────────────────────────
 * الدفترُ يعرف الفاتورةَ وإجماليَّها، والكشفُ يعرف حمولتَه. ولم يكن بينهما
 * جدولٌ يقول **ماذا تشمل هذه الفاتورة بالضبط وبكم لكلّ كشف** — فيُفتَح ملفُّ
 * إكسل جانبيٌّ عند كلّ سؤال.
 *
 * ── و«مردود» صفةُ السطر لا الفاتورة ────────────────────────────────────────
 * أوّلُ ما يُفهَم من الكلمة أنّ الفاتورةَ أُلغيت. وقياسُه على الأرقام يقول غيرَ
 * ذلك: من ١٧٨ فاتورةٍ فيها سطرٌ «مردود»، ١٧٤ **محصَّلةٌ** في الدفتر بكامل
 * قيمتها. وإجماليُّ ٢٦٣٦ فاتورةً من ٢٦٨١ يساوي مجموعَ سطورها كلِّها × ١٫١٥
 * بالضبط — **بما فيها المردودة**.
 *
 * فـ«مردود» حالةُ الشحنة: الحمولةُ رجعت أو لم تكمل، ومع ذلك فُوتِرت (الرحلةُ
 * قامت). والكشفُ نفسُه قد يظهر مرّةً أخرى على فاتورةٍ لاحقةٍ حين يُنفَّذ من
 * جديد — ولذلك يظهر الكشفُ الواحدُ على فاتورتين وثلاثٍ وأربع (٨٠٣ كشوف).
 *
 * فالسطرُ هو الوحدة، لا الفاتورة ولا الكشف: به تُقرأ المردوداتُ عددًا وقيمةً،
 * وبه يُعرَف الكشفُ الذي فُوتِر أكثرَ من مرّة.
 */
const collectionInvoiceLineSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, trim: true, index: true },
  kind: { type: String, enum: ['tax', 'cash'], default: 'tax', index: true },
  reportNumber: { type: String, required: true, trim: true, index: true },

  partyName: { type: String, trim: true, default: '' },
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', default: null, index: true },

  // صافي نصيبِ هذا الكشف من الفاتورة، كما في الورقة. والضريبةُ تُشتقّ ولا تُخزَّن.
  net: { type: Number, default: 0 },
  invoiceDate: { type: Date, default: null, index: true },

  // Collected | Delivered | مردود | '' — حالةُ **هذا السطر**.
  status: { type: String, trim: true, default: '', index: true },
  returned: { type: Boolean, default: false, index: true },

  // ترتيبُ ظهور الكشف: ١ لأوّل فاتورةٍ حمَلته، ٢ للتي بعدها… فيُقرأ «أُعيدت
  // فوترتُه» بلا حسابٍ في الشاشة.
  attempt: { type: Number, default: 1 },
  attempts: { type: Number, default: 1 },

  source: { type: String, trim: true, default: '' },
}, { timestamps: true });

collectionInvoiceLineSchema.index({ invoiceNumber: 1, reportNumber: 1 }, { unique: true });
collectionInvoiceLineSchema.index({ returned: 1, invoiceDate: -1 });

module.exports = mongoose.models.CollectionInvoiceLine
  || mongoose.model('CollectionInvoiceLine', collectionInvoiceLineSchema);
