/**
 * ls2Sensors — decode a raw Wialon `avl_unit` into a clean, structured telemetry
 * object our app can reason about.
 *
 * Wialon delivers sensors as expressions over raw message params, e.g.
 *   "tire_pressure_1_1*const0.145038"  (kPa → psi)
 *   "can_coolant_temp"                 (raw, J1939 offset −40 = °C)
 *   "fuel_lvl*const0.4"                (% or litres)
 *   "can_distance*const0.005"          (odometer km)
 * We evaluate those simple `param [* or /] const<n>` chains, then pull the fields
 * we care about (tires per axle, engine coolant, fuel, weight, speed, odometer,
 * engine hours, voltages, ignition/movement) into a normalized shape.
 *
 * Disconnected TPMS channels report 65535 (or absurd temps) — those are dropped.
 */
const cfg = require('../config/ls2Config');

// Evaluate a Wialon sensor expression against the raw param bag. Supports the
// common `base [* or /] const<number>` form (plus a bare param name). Returns null
// when the underlying param is missing/invalid.
function evalExpr(expr, params) {
  if (!expr || typeof expr !== 'string') return null;
  const m = expr.match(/^([a-zA-Z0-9_]+)(.*)$/);
  if (!m) return null;
  const base = m[1];
  const rest = m[2] || '';
  const raw = params[base];
  if (raw === undefined || raw === null) return null;
  let val = Number(raw);
  if (Number.isNaN(val)) return null;
  const ops = rest.matchAll(/([*/])const([0-9.]+)/g);
  for (const [, op, numStr] of ops) {
    const num = Number(numStr);
    if (op === '*') val *= num;
    else if (op === '/' && num !== 0) val /= num;
  }
  return val;
}

// Parse the unit display name — "1080 RXA سعيد اقبال" → { plate:'1080 RXA', driver:'سعيد اقبال' }.
// The plate is the leading "<digits> <2-4 latin letters>"; the rest is the driver.
function parseName(nm) {
  if (!nm) return { plate: '', driver: '' };
  const m = String(nm).match(/^\s*(\d{3,5}\s*[A-Za-z]{1,4})\s*(.*)$/);
  if (m) return { plate: m[1].replace(/\s+/g, ' ').trim(), driver: (m[2] || '').trim() };
  return { plate: '', driver: String(nm).trim() };
}

// Group raw tire params into a per-tire array. Wialon keys are
// `tire_<field>_<pos>_<axle>` (position, then axle — confirmed against LS2's own
// sensor names "1st-Axle-Tire1"). Pressure raw is kPa (→ psi ×0.145038).
//
// A TPMS channel that isn't reporting sends garbage: temp like 1774°, a leakage
// rate of 65535 ("no data"), or a valve-monitor status ≥3 (healthy = 1). When any
// of those fire we treat the WHOLE tire as a sensor fault and trust NEITHER its
// temperature NOR its pressure — the pressure it still "shows" is a stale/bogus
// value, so we blank both rather than display a fake reading.
function extractTires(params) {
  // Gather every tire_* field per (pos, axle) index first, then decide.
  const raw = new Map();
  for (const [k, v] of Object.entries(params)) {
    const m = k.match(/^(tire_[a-z_]+?)_(\d+)_(\d+)$/);
    if (!m) continue;
    const [, field, pos, axle] = m;
    const key = `${pos}_${axle}`;
    if (!raw.has(key)) raw.set(key, { axle: Number(axle), position: Number(pos) });
    raw.get(key)[field] = Number(v);
  }

  const out = [];
  for (const r of raw.values()) {
    const temp = r.tire_temp;
    const rawPress = r.tire_pressure;
    const leak = r.tire_air_leakage_rate;
    const valve = r.tire_valve_pressure_mon;
    const elec = r.tire_electrical_fault;
    const status = r.tire_status;

    const tempInvalid = temp == null || temp === cfg.INVALID_RAW || temp >= cfg.MAX_VALID_TIRE_TEMP || temp < -50;
    // Sensor not reporting → no-data. Calibrated against the live fleet: every
    // channel with valve≥3 also has garbage temp (fully subsumed), leak==65535
    // marks "no data", and status/electrical flags mark hardware faults.
    const fault = tempInvalid
      || leak === cfg.INVALID_RAW
      || (valve != null && valve >= 3)
      || (elec != null && elec > 0)
      || (status != null && status > 0);

    // A dead sensor's pressure is stale/bogus, so blank both when faulted.
    let tempC = null;
    let pressurePsi = null;
    if (!fault) {
      tempC = Math.round(temp);
      if (rawPress != null && rawPress !== cfg.INVALID_RAW && rawPress > 0) pressurePsi = Math.round(rawPress * 0.145038); // kPa → psi
    }
    out.push({ axle: r.axle, position: r.position, tempC, pressurePsi, fault });
  }
  // Front→back by axle, then tire position.
  return out
    .filter((t) => t.tempC !== null || t.pressurePsi !== null || t.fault)
    .sort((a, b) => a.axle - b.axle || a.position - b.position);
}

