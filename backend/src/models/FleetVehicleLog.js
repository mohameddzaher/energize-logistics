const mongoose = require('mongoose');

/**
 * Monthly vehicle log, fleet management.
 * A per-vehicle log, not per load: load tracking answers where a shipment is, not what happened to this vehicle last month (breakdown on the 9th, tire on the 14th, driver change on the 20th, six loads between). Those are vehicle events scattered across shipment logs.
 * A month closes by itself: the log is a period, not an open ledger, and when the next month starts the previous one is closed. Closure is a fact about time, not a button, so there is no scheduled job to forget; `isClosed(monthKey)` computes it.
 * Entries added to a closed month are flagged `lateEntry` rather than slipped in, so a reader sees it was written after closing.
 */

// Entry types. Loads are derived from shipments and not written here; these are events with no other home.
const LOG_KINDS = [
  'breakdown',    // Breakdown.
  'maintenance',  // Maintenance.
  'tire',         // Tires.
  'fuel',         // Fuel.
  'accident',     // Accident.
  'violation',    // Violation.
  'driver',       // Driver change.
  'idle',         // Stop/parking.
  'note',         // Note.
];

const KIND_LABELS = {
  breakdown: { ar: 'عطل', en: 'Breakdown' },
  maintenance: { ar: 'صيانة', en: 'Maintenance' },
  tire: { ar: 'إطارات', en: 'Tyres' },
  fuel: { ar: 'وقود', en: 'Fuel' },
  accident: { ar: 'حادث', en: 'Accident' },
  violation: { ar: 'مخالفة', en: 'Violation' },
  driver: { ar: 'تغيير سائق', en: 'Driver change' },
  idle: { ar: 'توقّف', en: 'Idle' },
  note: { ar: 'ملاحظة', en: 'Note' },
};

/** Month key from a date or string: 'YYYY-MM'. */
const monthKeyOf = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Whether the next month has started, so this month is closed. */
const isClosed = (monthKey, now = new Date()) => {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return false;
  return String(monthKey) < monthKeyOf(now);
};

/** Month bounds in UTC: [first day 00:00, last moment of the last day]. */
const monthRange = (monthKey) => {
  const [y, m] = String(monthKey).split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { from, to };
};

const fleetVehicleLogSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetVehicle', required: true },
  // Plate snapshot: the log is read a year later, and if the vehicle is deleted or re-plated the entry still says which vehicle it was written on.
  vehiclePlate: { type: String, trim: true, default: '', index: true },

  // Day the event happened, not the day it was written.
  at: { type: Date, required: true, index: true },
  monthKey: { type: String, default: '', index: true }, // YYYY-MM, derived from at.

  kind: { type: String, enum: LOG_KINDS, default: 'note', index: true },
  text: { type: String, trim: true, default: '' },
  location: { type: String, trim: true, default: '' },
  cost: { type: Number, default: 0 },

  // The entry may belong to a specific load (a breakdown while loaded) or to none.
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetShipment', default: null, index: true },
  waybillNumber: { type: Number, default: null },

  driverName: { type: String, trim: true, default: '' },

  // Written after its month closed.
  lateEntry: { type: Boolean, default: false },

  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, trim: true, default: '' },
}, { timestamps: true });

fleetVehicleLogSchema.index({ vehicle: 1, at: -1 });
fleetVehicleLogSchema.index({ monthKey: 1, vehicle: 1 });

// monthKey is always derived from `at` and never accepted from the client: a mismatch would put the entry in the wrong month and break closing and filtering.
fleetVehicleLogSchema.pre('save', function (next) {
  if (this.at) this.monthKey = monthKeyOf(this.at);
  next();
});

const bust = () => { try { require('../utils/ttlCache').clear('fleet:'); } catch (e) { /* noop */ } };
fleetVehicleLogSchema.post('save', bust);
fleetVehicleLogSchema.post(/^find.*[UD]/, bust);

module.exports = mongoose.models.FleetVehicleLog || mongoose.model('FleetVehicleLog', fleetVehicleLogSchema);
module.exports.LOG_KINDS = LOG_KINDS;
module.exports.KIND_LABELS = KIND_LABELS;
module.exports.monthKeyOf = monthKeyOf;
module.exports.isClosed = isClosed;
module.exports.monthRange = monthRange;
