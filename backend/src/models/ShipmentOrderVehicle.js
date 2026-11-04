const mongoose = require('mongoose');

// A truck the shipment-orders section can put on a load.
//
// The default driver ride along so that picking the truck on the create form
// fills the driver in one tap — the automation the section exists for. Both
// stay editable per shipment; a truck driven by someone else today is normal.
const shipmentOrderVehicleSchema = new mongoose.Schema(
  {
    plate: { type: String, required: true, trim: true ,
      // Plate format is the same across the system; see `formatPlate`.
      set: (v) => require('../utils/plateKey').formatPlate(v),
    },
    name: { type: String, trim: true, default: '' },        // e.g. white Mercedes Actros
    truckType: { type: String, trim: true, default: '' },   // same vocabulary as the form field
    /**
     * Make and color: the waybill asks for them.
     * The waybill has vehicle data (plate, make, color). The carrier truck register lacked the last two, so both boxes printed empty on every paper that goes out with a driver, papers handed over at gates and checked. They are now fields asked when a truck is registered.
     */
    brand: { type: String, trim: true, default: '' },
    color: { type: String, trim: true, default: '' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },

    /**
     * Whose truck this is, explicitly and not by absence (no supplier used to mean ours, which wrongly counted imported carrier trucks as our fleet).
     * supplier: a carrier's truck, referenced in `supplier`; ours: our fleet, matches our vehicle register by plate; unknown: from order history, owner not yet known.
     * Our fleet is managed in fleet management, so `ours` is not shown in the supplier truck picker.
     */
    ownership: {
      type: String, enum: ['supplier', 'ours', 'unknown'], default: 'unknown', index: true,
    },
    /**
     * Our truck is a reference to the vehicle register, not a copy.
     * Company rule: a vehicle is one record. An `ours` truck resolves by plate to `VehicleMaster` (utils/vehicleRef, the unified Arabic/Latin key), and its plate, make, color and year are read from there, so register edits show here. Supplier trucks have no reference since they are not in our register.
     */
    vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
    defaultDriverName: { type: String, trim: true, default: '' },
    defaultDriverPhone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // Vehicle data as carried by the operations platform.
    externalId: { type: String, trim: true, default: '', index: true },
    modelYear: { type: String, trim: true, default: '' },
    recordNumber: { type: String, trim: true, default: '' },
    // Operating card and its expiry: a vehicle with an expired card is not loaded. The road stops it, not us, so knowing the date before assignment saves a stalled load.
    operationCardNumber: { type: String, trim: true, default: '' },
    operationCardExpiry: { type: String, trim: true, default: '' },
    insuranceDetails: { type: String, trim: true, default: '' },

    // Plate by key, not by format.
    // `plate` is stored in display format (`formatPlate`), but one plate is written in orders in other forms: different hamza, Arabic digits, extra spaces. Comparison runs on a stripped key (`registryPlateKey`) that was not stored, so the waybill path pulled ALL trucks (about 13,500) to find three and filtered in JavaScript, growing with every truck on a paper printed daily.
    // The key is derived on save and indexed, as in `VehicleMaster` and `Ls2TireAsset`, so the call becomes an indexed `$in`.
    plateKey: { type: String, default: '', index: true },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderVehicleSchema.index({ plate: 1 });
// Active vehicles per supplier, counted on every suppliers screen, from the index alone.
shipmentOrderVehicleSchema.index({ supplier: 1, isActive: 1 });

// Derived on every save, not only on import.
// A truck added from the screen without a key is not found when its waybill prints and nothing says why: the boxes just come out empty. `updateOne`/`findOneAndUpdate` are covered too, so a plate edit from any path re-derives the key.
const deriveKey = (plate) => {
  try { return require('../utils/plateKey').registryPlateKey(plate) || ''; } catch (_) { return ''; }
};

shipmentOrderVehicleSchema.pre('save', function setPlateKey(next) {
  if (this.isModified('plate') || !this.plateKey) this.plateKey = deriveKey(this.plate);
  next();
});

for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
  shipmentOrderVehicleSchema.pre(op, function setPlateKeyOnUpdate(next) {
    const u = this.getUpdate() || {};
    const plate = (u.$set && u.$set.plate) ?? u.plate;
    if (plate != null) {
      const { formatPlate } = require('../utils/plateKey');
      const key = deriveKey(formatPlate(plate));
      if (u.$set) u.$set.plateKey = key; else u.plateKey = key;
      this.setUpdate(u);
    }
    next();
  });
}

// Saved shipment-order lists are cleared on every write.
// The suppliers and trucks lists are cached for two minutes (so:registry) because reading them from the cluster is slow. A supplier appears inside the trucks list and its truck count in its own list, so any write to either, from any screen or script, clears the whole prefix.
const clearRegistry = () => {
  try { require('../utils/ttlCache').clear('so:registry:'); } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderVehicleSchema.post(op, clearRegistry);
}

module.exports = mongoose.models.ShipmentOrderVehicle
  || mongoose.model('ShipmentOrderVehicle', shipmentOrderVehicleSchema);
