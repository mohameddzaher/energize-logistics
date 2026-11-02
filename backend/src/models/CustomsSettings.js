/**
 * Customs section settings: a single document.
 * Non-list values live here, not in code, so changes (such as the upcoming-transaction alert window in days) apply immediately without a deploy.
 */
const mongoose = require('mongoose');

const customsSettingsSchema = new mongoose.Schema({
  // Fixed key guaranteeing a single document.
  key: { type: String, default: 'customs', unique: true, index: true },
  // Days ahead an upcoming transaction appears in the alert.
  upcomingAlertDays: { type: Number, default: 2, min: 0, max: 60 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

/** Returns the single document, creating it with defaults if missing. */
customsSettingsSchema.statics.get = async function get() {
  const found = await this.findOne({ key: 'customs' }).lean();
  if (found) return found;
  // Two first requests at the same moment both find nothing; the second create
  // hits the unique key — it then reads what the first one wrote (found by QA).
  try { return (await this.create({ key: 'customs' })).toObject(); } catch (e) {
    if (e && e.code === 11000) return this.findOne({ key: 'customs' }).lean();
    throw e;
  }
};

module.exports = mongoose.model('CustomsSettings', customsSettingsSchema);
