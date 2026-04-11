const mongoose = require('mongoose');

const maintenanceTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  estimatedDuration: { type: Number }, // minutes
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

maintenanceTypeSchema.index({ name: 1 });
maintenanceTypeSchema.index({ isActive: 1 });

module.exports = mongoose.model('MaintenanceType', maintenanceTypeSchema);
