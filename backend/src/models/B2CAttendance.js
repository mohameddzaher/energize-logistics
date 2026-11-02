/**
 * Attendance of Amazon riders. Amazon has no orders, only attendance records.
 * Most riders attend every day, so presence is the default and is not stored; only absence is. The project manager marks who did not attend and the rest are present, instead of marking everyone daily. Marking a rider present again deletes his row.
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
