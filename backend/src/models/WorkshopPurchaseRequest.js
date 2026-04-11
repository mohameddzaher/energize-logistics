const mongoose = require('mongoose');

const workshopPurchaseRequestSchema = new mongoose.Schema({
  // What's needed
  itemName: { type: String, required: true, trim: true },
  quantity: { type: Number, default: 1 },
  description: { type: String, trim: true },

  // Link to maintenance request
  maintenanceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceRequest' },
  vehicleNumber: { type: String, trim: true },

  // Status flow: pending → received → fulfilled
  status: { type: String, enum: ['pending', 'received', 'fulfilled'], default: 'pending' },

  // Purchasing details (filled by purchasing team)
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receivedAt: { type: Date },
  cost: { type: Number },
  supplier: { type: String, trim: true },
  invoiceNumber: { type: String, trim: true },
  fulfilledAt: { type: Date },
  fulfilledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  fulfillmentNotes: { type: String, trim: true },

  // Tracking
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
}, { timestamps: true });

workshopPurchaseRequestSchema.index({ status: 1 });
workshopPurchaseRequestSchema.index({ maintenanceRequest: 1 });
workshopPurchaseRequestSchema.index({ createdAt: -1 });
workshopPurchaseRequestSchema.index({ requestedBy: 1 });
workshopPurchaseRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('WorkshopPurchaseRequest', workshopPurchaseRequestSchema);
