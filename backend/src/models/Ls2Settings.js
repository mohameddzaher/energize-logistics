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
  // OUR OWN addition (Wialon has no such thing): the checklist of tasks that make
  // up each service. Keyed by the Wialon service-interval id ("1".."4"), since the
  // 4 services are the same across the fleet. Fully editable from Settings.
  checklists: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }, // { [intervalId]: [{label,labelAr}] }
  // How early to warn for EACH of the real Wialon services, keyed by interval id.
  // A single fleet-wide number can't fit them: 3,000 km before a 20K service is
  // 15% of its life, but only 3.7% of an 80K one. Missing/blank → DEFAULT_ALERT_BEFORE_KM.
  alertBefore: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }, // { [intervalId]: km }
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// Fetch (creating on first use) the singleton settings doc.
ls2SettingsSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne({ singleton: 'ls2' });
  if (!doc) doc = await this.create({ singleton: 'ls2' });
  // Backfill any threshold/maintenance keys added after the doc was first seeded.
  const merged = { ...cfg.DEFAULT_THRESHOLDS, ...(doc.thresholds || {}) };
  const mergedM = { ...cfg.DEFAULT_MAINTENANCE, ...(doc.maintenance || {}) };
  // Retired: a fallback service interval from before we read Wialon's real ones.
  // No calculation ever used it; strip it from older docs so it stops surfacing.
  delete mergedM.serviceIntervalKm;
  doc.thresholds = merged;
  doc.maintenance = mergedM;
  return doc;
};

module.exports = mongoose.models.Ls2Settings || mongoose.model('Ls2Settings', ls2SettingsSchema);
