/**
 * Ls2OdometerDaily — one row per unit per Cairo-calendar day holding that day's
 * odometer reading (Wialon's own `cnm_km` counter) and engine hours.
 *
 * This is the fast, authoritative backbone for "how far did each truck go in a
 * period": km over [from, to] = odometer(day after `to`) − odometer(`from`).
 * The odometer only increases, so we keep the LARGEST reading seen each day
 * (`$max`) — the value at day's end. The poll job upserts today's row every tick;
 * a one-time backfill seeds history from Wialon reports.
 */
const mongoose = require('mongoose');

const ls2OdometerDailySchema = new mongoose.Schema({
  unitId: { type: Number, required: true, index: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD' (Africa/Cairo)
  odometerKm: { type: Number, required: true },
  engineHours: { type: Number, default: null },
  plate: { type: String, default: '' },
}, { timestamps: true });

ls2OdometerDailySchema.index({ unitId: 1, date: 1 }, { unique: true });
ls2OdometerDailySchema.index({ date: 1 });

module.exports = mongoose.models.Ls2OdometerDaily || mongoose.model('Ls2OdometerDaily', ls2OdometerDailySchema);
