/**
 * مهمّةُ تحصيل — «مَن يزور مَن اليوم، وماذا حدث».
 *
 * ── ما تصفه ────────────────────────────────────────────────────────────────
 * مديرُ التحصيل يكتب لكلّ موظّفٍ خطّةَ يومه: هذا العميلُ يُزار، وهذا يُتَّصل به،
 * وهذا يُرسَل له بريد. والموظّفُ نفسُه يكتب خطّتَه للغد. فيأتي الصباحُ ويعرف
 * كلٌّ ما أمامه بلا سؤال.
 *
 * وبعد الفعل يُكتب ما حدث: نتيجةُ الزيارة، وكم حُصِّل. وهو أثرٌ يُقرأ في تقييم
 * الفريق، ويُقرأ في ملفّ العميل: متى كلّمناه آخرَ مرّة وبم أجاب.
 *
 * ── يومٌ وعميلٌ وموظّف ─────────────────────────────────────────────────────
 * الوحدةُ هي (عميل × يوم): في ورقتهم عمودٌ لكلّ يومٍ تحت كلّ عميل. فالمهمّةُ
 * هنا صفٌّ بتاريخه — يُقرأ بالأسبوع كما تُقرأ الورقة، وبالموظّف كما يُقرأ
 * التقييم، وبالعميل كما يُقرأ ملفُّه.
 */
const mongoose = require('mongoose');

const collectionTaskSchema = new mongoose.Schema({
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty', index: true },
  partyCode: { type: String, trim: true, default: '', index: true },
  partyName: { type: String, trim: true, default: '' },

  // اسمُ الموظّف كما يُكتب في الورقة، ومعرّفُه حين يُربط بحسابٍ في النظام.
  officerName: { type: String, trim: true, default: '', index: true },
  officer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  date: { type: String, required: true, index: true },   // YYYY-MM-DD — يومُ المهمّة

  // نوعُ التواصل المطلوب: زيارةُ مكتبٍ، أو اتّصال، أو بريد، أو تسليمُ فاتورة.
  requestType: { type: String, trim: true, default: '' },
  planned: { type: Boolean, default: true },             // «x» في الورقة
  status: { type: String, trim: true, default: '' },     // Done / …
  collected: { type: Number, default: 0 },               // ما حُصِّل في هذه الزيارة
  action: { type: String, trim: true, default: '' },     // ما حدث، بكلام من قام به
  notes: { type: String, trim: true, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, trim: true, default: '' },
}, { timestamps: true });

// صفٌّ واحدٌ لكلّ (عميل × يوم × نوعِ طلب) — فلا يُستورَد اليومُ مرّتين.
collectionTaskSchema.index({ party: 1, date: 1, requestType: 1 }, { unique: true, sparse: true });
collectionTaskSchema.index({ officerName: 1, date: -1 });
collectionTaskSchema.index({ date: -1, status: 1 });

module.exports = mongoose.models.CollectionTask
  || mongoose.model('CollectionTask', collectionTaskSchema);
