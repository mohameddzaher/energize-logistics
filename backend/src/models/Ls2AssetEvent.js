/**
 * Ls2AssetEvent: append-only history of tire and trailer assets. One row per event (registered, mounted, removed, transferred, retired, edited) with origin and destination.
 * Vehicle, tire and trailer profiles read their timelines from here; rows are never rewritten.
 */
const mongoose = require('mongoose');

const ls2AssetEventSchema = new mongoose.Schema({
  entityType: { type: String, enum: ['tire', 'trailer', 'flatbed'], required: true, index: true },
  refId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  label: { type: String, default: '' },     // serial for tires, trailer number for trailers
  action: {
    type: String,
    // `to_store`: a tire returned to the shelf by direct order. It was missing from the list, so the status change saved but the event failed and the response errored, causing repeated transfers.
    enum: ['registered', 'mounted', 'removed', 'transferred', 'retired', 'updated', 'to_repair', 'from_repair', 'to_store', 'renewed', 'scrapped', 'damaged', 'sold'],
    required: true,
  },
  fromPlate: { type: String, default: null },
  fromPlateKey: { type: String, default: null, index: true },
  fromPosition: { type: String, default: '' },   // Human label, e.g. outer right tire 3, rear axle
  toPlate: { type: String, default: null },
  toPlateKey: { type: String, default: null, index: true },
  toPosition: { type: String, default: '' },
  date: { type: Date, default: Date.now, index: true },
  odometerKm: { type: Number, default: null },   // odometer of the receiving vehicle, if known
  // The tire as it stood right after this event; later edits must not rewrite history.
  stateAfter: { type: String, default: '' },
  percentAfter: { type: Number, default: null },
  reason: { type: String, default: '' },         // Reason for the transfer/removal
  notes: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
}, { timestamps: true });

ls2AssetEventSchema.index({ entityType: 1, refId: 1, date: -1 });

ls2AssetEventSchema.index({ fromPlateKey: 1, date: -1 }); // vehicle history $or lookups
ls2AssetEventSchema.index({ toPlateKey: 1, date: -1 });

module.exports = mongoose.models.Ls2AssetEvent || mongoose.model('Ls2AssetEvent', ls2AssetEventSchema);
