const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, unique: true, uppercase: true, trim: true },
    city: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// `name` is already indexed via `unique: true` above — no separate index needed.
branchSchema.index({ isActive: 1 });

module.exports = mongoose.model('Branch', branchSchema);
