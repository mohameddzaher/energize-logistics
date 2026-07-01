/**
 * ls2Config — static configuration for the Location Solutions (Wialon) telemetry
 * integration (قسم لوكيشن سوليوشن).
 *
 * Location Solutions is a white-label Wialon GPS/telemetry platform. Our 57 heavy
 * trucks carry LS2 sensors (per-axle tire pressure/temperature, fuel, engine
 * coolant, weight, RPM, odometer, engine hours). We poll the Wialon Remote API,
 * decode the raw sensor stream into clean values, evaluate alerts (high tire
 * temp/pressure, hot engine, low fuel, overload, speeding, maintenance-due) and
 * mirror the latest snapshot into Mongo — kept live over socket.io.
 *
 * IMPORTANT: the endpoint is /wialon/ajax.html (NOT the /lsx/... the public docs
 * mention — that 404s). Auth is token → session: `token/login` returns an `eid`
 * session id used as `sid` on every later call.
 */

// The Wialon Remote API base. Every call is an HTTP POST form (svc, params, sid).
const BASE_URL = (process.env.LS2_BASE_URL || 'https://ls2a.locationsolutions.com/wialon/ajax.html');
// 72-char access token from the Location Solutions login flow (env-provided).
const TOKEN = process.env.LS2_TOKEN || '';

// avl_unit data flags. Poller flag 11265 = base(1) + last-message&position(1024)
// + sensors(2048) + counters(8192) — returns position, sensor defs, last-message
// params (tire/coolant/fuel/weight/speed) and odometer+engine-hours in one call.
const FLAGS = {
  BASE: 1,
  LAST_MESSAGE: 1024,
  SENSORS: 2048,
  COUNTERS: 8192,
};
const POLL_FLAGS = FLAGS.BASE | FLAGS.LAST_MESSAGE | FLAGS.SENSORS | FLAGS.COUNTERS; // 11265

// A raw sensor/tire reading equal to this (or temps above MAX_VALID_TIRE_TEMP) is
// a disconnected/faulty TPMS channel — Wialon reports 65535 as "no data".
const INVALID_RAW = 65535;
const MAX_VALID_TIRE_TEMP = 150; // °C — above this the channel is faulty, ignore.

// Default alert thresholds. These are the *seed* defaults; they are stored in the
// Ls2Settings singleton and are editable from the UI, so operations can tune them.
const DEFAULT_THRESHOLDS = {
  tireTempC: 75, // tire surface temperature (°C) — warn at/above
  tireTempCriticalC: 85, // critical tire temperature
  tirePressureMinPsi: 90, // under-inflation warning (psi)
  tirePressureCriticalPsi: 60, // severe under-inflation → blow-out risk (psi)
  tirePressureMaxPsi: 150, // over-inflation warning (psi)
  tirePressureImbalancePsi: 25, // max−min pressure across one axle → uneven wear
  coolantTempC: 100, // engine coolant temperature (°C)
  coolantTempCriticalC: 110,
  rpmMax: 2500, // engine over-rev warning (rpm)
  fuelLowPct: 15, // low-fuel warning (%)
  fuelCriticalPct: 7, // critical low fuel (%)
  weightMaxKg: 45000, // overload warning (kg gross)
  speedMaxKmh: 90, // over-speed warning (km/h)
  speedCriticalKmh: 110, // severe over-speed (km/h)
  batteryLowV: 22, // low main-power/battery voltage (V) — 24V systems
  batteryCriticalV: 20, // critically low voltage (V)
  offlineMinutes: 60, // no message for this long → vehicle considered offline
  idleMinutes: 30, // engine on + not moving for this long → excessive idling
};

// Default maintenance plan (periodic service by distance). Editable per settings
// and per vehicle. "Every serviceIntervalKm, alert alertBeforeKm before due."
const DEFAULT_MAINTENANCE = {
  serviceIntervalKm: 10000, // periodic service every 10,000 km
  alertBeforeKm: 3000, // start alerting 3,000 km before the next service
  engineHoursInterval: 500, // optional: service by engine hours too
  engineHoursAlertBefore: 50,
};

// Alert severities (drives colour + priority in the UI).
const SEVERITY = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };

// Alert type keys — stable identifiers used for dedup + filtering.
const ALERT_TYPES = {
  TIRE_TEMP: 'tire_temp',
  TIRE_PRESSURE_LOW: 'tire_pressure_low',
  TIRE_PRESSURE_CRITICAL: 'tire_pressure_critical',
  TIRE_PRESSURE_HIGH: 'tire_pressure_high',
  TIRE_IMBALANCE: 'tire_imbalance',
  TIRE_FAULT: 'tire_fault',
  COOLANT_TEMP: 'coolant_temp',
  RPM_HIGH: 'rpm_high',
  FUEL_LOW: 'fuel_low',
  OVERLOAD: 'overload',
  SPEEDING: 'speeding',
  BATTERY_LOW: 'battery_low',
  IDLING: 'idling',
  MAINTENANCE_DUE: 'maintenance_due',
  MAINTENANCE_OVERDUE: 'maintenance_overdue',
  OFFLINE: 'offline',
};

module.exports = {
  BASE_URL,
  TOKEN,
  FLAGS,
  POLL_FLAGS,
  INVALID_RAW,
  MAX_VALID_TIRE_TEMP,
  DEFAULT_THRESHOLDS,
  DEFAULT_MAINTENANCE,
  SEVERITY,
  ALERT_TYPES,
  isConfigured: () => Boolean(BASE_URL && TOKEN),
};
