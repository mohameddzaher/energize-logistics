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
  size: { type: String, default: '' },                // e.g. 315/80 R22.5
  sensor: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  // The tire's LIFECYCLE, exactly as the workshop runs it:
  //   spare(new)        ← purchases register a fresh tire
  //   mounted           ← installed; installing where another tire sits FORCES
  //                       declaring where the displaced one goes (in ⇒ out)
  //   in_repair         ← تحت التجديد: off the truck at the renewal shop — NOT
  //                       available stock; counting it as spare is how a shelf
  //                       promises tires it cannot hand out
  //   spare(renewed)    ← renewal succeeded (مجدد). A renewed tire mounts on
  //                       the TRAILER only — never الرأس (enforced in /move)
  //   scrap             ← سكراب: renewal failed; unusable, kept in store to sell
  //   damaged           ← تالف: blew out / worn beyond existence; terminal
  //   retired           ← legacy value from before scrap/damaged were separated
  status: { type: String, enum: ['mounted', 'spare', 'in_repair', 'scrap', 'damaged', 'retired'], default: 'mounted', index: true },
  // Quality grade, independent of where it is: fresh from purchase, ordinary
  // used, or renewed (retreaded) — the grade the trailer-only rule reads.
  condition: { type: String, enum: ['new', 'used', 'renewed'], default: 'used' },
  // كام في المية — recorded when a tire goes back to the shelf so the workshop
  // can pick the right tire for the right slot later (تسكين). Null = never rated.
  conditionPercent: { type: Number, min: 0, max: 100, default: null },
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
