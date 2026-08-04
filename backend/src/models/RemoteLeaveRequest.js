const mongoose = require('mongoose');

const remoteLeaveRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['annual', 'sick', 'emergency', 'personal', 'unpaid', 'other'], default: 'annual' },
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true }, // YYYY-MM-DD
    days: { type: Number, default: 1 },
    reason: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true },
  },
  { timestamps: true }
);

remoteLeaveRequestSchema.index({ user: 1, createdAt: -1 });
remoteLeaveRequestSchema.index({ status: 1 });

module.exports = mongoose.model('RemoteLeaveRequest', remoteLeaveRequestSchema);
