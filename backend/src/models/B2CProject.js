const mongoose = require('mongoose');

const b2cProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    color: { type: String, default: '#f37121' },
    monthlyTarget: { type: Number, default: 400 },
    dailyTarget: { type: Number, default: 15 },
    expectedWorkingDays: { type: Number, default: 26 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

b2cProjectSchema.index({ isActive: 1 });

module.exports = mongoose.model('B2CProject', b2cProjectSchema);
