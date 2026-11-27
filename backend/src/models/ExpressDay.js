const mongoose = require('mongoose');

/**
 * One Express GPS unit's route for one closed Riyadh day, kept so a month opens from the database instead of ~30 provider calls
 * (which ran past the page's request timeout). Written once per unit-day (nightly job or first view), never rewritten.
 * `pts` are [t(ms), lat, lng, speed, ign(1/0/-1)], thinned to one point per 15 s at most; `km` is measured on the full set.
 */
const expressDaySchema = new mongoose.Schema({
  imei: { type: String, required: true },
  day: { type: String, required: true },
  pts: { type: [[Number]], default: [] },
  km: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

expressDaySchema.index({ imei: 1, day: 1 }, { unique: true });
// Kept 65 days: the page reads at most 31 days of route and 62 of distances.
expressDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 65 * 24 * 3600 });

module.exports = mongoose.models.ExpressDay || mongoose.model('ExpressDay', expressDaySchema);
