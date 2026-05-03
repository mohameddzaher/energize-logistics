const mongoose = require('mongoose');

const b2cExcelUploadSchema = new mongoose.Schema(
  {
    fileName: { type: String, trim: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject' },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    monthsDetected: [{ type: String }], // ['January 2026', 'February 2026', ...]
    repsDetected: { type: Number, default: 0 },
    repsCreated: { type: Number, default: 0 },
    daysInserted: { type: Number, default: 0 },
    daysUpdated: { type: Number, default: 0 },
    daysSkipped: { type: Number, default: 0 },
    warnings: [{ type: String }],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mode: { type: String, enum: ['merge_new_only', 'overwrite'], default: 'merge_new_only' },
  },
  { timestamps: true }
);

b2cExcelUploadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('B2CExcelUpload', b2cExcelUploadSchema);
