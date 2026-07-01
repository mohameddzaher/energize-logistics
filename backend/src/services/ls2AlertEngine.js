/**
 * ls2AlertEngine — turn a decoded telemetry snapshot into a set of alert
 * "conditions" and a derived status, given the editable thresholds + maintenance
 * plan. Pure/synchronous: the poll job calls this per vehicle and reconciles the
 * returned conditions against the open Ls2Alert docs (open new ones, resolve
 * cleared ones). No DB access here.
 */
const cfg = require('../config/ls2Config');
const { ALERT_TYPES: T, SEVERITY: S } = cfg;

const SEV_RANK = { [S.CRITICAL]: 3, [S.WARNING]: 2, [S.INFO]: 1 };

/**
 * Compute the periodic-service position for a vehicle.
 * Baseline = the odometer at the last completed service; when never recorded we
 * assume the vehicle is mid-cycle and derive it from the current odometer, so
 * "every 10k, alert 3k before" works out of the box.
 */
function maintenanceState(tel, vehicle, maint) {
  const odo = tel.odometerKm;
  if (odo == null) return null;
  const interval = (vehicle && vehicle.serviceIntervalKm) || maint.serviceIntervalKm || 10000;
  const alertBefore = maint.alertBeforeKm || 3000;
  const baseline = (vehicle && vehicle.lastServiceOdometerKm != null)
    ? vehicle.lastServiceOdometerKm
    : Math.floor(odo / interval) * interval;
  const nextServiceKm = baseline + interval;
  const kmToService = nextServiceKm - odo;
  let statusLevel = 'ok';
  if (kmToService <= 0) statusLevel = 'overdue';
  else if (kmToService <= alertBefore) statusLevel = 'due';
  return { interval, alertBefore, baseline, nextServiceKm, kmToService, statusLevel };
}

/**
 * @param {object} tel      normalized telemetry (ls2Sensors.normalize)
 * @param {object} vehicle  current Ls2Vehicle doc (for maintenance baseline) or null
 * @param {object} settings { thresholds, maintenance }
 * @returns {{ conditions: Array, status: string, alertLevel: string|null, maintenance: object|null }}
 */
