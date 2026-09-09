const mongoose = require('mongoose');

const b2cRepSchema = new mongoose.Schema(
  {
    repId: { type: String, trim: true, index: true }, // App account ID (rep's login on the delivery app)
    arabicName: { type: String, trim: true },
    englishName: { type: String, trim: true, required: true },
    phone: { type: String, trim: true },
    joiningDate: { type: Date },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject' },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    /**
     * المشرفُ المسؤول عن هذا المندوب.
     *
     * الفرعُ يقول أين يعمل، ولا يقول مَن يقف عليه صباحًا. وفرعٌ واحدٌ فيه
     * مشرفان وثلاثون مندوبًا — فلولا هذا الحقلُ لفتح كلُّ مشرفٍ قائمةَ الفرع
     * كلِّه وبحث فيها عن رجاله، أو تفقّد رجالَ غيره.
     *
     * وهو صلةٌ إداريّةٌ لا صلاحيّة: مَن يُذكَر هنا يرى هؤلاء في شاشة التفقّد،
     * ومَن لا مندوبَ له لا يرى شيئًا. راجع `controllers/b2cDutyController`.
     */
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    monthlyTarget: { type: Number, default: 400 },
    dailyTarget: { type: Number, default: 15 },
    expectedWorkingDays: { type: Number, default: 26 },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Composite uniqueness: repId per project (when both present)
b2cRepSchema.index({ repId: 1, project: 1 }, { unique: false, sparse: true });
b2cRepSchema.index({ englishName: 1 });
b2cRepSchema.index({ project: 1, isActive: 1 });
b2cRepSchema.index({ branch: 1, isActive: 1 });
b2cRepSchema.index({ supervisor: 1, isActive: 1 });

module.exports = mongoose.model('B2CRep', b2cRepSchema);
