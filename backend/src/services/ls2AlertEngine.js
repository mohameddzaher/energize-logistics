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

const STATUS_RANK = { ok: 0, due: 1, overdue: 2 };

/**
 * Compute each service's position from Wialon's OWN mirrored intervals.
 *
 * Every interval already carries the real interval size (`intervalKm`) and the
 * odometer at the last actual service (`lastServiceKm`), so:
 *   nextServiceKm  = lastServiceKm + intervalKm
 *   remainingKm    = nextServiceKm − currentOdometer
 * i.e. if a truck was serviced late at 152,000 km on a 10,000 km plan, its next
 * service lands at 162,000 km — exactly as Wialon shows. No fixed cycle, no
 * guessing a baseline from the current odometer.
 *
 * Returns { intervals, summary } or null when the odometer is unknown.
 */
function computeMaintenance(tel, maint) {
  const odo = tel.odometerKm;
  if (odo == null) return null;
  const alertBeforeKm = (maint && maint.alertBeforeKm) || 3000;
  const alertBeforeDays = (maint && maint.alertBeforeDays) || 14;
  // Each of the four services warns on its own window — a 20K and an 80K service
  // are nothing alike. Falls back to the global only where none is set.
  const perService = (maint && maint.alertBefore) || {};
  const windowFor = (id) => Number(perService[id]) > 0 ? Number(perService[id]) : alertBeforeKm;
  const source = Array.isArray(tel.serviceIntervals) ? tel.serviceIntervals : [];
  const now = Date.now();

  const intervals = source.map((s) => {
    const r = { ...s };
    if (s.kind === 'engineHours' && s.intervalEngineHrs > 0 && s.lastServiceEngineHrs != null && tel.engineHours != null) {
      r.nextServiceValue = s.lastServiceEngineHrs + s.intervalEngineHrs;
      r.remaining = Math.round((r.nextServiceValue - tel.engineHours) * 10) / 10;
      r.statusLevel = r.remaining <= 0 ? 'overdue' : (r.remaining <= 50 ? 'due' : 'ok');
    } else if (s.kind === 'time' && s.intervalDays > 0 && s.lastServiceAt) {
      const dueAt = new Date(s.lastServiceAt).getTime() + s.intervalDays * 86400000;
      r.nextServiceAt = new Date(dueAt);
      r.remainingDays = Math.round((dueAt - now) / 86400000);
      r.statusLevel = r.remainingDays <= 0 ? 'overdue' : (r.remainingDays <= alertBeforeDays ? 'due' : 'ok');
    } else {
      // mileage-based (the default; all Energize services are mileage)
      const base = s.lastServiceKm != null ? s.lastServiceKm : odo;
      r.nextServiceKm = base + (s.intervalKm || 0);
      r.remainingKm = r.nextServiceKm - odo;
      r.alertBeforeKm = windowFor(s.id); // exposed so the UI can show each window
      r.statusLevel = r.remainingKm <= 0 ? 'overdue' : (r.remainingKm <= r.alertBeforeKm ? 'due' : 'ok');
    }
    return r;
  });

  // Fleet-level rollup: worst status wins, nearest upcoming mileage service.
  let summaryStatus = 'ok';
  for (const iv of intervals) if (STATUS_RANK[iv.statusLevel] > STATUS_RANK[summaryStatus]) summaryStatus = iv.statusLevel;
  const overdueCount = intervals.filter((iv) => iv.statusLevel === 'overdue').length;
  const dueCount = intervals.filter((iv) => iv.statusLevel === 'due').length;
  const mileageIvs = intervals.filter((iv) => iv.remainingKm != null);
  // "Worst" = smallest remaining km (overdue services are negative → most urgent
  // first). Drives triage sorting + the fleet "most overdue" column.
  const worst = mileageIvs.length
    ? mileageIvs.reduce((a, b) => (b.remainingKm < a.remainingKm ? b : a))
    : null;
  // "Upcoming" = the soonest service that hasn't passed yet (smallest positive
  // remaining). Null when everything is already overdue.
  const upcomingCandidates = mileageIvs.filter((iv) => iv.remainingKm > 0);
  const upcoming = upcomingCandidates.length
    ? upcomingCandidates.reduce((a, b) => (b.remainingKm < a.remainingKm ? b : a))
    : null;

  return {
    intervals,
    statusLevel: summaryStatus,
    overdueCount,
    dueCount,
    odometerKm: odo,
    // Most-urgent service (most overdue, or closest to due) — kept as kmToService
    // for existing callers/sorting.
    kmToService: worst ? worst.remainingKm : null,
    nextServiceKm: worst ? worst.nextServiceKm : null,
    nextServiceName: worst ? worst.name : null,
    // Nearest UPCOMING service (soonest not-yet-passed).
    upcomingKm: upcoming ? upcoming.remainingKm : null,
    upcomingServiceKm: upcoming ? upcoming.nextServiceKm : null,
    upcomingServiceName: upcoming ? upcoming.name : null,
  };
}

