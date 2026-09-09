const mongoose = require('mongoose');

/**
 * تفقُّد بداية الدوام — المندوبُ لا يخرج من المحطّة إلّا والمشرفُ واقفٌ عليه.
 *
 * ── لماذا صورةٌ لا إقرار ─────────────────────────────────────────────────
 * كان خروجُ المندوب كلامًا: يقول المشرفُ «نزلوا كلُّهم»، فإذا رجعت الدرّاجةُ
 * مكسورةً لم يُعرَف أكانت كذلك قبل الخروج أم كُسرت في الطريق. فلا تُراجَع
 * الحادثةُ ولا يُسأل أحد.
 *
 * فصار لكلّ مندوبٍ في كلّ يومٍ صفٌّ واحد: مَن المشرفُ الذي أخرجه، ومتى، وصورةُ
 * مركبته ساعتَها. والصورةُ هي الحجّة: تُقارَن بما رجع، فيُعرَف أين وقع العطب
 * ومَن يُسأل عنه.
 *
 * ── والصورةُ تُلتقَط ولا تُرفَع ──────────────────────────────────────────
 * صورةٌ تُرفَع من الملفّات قد تكون صورةَ أمسِ أو صورةَ درّاجةٍ أخرى — وحينئذٍ
 * لا يكون هذا سجلًّا بل ورقةً تُملأ من المكتب. فالتقاطُها من الكاميرا مباشرةً
 * هو ما يجعلها شهادةً على أنّ المشرفَ كان واقفًا هناك. والواجهةُ لا تعرض زرَّ
 * رفعٍ أصلًا، و`captureSource` يُثبّت في الصفّ من أين جاءت.
 *
 * ── وصفٌّ واحدٌ لكلّ مندوبٍ في اليوم ─────────────────────────────────────
 * الفهرسُ الفريد على (المندوب، اليوم) يمنع تفقّدَين لرجلٍ واحدٍ في يوم — لا
 * لأنّه خطأ إدخالٍ فحسب، بل لأنّ عدَّ «كم نزل اليوم» يصير كذبًا لو تكرّر الصفّ.
 * ومَن أراد التصحيح يُعدَّل صفُّه لا يُضاف إليه ثانٍ.
 */
const photoSchema = new mongoose.Schema(
  {
    fileUrl: { type: String, required: true },
    fileName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number },
    // ما تقوله الصورةُ عن نفسها: التقاطٌ حيٌّ أم غيرُه. راجع رأس الملفّ.
    captureSource: { type: String, enum: ['camera', 'unknown'], default: 'camera' },
    takenAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const b2cDutyCheckSchema = new mongoose.Schema(
  {
    rep: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CRep', required: true, index: true },
    // المشرفُ الذي وقف على الخروج — لا الذي يملك المندوبَ في السجلّ. فقد يقوم
    // غيرُه مقامَه يومًا، والمحاسبةُ تكون على من فعل لا على من كان مسؤولًا.
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    supervisorName: { type: String, trim: true },   // لقطةُ اسمٍ تبقى لو تغيّر الحساب
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject', index: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },

    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, index: true }, // 'YYYY-MM-DD'
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    day: { type: Number, required: true },
    checkedAt: { type: Date, default: Date.now },

    /**
     * الحصيلة: أخرجَه أم لم يحضر أم مُنع من الخروج.
     * و«مُنع» ليست غيابًا: المركبةُ غيرُ صالحة، وهو قرارُ المشرف لا تخلّفُ الرجل.
     */
    outcome: {
      type: String,
      enum: ['started', 'absent', 'blocked'],
      default: 'started',
      index: true,
    },

    vehicleType: { type: String, enum: ['motorcycle', 'car', 'other', ''], default: '' },
    vehiclePlate: { type: String, trim: true },
    // حالةُ المركبة تُقرأ من قائمةٍ تُدار من إعدادات القسم لا من نصٍّ حرّ.
    conditionAr: { type: String, trim: true },
    hasDamage: { type: Boolean, default: false, index: true },
    damageNotes: { type: String, trim: true },
    notes: { type: String, trim: true },

    photos: { type: [photoSchema], default: [] },

    /**
     * موضعُ المشرف ساعةَ التفقّد — إن أذن المتصفّحُ به.
     * لا يُشترَط: المحطّةُ قد تكون مغلقةَ الإشارة، ورفضُ الإذن ليس تهمة. لكنّه
     * حين يوجد يجيب عن السؤال الذي لا تجيب عنه الصورةُ وحدَها: أكان هناك حقًّا؟
     */
    location: {
      lat: { type: Number },
      lng: { type: Number },
      accuracy: { type: Number },
    },

    // مراجعةُ الإدارة: تُقرأ الصورةُ فيُقال «سليم» أو «يُحاسَب».
    review: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
      verdict: { type: String, enum: ['ok', 'flagged', ''], default: '' },
      note: { type: String, trim: true },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// صفٌّ واحدٌ لكلّ مندوبٍ في اليوم — راجع رأس الملفّ.
b2cDutyCheckSchema.index({ rep: 1, dateKey: 1 }, { unique: true });
// شاشةُ الإدارة تُفتَح على يومٍ ثمّ تُصفّى بالمشرف أو الفرع أو المشروع.
b2cDutyCheckSchema.index({ dateKey: 1, supervisor: 1 });
b2cDutyCheckSchema.index({ dateKey: 1, branch: 1 });
b2cDutyCheckSchema.index({ dateKey: 1, outcome: 1 });
b2cDutyCheckSchema.index({ supervisor: 1, date: -1 });
b2cDutyCheckSchema.index({ hasDamage: 1, date: -1 });

module.exports = mongoose.model('B2CDutyCheck', b2cDutyCheckSchema);
