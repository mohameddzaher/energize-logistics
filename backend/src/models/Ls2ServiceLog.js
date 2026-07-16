/**
 * Ls2ServiceLog — an audit trail of maintenance actions taken on a vehicle from
 * the Location Solutions section (e.g. "sent to workshop / serviced at 340,000 km").
 * Marking a vehicle serviced writes a log row AND resets the vehicle's
 * lastServiceOdometerKm so the next periodic-service alert is recalculated.
 */
const mongoose = require('mongoose');

const ls2ServiceLogSchema = new mongoose.Schema({
  unitId: { type: Number, required: true, index: true },
  plate: { type: String, default: '' },
  action: { type: String, default: 'serviced' }, // serviced | scheduled | note
  odometerKm: { type: Number, default: null }, // odometer AT the service (entered)
  serviceType: { type: String, default: 'periodic' }, // periodic | repair | tires | other
  // Which Wialon service interval this was (so history is per-service, not global).
  intervalId: { type: Number, default: null },
  intervalName: { type: String, default: '' },
  // The REAL date the service was performed (may predate when it was logged). We
  // keep it exactly; Wialon only stores the write moment, so this is our record.
  serviceDate: { type: Date, default: null },
  engineHours: { type: Number, default: null },
  cost: { type: Number, default: null },
  syncedToWialon: { type: Boolean, default: false }, // did the Wialon write succeed?
  notes: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
}, { timestamps: true });

ls2ServiceLogSchema.index({ unitId: 1, createdAt: -1 });

module.exports = mongoose.models.Ls2ServiceLog || mongoose.model('Ls2ServiceLog', ls2ServiceLogSchema);
