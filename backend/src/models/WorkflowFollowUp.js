/**
 * متابعةُ كشف تشغيل — سطرٌ يكتبه موظّفٌ على الكشف: ما جرى، ومَن كتبه، ومتى.
 *
 * ── ولماذا سجلٌّ بذاته لا «ملاحظات الفاتورة» ولا متابعاتُ التحصيل ──────────
 * الكشفُ لم يكن له سجلُّ متابعة: «ملاحظات الفاتوره» (`invoiceNotes`) خانةٌ
 * واحدةٌ من أعمدة المال يكتبها أهلُ الفاتورة وحدَهم ويكتب كلُّ واحدٍ فوق مَن
 * قبله؛ و`CollectionsFollowUp` متابعةُ تحصيلٍ على **طرفٍ** (عميل) بنوعها
 * ووعدها، لا تُكتب بلا طرف ولا يقرؤها التخليص. والذي طُلب أوسعُ منهما: قسمُ
 * التخليص يكتب «الحاويةُ ما زالت في الميناء»، والتشغيلُ يكتب «السائقُ وصل»،
 * والتحصيلُ يكتب «العميلُ استلم» — على الكشف نفسِه، يقرؤها الثلاثة.
 *
 * ── ووثيقةٌ لكلّ سطر ─────────────────────────────────────────────────────────
 * والكشفُ نموذجٌ ساخنٌ تكتب فيه المزامنةُ كلَّ دقيقة؛ فمصفوفةٌ عليه تُثقل كلَّ
 * قراءةٍ له وتجعل كلَّ حفظٍ هناك يحمل سطورًا لا شأنَ له بها (كما في
 * `CollectionAttachment`). والحذفُ هنا حذفُ وثيقة، والعدُّ تجميعٌ على الفهرس.
 */
const mongoose = require('mongoose');

const workflowFollowUpSchema = new mongoose.Schema({
  workflow: { type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow', required: true },
  // رقمُ الكشف محفوظٌ معه: يبقى السطرُ مقروءًا في سجلّ المراجعة إن حُذف الكشف.
  reportNumber: { type: String, trim: true, default: '' },

  text: { type: String, required: true, trim: true, maxlength: 2000 },
  // مرفقٌ واحدٌ اختياريّ — صورةُ ورقةٍ أو إيصال. راجع utils/fileStore.
  attachment: {
    fileUrl: { type: String, default: '' },
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },

  // مَن كتب — والاسمُ والقسمُ محفوظان معه فلا يُقرأ المستخدمُ عند كلّ عرض.
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  byName: { type: String, trim: true, default: '' },
  byRole: { type: String, trim: true, default: '' },
  // الشاشةُ التي كُتب منها: التشغيل أو التخليص أو التحصيل.
  source: { type: String, enum: ['operations', 'customs', 'collections'], default: 'operations' },
  at: { type: Date, default: Date.now },
});

workflowFollowUpSchema.index({ workflow: 1, at: -1 });

module.exports = mongoose.models.WorkflowFollowUp
  || mongoose.model('WorkflowFollowUp', workflowFollowUpSchema);
