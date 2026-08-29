const mongoose = require('mongoose');

/**
 * VehicleDocument — ملفٌّ مرفوعٌ على مركبة: صورة رخصة السير، بطاقة التشغيل،
 * وثيقة التأمين، استمارة الفحص…
 *
 * ── لماذا سجلٌّ مستقلّ لا حقلٌ على المركبة ───────────────────────────────────
 * المركبة تحمل **تواريخ** مستنداتها وأرقامَها، وهذه تحمل **صورها**. والعلاقة
 * واحدٌ إلى كثير: رخصةٌ واحدة قد تُصوَّر وجهين، والتأمين يُجدَّد كلّ سنة فتتراكم
 * وثائقُه. وحشرُها في المركبة يجعل كلَّ قراءةٍ للأسطول تجرّ معها مئاتِ المسارات
 * التي لا تُستعمل إلّا في شاشةٍ واحدة.
 *
 * والبايتات على القرص تحت uploads/vehicles؛ `fileUrl` هو المسار المخدوم. و`title`
 * هو ما يكتبه المستخدم بيده — «صورة الرخصة» — لا اسمُ الملفّ كما خرج من هاتفه.
 *
 * و`category` يربط الملفّ بعائلة مستنده، فيظهر في كارت التأمين ملفُّ التأمين
 * وحده لا كلُّ ما رُفع على المركبة.
 */
const vehicleDocumentSchema = new mongoose.Schema(
  {
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', required: true, index: true },
    // اللوحة لقطةً: الملفّ يبقى مقروءًا في سجلّ التدقيق ولو حُذفت المركبة.
    plateNumber: { type: String, trim: true, default: '' },
    title: { type: String, required: true, trim: true },
    // insurance / operatingCard / vehicleLicense / inspection / gps / authorization / other
    category: { type: String, trim: true, default: 'other', index: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, default: 0 },
    expiryDate: { type: String },   // YYYY-MM-DD اختياريّ
    notes: { type: String, trim: true, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

vehicleDocumentSchema.index({ vehicle: 1, createdAt: -1 });

module.exports = mongoose.models.VehicleDocument || mongoose.model('VehicleDocument', vehicleDocumentSchema);
