/**
 * ربطُ حسابٍ باسمٍ آخر — اقتراحٌ يُعرض، لا دمجٌ يقع.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * أسماءُ العملاء عندنا جاءت من كشوف التشغيل: يكتبها موظّفٌ بسرعة، فتخرج
 * «شركه صليهم الهاجري». واسمُ الحساب في دفتر المحاسبة «شركة صليهم سعيد
 * الهاجري للنقليات». حسابٌ واحدٌ باسمين، ومن ٢٥٣ حسابًا في الدفتر لم يطابق
 * أسماءَنا إلّا ٣٧.
 *
 * ── ولماذا لا يُدمَج ما تشابه ──────────────────────────────────────────────
 * الدمجُ ينقل مديونيّةً من حسابٍ إلى حساب. وتشابهُ الأسماء يُخطئ: «مؤسسة
 * النور للنقليات» و«مؤسسة النور التجارية» متشابهتان ولا تجمعهما جهة. وخطأٌ
 * هنا لا يُكتشف إلّا حين يُطالَب عميلٌ بمالِ غيرِه.
 *
 * فما تجاوز تشابهُه حدًّا عاليًا جدًّا يُربط، وما دونه يُعرض على مدير التحصيل
 * في شاشةٍ يقرّر فيها واحدًا واحدًا. والقرارُ يُحفَظ فلا يُسأل عنه مرّتين.
 */
const mongoose = require('mongoose');

const partyLinkSuggestionSchema = new mongoose.Schema({
  // الحسابُ كما جاء من الدفتر.
  code: { type: String, trim: true, required: true },
  accountName: { type: String, trim: true, required: true },
  kind: { type: String, enum: ['tax', 'cash'], default: 'tax' },

  // المرشَّحُ عندنا، ودرجةُ التشابه التي رُشِّح بها.
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty' },
  candidateName: { type: String, trim: true, default: '' },
  score: { type: Number, default: 0 },

  // 'pending' ينتظر · 'linked' رُبط · 'separate' حسابٌ مستقلّ
  decision: { type: String, enum: ['pending', 'linked', 'separate'], default: 'pending', index: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: { type: Date },
  // 'auto' رُبط تلقائيًّا لعلوّ التشابه · 'manual' قرارُ إنسان
  decidedHow: { type: String, trim: true, default: '' },
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty' },
}, { timestamps: true });

partyLinkSuggestionSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.models.PartyLinkSuggestion
  || mongoose.model('PartyLinkSuggestion', partyLinkSuggestionSchema);
