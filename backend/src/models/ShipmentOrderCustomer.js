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
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },

    // The agreed price list: "من جدة للرياض بكذا". Picking this customer plus a
    // from/to on the create form pulls the matching price automatically; a NEW
    // route priced on the form is appended here, so the profile learns as the
    // work happens instead of someone maintaining it by hand.
    routes: [{
      fromCity: { type: String, trim: true, default: '' },
      toCity: { type: String, trim: true, default: '' },
      price: { type: Number, default: null },
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
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderCustomerSchema.index({ name: 1 });

module.exports = mongoose.models.ShipmentOrderCustomer
  || mongoose.model('ShipmentOrderCustomer', shipmentOrderCustomerSchema);
