/**
 * Ls2AssetEvent — سجل حركة الأصول: the append-only history behind the tire &
 * trailer registry. One row = one thing that happened to one asset (registered,
 * mounted, removed, transferred, retired, edited), with where it came from and
 * where it went. Vehicle profiles, tire profiles and trailer profiles all read
 * their timelines from here — nothing is ever rewritten.
 */
const mongoose = require('mongoose');

const ls2AssetEventSchema = new mongoose.Schema({
  entityType: { type: String, enum: ['tire', 'trailer', 'flatbed'], required: true, index: true },
  refId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  label: { type: String, default: '' },     // serial for tires, trailer number for trailers
  action: {
    type: String,
    enum: ['registered', 'mounted', 'removed', 'transferred', 'retired', 'updated'],
    required: true,
  },
  fromPlate: { type: String, default: null },
  fromPlateKey: { type: String, default: null, index: true },
  fromPosition: { type: String, default: '' },   // human label ("اطار 3 خارجي يمين — المحور الخلفي")
  toPlate: { type: String, default: null },
  toPlateKey: { type: String, default: null, index: true },
  toPosition: { type: String, default: '' },
  date: { type: Date, default: Date.now, index: true },
  odometerKm: { type: Number, default: null },   // odometer of the receiving vehicle, if known
  reason: { type: String, default: '' },         // سبب النقل/الإزالة
  notes: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
}, { timestamps: true });

ls2AssetEventSchema.index({ entityType: 1, refId: 1, date: -1 });

module.exports = mongoose.models.Ls2AssetEvent || mongoose.model('Ls2AssetEvent', ls2AssetEventSchema);
