/**
 * قالبُ بريد كشف الحساب — يكتبه قسمُ التحصيل من إعداداته (٢٠٢٦/١٠/٢٤).
 *
 * صفٌّ واحدٌ لكلّ قالب (`key`). يُقرأ من القاعدة في كلّ مسودّةٍ بلا ذاكرةٍ مؤقّتة،
 * فما يُعدَّل يصل أوّلَ إرسالٍ بعده. وخاناتُه بين قوسين — راجع PLACEHOLDERS في
 * controllers/collectionsMailController.
 */
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },   // 'statement'
  subject: { type: String, default: '', trim: true, maxlength: 300 },
  body: { type: String, default: '', maxlength: 8000 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.CollectionsEmailTemplate || mongoose.model('CollectionsEmailTemplate', schema);
