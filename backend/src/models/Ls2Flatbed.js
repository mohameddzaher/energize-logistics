/**
 * Ls2Flatbed — سطحة: one flatbed truck in OUR asset registry (numbering 1..61).
 * This is our own bookkeeping on top of the live Wialon mirror: the workshop's
 * official numbering, purchase batch (S1/S2/M1…) and brand, plus which trailer
 * (تيدر) is currently hitched to it. Live telemetry stays on Ls2Vehicle; the two
 * are matched by normalized plate digits (plateKey).
 */
const mongoose = require('mongoose');

const ls2FlatbedSchema = new mongoose.Schema({
  numbering: { type: Number, default: null },              // الترقيم الرسمي 1..61
  plate: { type: String, required: true, trim: true },     // "2708", "TR1"…
  plateKey: { type: String, required: true, unique: true },// digits-only match key
  batch: { type: String, default: '' },                    // S1/S2/S3/S4/M1/M2/MAN/سطحة سبير
  brand: { type: String, default: '' },                    // سينو ترك / ميرسيدس / مان
  currentTrailerNumber: { type: String, default: null },   // التيدر المركّب حاليًا
  notes: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.Ls2Flatbed || mongoose.model('Ls2Flatbed', ls2FlatbedSchema);
