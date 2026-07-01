/**
 * Ls2Vehicle — the latest known state of one Location Solutions (Wialon) unit.
 *
 * The poll job upserts one document per unit (`unitId` = Wialon item id) every
 * tick: the full decoded telemetry snapshot plus the handful of computed fields
 * we filter/sort by (odometer, hottest tire, coolant, online status). Maintenance
 * planning lives here too — the periodic-service baseline + optional per-vehicle
 * interval overrides that drive the "service due" alerts.
 */
const mongoose = require('mongoose');

const tireSchema = new mongoose.Schema({
  axle: Number,
  position: Number,
  tempC: Number,
  pressurePsi: Number,
  fault: Boolean,
}, { _id: false });

const ls2VehicleSchema = new mongoose.Schema({
  unitId: { type: Number, required: true, unique: true, index: true },
  name: { type: String, default: '' },
  plate: { type: String, default: '', index: true },
  driver: { type: String, default: '' },

  // ---- Live telemetry (refreshed every poll) ----
  position: { lat: Number, lng: Number, speed: Number, course: Number, altitude: Number },
  lastMessageAt: { type: Date, index: true },
  ignition: { type: Boolean, default: null },
  moving: { type: Boolean, default: null },
  speed: Number,
  rpm: Number,
  coolantC: Number,
  fuelPct: Number,
  totalFuelUsedL: Number,
  weightKg: Number,
  mainPowerV: Number,
  backupBatteryV: Number,
  gsmSignal: Number,
  odometerKm: { type: Number, index: true },
  engineHours: Number,
  tires: [tireSchema],
  tireCount: Number,
  maxTireTempC: Number,
  minTirePressurePsi: Number,
  tireFaults: Number,

  // Derived movement status: moving | idle | stopped | offline
  status: { type: String, default: 'stopped', index: true },
  // Highest active-alert severity on this vehicle (critical|warning|info|null).
  alertLevel: { type: String, default: null, index: true },
  activeAlertCount: { type: Number, default: 0 },

  // ---- Maintenance plan (periodic service by distance) ----
  // Odometer reading at the last completed service. nextServiceKm =
  // lastServiceOdometerKm + (serviceIntervalKm || settings default).
  lastServiceOdometerKm: { type: Number, default: null },
  serviceIntervalKm: { type: Number, default: null }, // override; null → use settings
  lastServiceAt: { type: Date, default: null },

  lastSyncedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.models.Ls2Vehicle || mongoose.model('Ls2Vehicle', ls2VehicleSchema);