/**
 * @param {object} tel      normalized telemetry (ls2Sensors.normalize) — carries
 *                          the Wialon-mirrored serviceIntervals
 * @param {object} _vehicle unused (kept for call-site compatibility; maintenance
 *                          now comes straight from Wialon, not our own baseline)
 * @param {object} settings { thresholds, maintenance }
 * @returns {{ conditions: Array, status: string, alertLevel: string|null, maintenance: object|null }}
 */
function evaluate(tel, _vehicle, settings, deferrals = []) {
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

  // ---- Maintenance (Wialon's real per-service intervals) -----------------
  // One alert per due/overdue service, keyed by the Wialon interval id so each
  // service (Group A/B/C, TR Wheels…) reconciles independently.
  const m = computeMaintenance(tel, maint);
  if (m) {
    for (const iv of m.intervals) {
      if (iv.statusLevel === 'ok') continue;
      const key = `si${iv.id}`;
      const rem = iv.remainingKm != null ? iv.remainingKm : (iv.remainingDays != null ? iv.remainingDays : iv.remaining);
      const unit = iv.remainingKm != null ? 'km' : (iv.remainingDays != null ? 'd' : 'h');
      if (iv.statusLevel === 'overdue') {
        add({ type: T.MAINTENANCE_OVERDUE, key, severity: S.CRITICAL, unit, value: Math.abs(rem), threshold: 0,
          message: `${iv.name}: overdue by ${Math.abs(rem).toLocaleString()} ${unit}` });
      } else {
        add({ type: T.MAINTENANCE_DUE, key, severity: S.WARNING, unit, value: rem, threshold: iv.alertBeforeKm ?? maint.alertBeforeKm,
          message: `${iv.name}: due in ${rem.toLocaleString()} ${unit}${iv.nextServiceKm != null ? ` (at ${iv.nextServiceKm.toLocaleString()} km)` : ''}` });
      }
    }
  }

  // ---- Deferred checklist tasks (OUR extension, not Wialon) -------------
  // A task judged "still good for another N km" at a service gets an odometer
  // deadline. Warn before those km run out, escalate once they're used up.
  const perServiceWindow = (maint && maint.alertBefore) || {};
  for (const d of deferrals) {
    if (tel.odometerKm == null || d.dueAtOdometerKm == null) continue;
    const remaining = Math.round(d.dueAtOdometerKm - tel.odometerKm);
    // The task was deferred at a service, so it warns on that service's window.
    const before = Number(perServiceWindow[d.intervalId]) > 0
      ? Number(perServiceWindow[d.intervalId])
      : (maint.alertBeforeKm || 3000);
    if (remaining > before) continue; // still comfortably within the grant
    const overdue = remaining < 0;
    add({
      type: T.DEFERRED_TASK,
      key: `def${d.logId}:${d.label}`,
      severity: overdue ? S.CRITICAL : S.WARNING,
      unit: 'km',
      value: Math.abs(remaining),
      threshold: before,
      message: overdue
        ? `Deferred task "${d.label}" is overdue by ${Math.abs(remaining).toLocaleString()} km`
        : `Deferred task "${d.label}" is due in ${remaining.toLocaleString()} km (at ${d.dueAtOdometerKm.toLocaleString()} km)`,
      context: { deferred: true, label: d.label, dueAtOdometerKm: d.dueAtOdometerKm, intervalName: d.intervalName || '' },
    });
  }

  // Highest severity present becomes the vehicle's alert level.
  let alertLevel = null;
  for (const c of conditions) {
    if (!alertLevel || SEV_RANK[c.severity] > SEV_RANK[alertLevel]) alertLevel = c.severity;
  }

  return { conditions, status, alertLevel, maintenance: m };
}

module.exports = { evaluate, computeMaintenance, SEV_RANK };
