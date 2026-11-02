/**
 * Ls2TireAsset: one physical tire tracked by SERIAL for life.
 * Current mounting (flatbed, one of 14 positions, section) lives here; each mount/removal/transfer is an Ls2AssetEvent. `sensor` is what the workshop registered (present/absent), compared by the sensor-check endpoint with the live Wialon feed.
 * NOT the live pressure/temperature readings; those stay on Ls2Vehicle.tires.
 */
const mongoose = require('mongoose');

const ls2TireAssetSchema = new mongoose.Schema({
  tireNumber: { type: String, default: '' },          // workshop tag number (may repeat)
  serial: { type: String, required: true, unique: true, trim: true },
  type: { type: String, default: '' },                // Michelin / Bridgestone / Conti / China
  size: { type: String, default: '' },                // e.g. 315/80 R22.5
  sensor: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  // Tire lifecycle (full definition in config/tireStates.js). `condition` describes the tire, not its place.
  // mounted (on truck/trailer), spare (shelf), under_renewal (decided to renew, still in workshop custody), at_factory (physically at the renewal factory), scrap, damaged, sold; retired/in_repair are legacy read-only values.
  // Under renewal and at factory differ so the workshop never promises a tire it does not hold.
  status: { type: String, enum: require('../config/tireStates').STATUS_ENUM, default: 'mounted', index: true },
  // Tire condition describes the tire, not its place.
  // new: new from purchase
  // used: used, including renewed (the workshop treats both alike on the shelf)
  // A third condition `at_factory` described a place and mixed two sources; all location now lives in `status`.
  condition: { type: String, enum: ['new', 'used'], default: 'used' },
  // Percent rating recorded when a tire goes back to the shelf, so the workshop can pick the right tire for a slot later. Null = never rated.
  conditionPercent: { type: Number, min: 0, max: 100, default: null },
  // Current mount (null while spare/retired)
  plate: { type: String, default: null },
  plateKey: { type: String, default: null, index: true },
  positionNumber: { type: Number, default: null },    // 1..14
  positionLabel: { type: String, default: '' },       // e.g. outer right tire 3
  section: { type: String, default: '' },             // Section: head / head rear axle / trailer / spare
  // Which trailer this tire is on (trailer-section tires only).
  // A trailer tire follows the TRAILER, not the truck. Stored by truck plate alone, it stayed on the old truck after the trailer moved, leaving both trucks with wrong counts.
  // A standalone trailer (no truck) keeps its tires `mounted` with the trailer number and an empty plate.
  trailerNumber: { type: String, default: null, index: true },
  // Is this mounted tire serving as the truck's spare? A first-class flag (not just text) so every screen shows it. Cleared automatically when the tire leaves a truck.
  isSpare: { type: Boolean, default: false, index: true },
  notes: { type: String, default: '' },
}, { timestamps: true });

ls2TireAssetSchema.index({ plateKey: 1, positionNumber: 1 });
// Two tires can never hold one slot, even when two requests race across workers.
// Tires on a standing trailer have no plate and stay outside it.
ls2TireAssetSchema.index({ plateKey: 1, positionNumber: 1 }, {
  name: 'one_tire_per_slot',
  unique: true,
  partialFilterExpression: { status: 'mounted', plateKey: { $type: 'string' }, positionNumber: { $type: 'number' } },
});

// `isSpare` and `section` must never disagree: section text comes from the workshop sheet, the flag is what screens filter and count on. They drifted before, so the flag is derived here and mount, swap, import and manual edit all go through save().
// Only a MOUNTED tire can be the spare; a shelf tire is stock.
ls2TireAssetSchema.pre('save', function deriveIsSpare(next) {
  this.isSpare = this.status === 'mounted' && /استبن/.test(String(this.section || ''));
  next();
});

/**
 * Trailer number follows the tire's position and is never hand-written; otherwise a tire moved off a trailer kept the old trailer and two pages disagreed.
 * Derived on every save: unmounted, head or spare means no trailer; trailer section on a truck means the trailer hitched to that truck now; trailer section without a truck keeps its number.
 */
const TRAILER_SECTION = /تيدر|تريل/;
ls2TireAssetSchema.statics.isTrailerSection = (section) => TRAILER_SECTION.test(String(section || ''));
ls2TireAssetSchema.pre('save', async function deriveTrailer(next) {
  try {
    if (this.status !== 'mounted' || !TRAILER_SECTION.test(String(this.section || ''))) {
      this.trailerNumber = null;
    } else if (this.plateKey) {
      const Ls2Trailer = mongoose.models.Ls2Trailer || require('./Ls2Trailer');
      const tr = await Ls2Trailer.findOne({ currentPlateKey: this.plateKey }).select('trailerNumber').lean();
      this.trailerNumber = tr ? tr.trailerNumber : null;
    }
    next();
  } catch (e) { next(e); }
});

module.exports = mongoose.models.Ls2TireAsset || mongoose.model('Ls2TireAsset', ls2TireAssetSchema);
