const mongoose = require('mongoose');

const b2cProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    // Project name in the light-transport register (`LightTransportEmployee.projectAr`): Keeta, HungerStation, Ninja, Amazon.
    // Links a rep's project to the order project, so moving a rep moves their orders from that day (utils/b2cEntry).
    nameAr: { type: String, trim: true, index: true },
    // Amazon is counted by shipments and has no target (monthly target 0).
    unitAr: { type: String, trim: true, default: 'طلب' },
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
