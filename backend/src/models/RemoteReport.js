const mongoose = require('mongoose');

// Daily work report submitted by a remote employee. One per employee per day.
const remoteReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (Africa/Cairo)
    body: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

remoteReportSchema.index({ user: 1, date: -1 }, { unique: true });
remoteReportSchema.index({ date: -1 });

module.exports = mongoose.model('RemoteReport', remoteReportSchema);
