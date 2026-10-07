const mongoose = require('mongoose');

/**
 * طلبٌ من قسمٍ إلى الموارد البشريّة في شأن موظّفين.
 *
 * ── المشكلةُ التي يحلّها ────────────────────────────────────────────────────
 * حالةُ الموظّف في الموارد البشريّة هي الحقيقةُ التي تبني عليها الأقسام: من
 * أُنهيت خدمتُه لا يُصدَر له أمرُ تشغيل، ومن ليس على رأس العمل لا تُسجَّل عليه
 * مركبة. وهذا صحيحٌ ويتأخّر: المندوبُ يعود إلى العمل اليومَ، ويبلغ الخبرُ
 * الموارد البشريّة بعد أيّام — فيبقى في النظام «منتهيًا» ولا يُشغَّل، أو يبقى
 * «على رأس العمل» وقد ترك.
 *
 * فالقسمُ الذي يرى الميدان يقول ما رآه: «هؤلاء عادوا»، «هذا لم يعد»، أو أيُّ
 * طلبٍ آخر. ولا يُجبَر على تسمية أحد — طلبٌ بلا أسماءٍ طلبٌ أيضًا.
 *
 * ── وما يميّزها عن شكوى أو مهمّة ────────────────────────────────────────────
 * `SectionWork` مهامٌّ وشكاوى **داخل** القسم. وهذا عبورٌ بين قسمين: له مُرسِلٌ
 * ومستقبِلٌ وجوابٌ ملزَم — تُستلَم، ثمّ تُنفَّذ أو تُرفَض **بسببٍ مكتوب**. ورفضٌ
 * بلا سببٍ يُعاد إرسالُه غدًا كما هو.
 *
 * والجوابُ قد يكون جزئيًّا: عشرةُ مناديبَ في طلبٍ واحد، سبعةٌ عادوا فعلًا
 * وثلاثةٌ عندهم مشكلة. فلكلّ اسمٍ قرارُه ونصُّه، ولا يُلخَّص الطلبُ كلُّه في
 * كلمةٍ واحدة.
 */
const SECTIONS = ['B2C', 'Light Transport', 'Fleet Management', 'Operations', 'Location Solutions',
  'Vehicles', 'Customs', 'Collections', 'Workshop', 'Other'];

const KINDS = [
  'back_to_work',   // عاد على رأس العمل
  'service_ended',  // لم يعد / أُنهيت خدمتُه
  'on_leave',       // في إجازة
  'data_fix',       // تصحيحُ بياناتٍ
  'other',
];

const subjectSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  // اللقطةُ تبقى وإن غُيِّر الاسمُ لاحقًا — الطلبُ وثيقةٌ تُقرأ بعد شهور.
  name: { type: String, trim: true, default: '' },
  employeeNumber: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  // قرارُ الموارد البشريّة في هذا الاسم وحدَه.
  decision: { type: String, enum: ['pending', 'done', 'rejected'], default: 'pending' },
  decisionNote: { type: String, trim: true, default: '' },
  decidedAt: { type: Date, default: null },
}, { _id: true });

const staffStatusRequestSchema = new mongoose.Schema({
  number: { type: Number, index: true },            // تسلسلٌ يُقال في المحادثة
  section: { type: String, enum: SECTIONS, default: 'B2C', index: true },
  kind: { type: String, enum: KINDS, default: 'back_to_work', index: true },
  title: { type: String, trim: true, default: '' },
  body: { type: String, trim: true, default: '' },

  subjects: [subjectSchema],

  // `new` حتى تُستلَم، ثمّ `received`، ثمّ `done` أو `rejected`.
  status: { type: String, enum: ['new', 'received', 'done', 'rejected'], default: 'new', index: true },
  // ورفضُ الطلبِ كلِّه لا يصحّ بلا سبب — يُحرَس في المتحكّم.
  decisionNote: { type: String, trim: true, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, trim: true, default: '' },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedByName: { type: String, trim: true, default: '' },
  receivedAt: { type: Date, default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, trim: true, default: '' },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

staffStatusRequestSchema.index({ status: 1, createdAt: -1 });
staffStatusRequestSchema.index({ section: 1, createdAt: -1 });

module.exports = mongoose.models.StaffStatusRequest
  || mongoose.model('StaffStatusRequest', staffStatusRequestSchema);
module.exports.SECTIONS = SECTIONS;
module.exports.KINDS = KINDS;
