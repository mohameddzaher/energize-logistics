const mongoose = require('mongoose');

/**
 * Operations targets: trips and sales per year.
 * Previously a spreadsheet cell written by the operations manager; now data in the system, since a target changed in a meeting needs no release.
 * A period's target is derived, not written: the annual figure spread over its days (see utils/opsAnalytics), so any chosen range gets its target. `override` fixes a specific figure for a specific month.
 */
const opsTargetSchema = new mongoose.Schema({
  key: { type: String, default: 'ops', unique: true },
  annualTrips: { type: Number, default: 36000 },
  annualRevenue: { type: Number, default: 90000000 },
  // Targets written explicitly for a month (YYYY-MM); they take precedence over the derivation.
  overrides: [{
    month: { type: String, trim: true, default: '' },
    trips: { type: Number, default: null },
    revenue: { type: Number, default: null },
  }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.OpsTarget || mongoose.model('OpsTarget', opsTargetSchema);
