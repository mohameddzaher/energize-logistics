const mongoose = require('mongoose');

/**
 * A selling-price edit held for approval (config/sellingPriceRequests).
 * Points at the workflow row and/or the shipment order; the order fields are a
 * snapshot for the approver's list, not a second source of truth.
 */
const schema = new mongoose.Schema({
  workflow: { type: mongoose.Schema.Types.ObjectId, ref: 'OperationsWorkflow', default: null, index: true },
  shipmentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrder', default: null, index: true },
  // Screen the edit came from; approval writes through that side's path.
  origin: { type: String, enum: ['workflow', 'shipment_order'], required: true },
  reportNumber: { type: String, default: '' },
  customerName: { type: String, default: '' },
  fromCity: { type: String, default: '' },
  toCity: { type: String, default: '' },
  orderDate: { type: Date, default: null },
  driverName: { type: String, default: '' },
  plate: { type: String, default: '' },
  oldPrice: { type: Number, default: 0 },
  requestedPrice: { type: Number, required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByName: { type: String, default: '' },
  requestedByRole: { type: String, default: '' },
  requestedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  reason: { type: String, default: '', trim: true },
  // Price on the order when the approver decided; differs from oldPrice if someone else edited meanwhile.
  priceAtDecision: { type: Number, default: null },
}, { timestamps: true });

schema.index({ status: 1, requestedAt: -1 });

module.exports = mongoose.model('SellingPriceChangeRequest', schema);
