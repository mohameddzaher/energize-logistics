/**
 * Ls2MaintenanceRecord — one maintenance visit of a heavy-transport truck, of one of four types:
 * periodic (a Wialon service interval, linked to its Ls2ServiceLog), preventive, roadside or accident.
 * Spare parts are taken from the heavy store through a store issue request (طلب صرف), so the store
 * balance, its movement log and the vehicle file all read them; the record keeps a priced snapshot.
 * A record is never edited; it is cancelled with a reason, which cancels its issue request and returns the parts.
 */
const mongoose = require('mongoose');

const MAINTENANCE_TYPES = ['periodic', 'preventive', 'roadside', 'accident'];

const partSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2StoreItem', required: true },
  itemName: { type: String, default: '' },
  itemCode: { type: String, default: '' },
  category: { type: String, default: '' },
  unit: { type: String, default: '' },
  quantity: { type: Number, required: true },
  // Store price at the moment of issue; the cost basis of the analytics.
  unitPrice: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  isTire: { type: Boolean, default: false },
}, { _id: false });

const workSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  cost: { type: Number, default: null },
  note: { type: String, default: '' },
}, { _id: false });

const recordSchema = new mongoose.Schema({
  unitId: { type: Number, required: true, index: true },
  plate: { type: String, default: '' },
  driver: { type: String, default: '' },
  type: { type: String, enum: MAINTENANCE_TYPES, required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD, the day the work was done
  odometerKm: { type: Number, default: null },
  title: { type: String, default: '' },
  location: { type: String, default: '' },              // Roadside / accident place
  parts: { type: [partSchema], default: [] },
  work: { type: [workSchema], default: [] },              // Technician work lines (greasing, adjustment…)
  partsCost: { type: Number, default: 0 },
  labourCost: { type: Number, default: 0 },
  towingCost: { type: Number, default: 0 },
  // One undivided amount carried from a source that never split parts from labour (a migrated repair).
  unsplitCost: { type: Number, default: 0 },
  totalCost: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  // Periodic only: the service interval and its log.
  serviceLog: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2ServiceLog', default: null, index: true },
  intervalId: { type: Number, default: null },
  intervalName: { type: String, default: '' },
  issueRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreIssueRequest', default: null, index: true },
  // Set on records migrated from an exceptional repair (scripts/migrateLs2RepairsToRecords); the repair is kept.
  sourceRepair: { type: mongoose.Schema.Types.ObjectId, ref: 'Ls2Repair', default: null },
  repairCategory: { type: String, default: '' },
  issueRequestNo: { type: String, default: '' },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active', index: true },
  cancelledAt: { type: Date, default: null },
  cancelledByName: { type: String, default: '' },
  cancelReason: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

recordSchema.index({ unitId: 1, date: -1 });
recordSchema.index({ status: 1, date: -1 });
recordSchema.index({ sourceRepair: 1 }, { unique: true, partialFilterExpression: { sourceRepair: { $type: 'objectId' } } });

module.exports = {
  Ls2MaintenanceRecord: mongoose.models.Ls2MaintenanceRecord || mongoose.model('Ls2MaintenanceRecord', recordSchema),
  MAINTENANCE_TYPES,
};
