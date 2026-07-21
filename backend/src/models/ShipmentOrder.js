const mongoose = require('mongoose');

// One shipment created NATIVELY in our system — the trial replacement for
// creating shipments on the external UPL operations platform.
//
// Deliberately independent of the Operations Platform section: no upl ids, no sync,
// no shared collections. The section is an experiment; if it proves out, the
// team moves its work here and the integration becomes the thing that gets
// retired — not the other way around.
const routeStop = { type: String, trim: true, default: '' };

const shipmentOrderSchema = new mongoose.Schema(
  {
    // رقم البوليصة — the waybill number. What the dispatch flow used to call
    // كشف التخريج; the correct commercial name is بوليصة, so that is the name
    // here. Auto-issued from a counter that starts at 500 (matching where the
    // old manual numbering left off) and never reused, even after deletes.
    waybillNumber: { type: Number, unique: true, index: true },

    // ── الاستلام والتسليم ──────────────────────────────────────────────────
    fromCity: routeStop,
    toCity: routeStop,
    addressFrom: routeStop,
    addressTo: routeStop,

    // ── تفاصيل الشحنة ─────────────────────────────────────────────────────
    truckType: { type: String, trim: true, default: '' },
    cargoType: { type: String, trim: true, default: '' },
    truckLength: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: null },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderCustomer', default: null, index: true },
    // Snapshot — the list and the waybill must keep reading correctly even if
    // the customer is later renamed or removed.
    customerName: { type: String, trim: true, default: '', index: true },

    driverName: { type: String, trim: true, default: '' },
    driverPhone: { type: String, trim: true, default: '' },
    vehicleName: { type: String, trim: true, default: '' }, // snapshot: السيارة / رقم اللوحة
    // Refs behind the snapshots — ours when supplier is null, a 3PL's otherwise.
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderVehicle', default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },

    // المندوب — whoever created the order, stamped from their account, never
    // typed by hand.
    agentName: { type: String, trim: true, default: '' },

    // ── الأسعار والتوقيت ──────────────────────────────────────────────────
    pickupTime: { type: Date, default: null },
    startTime: { type: Date, default: null },
    arrivalTime: { type: Date, default: null },
    sellPrice: { type: Number, default: null },
    buyPrice: { type: Number, default: null },

    // ── المدفوعات ─────────────────────────────────────────────────────────
    driverRentType: { type: String, trim: true, default: '' },
    paymentMethod: { type: String, trim: true, default: '' },
    driverRentPrice: { type: Number, default: null },
    branch: { type: String, trim: true, default: '' },

    // Same lifecycle keys as the ops mirror, so the team reads one vocabulary
    // across both — but stored here, owned here.
    status: {
      type: String,
      enum: [
        'requesting', 'loading', 'uploaded', 'on_way', 'arrived',
        'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled',
      ],
      default: 'requesting',
      index: true,
    },
    notes: { type: String, trim: true, default: '' },

    // Values of user-added inputs from the form-settings page, keyed by the
    // field's key. Mixed on purpose: those fields are the user's to invent.
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSchema.index({ createdAt: -1 });
shipmentOrderSchema.index({ fromCity: 1, toCity: 1 });

// The waybill counter lives in its own tiny collection so the number survives
// deletes: a voided shipment must not free its number for someone else.
const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
const Counter = mongoose.models.ShipmentOrderCounter
  || mongoose.model('ShipmentOrderCounter', counterSchema);

shipmentOrderSchema.pre('save', async function (next) {
  if (this.isNew && this.waybillNumber == null) {
    try {
      const c = await Counter.findOneAndUpdate(
        { _id: 'waybill' },
        // First issue lands on 500 — the requested starting point.
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (c.seq < 500) {
        c.seq = 500;
        await c.save();
      }
      this.waybillNumber = c.seq;
    } catch (e) {
      return next(e);
    }
  }
  next();
});

module.exports = mongoose.models.ShipmentOrder || mongoose.model('ShipmentOrder', shipmentOrderSchema);
