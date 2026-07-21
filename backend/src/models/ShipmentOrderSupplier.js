const mongoose = require('mongoose');

// A 3PL supplier for the shipment-orders trial: whoever owns the truck when it
// is not ours. Either a company or an individual freelancer — the same row
// shape, one flag apart, because the workflow treats them identically.
//
// Suppliers are usually born from the create-shipment form ("this truck is not
// ours → whose is it?") rather than data entry, so most rows arrive with just a
// name and get enriched later.
const shipmentOrderSupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['company', 'freelancer'], default: 'company' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSupplierSchema.index({ name: 1 });

module.exports = mongoose.models.ShipmentOrderSupplier
  || mongoose.model('ShipmentOrderSupplier', shipmentOrderSupplierSchema);
