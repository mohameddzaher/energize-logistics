const mongoose = require('mongoose');

/**
 * A shipment request: the first half of creating a shipment.
 * Sales writes the load as sold (customer, route, truck asked for, timing, selling price, payment) for one or more
 * identical trucks; the vendors team places each truck (supplier, truck, driver, purchase price) and only then does a
 * truck become a transport order with the normal serial number. Until then nothing reaches the shipments list or the
 * operations workflow, because the vendors team may reject it, with a reason, and sales may amend and resend it.
 */
const logEntry = new mongoose.Schema({
  action: {
    type: String,
    enum: ['created', 'edited', 'resubmitted', 'claimed', 'released', 'placed', 'completed', 'rejected', 'cancelled'],
    required: true,
  },
  note: { type: String, trim: true, default: '' },
  reason: { type: String, trim: true, default: '' },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrder', default: null },
  waybillNumber: { type: Number, default: null },
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
}, { _id: true });

const placedTruck = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrder', required: true },
  waybillNumber: { type: Number, default: null },
  supplierName: { type: String, default: '' },
  vehiclePlate: { type: String, default: '' },
  driverName: { type: String, default: '' },
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
}, { _id: false });

const shipmentRequestSchema = new mongoose.Schema({
  number: { type: Number, unique: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rejected', 'cancelled'],
    default: 'pending',
    index: true,
  },

  // Sales half: the same inputs as the shipment form, minus the execution.
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrderCustomer', default: null, index: true },
  customerName: { type: String, trim: true, default: '', index: true },
  salesRep: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  salesRepName: { type: String, trim: true, default: '' },
  fromCity: { type: String, trim: true, default: '' },
  toCity: { type: String, trim: true, default: '' },
  branch: { type: String, trim: true, default: '', index: true },
  notes: { type: String, trim: true, default: '' },
  blNumber: { type: String, trim: true, default: '' },
  containerNumber: { type: String, trim: true, default: '' },
  truckType: { type: String, trim: true, default: '' },
  cargoType: { type: String, trim: true, default: '' },
  truckLength: { type: String, trim: true, default: '' },
  quantity: { type: Number, default: null },
  pickupTime: { type: Date, default: null },
  startTime: { type: Date, default: null },
  arrivalTime: { type: Date, default: null },
  sellPrice: { type: Number, default: null },
  paymentSubtype: { type: String, trim: true, default: '' },
  paymentMethod: { type: String, trim: true, default: '' },
  customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  /** How many identical trucks the customer asked for; each placed truck becomes its own transport order. */
  trucks: { type: Number, default: 1, min: 1, max: 25 },

  // Vendors half.
  placed: { type: [placedTruck], default: [] },
  /** The vendors team member working the request, so two people do not place the same load. */
  handler: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  handlerName: { type: String, default: '' },
  handledAt: { type: Date, default: null },
  rejectReason: { type: String, trim: true, default: '', index: true },
  rejectNote: { type: String, trim: true, default: '' },
  rejectedAt: { type: Date, default: null },
  rejectedByName: { type: String, default: '' },
  resubmits: { type: Number, default: 0 },
  /** Short lock while trucks are being placed, so two people cannot place the same open slots. */
  lockUntil: { type: Date, default: null },
  /** When the request first reached a final state, for the time-to-place measure. */
  closedAt: { type: Date, default: null },

  log: { type: [logEntry], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  createdByName: { type: String, default: '' },
  createdByRole: { type: String, default: '' },
}, { timestamps: true });

shipmentRequestSchema.index({ status: 1, createdAt: -1 });
shipmentRequestSchema.index({ createdAt: -1 });

shipmentRequestSchema.virtual('open').get(function open() {
  return Math.max(0, (this.trucks || 0) - (this.placed || []).length);
});

const Counter = mongoose.models.ShipmentRequestCounter
  || mongoose.model('ShipmentRequestCounter', new mongoose.Schema({ _id: String, seq: Number }));

shipmentRequestSchema.pre('save', async function number(next) {
  if (!this.isNew || this.number != null) return next();
  try {
    const c = await Counter.findOneAndUpdate({ _id: 'shipment_request' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    this.number = c.seq;
    return next();
  } catch (e) { return next(e); }
});

module.exports = mongoose.models.ShipmentRequest || mongoose.model('ShipmentRequest', shipmentRequestSchema);
