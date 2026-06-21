const mongoose = require('mongoose');

// Configurable leave categories. HR can add their own at any time. A set of
// Saudi-labour-law defaults is seeded on first run (see config/hrDefaults.js).
const leaveTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, lowercase: true },
    nameEn: { type: String, required: true, trim: true },
    nameAr: { type: String, required: true, trim: true },
    paid: { type: Boolean, default: true },
    // Whether using this leave deducts from the annual accrued balance.
    affectsBalance: { type: Boolean, default: true },
    color: { type: String, default: '#f37121' },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

leaveTypeSchema.index({ active: 1 });

module.exports = mongoose.model('LeaveType', leaveTypeSchema);
