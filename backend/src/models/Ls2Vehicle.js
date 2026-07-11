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

  // ---- Identity (mirrored from Wialon profile + custom fields, slow sync) ----
  profile: {
    vin: { type: String, default: '' },
    brand: { type: String, default: '' },
    modelYear: { type: String, default: '' },
    vehicleType: { type: String, default: '' },
    registrationPlate: { type: String, default: '' },
    simIccid: { type: String, default: '' },
    installDate: { type: String, default: '' },
    lsUnitId: { type: String, default: '' },
    extra: [{ label: String, value: String }],
    syncedAt: { type: Date, default: null },
  },

  // Derived movement status: moving | idle | stopped | offline
  status: { type: String, default: 'stopped', index: true },
  // Highest active-alert severity on this vehicle (critical|warning|info|null).
  alertLevel: { type: String, default: null, index: true },
  activeAlertCount: { type: Number, default: 0 },

  // ---- Maintenance (mirrored straight from Wialon's `si` service plan) ----
  // One entry per Wialon service (Group A/B/C, TR Wheels…), each with the real
  // interval + the odometer at the last actual service, and the computed
  // next-service / remaining / status. This IS what Wialon shows — no fixed cycle.
  serviceIntervals: [{
    id: Number,
    name: String,
    description: String,
    kind: String, // mileage | time | engineHours
    intervalKm: Number,
    intervalDays: Number,
    intervalEngineHrs: Number,
    lastServiceKm: Number,
    lastServiceEngineHrs: Number,
    lastServiceAt: Date,
    serviceCount: Number,
    nextServiceKm: Number,
    remainingKm: Number,
    nextServiceAt: Date,
    remainingDays: Number,
    nextServiceValue: Number,
    remaining: Number,
    statusLevel: String, // ok | due | overdue
  }],
  // Fleet-list rollup (worst service status + the nearest upcoming one).
  maintenanceStatus: { type: String, default: 'ok', index: true }, // ok | due | overdue
  maintenanceOverdueCount: { type: Number, default: 0 },
  maintenanceDueCount: { type: Number, default: 0 },
  kmToService: { type: Number, default: null }, // most-urgent service remaining km (may be negative)
  nextServiceKm: { type: Number, default: null },
  nextServiceName: { type: String, default: '' },
  // Nearest UPCOMING service (soonest not-yet-passed) — null when all overdue.
  upcomingKm: { type: Number, default: null },
  upcomingServiceKm: { type: Number, default: null },
  upcomingServiceName: { type: String, default: '' },

  lastSyncedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.models.Ls2Vehicle || mongoose.model('Ls2Vehicle', ls2VehicleSchema);
