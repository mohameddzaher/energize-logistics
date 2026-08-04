/**
 * Ls2TripCache — the answer to "how slow is a driver report?".
 *
 * Trip metrics come from Wialon's report engine, one report PER TRUCK, and those
 * reports must run one at a time (the engine has a single server-side slot — see
 * ls2Client.serialiseReport). At ~3–5s each that is what made a driver report
 * take fifteen seconds and a deep fleet pass take minutes.
 *
 * The saving observation: a period that has ENDED can never change. Trips for
 * July are the same trips whether you ask in August or next year. So a window
 * whose `to` is in the past is cached permanently; only a window that includes
 * today is short-lived, because today is still accumulating.
 *
 * In Mongo rather than in memory on purpose: it survives restarts and is shared
 * across every user and every process, so the second person to open a report
 * pays nothing.
 */
const mongoose = require('mongoose');

const ls2TripCacheSchema = new mongoose.Schema({
  unitId: { type: Number, required: true },
  // YYYY-MM-DD window this entry answers for.
  from: { type: String, required: true },
  to: { type: String, required: true },

  // The computed metrics (see ls2DriverPerformance.unitTripMetrics).
  metrics: { type: mongoose.Schema.Types.Mixed, required: true },

  // Whether the window was already closed when this was computed. A closed
  // window is immutable; an open one is re-read once it goes stale.
  closed: { type: Boolean, default: false },
  // Only set for OPEN windows — Mongo's TTL monitor drops them automatically.
  // Closed windows carry no expiry and are kept for good.
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

ls2TripCacheSchema.index({ unitId: 1, from: 1, to: 1 }, { unique: true });
// TTL: documents with `expiresAt` in the past are removed; docs with a null
// expiresAt are exempt, which is exactly the closed-window behaviour we want.
ls2TripCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Ls2TripCache || mongoose.model('Ls2TripCache', ls2TripCacheSchema);
