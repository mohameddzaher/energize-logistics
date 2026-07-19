/**
 * Ls2Trailer — تيدر: a trailer that moves between flatbeds. Only its CURRENT
 * hitch lives here; every move is a Ls2AssetEvent, so the full "was on 2708,
 * moved to 7360 on …" story is reconstructable per trailer and per vehicle.
 */
const mongoose = require('mongoose');

const ls2TrailerSchema = new mongoose.Schema({
  trailerNumber: { type: String, required: true, unique: true, trim: true }, // "23"
  currentPlate: { type: String, default: null },     // السطحة المركّب عليها الآن
  currentPlateKey: { type: String, default: null },  // digits-only match key
  status: { type: String, enum: ['active', 'spare', 'retired'], default: 'active' },
  notes: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.Ls2Trailer || mongoose.model('Ls2Trailer', ls2TrailerSchema);
