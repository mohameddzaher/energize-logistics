/**
 * Ls2Flatbed: one flatbed truck in our asset registry (numbering 1..61), layered on the live Wialon mirror.
 * Holds the workshop's official number, purchase batch (S1/S2/M1...), brand and the trailer currently hitched.
 * Live telemetry stays on Ls2Vehicle; the two are matched by normalized plate digits (plateKey).
 */
const mongoose = require('mongoose');

const ls2FlatbedSchema = new mongoose.Schema({
  numbering: { type: Number, default: null },              // Official numbering 1..61
  plate: { type: String, required: true, trim: true },     // "2708", "TR1"…
  plateKey: { type: String, required: true, unique: true },// digits-only match key
  batch: { type: String, default: '' },                    // Purchase batch: S1/S2/S3/S4/M1/M2/MAN/spare flatbed
  brand: { type: String, default: '' },                    // Brand: Sino Truck / Mercedes / MAN
  currentTrailerNumber: { type: String, default: null },   // Trailer currently hitched
  notes: { type: String, default: '' },
  // Its vehicle in the vehicle register, matched from the truck and not from digits alone (services/ls2VehicleLink).
  vehicleMaster: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null, index: true },
}, { timestamps: true });

module.exports = mongoose.models.Ls2Flatbed || mongoose.model('Ls2Flatbed', ls2FlatbedSchema);
