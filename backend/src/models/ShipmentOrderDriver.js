const mongoose = require('mongoose');

/**
 * Carrier truck drivers: a register that was entirely missing.
 * Before: the section recorded the supplier and its truck, with the driver only a name and phone typed on the truck row (`defaultDriverName`/`defaultDriverPhone`), so there was no way to list a supplier's drivers, find a residence number or card expiry, and a different spelling made two people.
 * The operations platform holds a full file for each driver; this register mirrors it here.
 * The driver links a truck to its owner: the platform's vehicle register has no owner, while the driver record has both (`car` and `carOwner`). Truck-to-supplier assignment is read from here instead of inferred from order history by plate, which left thousands of owners unknown. Knowing beats inferring.
 */
const shipmentOrderDriverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    nationality: { type: String, trim: true, default: '' },
    /** Residence number; identifies the person when names are similar. */
    residenceNumber: { type: String, trim: true, default: '', index: true },
    /**
     * A driver who is our employee is read from his file.
     * Company rule: one record per person. Someone whose residence number is in HR is linked to that file here, with name, mobile and nationality shown from there. Outside carrier drivers stay as they are.
     */
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },

    // Operating card: a driver with an expired card is not loaded. The road stops him, not us, so knowing the date before assignment saves a stalled load.
    driverCardNumber: { type: String, trim: true, default: '' },
    driverCardExpiry: { type: String, trim: true, default: '' },

    companyName: { type: String, trim: true, default: '' },
    sponsorName: { type: String, trim: true, default: '' },

    // Document images as the platform holds them: their links, not copies.
    residenceImage: { type: String, trim: true, default: '' },
    licenseImage: { type: String, trim: true, default: '' },
    absherImage: { type: String, trim: true, default: '' },

    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderVehicle', default: null, index: true },

    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    /** Its id in the operations platform, used to match on every import so it is not duplicated. */
    externalId: { type: String, trim: true, default: '', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderDriverSchema.index({ name: 1 });
// Active drivers per supplier, counted on every suppliers screen, from the index alone.
shipmentOrderDriverSchema.index({ supplier: 1, isActive: 1 });

// Saved shipment-order lists are cleared on every write.
// A driver appears in the trucks list (its usual driver) and in the supplier's driver count, so any write to it, from any screen or script, clears the whole prefix.
const clearRegistry = () => {
  try { require('../utils/ttlCache').clear('so:registry:'); } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderDriverSchema.post(op, clearRegistry);
}

module.exports = mongoose.models.ShipmentOrderDriver
  || mongoose.model('ShipmentOrderDriver', shipmentOrderDriverSchema);
