const mongoose = require('mongoose');

/**
 * نموذجٌ أو خطابٌ رسميٌّ للشركة — ملفُّ الموارد البشريّة الجاهزُ للطبع.
 *
 * ── لماذا سجلٌّ لا مرفقٌ على موظّف ──────────────────────────────────────────
 * `EmployeeDocument` ملفٌّ **لموظّفٍ بعينه**: صورةُ إقامته، عقدُه. وهذه ورقةٌ
 * لا صاحبَ لها: «نموذج طلب إجازة»، «خطاب تعريف بالراتب»، «إقرار استلام عهدة»،
 * «نموذج إخلاء طرف». تُكتب مرّةً وتُطبَع لكلّ من يحتاجها.
 *
 * وكانت تعيش في محادثاتِ واتساب ومجلّداتِ أجهزةٍ شخصيّة: من يحتاج نموذجًا
 * يسأل عنه، ومن أرسله يرسل آخرَ نسخةٍ عنده — فتُوقَّع نسخةٌ قديمةٌ وتُعاد.
 *
 * فصارت لها خانةٌ واحدة: الملفُّ الحاليُّ لكلّ نموذج، ومن رفعه ومتى، ورقمُ
 * النسخة. والقديمُ لا يُحذَف بل يُعلَّم `isActive: false` — من وقّع على نسخةٍ
 * قديمةٍ يحتاج أن يجدها.
 */
const hrFormTemplateSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    titleEn: { type: String, trim: true, default: '' },
    // التصنيفُ قائمةٌ مفتوحةٌ لا مُغلقة: الأقسامُ تطلب أنواعًا لم تُحسَب.
    // والقيمُ المعروفة: forms | letters | policies | contracts | hse | other
    category: { type: String, trim: true, default: 'forms', index: true },
    description: { type: String, trim: true, default: '' },

    fileUrl: { type: String, required: true },          // /uploads/hr-forms/xxxx.pdf
    fileName: { type: String, trim: true, default: '' },
    mimeType: { type: String, trim: true, default: '' },
    size: { type: Number, default: 0 },

    // رقمُ النسخة يرتفع مع كلّ استبدالٍ للملفّ — فمن يسأل «أهذه الأحدث؟» يقرأ.
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },

    // كم مرّةً نُزِّل: النماذجُ التي لا تُنزَّل إمّا لا يحتاجها أحدٌ أو لا
    // يعرف أحدٌ أنّها هنا — والرقمُ يفرّق بينهما مع الزمن.
    downloads: { type: Number, default: 0 },
    lastDownloadAt: { type: Date, default: null },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

hrFormTemplateSchema.index({ category: 1, title: 1 });

module.exports = mongoose.models.HrFormTemplate
  || mongoose.model('HrFormTemplate', hrFormTemplateSchema);
