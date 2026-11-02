const mongoose = require('mongoose');

/**
 * HR department settings: a single row.
 * Alert thresholds (days before expiry) were numbers in code, so changing sixty for thirty needed a release. They differ by document: residence renews in a week (thirty is enough), work permit needs two months.
 * Stored as a Map, not named fields: documents are added over time and each new field would need another release.
 */
const hrConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'hr', unique: true },
  alerts: { type: Map, of: Number, default: () => ({}) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.models.HrConfig || mongoose.model('HrConfig', hrConfigSchema);

/** Default thresholds, used unless others are saved. */
module.exports.DEFAULT_ALERTS = {
  iqama: 30,
  passport: 60,
  workPermit: 30,
  healthCertificate: 30,
  driverCard: 30,
  drivingLicense: 30,
  medicalInsurance: 30,
  contract: 30,
  visa: 30,
  ajeer: 30,
};
