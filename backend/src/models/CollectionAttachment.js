/**
 * مرفقُ فاتورةِ تحصيل — ملفٌّ واحدٌ في وثيقةٍ واحدة.
 *
 * ── ولماذا مجموعةٌ بذاتها ───────────────────────────────────────────────────
 * الفاتورةُ في القسم وجهان: الضريبيّةُ صفٌّ في `CollectionInvoice` يُعرَف برقمه،
 * والنقديّةُ كشفٌ في `OperationsWorkflow` يُعرَف بمعرّفه. وكلاهما نموذجٌ ساخنٌ
 * تكتب فيه المزامنةُ والاستيرادُ والتشغيلُ كلَّ دقيقة. فإضافةُ مصفوفةِ ملفّاتٍ
 * إلى أيٍّ منهما تُثقل كلَّ قراءةٍ له، وتجعل كلَّ حفظٍ هناك يحمل ملفّاتٍ لا
 * شأنَ له بها.
 *
 * فالمرفقُ هنا، يُشير إلى فاتورته بـ(`kind`, `key`):
 *   tax  → رقمُ الفاتورة كما في الدفتر (نصٌّ مقصوصُ الأطراف)
 *   cash → معرّفُ الكشف في سير العمل
 *
 * ── ووثيقةٌ لكلّ ملفّ ───────────────────────────────────────────────────────
 * فالحذفُ حذفُ وثيقة، والعدُّ لصفحةٍ من مئة فاتورة تجميعٌ واحدٌ على الفهرس
 * (`kind` + `key`) — لا مصفوفاتٌ تُقرأ لتُعَدّ.
 */
const mongoose = require('mongoose');

const collectionAttachmentSchema = new mongoose.Schema({
  kind: { type: String, enum: ['tax', 'cash'], required: true },
  key: { type: String, required: true, trim: true },

  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },

  // مَن رفعه — والاسمُ محفوظٌ معه، فلا يُقرأ المستخدمُ عند كلّ عرض، ولا يضيع
  // إن عُطِّل حسابُه.
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, trim: true, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

collectionAttachmentSchema.index({ kind: 1, key: 1, uploadedAt: -1 });

module.exports = mongoose.models.CollectionAttachment
  || mongoose.model('CollectionAttachment', collectionAttachmentSchema);
