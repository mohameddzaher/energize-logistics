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
  status: { type: String, enum: ['mounted', 'spare', 'in_repair', 'scrap', 'damaged', 'retired', 'sold'], default: 'mounted', index: true },
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
  // Is this mounted tire serving as the truck's SPARE (الاستبن)? A first-class
  // flag (not just text) so the workshop can see at a glance which tire is the
  // spare — surfaced everywhere. Cleared automatically when the tire leaves a truck.
  isSpare: { type: Boolean, default: false, index: true },
  notes: { type: String, default: '' },
}, { timestamps: true });

ls2TireAssetSchema.index({ plateKey: 1, positionNumber: 1 });

// `isSpare` and `section` must never disagree: the section text comes from the
// workshop sheet, the flag is what every screen filters and counts on. They
// drifted once — 47 tires sat in section «الاستبن» with the flag unset, so a
// vehicle whose real layout is 6 head / 6 trailer / 2 spare rendered as
// «رأس ٧ · استبن ١». Deriving the flag here means no caller can reintroduce it:
// mount, swap, import and manual edit all go through save().
//
// Only a MOUNTED tire can be the spare — a tire on the shelf is not «الاستبن»
// of anything, it is stock.
ls2TireAssetSchema.pre('save', function deriveIsSpare(next) {
  this.isSpare = this.status === 'mounted' && /استبن/.test(String(this.section || ''));
  next();
});

module.exports = mongoose.models.Ls2TireAsset || mongoose.model('Ls2TireAsset', ls2TireAssetSchema);
