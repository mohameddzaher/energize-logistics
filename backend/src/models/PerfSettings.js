/**
 * PerfSettings — the singleton holding the company-wide rules that sit ABOVE the
 * per-department forms: the performance bands, the bonus-per-tier tables, and
 * which tier each department defaults to.
 *
 * Super-admin only. Mirrors the Ls2Settings singleton pattern.
 */
const mongoose = require('mongoose');
const { DEFAULT_BANDS, DEFAULT_TIERS } = require('../config/performanceConfig');

const perfSettingsSchema = new mongoose.Schema({
  singleton: { type: String, default: 'perf', unique: true },
  bands: { type: mongoose.Schema.Types.Mixed, default: () => DEFAULT_BANDS },
  tiers: { type: mongoose.Schema.Types.Mixed, default: () => DEFAULT_TIERS },
  // { 'النقل الثقيل': 1, 'التخليص الجمركي': 2, … } — a department's default tier,
  // used when a template doesn't state its own.
  departmentTiers: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Threshold below which no bonus is paid, shown as explanatory text on the form.
  eligibilityThreshold: { type: Number, default: 70 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

perfSettingsSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne({ singleton: 'perf' });
  if (!doc) doc = await this.create({ singleton: 'perf' });
  // Fill in anything a partial save left empty, so callers can rely on shape.
  if (!Array.isArray(doc.bands) || !doc.bands.length) doc.bands = DEFAULT_BANDS;
  if (!Array.isArray(doc.tiers) || !doc.tiers.length) doc.tiers = DEFAULT_TIERS;
  if (!doc.departmentTiers) doc.departmentTiers = {};
  return doc;
};

module.exports = mongoose.models.PerfSettings || mongoose.model('PerfSettings', perfSettingsSchema);