// Extract Wialon's own service intervals (`si`) into a clean, mirrored shape.
// Wialon stores the REAL maintenance plan per unit — one entry per service with:
//   n  = name (e.g. "1- Regular Service - Group A (20K KMs)")
//   t  = description (the parts/checklist)
//   im = interval by mileage (km);  it = by time (s);  ie = by engine-hours (h)
//   pm = odometer at the last service; pt/pe = last-service time/engine-hours
//   c  = how many times this service has been registered
//   ct = created, mt = last modified (≈ last time a service was registered)
// Next service = last-service reading + interval. We keep the raw mirrored
// numbers here; remaining/status is computed later where the odometer + pre-alert
// window are known (ls2AlertEngine.computeMaintenance).
function extractServiceIntervals(unit) {
  const si = unit && unit.si;
  if (!si || typeof si !== 'object') return [];
  const out = [];
  for (const key of Object.keys(si)) {
    const e = si[key];
    if (!e || typeof e !== 'object') continue;
    const im = Number(e.im) || 0;
    const it = Number(e.it) || 0;
    const ie = Number(e.ie) || 0;
    const kind = im > 0 ? 'mileage' : it > 0 ? 'time' : ie > 0 ? 'engineHours' : 'mileage';
    out.push({
      id: Number(e.id) || Number(key),
      name: (e.n || '').trim(),
      description: (e.t || '').replace(/\t+/g, ' ').trim(),
      kind,
      intervalKm: im,
      intervalDays: it > 0 ? Math.round(it / 86400) : 0,
      intervalEngineHrs: ie,
      lastServiceKm: e.pm != null ? Number(e.pm) : null,
      lastServiceEngineHrs: e.pe != null && e.pe > 0 ? Number(e.pe) : null,
      // pt (last-service time) is only set for time-based services; fall back to
      // `mt` (last modified = when the service was last registered in Wialon).
      lastServiceAt: e.pt > 0 ? new Date(e.pt * 1000) : (e.mt ? new Date(e.mt * 1000) : null),
      serviceCount: Number(e.c) || 0,
    });
  }
  // Group A → B → C order by interval size, then name.
  return out.sort((a, b) => (a.intervalKm - b.intervalKm) || a.name.localeCompare(b.name));
}

/**
 * Normalize one raw Wialon unit into our telemetry shape.
 * @param {object} unit raw item from core/search_items (poll flags)
 */
