/** Ls2Trailer: a trailer that moves between flatbeds. Only the CURRENT hitch lives here; each move is an Ls2AssetEvent, so the history per trailer and per vehicle can be rebuilt. */
const mongoose = require('mongoose');

const ls2TrailerSchema = new mongoose.Schema({
  trailerNumber: { type: String, required: true, unique: true, trim: true }, // "23"
  currentPlate: { type: String, default: null },     // Flatbed it is currently hitched to
  currentPlateKey: { type: String, default: null },  // digits-only match key
  status: { type: String, enum: ['active', 'spare', 'retired'], default: 'active' },
  notes: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.Ls2Trailer || mongoose.model('Ls2Trailer', ls2TrailerSchema);
