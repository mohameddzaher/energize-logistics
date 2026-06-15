const mongoose = require('mongoose');

// One document per remote employee per day. `date` is the Cairo-local calendar
// day as 'YYYY-MM-DD' so day-grouping doesn't drift across the UTC boundary.
const remoteAttendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (Africa/Cairo)
    checkIn: { type: Date },
    checkOut: { type: Date },
    durationMinutes: { type: Number, default: 0 },
    status: { type: String, enum: ['present', 'incomplete'], default: 'incomplete' },
  },
  { timestamps: true }
);

remoteAttendanceSchema.index({ user: 1, date: 1 }, { unique: true });
remoteAttendanceSchema.index({ date: -1 });

module.exports = mongoose.model('RemoteAttendance', remoteAttendanceSchema);
