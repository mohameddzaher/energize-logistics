/**
 * خطّةُ العمل (JP) — المهامُّ والمشروعاتُ التي يُدار بها عملُ القسم اليوميّ.
 *
 * ── نطاقان بنموذجٍ واحد ────────────────────────────────────────────────────
 *   section     داخل القسم: المديرُ يُسند إلى موظّفيه.
 *   management  بين الإدارة العليا ومديري الأقسام: المعنى نفسُه درجةً أعلى.
 * فالقواعدُ واحدةٌ والشاشةُ واحدة، ويختلف من هو «المدير» ومن هم «الفريق».
 *
 * ── مهمّةٌ وطلب ────────────────────────────────────────────────────────────
 * ما يُسنده المديرُ **مهمّة**. وما يكتبه الموظّفُ لنفسه أو لزميله **طلب**: هو
 * ليس تكليفًا من صاحب صلاحيّة، ويُعَدّ ويُقرأ على حدة. والنوعُ يحدّده الخادمُ
 * ممّن كتب، لا يُرسَل من الشاشة.
 *
 * ── والموعدُ اختياريٌّ، بيومٍ أو بساعات ────────────────────────────────────
 * «سلِّمها يوم كذا» أو «أمامك ساعتان». ويُخزَّن في الحالين لحظةً واحدة
 * (`deadlineAt`) يُقاس عليها التأخّر، ومعها كيف قيل الموعد ليُعرَض كما قيل.
 */
const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  // مرفقُ التكليف (ممّن أسند) أم مرفقُ الإتمام (ممّن نفّذ).
  phase: { type: String, enum: ['brief', 'done'], default: 'brief' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

const SCOPES = ['section', 'management'];
// طريقةُ التواصل حين تكون المهمّةُ «كلِّم فلانًا».
const ACTIONS = ['', 'call', 'whatsapp', 'visit', 'email', 'meeting', 'other'];

const jpProjectSchema = new mongoose.Schema({
  scope: { type: String, enum: SCOPES, required: true },
  section: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, default: '', maxlength: 2000 },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // مشروعُ قسمٍ وُلِد من مشروعٍ أسندته الإدارةُ العليا إلى مديره — راجع parentTask.
  parentProject: { type: mongoose.Schema.Types.ObjectId, ref: 'JpProject', default: null },
}, { timestamps: true });
jpProjectSchema.index({ scope: 1, section: 1, status: 1 });

const jpTaskSchema = new mongoose.Schema({
  scope: { type: String, enum: SCOPES, required: true },
  section: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['task', 'request'], required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'JpProject', default: null },

  title: { type: String, required: true, trim: true, maxlength: 200 },
  details: { type: String, trim: true, default: '', maxlength: 4000 },
  action: { type: String, enum: ACTIONS, default: '' },
  // مع من يكون التواصل — اسمٌ أو رقم، كما يكتبه المدير.
  contact: { type: String, trim: true, default: '', maxlength: 200 },

  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  deadlineKind: { type: String, enum: ['', 'date', 'hours'], default: '' },
  deadlineHours: { type: Number, default: null },
  deadlineAt: { type: Date, default: null },

  // الإتمامُ اختياريّ: المهمّةُ تبقى مفتوحةً حتى يقول صاحبُها إنّها تمّت.
  status: { type: String, enum: ['open', 'done'], default: 'open' },
  doneAt: { type: Date, default: null },
  doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  doneNote: { type: String, trim: true, default: '', maxlength: 2000 },

  attachments: [attachmentSchema],

  // ── مهمّةٌ نزلت من الإدارة العليا ────────────────────────────────────────
  // مديرُ القسم يُسند ما كُلِّف به إلى أحد موظّفيه: فتُنشأ مهمّةُ قسمٍ عاديّةٌ
  // باسمه هو، وهذا الرابطُ يصلها بأصلها. **ولا يخرج إلى الموظّف أبدًا** — هو
  // يرى مهمّةً من مديره لا غير؛ والرابطُ للمدير وللإدارة ليعرفا أين وصلت.
  parentTask: { type: mongoose.Schema.Types.ObjectId, ref: 'JpTask', default: null, index: true },
}, { timestamps: true });
jpTaskSchema.index({ scope: 1, section: 1, status: 1, deadlineAt: 1 });
jpTaskSchema.index({ assignedTo: 1, status: 1 });
jpTaskSchema.index({ createdBy: 1 });
jpTaskSchema.index({ project: 1 });

const JpProject = mongoose.models.JpProject || mongoose.model('JpProject', jpProjectSchema);
const JpTask = mongoose.models.JpTask || mongoose.model('JpTask', jpTaskSchema);

module.exports = { JpProject, JpTask, SCOPES, ACTIONS };