function normalize(unit) {
  if (!unit) return null;
  const p = (unit.lmsg && unit.lmsg.p) || {};
  const pos = unit.pos || null;
  const { plate, driver } = parseName(unit.nm);

  // NOTE: Wialon does NOT return the sensor DEFINITIONS (`sens`) in the poll
  // flags — they come back empty. So we compute every value straight from the
  // raw CAN/IO params (all present fleet-wide), using the same formulas LS2's
  // sensors use. This is also more robust than name-matching.
  const num = (k) => {
    const v = p[k];
    if (v === undefined || v === null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };

  const tires = extractTires(p);
  const tireTemps = tires.map((t) => t.tempC).filter((v) => v !== null && v !== undefined);
  const tirePress = tires.map((t) => t.pressurePsi).filter((v) => v !== null && v !== undefined && v > 10);

  const coolantRaw = num('can_coolant_temp');
  const coolantC = coolantRaw != null && coolantRaw !== cfg.INVALID_RAW ? Math.round(coolantRaw - 40) : null; // J1939 offset −40

  const rpmRaw = num('can_rpm');
  const rpm = rpmRaw != null ? Math.round(rpmRaw * 0.125) : null;

  // Fuel level: fuel_lvl×0.4 = %. On these trucks a raw 0 means the fuel sensor
  // is not wired (16/57), so treat 0 as "no data" rather than an empty tank —
  // otherwise every unwired truck raises a false low-fuel alert.
  const fuelRaw = num('fuel_lvl');
  const fuelPct = fuelRaw != null && fuelRaw > 0 ? Math.round(fuelRaw * 0.4) : null;

  // Gross weight: io_2_358×10 = kg (0 → unwired/empty, treat as no data).
  const weightRaw = num('io_2_358');
  const weightKg = weightRaw != null && weightRaw > 0 ? Math.round(weightRaw * 10) : null;

  // Electrical: `power` is the truck's 24V system (×0.001 = V). `battery` is the
  // GPS DEVICE's own ~4V backup cell — kept separate so we never compare it to
  // the 24V low-voltage threshold.
  const powerRaw = num('power');
  const mainPowerV = powerRaw != null && powerRaw > 0 ? Number((powerRaw * 0.001).toFixed(1)) : null;
  const battRaw = num('battery');
  const backupBatteryV = battRaw != null && battRaw > 0 ? Number((battRaw * 0.001).toFixed(1)) : null;

  const gsmSignal = num('gsm_signal'); // 0..31 GSM signal quality
  const totalFuelRaw = num('can_hfrc');
  const totalFuelUsedL = totalFuelRaw != null ? Math.round(totalFuelRaw * 0.001) : null;

  const lastTs = (unit.lmsg && unit.lmsg.t) || (pos && pos.t) || null;
  const speed = pos ? Math.round(Number(pos.s) || 0) : null;
  const moving = speed != null ? speed > 3 : (num('movement_sens') != null ? num('movement_sens') > 0 : null);
  // `in1` (ignition input) isn't in the raw stream on these devices → derive it
  // from engine RPM (engine running ⇒ ignition on).
  const in1 = num('in1');
  const ignition = in1 != null ? in1 === 1 : (rpm != null ? rpm > 0 : null);

  return {
    unitId: unit.id,
    name: unit.nm || '',
    plate,
    driver,
    // Position
    position: pos ? { lat: pos.y, lng: pos.x, speed: Math.round(Number(pos.s) || 0), course: pos.c ?? null, altitude: pos.z ?? null } : null,
    lastMessageAt: lastTs ? new Date(lastTs * 1000) : null,
    // Engine / drivetrain
    ignition,
    moving,
    speed,
    rpm,
    coolantC,
    // Fuel
    fuelPct,
    totalFuelUsedL,
    // Load
    weightKg,
    // Electrical
    mainPowerV,
    backupBatteryV,
    // Connectivity
    gsmSignal,
    // Counters (maintenance drivers)
    odometerKm: unit.cnm_km != null ? Math.round(unit.cnm_km) : null,
    engineHours: unit.cneh != null ? Math.round(Number(unit.cneh) * 10) / 10 : null,
    // Wialon's own service plan (mirrored — the real intervals, not a fixed cycle).
    serviceIntervals: extractServiceIntervals(unit),
    // Tires
    tires,
    tireCount: tires.length,
    maxTireTempC: tireTemps.length ? Math.max(...tireTemps) : null,
    minTirePressurePsi: tirePress.length ? Math.min(...tirePress) : null,
    tireFaults: tires.filter((t) => t.fault).length,
  };
}

module.exports = { normalize, evalExpr, parseName, extractTires, extractServiceIntervals };
