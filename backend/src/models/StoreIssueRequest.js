const mongoose = require('mongoose');

/**
 * Store issue request (طلب صرف): the only way stock leaves the light-transport store.
 * Saving it writes one outgoing Ls2StoreMovement per line, so the movement log, balances and vehicle file read it like any issue.
 * Posted quantities are never edited; a mistake is fixed by cancelling the request, which reverses its movements on the record.
 */
const lineSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreItem', required: true },
  itemName: { type: String, default: '' },
  itemCode: { type: String, default: '' },
  unit: { type: String, default: '' },
  quantity: { type: Number, required: true },
  // Item balance right after this line was issued, as printed on the request.
  balanceAfter: { type: Number, default: 0 },
  movement: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreMovement', default: null },
}, { _id: true });

const issueRequestSchema = new mongoose.Schema({
  warehouse: { type: String, enum: ['heavy', 'light'], default: 'light', index: true },
  seq: { type: Number, required: true },
  number: { type: String, required: true, unique: true },
  date: { type: String, required: true, index: true },        // YYYY-MM-DD, the actual issue day picked on entry; createdAt is when it was recorded
  vehiclePlate: { type: String, default: '' },
  vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
  // Snapshot of who rode the vehicle and for which project when the request was made.
  project: { type: String, default: '' },
  rider: { type: String, default: '' },
  issueReason: { type: String, default: '' },
  note: { type: String, default: '' },
  lines: { type: [lineSchema], default: [] },
  // Set when a heavy-transport maintenance record consumed these parts; such a request is cancelled from its record.
  maintenanceRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2MaintenanceRecord', default: null, index: true },
  status: { type: String, enum: ['posted', 'cancelled'], default: 'posted', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledByName: { type: String, default: '' },
  cancelReason: { type: String, default: '' },
}, { timestamps: true });
issueRequestSchema.index({ warehouse: 1, seq: -1 });

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.models.StoreIssueCounter || mongoose.model('StoreIssueCounter', counterSchema);

/** Readable request number: SR-00001 in the light store, HSR-00001 in the heavy one (numbers are unique across both). */
const formatNumber = (seq, warehouse = 'light') => `${warehouse === 'heavy' ? 'HSR' : 'SR'}-${String(seq).padStart(5, '0')}`;

/** Next number for a warehouse; numbers are taken only after the stock is secured, so a rejected request leaves no gap. */
async function nextNumber(warehouse = 'light') {
  const c = await Counter.findOneAndUpdate({ _id: `issue:${warehouse}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return { seq: c.seq, number: formatNumber(c.seq, warehouse) };
}

module.exports = {
  StoreIssueRequest: mongoose.models.StoreIssueRequest || mongoose.model('StoreIssueRequest', issueRequestSchema),
  nextIssueNumber: nextNumber,
  formatIssueNumber: formatNumber,
};
