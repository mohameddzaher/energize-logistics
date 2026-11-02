/**
 * Ad content requests: Media Go asks for an ad to be filmed on our vehicles.
 * Flow: Media Go creates the request (ad name, owning company from section settings, light transport vehicles if ours, photos or video, parked or on the road, optional note and date). We film; each vehicle has its own verification (photos or video up to 15 s) that we review and mark ready. When all are ready we mark delivered and Media Go sees it per vehicle and may reply with a note.
 * new -> in_progress (first file uploaded) -> delivered -> closed; Media Go may cancel before delivery (cancelled).
 */
const mongoose = require('mongoose');

const AD_VOCAB = {
  mediaType: [
    { key: 'photo', ar: 'صور', en: 'Photos' },
    { key: 'video', ar: 'فيديو', en: 'Video' },
  ],
  location: [
    { key: 'shelter', ar: 'بالإيواء', en: 'At the shelter' },
    { key: 'road', ar: 'بالطريق', en: 'On the road' },
  ],
  status: [
    { key: 'new', ar: 'جديد', en: 'New' },
    { key: 'in_progress', ar: 'قيد التصوير', en: 'In progress' },
    { key: 'delivered', ar: 'تمّ التسليم', en: 'Delivered' },
    { key: 'closed', ar: 'مغلق', en: 'Closed' },
    { key: 'cancelled', ar: 'ملغى', en: 'Cancelled' },
  ],
};
const keysOf = (l) => l.map((x) => x.key);
const SIDES = ['energize', 'mediago'];

const fileSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  kind: { type: String, enum: ['image', 'video'], default: 'image' },
  durationSec: { type: Number, default: null },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

/** A vehicle in the request, with its verification: files and review. */
const itemSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null },
  plateNumber: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  project: { type: String, default: '' },
  // What is filmed for this vehicle: the request type itself, not changed.
  mediaType: { type: String, enum: keysOf(AD_VOCAB.mediaType), default: 'photo' },
  files: { type: [fileSchema], default: [] },
  ready: { type: Boolean, default: false },   // Reviewed and ready for delivery
  readyAt: { type: Date, default: null },
  readyByName: { type: String, default: '' },
  note: { type: String, default: '', maxlength: 500 },
}, { _id: true });

const historySchema = new mongoose.Schema({
  status: { type: String, enum: keysOf(AD_VOCAB.status), required: true },
  note: { type: String, default: '' },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  side: { type: String, enum: SIDES, default: 'energize' },
  at: { type: Date, default: Date.now },
}, { _id: false });

const replySchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 2000 },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  side: { type: String, enum: SIDES, default: 'energize' },
  at: { type: Date, default: Date.now },
}, { _id: true });

const adRequestSchema = new mongoose.Schema({
  ref: { type: String, unique: true },        // AD-0001
  seq: { type: Number, index: true },
  adName: { type: String, required: true, trim: true, maxlength: 200 },
  // Company the ad is for, from the ad-content companies list in section settings.
  company: { type: String, required: true, trim: true, index: true },
  companyKey: { type: String, default: '', index: true },
  mediaType: { type: String, enum: keysOf(AD_VOCAB.mediaType), required: true },
  location: { type: String, enum: keysOf(AD_VOCAB.location), required: true },
  note: { type: String, default: '', trim: true, maxlength: 2000 },
  neededBy: { type: String, default: '' },     // YYYY-MM-DD, optional
  items: { type: [itemSchema], default: [] },
  // Files for the request itself when it has no vehicles (an ad for another company).
  files: { type: [fileSchema], default: [] },
  status: { type: String, enum: keysOf(AD_VOCAB.status), default: 'new', index: true },
  statusHistory: { type: [historySchema], default: [] },
  replies: { type: [replySchema], default: [] },
  deliveredAt: { type: Date, default: null },
  deliveredByName: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
  createdSide: { type: String, enum: SIDES, default: 'mediago' },
}, { timestamps: true });
adRequestSchema.index({ createdAt: -1 });
adRequestSchema.index({ 'items.vehicle': 1 });

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.models.MediaGoAdCounter || mongoose.model('MediaGoAdCounter', counterSchema);
adRequestSchema.pre('save', async function assignRef(next) {
  if (this.ref) return next();
  try {
    const c = await Counter.findOneAndUpdate({ _id: 'ad' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    this.seq = c.seq;
    this.ref = `AD-${String(c.seq).padStart(4, '0')}`;
    return next();
  } catch (e) { return next(e); }
});

const MediaGoAdRequest = mongoose.models.MediaGoAdRequest || mongoose.model('MediaGoAdRequest', adRequestSchema);
module.exports = MediaGoAdRequest;
module.exports.AD_VOCAB = AD_VOCAB;
