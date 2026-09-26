const mongoose = require('mongoose');

/**
 * طلبُ تصديرٍ يُبنى في الخلفيّة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * «كلُّ الكشوف» ستّةٌ وثلاثون ألفَ صفٍّ وملفٌّ يقارب اثنين وعشرين ميجابايت،
 * وبناؤه نصفُ دقيقة. وكان يُبنى داخلَ الطلب نفسِه: الموظّفُ ينتظر أمام صفحةٍ
 * لا تستجيب، وإن أغلقها أو انقطعت شبكتُه ضاع العملُ كلُّه وأُعيد من أوّله.
 *
 * فصار طلبًا مسجَّلًا: يُقال له «جاري التجهيز» فيمضي إلى عمله، ويُبنى الملفُّ
 * في الخادم، ويصله إشعارٌ فيه رابطُ التنزيل حين يجهز. ولو أُغلقت الصفحةُ بقي
 * الملفُّ ينتظره.
 */
const exportJobSchema = new mongoose.Schema(
  {
    // ما يُصدَّر: مفتاحٌ معروفٌ في exportRunners — لا مسارٌ يأتي من المتصفّح.
    kind: { type: String, required: true, index: true },
    query: { type: Object, default: {} },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedByName: { type: String, default: '' },
    // والدورُ يُحفظ مع الطلب: الملفُّ يُبنى بحجب المال بحسب دور صاحبه، فلا
    // يصير التصديرُ بابًا خلفيًّا لعمودٍ محجوبٍ على الشاشة.
    role: { type: String, default: '' },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued', index: true },
    rows: { type: Number, default: 0 },
    fileName: { type: String, default: '' },
    filePath: { type: String, default: '' },   // على القرص، لا يُرسَل للمتصفّح
    size: { type: Number, default: 0 },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    // يُحذف الملفُّ بعد يوم — التصديرةُ لقطةٌ للحظتها، وحفظُها أبدًا يملأ القرص.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), index: true },
  },
  { timestamps: true },
);

exportJobSchema.index({ requestedBy: 1, createdAt: -1 });

module.exports = mongoose.models.ExportJob || mongoose.model('ExportJob', exportJobSchema);
