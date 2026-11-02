/**
 * Media Go complaints: fault reports for screens mounted on our scooters.
 * Written here instead of Media Go's Google form: we raise them from the individuals section, and their account (`mediago_account`) sees, updates and replies. Fields mirror their form questions with stable keys; Arabic and English texts are in `MEDIAGO_VOCAB` below, read by the site and the app.
 */
const mongoose = require('mongoose');

// Vocabulary: a stored key and two display texts
const MEDIAGO_VOCAB = {
  issue: [
    { key: 'screen_off', ar: 'الشاشة لا تعمل بالكامل', en: 'The screen is not working at all' },
    { key: 'screen_partial', ar: 'جزء من الشاشة لا يعمل', en: 'Part of the screen is not working' },
    { key: 'screen_flicker', ar: 'الشاشة تقطع', en: 'The screen is flickering intermittently' },
    { key: 'power_disconnected', ar: 'الباور مفصول', en: 'The power supply is disconnected' },
    { key: 'motorcycle_down', ar: 'الدبّاب لا يعمل', en: 'The motorcycle is not working' },
    { key: 'scratches', ar: 'خدوش أو كسور', en: 'Scratches or Cracks' },
    { key: 'other', ar: 'أخرى', en: 'Other' },
  ],
  location: [
    { key: 'hero_mile_safa', ar: 'هيرو مايل – الصفا', en: 'Hero Mile – Al Safa' },
    { key: 'energize', ar: 'إنرجايز', en: 'Energize' },
  ],
  availability: [
    { key: 'am_5_9', ar: '5 فجرًا إلى 9 صباحًا', en: '5:00 AM – 9:00 AM' },
    { key: 'am_10_pm_1', ar: '10 صباحًا إلى 1 مساءً', en: '10:00 AM – 1:00 PM' },
    { key: 'pm_2_5', ar: '2 مساءً إلى 5 مساءً', en: '2:00 PM – 5:00 PM' },
    { key: 'pm_6_9', ar: '6 مساءً إلى 9 مساءً', en: '6:00 PM – 9:00 PM' },
    { key: 'other', ar: 'أخرى', en: 'Other' },
  ],
  status: [
    { key: 'new', ar: 'جديدة', en: 'New' },
    { key: 'in_progress', ar: 'قيد المعالجة', en: 'In progress' },
    { key: 'fixed', ar: 'تمّ الإصلاح', en: 'Fixed' },
    { key: 'closed', ar: 'مغلقة', en: 'Closed' },
  ],
};
const keysOf = (list) => list.map((x) => x.key);

const fileSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  kind: { type: String, enum: ['image', 'video'], default: 'image' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

/** Who is acting in the log: our side or theirs, shown next to each entry. */
const SIDES = ['energize', 'mediago'];

const historySchema = new mongoose.Schema({
  status: { type: String, enum: keysOf(MEDIAGO_VOCAB.status), required: true },
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

const mediaGoComplaintSchema = new mongoose.Schema({
  /** MG-0001, derived from the counter and never typed. */
  ref: { type: String, unique: true },
  seq: { type: Number, index: true },

  // Scooter number
  // Picked from the vehicle register (light transport) so plate and serial are stored with it; free text is accepted if the scooter is not in the register, since a report must not wait for the register.
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleMaster', default: null },
  motorcycleNumber: { type: String, required: true, trim: true, maxlength: 60 },
  plateNumber: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  project: { type: String, default: '' },

  screenNumber: { type: String, default: '', trim: true, maxlength: 60 },
  files: { type: [fileSchema], default: [] },

  issue: { type: String, enum: keysOf(MEDIAGO_VOCAB.issue), required: true },
  issueOther: { type: String, default: '', trim: true, maxlength: 500 },
  location: { type: String, enum: keysOf(MEDIAGO_VOCAB.location), required: true },
  availability: { type: String, enum: keysOf(MEDIAGO_VOCAB.availability), required: true },
  availabilityOther: { type: String, default: '', trim: true, maxlength: 200 },

  status: { type: String, enum: keysOf(MEDIAGO_VOCAB.status), default: 'new', index: true },
  statusHistory: { type: [historySchema], default: [] },
  replies: { type: [replySchema], default: [] },
  fixedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

mediaGoComplaintSchema.index({ createdAt: -1 });

// Counter and reference
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.models.MediaGoCounter || mongoose.model('MediaGoCounter', counterSchema);

const formatRef = (n) => `MG-${String(n).padStart(4, '0')}`;

mediaGoComplaintSchema.pre('save', async function assignRef(next) {
  if (this.ref) return next();
  try {
    const c = await Counter.findOneAndUpdate({ _id: 'complaint' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    this.seq = c.seq;
    this.ref = formatRef(c.seq);
    return next();
  } catch (e) { return next(e); }
});

const MediaGoComplaint = mongoose.models.MediaGoComplaint || mongoose.model('MediaGoComplaint', mediaGoComplaintSchema);

module.exports = MediaGoComplaint;
module.exports.MEDIAGO_VOCAB = MEDIAGO_VOCAB;
module.exports.SIDES = SIDES;
module.exports.formatRef = formatRef;
