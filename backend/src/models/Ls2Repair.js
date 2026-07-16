/**
 * Ls2Repair — an UNSCHEDULED (exceptional) repair: something broke, an accident,
 * a fault — work that isn't one of the periodic services.
 *
 * This lives only in OUR system: Location Solutions has no concept of it (its
 * service intervals are strictly periodic), so nothing here is written to Wialon.
 */
const mongoose = require('mongoose');

const ls2RepairSchema = new mongoose.Schema({
  unitId: { type: Number, required: true, index: true },
  plate: { type: String, default: '' },
  title: { type: String, required: true, trim: true },       // what happened
  category: {
    type: String,
    enum: ['breakdown', 'accident', 'tires', 'electrical', 'engine', 'body', 'other'],
    default: 'other',
    index: true,
  },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'done'], default: 'done', index: true },
  repairDate: { type: Date, default: Date.now },  // when the work happened
  odometerKm: { type: Number, default: null },    // odometer at the repair
  cost: { type: Number, default: null },
  workshop: { type: String, default: '' },        // who did it
  partsReplaced: { type: String, default: '' },
  description: { type: String, default: '' },
  driver: { type: String, default: '' },          // driver at the time (if relevant)
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
}, { timestamps: true });

ls2RepairSchema.index({ unitId: 1, repairDate: -1 });

module.exports = mongoose.models.Ls2Repair || mongoose.model('Ls2Repair', ls2RepairSchema);
