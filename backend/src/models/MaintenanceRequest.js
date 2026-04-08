const mongoose = require('mongoose');

const maintenanceRequestSchema = new mongoose.Schema({
  // Vehicle info
  vehicleNumber: { type: String, required: true, trim: true },
  vehicleType: { type: String, trim: true },
  driverName: { type: String, trim: true },

  // Timing
  startTime: { type: Date, required: true, default: Date.now },
  endTime: { type: Date },
  duration: { type: Number }, // minutes, calculated on completion

  // Status: open → in_progress → completed
  status: { type: String, enum: ['open', 'in_progress', 'completed'], default: 'open' },

  // Maintenance details (filled on completion)
  workDescription: { type: String, trim: true },
  technicianName: { type: String, trim: true },
  notes: { type: String, trim: true },

  // Parts/items needed (can generate purchase requests)
  partsNeeded: [{
    name: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    sentToPurchasing: { type: Boolean, default: false },
    purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkshopPurchaseRequest' },
  }],

  // Tracking
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
}, { timestamps: true });

maintenanceRequestSchema.index({ status: 1 });
maintenanceRequestSchema.index({ vehicleNumber: 1 });
maintenanceRequestSchema.index({ createdAt: -1 });
maintenanceRequestSchema.index({ branch: 1 });

module.exports = mongoose.model('MaintenanceRequest', maintenanceRequestSchema);
