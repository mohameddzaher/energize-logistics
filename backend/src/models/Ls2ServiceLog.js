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
  odometerKm: { type: Number, default: null }, // odometer at the action
  serviceType: { type: String, default: 'periodic' }, // periodic | repair | tires | other
  notes: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
}, { timestamps: true });

ls2ServiceLogSchema.index({ unitId: 1, createdAt: -1 });

module.exports = mongoose.models.Ls2ServiceLog || mongoose.model('Ls2ServiceLog', ls2ServiceLogSchema);
