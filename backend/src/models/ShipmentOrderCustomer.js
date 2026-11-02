const mongoose = require('mongoose');

// A customer of the shipment-orders trial section, with the two things that
// make creating an order fast: the prices agreed per route, and the defaults
// they usually ship with.
//
// Separate from the CRM/ops customer bases on purpose — this whole section is
// an experiment, and its data must be disposable without touching anything the
// rest of the system depends on. If the trial graduates, migrating a handful of
// rows is trivial; untangling shared rows would not be.
const shipmentOrderCustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Set when a person renames the customer, so the new-shipment picker shows it even if not on the approved list.
    nameManual: { type: Boolean, default: false },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // Customer data as carried by the operations platform.
    externalId: { type: String, trim: true, default: '', index: true },
    // Individual or company: invoicing and price differ.
    customerType: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },

    // The agreed price list per route, e.g. from Jeddah to Riyadh for X. Picking this customer plus a from/to on the create form pulls the matching price automatically; a NEW route priced on the form is appended here, so the profile learns as work happens.
    // The price is the latest agreed. A route repeats many times a year at changing prices, so one row holds the LATEST price with its date and source (a created shipment, the branches report, or a user's hand), and the newest wins regardless of source.
    // `at` is the date of the WORK, not the write date: a row imported today for a March shipment does not override a price agreed in August.
    routes: [{
      fromCity: { type: String, trim: true, default: '' },
      toCity: { type: String, trim: true, default: '' },
      price: { type: Number, default: null },
      at: { type: Date, default: null },
      source: { type: String, trim: true, default: '' }, // order | platform | sheet | manual | private
      hits: { type: Number, default: 1 },                 // How many times this route has been seen
      // The price may depend on the number of trucks, e.g. one to five at 2200 each, six to ten at 2400.
      // The route holds its tiers: from a count to a count (empty `maxTrucks` = and above) at a price PER TRUCK, where the count is the customer's trucks on this route in the order. Written only by the operations manager or system admin (customerRegistryController.setRouteTiers). The private operations page writes the HIGHEST tier of its route to the report, since a report is one truck and the ordered count is unknown. A route without tiers keeps its single price.
      tiers: [{
        _id: false,
        minTrucks: { type: Number, required: true },
        maxTrucks: { type: Number, default: null },
        price: { type: Number, required: true },
      }],
      tiersAt: { type: Date, default: null },
      tiersBy: { type: String, trim: true, default: '' },
    }],

    // What this customer usually ships with — prefilled, always editable.
    defaults: {
      truckType: { type: String, trim: true, default: '' },
      cargoType: { type: String, trim: true, default: '' },
      paymentMethod: { type: String, trim: true, default: '' },
      driverRentType: { type: String, trim: true, default: '' },
      branch: { type: String, trim: true, default: '' },
    },

    isActive: { type: Boolean, default: true },
    // Why the row is hidden, when a cleanup rather than a person hid it.
    hiddenReason: { type: String, default: undefined },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderCustomerSchema.index({ name: 1 });

// The route price index is cleared on every write.
// The private operations page caches a (customer|route -> price) index for a minute instead of reading all customers on each call. Any write to a customer (save, update or delete, from any screen) clears it here in one place so no write path leaves a stale price. The customer list in shipment orders (so:registry) is cached too and cleared with it.
const clearRouteIndex = () => {
  try {
    const cache = require('../utils/ttlCache');
    cache.clear('opsprivate:routes');
    cache.clear('so:registry:');
  } catch (_) { /* */ }
};
for (const op of ['save', 'findOneAndUpdate', 'updateOne', 'updateMany', 'insertMany', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  shipmentOrderCustomerSchema.post(op, clearRouteIndex);
}

// One customer across all sections: link to the parent relations company (services/customerHub)
shipmentOrderCustomerSchema.add({ crmCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany', default: null, index: true } });
// Copy of the master's customer code (utils/customerCode).
shipmentOrderCustomerSchema.add({ customerCode: require('../utils/customerCode').codeField() });
require('../services/customerHub').attach(shipmentOrderCustomerSchema, 'shipment');
module.exports = mongoose.models.ShipmentOrderCustomer
  || mongoose.model('ShipmentOrderCustomer', shipmentOrderCustomerSchema);
