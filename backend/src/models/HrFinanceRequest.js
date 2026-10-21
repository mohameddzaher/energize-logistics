const mongoose = require('mongoose');

/**
 * طلبٌ من الموارد البشريّة إلى الإدارة الماليّة في شأن موظّفين.
 *
 * الموارد البشريّة تختار موظّفًا أو أكثر وتكتب أمامَ كلٍّ منهم ما تحتاجه له
 * (رسومُ نقل كفالة، تأشيرةُ خروجٍ وعودة، غرامةُ تأخير…)، وترفق ما يلزم. والماليّة
 * تجيب: «تمّ» أو «لم يتمّ»، بملاحظةٍ ومرفقاتٍ إن شاءت. ويصل كلَّ طرفٍ إشعارٌ بما
 * فعله الآخر.
 *
 * والجوابُ قابلٌ للتصحيح، وكلُّ جوابٍ يُحفظ في `history` — فما قيل أوّلًا لا
 * يضيع إن غُيِّر.
 */
const STATUSES = ['pending', 'done', 'not_done'];

const fileSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const itemSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  // لقطةٌ تبقى وإن غُيِّر الملفّ لاحقًا.
  name: { type: String, trim: true, default: '' },
  employeeNumber: { type: String, trim: true, default: '' },
  idNumber: { type: String, trim: true, default: '' },
  department: { type: String, trim: true, default: '' },
  // ما تحتاجه الموارد البشريّة لهذا الموظّف — خانةٌ واحدة.
  note: { type: String, trim: true, default: '' },
}, { _id: true });

const historySchema = new mongoose.Schema({
  status: { type: String, enum: STATUSES },
  note: { type: String, trim: true, default: '' },
  files: [fileSchema],
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
  at: { type: Date, default: Date.now },
}, { _id: false });

const hrFinanceRequestSchema = new mongoose.Schema({
  number: { type: Number, index: true },
  items: { type: [itemSchema], validate: [(v) => Array.isArray(v) && v.length > 0, 'اختر موظّفًا واحدًا على الأقلّ'] },
  files: [fileSchema],

  status: { type: String, enum: STATUSES, default: 'pending', index: true },
  answerNote: { type: String, trim: true, default: '' },
  answerFiles: [fileSchema],
  answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  answeredByName: { type: String, trim: true, default: '' },
  answeredAt: { type: Date, default: null },
  history: [historySchema],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  createdByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

hrFinanceRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.HrFinanceRequest || mongoose.model('HrFinanceRequest', hrFinanceRequestSchema);
module.exports.STATUSES = STATUSES;
