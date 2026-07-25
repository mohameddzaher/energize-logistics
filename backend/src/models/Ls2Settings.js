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
  // up each service. Keyed by serviceTemplateKey(name) — NOT the Wialon interval
  // id, which means a different service on different trucks. Editable from Settings.
  checklists: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }, // { [serviceTemplateKey]: [{label,labelAr}] }
  // How early to warn for EACH of the real Wialon services, keyed by
  // serviceTemplateKey(name). A single fleet-wide number can't fit them: 3,000 km
  // before a 20K service is 15% of its life, but only 3.7% of an 80K one.
  // Missing/blank → DEFAULT_ALERT_BEFORE_KM.
  alertBefore: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }, // { [serviceTemplateKey]: km }
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// One-time repair of docs written before checklists/alertBefore were keyed by
// serviceTemplateKey. Old keys were bare numbers ("1".."4") that meant "the
// service whose NAME starts with this number" — resolve each by majority vote
// over the fleet's real interval names and re-key. Idempotent: once no numeric
// keys remain, this is a no-op.
async function migrateTemplateKeys(doc) {
  const numeric = (o) => Object.keys(o || {}).some((k) => /^\d+$/.test(k));
  if (!numeric(doc.checklists) && !numeric(doc.alertBefore)) return;
  const Ls2Vehicle = require('./Ls2Vehicle');
  const vehicles = await Ls2Vehicle.find({}).select('serviceIntervals.name').lean();
  const votes = new Map(); // leading name-number -> { templateKey -> count }
  for (const v of vehicles) {
    for (const si of v.serviceIntervals || []) {
      const num = (String(si.name || '').match(/^\s*(\d+)\s*-/) || [])[1];
      const key = cfg.serviceTemplateKey(si.name);
      if (!num || !key) continue;
      if (!votes.has(num)) votes.set(num, new Map());
      const m = votes.get(num);
      m.set(key, (m.get(key) || 0) + 1);
    }
  }
  const winner = (num) => {
    const m = votes.get(num);
    return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
  };
  const remap = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const nk = (/^\d+$/.test(k) && winner(k)) || k;
      if (out[nk] == null) out[nk] = v; // never clobber an already-canonical entry
    }
    return out;
  };
  doc.checklists = remap(doc.checklists);
  doc.alertBefore = remap(doc.alertBefore);
  doc.markModified('checklists');
  doc.markModified('alertBefore');
  // A concurrent poll tick may win the save race — fine, it ran the same remap.
  try { await doc.save(); } catch { /* re-checked on next getOrCreate */ }
}

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
  await migrateTemplateKeys(doc);
  return doc;
};

module.exports = mongoose.models.Ls2Settings || mongoose.model('Ls2Settings', ls2SettingsSchema);
