/**
 * ls2Reports — authoritative distance over an arbitrary date range, straight from
 * Wialon's report engine (the same numbers the LS2 web UI shows).
 *
 * The mirrored daily-odometer snapshots (Ls2OdometerDaily) answer "km in a period"
 * instantly for the whole fleet, but only from the day we started snapshotting.
 * This module is the ground truth used for (a) on-demand single-vehicle drill-down
 * over any historical range, and (b) the one-time history backfill.
 *
 * We run the "Cumulative distance report" template PER UNIT (fleet-wide reports
 * time out at the gateway) and read its "Mileage" column.
 */
const client = require('./ls2Client');
const cfg = require('../config/ls2Config');

// Wialon report cells come back as objects ({ t: "19,309.50 km", v: <raw> }) or
// plain strings. Pull the first usable number out (raw `v` preferred, else parse
// the formatted text). Returns null for the "-----" empty marker.
function cellNumber(cell) {
  if (cell == null) return null;
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'object') {
    if (typeof cell.v === 'number') return cell.v;
    if (cell.t != null) return cellNumber(cell.t);
    return null;
  }
  const s = String(cell).trim();
  if (!s || /^-+$/.test(s)) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function headerIndex(header, name) {
  return header.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
}

/**
 * Total distance (km) a single unit travelled in [from, to] (epoch seconds),
 * per Wialon's "Cumulative distance report". Returns { km, initialKm, finalKm }
 * (initial/final odometer when the template exposes them, else null).
 */
async function unitDistance(unitId, from, to) {
  const { header, rows } = await client.execReport(cfg.REPORTS.DISTANCE_TEMPLATE_ID, Number(unitId), from, to);
  if (!rows.length) return { km: 0, initialKm: null, finalKm: null };
  const iMileage = headerIndex(header, 'Mileage');
  const iInit = headerIndex(header, 'Initial mileage');
  const iFinal = headerIndex(header, 'Final mileage');
  // Sum across rows in case the template groups (single row for our template).
  let km = 0; let initialKm = null; let finalKm = null;
  for (const r of rows) {
    const c = r.c || [];
    if (iMileage >= 0) km += cellNumber(c[iMileage]) || 0;
    if (iInit >= 0 && initialKm == null) initialKm = cellNumber(c[iInit]);
    if (iFinal >= 0) { const f = cellNumber(c[iFinal]); if (f != null) finalKm = f; }
  }
  return { km: Math.round(km * 100) / 100, initialKm, finalKm };
}

// Parse a Wialon duration cell ("2:35:47" or "13 days 19:47:24") → seconds.
function durationSec(s) {
  if (s == null) return null;
  const str = String(s);
  let sec = 0;
  const dm = str.match(/(\d+)\s*day/i);
  if (dm) sec += Number(dm[1]) * 86400;
  const tm = str.match(/(\d+):(\d+):(\d+)/);
  if (tm) sec += Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3]);
  return sec || (dm ? sec : null);
}

/**
 * Individual trips for one unit over [from, to] (epoch seconds), from the
 * "Trips with Map" template. Each: begin/end time + location, distance, duration,
 * max/avg speed. Also derives the STOPS in between (gap = a stop at that place).
 */
async function unitTrips(unitId, from, to) {
  const { rows } = await client.runReport(cfg.REPORTS.TRIPS_TEMPLATE_ID, Number(unitId), from, to, { maxRows: 5000 });
  const trips = rows.map((r) => ({
    beginTime: r['Beginning'] || null,
    beginLocation: r['Initial location'] || '',
    endTime: r['End'] || null,
    endLocation: r['Final location'] || '',
    durationSec: durationSec(r['Duration']),
    km: cellNumber(r['Distance']) || 0,
    maxSpeed: cellNumber(r['Max speed']),
    avgSpeed: cellNumber(r['Avg speed']),
  }));
  // Stops = the idle gaps between consecutive trips (parked at trip N's end).
  const stops = [];
  for (let i = 1; i < trips.length; i++) {
    const prev = trips[i - 1]; const cur = trips[i];
    if (!prev.endTime || !cur.beginTime) continue;
    const secs = Math.round((new Date(cur.beginTime.replace(' ', 'T')) - new Date(prev.endTime.replace(' ', 'T'))) / 1000);
    if (secs <= 0) continue;
    stops.push({ location: prev.endLocation, from: prev.endTime, to: cur.beginTime, durationSec: secs });
  }
  const totalKm = Math.round(trips.reduce((s, t) => s + (t.km || 0), 0) * 10) / 10;
  const totalDriveSec = trips.reduce((s, t) => s + (t.durationSec || 0), 0);
  const maxSpeed = trips.reduce((m, t) => Math.max(m, t.maxSpeed || 0), 0);
  return {
    trips, stops,
    summary: { tripCount: trips.length, stopCount: stops.length, totalKm, totalDriveSec, maxSpeed },
  };
}

/**
 * Fuel consumption for one unit over [from, to] from the CAN "Fuel Consumed"
 * template: litres burned, efficiency (km/L), engine-on time, brand/model.
 * Returns null-ish zeros when the unit's CAN fuel isn't reporting.
 */
async function unitFuel(unitId, from, to) {
  const { rows } = await client.runReport(cfg.REPORTS.FUEL_CONSUMED_TEMPLATE_ID, Number(unitId), from, to);
  const r = rows[0] || {};
  return {
    brand: r['Brand'] || '',
    model: (r['Model'] || '').trim(),
    engineOnSec: durationSec(r['Engine on Time (hh:mm:ss)']),
    distanceKm: cellNumber(r['Driven Distance (KM)']),
    fuelL: cellNumber(r['Fuel Consumption (L)']),
    efficiencyKmL: cellNumber(r['Fuel Efficiency (Km/L)']),
  };
}

module.exports = { unitDistance, unitTrips, unitFuel, cellNumber, headerIndex, durationSec };
