/**
 * Ls2Alert — a telemetry alert raised for a vehicle (hot tire, over-pressure,
 * hot engine, low fuel, overload, speeding, low battery, service due, offline).
 *
 * The alert engine keeps at most one OPEN alert per (unitId, type, key) — where
 * `key` distinguishes sub-targets like a specific tire ("axle2-tire1"). When the
 * condition clears it flips the same doc to `resolved` (so we keep history) and
 * stops counting it as active. `value`/`threshold` capture the reading that
 * tripped it, for the UI.
 */
const mongoose = require('mongoose');

const ls2AlertSchema = new mongoose.Schema({
  unitId: { type: Number, required: true, index: true },
  plate: { type: String, default: '' },
  driver: { type: String, default: '' },

  type: { type: String, required: true, index: true }, // ALERT_TYPES.*
  key: { type: String, default: '' }, // sub-target (e.g. tire id) for dedup
  severity: { type: String, default: 'warning', index: true }, // critical|warning|info
  status: { type: String, default: 'open', index: true }, // open|resolved

  message: { type: String, default: '' },
  value: { type: Number, default: null }, // the reading that tripped it
  threshold: { type: Number, default: null },
  unit: { type: String, default: '' }, // °C | psi | % | km | km/h | V | kg

  // Snapshot context for the alert card (position/odometer when raised).
  context: { type: mongoose.Schema.Types.Mixed, default: {} },

  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  // Acknowledgement (an operator has seen/actioned it) — does not resolve it.
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acknowledgedAt: { type: Date, default: null },
}, { timestamps: true });

// One open alert per vehicle+type+sub-target.
ls2AlertSchema.index({ unitId: 1, type: 1, key: 1, status: 1 });
ls2AlertSchema.index({ status: 1, severity: 1, lastSeenAt: -1 });

module.exports = mongoose.models.Ls2Alert || mongoose.model('Ls2Alert', ls2AlertSchema);
