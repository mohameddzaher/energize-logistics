/**
 * حضورُ مناديب أمازون — أمازون لا أوردرات لها، بل تسجيلُ حضور.
 *
 * والأغلبُ يحضر كلَّ يوم، فالحضورُ هو الأصل ولا يُكتب: يُكتب **الغيابُ** وحدَه.
 * مديرُ المشروع يعلّم مَن لم يحضر، والباقون حاضرون — بدل أن يعلّم الجميعَ كلَّ
 * يوم (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠). وإعادةُ المندوب «حاضرًا» تحذف صفَّه.
 */
const mongoose = require('mongoose');

const b2cAttendanceSchema = new mongoose.Schema({
  lt: { type: mongoose.Schema.Types.ObjectId, ref: 'LightTransportEmployee', required: true },
  dateKey: { type: String, required: true }, // YYYY-MM-DD
  projectAr: { type: String, trim: true, default: '' },
  present: { type: Boolean, default: false },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
}, { timestamps: true });
b2cAttendanceSchema.index({ lt: 1, dateKey: 1 }, { unique: true });
b2cAttendanceSchema.index({ dateKey: 1 });

module.exports = mongoose.models.B2CAttendance || mongoose.model('B2CAttendance', b2cAttendanceSchema);
