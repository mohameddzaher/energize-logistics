/**
 * Ls2Settings — a single editable settings document (singleton) holding the alert
 * thresholds + default maintenance plan for the Location Solutions section. Seeded
 * once from ls2Config defaults; operations tune it from the Settings page and the
 * alert engine reads it every evaluation.
 */
const mongoose = require('mongoose');
const cfg = require('../config/ls2Config');

const ls2SettingsSchema = new mongoose.Schema({
  singleton: { type: String, default: 'ls2', unique: true },
  thresholds: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...cfg.DEFAULT_THRESHOLDS }) },
  maintenance: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...cfg.DEFAULT_MAINTENANCE }) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// Fetch (creating on first use) the singleton settings doc.
ls2SettingsSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne({ singleton: 'ls2' });
  if (!doc) doc = await this.create({ singleton: 'ls2' });
  // Backfill any threshold/maintenance keys added after the doc was first seeded.
  const merged = { ...cfg.DEFAULT_THRESHOLDS, ...(doc.thresholds || {}) };
  const mergedM = { ...cfg.DEFAULT_MAINTENANCE, ...(doc.maintenance || {}) };
  doc.thresholds = merged;
  doc.maintenance = mergedM;
  return doc;
};

module.exports = mongoose.models.Ls2Settings || mongoose.model('Ls2Settings', ls2SettingsSchema);
