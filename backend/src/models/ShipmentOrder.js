const mongoose = require('mongoose');

// One shipment: created here (`source: 'system'`) or copied from the operations
// platform. Both carry a manifest number and have a row in the operations workflow.
const routeStop = { type: String, trim: true, default: '' };

const shipmentOrderSchema = new mongoose.Schema(
  {
    // Waybill number, equal to the manifest number on shipments created here.
    // Issued from a counter and never reused, even after deletes.
    waybillNumber: { type: Number, unique: true, sparse: true, index: true },

    source: { type: String, enum: ['system', 'platform'], default: 'system', index: true },
    /** Manifest number, one series across platform and system shipments. */
    graduationNumber: { type: Number, default: null, index: true },
    /** Platform id, used to match on re-sync so rows are not duplicated. */
    externalId: { type: String, trim: true, default: '', index: true },
    /** The number as shown: the manifest number. */
    reference: { type: String, trim: true, default: '', index: true },

    // Pickup and delivery
    fromCity: routeStop,
    toCity: routeStop,
    addressFrom: routeStop,
    addressTo: routeStop,

    // Shipment details
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
    vehicleName: { type: String, trim: true, default: '' }, // Snapshot: vehicle / plate number
    vehiclePlate: { type: String, trim: true, default: '', index: true },
    // Platform reference number, stored as is and not confused with our waybill number.
    externalRef: { type: String, trim: true, default: '' },
    // Refs behind the snapshots — ours when supplier is null, a 3PL's otherwise.
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderVehicle', default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderSupplier', default: null, index: true },
    // Supplier name snapshot.
    // The field was missing from the schema, so every supplier name written to it was silently dropped (mongoose ignores unknown fields), leaving tens of thousands of shipments without a supplier and analytics reporting zero suppliers.
    // A snapshot, not just a reference: the waybill is read a year later and the platform's supplier may not be in our registry; the name stays even if the row is missing.
    supplierName: { type: String, trim: true, default: '', index: true },

    // Rep: whoever created the order, stamped from their account, never typed by hand.
    agentName: { type: String, trim: true, default: '' },

    // Operations salesperson: who brought this load to the company, from sales or operations. The name is a snapshot so it stays in analytics even if the person leaves.
    salesRep: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    salesRepName: { type: String, trim: true, default: '', index: true },

    // Cancellation reason: a shipment is never cancelled without one. Taken from the cancellation reasons list in section settings (so_cancel_reason), stored as text.
    cancelReason: { type: String, trim: true, default: '', index: true },

    // Prices and timing
    pickupTime: { type: Date, default: null },
    startTime: { type: Date, default: null },
    arrivalTime: { type: Date, default: null },
    sellPrice: { type: Number, default: null },
    buyPrice: { type: Number, default: null },

    // Payments
    // Payment type: one of four types using the operations workflow keys (deferred_cash | deferred_invoice | cash_3pl | cash_ht). It replaced driver rental type in the create form, and `paymentMethod` is derived from it on the server; see utils/shipmentOrderPayment.
    paymentSubtype: {
      type: String, trim: true, default: '',
      enum: ['', ...require('../utils/paymentType').SUBTYPE_KEYS],
    },
    // Driver rental type: no longer asked in the form. Kept for rows recorded before, for what the platform sends (`driver_rental_type`), and printed in the rent box of the waybill.
    driverRentType: { type: String, trim: true, default: '' },
    paymentMethod: { type: String, trim: true, default: '' },
    driverRentPrice: { type: Number, default: null },
    branch: { type: String, trim: true, default: '' },

    // Same lifecycle keys as the ops mirror, so the team reads one vocabulary across both, but stored and owned here.
    // No `enum`: the section can add a status from its settings, and an `enum` in the schema would reject the added status on save after it appeared on screen. Validation is in the controller against the live vocabulary (`utils/shipmentOrderStatuses`), which knows both coded and configured statuses.
    status: { type: String, default: 'requesting', trim: true, index: true },
    // Arrival date this shipment was already turned late for, so it happens once.
    lateForDay: { type: String, default: '' },
    notes: { type: String, trim: true, default: '' },

    // Waybill and container, and the link to the customs transaction.
    // Optional in pickup and delivery. From these, or from the shipment number written in the container transport field of the transaction, the shipment is linked to its transaction in both directions: written here it appears there and vice versa. `customsLink` is written only by services/customsOpsLink, in the same shape as on the operations report.
    // Advance paid to the driver on this shipment: a number entered under prices and timing.
    advanceAmount: { type: Number, default: null },
    blNumber: { type: String, trim: true, default: '' },
    containerNumber: { type: String, trim: true, default: '' },
    customsLink: {
      type: new mongoose.Schema({
        clearance: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsClearance', default: null },
        refNumber: { type: String, default: '' },
        blNumber: { type: String, default: '' },
        customerName: { type: String, default: '' },
        containers: { type: [String], default: [] },
        via: { type: String, enum: ['move', 'bl', 'container', 'manual', 'unlinked'], default: 'move' },
        at: { type: Date, default: null },
        byName: { type: String, default: '' },
      }, { _id: false }),
      default: undefined,
    },

    // Follow-up here is a status change, not a call.
    // In fleet management the vehicle is ours, so follow-up is a call to our driver. Here the truck is a supplier's, and what is tracked is the order's position in its cycle: ordered, loaded, in transit, arrived, voucher sent. Follow-up is a status transition with its reason if any.
    // Every transition is recorded because "when did it go in transit" and "who delayed it" are asked a week later and cannot be answered from the last status alone.
    // A transition may carry its paper: "voucher sent" claims a sent document, so it is attached to the transition itself (see REQUIRE_FILE in the controller).
    statusLog: [{
      from: { type: String, default: '' },
      to: { type: String, default: '' },
      note: { type: String, trim: true, default: '' },
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, default: '' },
      fileUrl: { type: String, default: '' },
      fileName: { type: String, default: '' },
      mimeType: { type: String, default: '' },
      size: { type: Number, default: 0 },
      // The follow-up note can be edited, and it stays visible that it was edited and by whom.
      editedAt: { type: Date, default: null },
      editedByName: { type: String, default: '' },
    }],

    // Values of user-added inputs from the form-settings page, keyed by the
    // field's key. Mixed on purpose: those fields are the user's to invent.
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shipmentOrderSchema.index({ createdAt: -1 });
shipmentOrderSchema.index({ source: 1, createdAt: -1 });
shipmentOrderSchema.index({ 'customsLink.clearance': 1 }, { partialFilterExpression: { 'customsLink.clearance': { $type: 'objectId' } } });

shipmentOrderSchema.index({ fromCity: 1, toCity: 1 });
// Status counts per branch (page cards, nav badges) are answered from the index alone.
shipmentOrderSchema.index({ branch: 1, status: 1 });

// The waybill counter lives in its own tiny collection so the number survives
// deletes: a voided shipment must not free its number for someone else.
const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
const Counter = mongoose.models.ShipmentOrderCounter
  || mongoose.model('ShipmentOrderCounter', counterSchema);

shipmentOrderSchema.pre('save', async function (next) {
  if (this.source === 'platform') return next();
  if (this.isNew && this.waybillNumber == null) {
    try {
      const seq = await require('../utils/transportOrderNumber').nextTransportNumber();
      this.waybillNumber = seq;
      this.graduationNumber = seq;
    } catch (e) {
      return next(e);
    }
  }
  next();
});

shipmentOrderSchema.pre('save', function (next) {
  // Derived, never typed: the shown reference is the manifest number.
  this.reference = this.graduationNumber != null ? String(this.graduationNumber) : '';
  next();
});

module.exports = mongoose.models.ShipmentOrder || mongoose.model('ShipmentOrder', shipmentOrderSchema);
