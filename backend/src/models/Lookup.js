const mongoose = require('mongoose');

// A single generic collection that backs every editable reference list / dropdown
// in the system (procurement categories, CRM industries, sources, etc.). Each row
// belongs to a `type` (registered in config/lookupTypes.js). Workflow-critical
// enums (statuses, pipeline stages) are intentionally NOT stored here — they stay
// in code so business logic can rely on their keys.
const lookupSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, index: true },
    key: { type: String, required: true, trim: true }, // stable slug stored on documents
    nameEn: { type: String, required: true, trim: true },
    nameAr: { type: String, required: true, trim: true },
    color: { type: String, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false }, // seeded default
    // ── شاهدةُ قبر ───────────────────────────────────────────────────────────
    // البذرُ عند الإقلاع ينشئ ما لا يجده، فالقيمةُ المبذورةُ التي تُحذَف حذفًا
    // نهائيًّا تعود في أوّل إعادة تشغيل. ولذلك كان زرُّ الحذف مخفيًّا عنها —
    // وهو حلٌّ للعَرَض: القائمةُ تمتلئ بقيمٍ لا تُستعمل ولا تُزال.
    // فتُعلَّم محذوفةً: تختفي من كلّ قائمةٍ ولا يعيدها البذرُ لأنّه يجدها.
    deleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One key per type.
lookupSchema.index({ type: 1, key: 1 }, { unique: true });
lookupSchema.index({ type: 1, isActive: 1, order: 1 });

module.exports = mongoose.model('Lookup', lookupSchema);