function evaluate(tel, vehicle, settings) {
  const th = { ...cfg.DEFAULT_THRESHOLDS, ...(settings.thresholds || {}) };
  const maint = { ...cfg.DEFAULT_MAINTENANCE, ...(settings.maintenance || {}) };
  const conditions = [];
  const add = (c) => conditions.push(c);

  // ---- Offline / movement status -----------------------------------------
  const now = Date.now();
  const ageMin = tel.lastMessageAt ? (now - new Date(tel.lastMessageAt).getTime()) / 60000 : Infinity;
  const offline = ageMin > th.offlineMinutes;
  let status;
  if (offline) status = 'offline';
  else if (tel.speed != null && tel.speed > 3) status = 'moving';
  else if (tel.ignition) status = 'idle';
  else status = 'stopped';

  if (offline && Number.isFinite(ageMin)) {
    add({ type: T.OFFLINE, key: '', severity: S.INFO, unit: 'min', value: Math.round(ageMin), threshold: th.offlineMinutes,
      message: `No signal for ${Math.round(ageMin)} min` });
  }

  // ---- Tires: temperature + pressure -------------------------------------
  for (const tire of tel.tires || []) {
    const label = `A${tire.axle}·T${tire.position}`;
    const key = `axle${tire.axle}-tire${tire.position}`;
    if (tire.tempC != null) {
      if (tire.tempC >= th.tireTempCriticalC) {
        add({ type: T.TIRE_TEMP, key, severity: S.CRITICAL, unit: '°C', value: tire.tempC, threshold: th.tireTempCriticalC,
          message: `Tire ${label} critically hot: ${tire.tempC}°C` });
      } else if (tire.tempC >= th.tireTempC) {
        add({ type: T.TIRE_TEMP, key, severity: S.WARNING, unit: '°C', value: tire.tempC, threshold: th.tireTempC,
          message: `Tire ${label} hot: ${tire.tempC}°C` });
      }
    }
    if (tire.pressurePsi != null && tire.pressurePsi > 10) {
      if (tire.pressurePsi < th.tirePressureCriticalPsi) {
        add({ type: T.TIRE_PRESSURE_CRITICAL, key, severity: S.CRITICAL, unit: 'psi', value: tire.pressurePsi, threshold: th.tirePressureCriticalPsi,
          message: `Tire ${label} dangerously flat: ${tire.pressurePsi} psi — blow-out risk` });
      } else if (tire.pressurePsi < th.tirePressureMinPsi) {
        add({ type: T.TIRE_PRESSURE_LOW, key, severity: S.WARNING, unit: 'psi', value: tire.pressurePsi, threshold: th.tirePressureMinPsi,
          message: `Tire ${label} under-inflated: ${tire.pressurePsi} psi` });
      } else if (tire.pressurePsi > th.tirePressureMaxPsi) {
        add({ type: T.TIRE_PRESSURE_HIGH, key, severity: S.WARNING, unit: 'psi', value: tire.pressurePsi, threshold: th.tirePressureMaxPsi,
          message: `Tire ${label} over-inflated: ${tire.pressurePsi} psi` });
      }
    }
  }
  // Pressure imbalance across an axle (uneven wear / slow leak) — one per axle.
  const axleMap = new Map();
  for (const tire of tel.tires || []) {
    if (tire.fault || tire.pressurePsi == null || tire.pressurePsi <= 10) continue;
    if (!axleMap.has(tire.axle)) axleMap.set(tire.axle, []);
    axleMap.get(tire.axle).push(tire.pressurePsi);
  }
  for (const [axle, pressures] of axleMap) {
    if (pressures.length < 2) continue;
    const spread = Math.max(...pressures) - Math.min(...pressures);
    if (spread >= th.tirePressureImbalancePsi) {
      add({ type: T.TIRE_IMBALANCE, key: `axle${axle}`, severity: S.WARNING, unit: 'psi', value: spread, threshold: th.tirePressureImbalancePsi,
        message: `Axle ${axle} pressure imbalance: ${spread} psi spread` });
    }
  }
  // Faulty TPMS channels aggregated into one info alert (keeps the list clean).
  if (tel.tireFaults > 0) {
    add({ type: T.TIRE_FAULT, key: '', severity: S.INFO, unit: '', value: tel.tireFaults, threshold: 0,
      message: `${tel.tireFaults} tire sensor(s) not reporting` });
  }

  // ---- Engine coolant -----------------------------------------------------
  if (tel.coolantC != null) {
    if (tel.coolantC >= th.coolantTempCriticalC) {
      add({ type: T.COOLANT_TEMP, key: '', severity: S.CRITICAL, unit: '°C', value: tel.coolantC, threshold: th.coolantTempCriticalC,
        message: `Engine overheating: ${tel.coolantC}°C` });
    } else if (tel.coolantC >= th.coolantTempC) {
      add({ type: T.COOLANT_TEMP, key: '', severity: S.WARNING, unit: '°C', value: tel.coolantC, threshold: th.coolantTempC,
        message: `Engine hot: ${tel.coolantC}°C` });
    }
  }

  // ---- Engine over-rev ----------------------------------------------------
  if (tel.rpm != null && tel.rpm >= th.rpmMax) {
    add({ type: T.RPM_HIGH, key: '', severity: S.WARNING, unit: 'rpm', value: tel.rpm, threshold: th.rpmMax,
      message: `Engine over-revving: ${tel.rpm.toLocaleString()} rpm` });
  }

  // ---- Fuel / load / speed / battery (tiered) ----------------------------
  if (tel.fuelPct != null && tel.fuelPct < th.fuelCriticalPct) {
    add({ type: T.FUEL_LOW, key: '', severity: S.CRITICAL, unit: '%', value: tel.fuelPct, threshold: th.fuelCriticalPct,
      message: `Critically low fuel: ${tel.fuelPct}%` });
  } else if (tel.fuelPct != null && tel.fuelPct < th.fuelLowPct) {
    add({ type: T.FUEL_LOW, key: '', severity: S.WARNING, unit: '%', value: tel.fuelPct, threshold: th.fuelLowPct,
      message: `Low fuel: ${tel.fuelPct}%` });
  }
  if (tel.weightKg != null && tel.weightKg > th.weightMaxKg) {
    add({ type: T.OVERLOAD, key: '', severity: S.WARNING, unit: 'kg', value: tel.weightKg, threshold: th.weightMaxKg,
      message: `Overloaded: ${tel.weightKg.toLocaleString()} kg` });
  }
  if (status === 'moving' && tel.speed != null && tel.speed > th.speedCriticalKmh) {
    add({ type: T.SPEEDING, key: '', severity: S.CRITICAL, unit: 'km/h', value: tel.speed, threshold: th.speedCriticalKmh,
      message: `Dangerous speed: ${tel.speed} km/h` });
  } else if (status === 'moving' && tel.speed != null && tel.speed > th.speedMaxKmh) {
    add({ type: T.SPEEDING, key: '', severity: S.WARNING, unit: 'km/h', value: tel.speed, threshold: th.speedMaxKmh,
      message: `Speeding: ${tel.speed} km/h` });
  }
  // Only the truck's 24V system (mainPowerV) — never the device's ~4V backup cell.
  const volt = tel.mainPowerV;
  if (volt != null && volt > 0 && volt < th.batteryCriticalV) {
    add({ type: T.BATTERY_LOW, key: '', severity: S.CRITICAL, unit: 'V', value: volt, threshold: th.batteryCriticalV,
      message: `Critically low voltage: ${volt} V` });
  } else if (volt != null && volt > 0 && volt < th.batteryLowV) {
    add({ type: T.BATTERY_LOW, key: '', severity: S.WARNING, unit: 'V', value: volt, threshold: th.batteryLowV,
      message: `Low voltage: ${volt} V` });
  }

  // ---- Maintenance (periodic service by distance) ------------------------
  const m = maintenanceState(tel, vehicle, maint);
  if (m) {
    if (m.statusLevel === 'overdue') {
      add({ type: T.MAINTENANCE_OVERDUE, key: '', severity: S.CRITICAL, unit: 'km', value: Math.abs(m.kmToService), threshold: 0,
        message: `Service overdue by ${Math.abs(m.kmToService).toLocaleString()} km (odo ${tel.odometerKm.toLocaleString()})` });
    } else if (m.statusLevel === 'due') {
      add({ type: T.MAINTENANCE_DUE, key: '', severity: S.WARNING, unit: 'km', value: m.kmToService, threshold: m.alertBefore,
        message: `Service due in ${m.kmToService.toLocaleString()} km (at ${m.nextServiceKm.toLocaleString()} km)` });
    }
  }

  // Highest severity present becomes the vehicle's alert level.
  let alertLevel = null;
  for (const c of conditions) {
    if (!alertLevel || SEV_RANK[c.severity] > SEV_RANK[alertLevel]) alertLevel = c.severity;
  }

  return { conditions, status, alertLevel, maintenance: m };
}

module.exports = { evaluate, maintenanceState, SEV_RANK };
