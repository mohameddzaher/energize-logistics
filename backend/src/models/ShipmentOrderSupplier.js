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

    // Supplier data as carried by the operations platform.
    // A supplier is a commercial register, tax card, IBAN for transfers, a manager and an accountant each with a number, not just a name and phone; calling the owner about an invoice wastes a day. Payment terms are what it is settled on.
    externalId: { type: String, trim: true, default: '', index: true },
    commercialRegister: { type: String, trim: true, default: '' },
    taxCard: { type: String, trim: true, default: '' },
    nationalAddress: { type: String, trim: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    iban: { type: String, trim: true, default: '' },
    ownerName: { type: String, trim: true, default: '' },
    ownerPhone: { type: String, trim: true, default: '' },
    managerName: { type: String, trim: true, default: '' },
    managerPhone: { type: String, trim: true, default: '' },
    accountantName: { type: String, trim: true, default: '' },
    accountantPhone: { type: String, trim: true, default: '' },
    paymentTerms: { type: String, trim: true, default: '' },
    agreedPriceStatement: { type: String, trim: true, default: '' },
    contractFile: { type: String, trim: true, default: '' },

    // Merging.
    // One supplier may have several records in the operations platform (one has two). When two are merged, the other's id stays here so import finds it under either and does not recreate it. The merged record stays disabled with `mergedInto`, a permanent trail.
    externalIds: { type: [String], default: [], index: true },
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSupplierSchema.index({ name: 1 });

// Saved shipment-order lists are cleared on every write.
// The suppliers and trucks lists are cached for two minutes (so:registry) because reading them from the cluster is slow. A supplier appears inside the trucks list and its truck count in its own list, so any write to either, from any screen or script, clears the whole prefix.
const clearRegistry = () => {
  try { require('../utils/ttlCache').clear('so:registry:'); } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderSupplierSchema.post(op, clearRegistry);
}

module.exports = mongoose.models.ShipmentOrderSupplier
  || mongoose.model('ShipmentOrderSupplier', shipmentOrderSupplierSchema);
