/**
 * Ls2TireAsset — فردة كاوتش: one physical tire tracked by its SERIAL for life.
 * Where it is mounted right now (which flatbed, which of the 14 positions, which
 * section: الرأس / المحور الخلفي للرأس / التيدر / الاستبن) lives here; every
 * mount/removal/transfer is an Ls2AssetEvent. `sensor` is what the workshop
 * registered (يوجد/لايوجد) — the sensor-check endpoint compares it against what
 * the live Wialon feed actually reports.
 *
 * NOT the live pressure/temperature readings — those stay on Ls2Vehicle.tires.
 */
const mongoose = require('mongoose');

const ls2TireAssetSchema = new mongoose.Schema({
  tireNumber: { type: String, default: '' },          // workshop tag number (may repeat)
  serial: { type: String, required: true, unique: true, trim: true },
  type: { type: String, default: '' },                // Michelin / Bridgestone / Conti / China
  sensor: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  // 'in_repair' = off the truck at the repair shop — NOT available stock;
  // counting it as spare is how a shelf ends up promising tires it cannot hand out.
  status: { type: String, enum: ['mounted', 'spare', 'in_repair', 'retired'], default: 'mounted', index: true },
  // Current mount (null while spare/retired)
  plate: { type: String, default: null },
  plateKey: { type: String, default: null, index: true },
  positionNumber: { type: Number, default: null },    // 1..14
  positionLabel: { type: String, default: '' },       // "اطار 3 خارجي يمين"
  section: { type: String, default: '' },             // الرأس / المحور الخلفي للرأس / التيدر / الاستبن
  notes: { type: String, default: '' },
}, { timestamps: true });

ls2TireAssetSchema.index({ plateKey: 1, positionNumber: 1 });

module.exports = mongoose.models.Ls2TireAsset || mongoose.model('Ls2TireAsset', ls2TireAssetSchema);
