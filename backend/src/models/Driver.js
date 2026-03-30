const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    idNumber: { type: String, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    totalPaid: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    notes: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

driverSchema.index({ name: 1 });
driverSchema.index({ branch: 1 });
driverSchema.index({ isActive: 1 });

module.exports = mongoose.model('Driver', driverSchema);
