/**
 * Express IT GPS (track4.expressit.com.sa): the light-transport / Media Go units.
 * Read-only REST: one key, `cmd` per call. Times from the provider are UTC ("YYYY-MM-DD HH:MM:SS"); the history parameter is
 * spelled `iemi` by the provider (`imei` errors). Positions arrive about every 2 min while moving (batched uploads), route points ~27 s.
 * The key lives in EXPRESS_TRACK_KEY and is never sent to clients.
 */
const cache = require('../utils/ttlCache');

const BASE = 'https://track4.expressit.com.sa/api/rest.php';
const KEY = () => String(process.env.EXPRESS_TRACK_KEY || '').trim();
const configured = () => /^[A-F0-9]{32}$/i.test(KEY());

/** Units seen within this many minutes are live; after a day without data a unit is offline. */
const LIVE_MIN = 10;
const OFFLINE_MIN = 24 * 60;
const MOVING_KMH = 3;
const STOP_MIN = 5;

async function call(cmd, params = {}) {
  if (!configured()) { const e = new Error('تتبّع إكسبريس غير مُعدّ على الخادم'); e.status = 503; throw e; }
  const qs = new URLSearchParams({ Key: KEY(), cmd, ...params });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(`${BASE}?${qs}`, { signal: ctrl.signal });
    const text = await r.text();
    // The provider prefixes PHP notices to bad requests; the JSON is what follows them.
    const start = text.search(/[[{]/);
    if (start < 0) throw new Error('رد غير متوقَّع من مزوّد التتبّع');
    return JSON.parse(text.slice(start));
  } finally { clearTimeout(t); }
}

const utcStamp = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const parseUtc = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`) : null);
const riyadhDay = (d) => new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const plateOfName = (name) => String(name || '').split(' - ')[0].replace(/\s+/g, ' ').trim();
const isMediaGo = (name) => /media\s*go/i.test(String(name || ''));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Teltonika IO elements worth showing: ignition, movement, external and battery voltage (mV), odometer (m), GSM signal. */
function decodeParams(p = {}) {
  const out = {};
  if (p.io239 != null) out.ignition = String(p.io239) === '1';
  if (p.io240 != null) out.movement = String(p.io240) === '1';
  if (p.io66 != null) out.externalVoltage = Math.round(Number(p.io66) / 10) / 100;
  if (p.io67 != null) out.batteryVoltage = Math.round(Number(p.io67) / 10) / 100;
  if (p.io16 != null) out.odometerKm = Math.round(Number(p.io16) / 100) / 10;
  if (p.io21 != null) out.gsmSignal = Number(p.io21);
  if (p.gpslev != null) out.satellites = Number(p.gpslev);
  return out;
}

function stateOf(at, speed, ignition) {
  if (!at) return 'offline';
  const age = (Date.now() - at.getTime()) / 60000;
  if (age > OFFLINE_MIN) return 'offline';
  if (age > LIVE_MIN) return 'late';
  if (speed > MOVING_KMH) return 'moving';
  return ignition ? 'idling' : 'stopped';
}

/**
 * Every unit with its last position. The provider takes about 20 s to answer OBJECT_GET_LOCATIONS, so the last answer is served at
 * once and refreshed in the background (fresh 25 s, kept 15 min), and while anyone watched in the last 5 min a 30 s timer keeps it
 * warm, so viewers never wait on the provider after the first load.
 */
let lastDemand = 0;
let warmTimer = null;
function keepWarm() {
  lastDemand = Date.now();
  if (warmTimer) return;
  warmTimer = setInterval(() => {
    if (Date.now() - lastDemand > 5 * 60000) { clearInterval(warmTimer); warmTimer = null; return; }
    loadUnits().catch(() => {});
  }, 30000);
  if (warmTimer.unref) warmTimer.unref();
}
async function units() {
  keepWarm();
  return loadUnits();
}
async function loadUnits() {
  return cache.wrapStale('express:units', 25000, 15 * 60000, async () => {
    const [objects, locs] = await Promise.all([
      cache.wrap('express:objects', 10 * 60000, () => call('USER_GET_OBJECTS')),
      call('OBJECT_GET_LOCATIONS'),
    ]);
    const list = Array.isArray(objects) ? objects : [];
    return list.map((o) => {
      const l = (locs && locs[o.imei]) || {};
      const at = parseUtc(l.dt_tracker);
      const speed = num(l.speed) || 0;
      const io = decodeParams(l.params);
      return {
        imei: String(o.imei), name: String(o.name || l.name || '').trim(), plate: plateOfName(o.name || l.name),
        mediaGo: isMediaGo(o.name || l.name), active: String(o.active) === 'true',
        lat: num(l.lat), lng: num(l.lng), speed, angle: num(l.angle), altitude: num(l.altitude),
        at: at ? at.toISOString() : null, serverAt: l.dt_server ? parseUtc(l.dt_server).toISOString() : null,
        state: stateOf(at, speed, io.ignition), io,
      };
    });
  });
}

/** One unit's raw points for [from, to); a closed window (ended over 10 min ago) is kept 6 h, an open one 30 s. */
async function rawHistory(imei, from, to) {
  const closed = Date.now() - to.getTime() > 10 * 60000;
  const key = `express:hist:${imei}:${from.toISOString()}:${to.toISOString()}`;
  return cache.wrap(key, closed ? 6 * 3600000 : 30000, async () => {
    const rows = await call('OBJECT_GET_HISTORY', { iemi: imei, dtf: utcStamp(from), dtt: utcStamp(to) });
    return (Array.isArray(rows) ? rows : []).map((p) => ({
      t: parseUtc(p.dt_tracker).getTime(), lat: num(p.lat), lng: num(p.lng), speed: num(p.speed) || 0, angle: num(p.angle),
      ign: p.params?.io239 != null ? String(p.params.io239) === '1' : null,
    })).filter((p) => Number.isFinite(p.t) && p.lat && p.lng && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  });
}

/** Points over any span, fetched in one-day windows (4 at a time) so a month neither times out nor refetches closed days. */
async function history(imei, from, to) {
  const DAY = 24 * 3600000;
  const windows = [];
  for (let a = from.getTime(); a < to.getTime(); a += DAY) windows.push([new Date(a), new Date(Math.min(a + DAY, to.getTime()))]);
  const out = [];
  for (let i = 0; i < windows.length; i += 4) {
    // eslint-disable-next-line no-await-in-loop
    const parts = await Promise.all(windows.slice(i, i + 4).map(([a, b]) => rawHistory(imei, a, b)));
    parts.forEach((p) => out.push(...p));
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((p, i) => i === 0 || p.t !== out[i - 1].t);
}

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Route analysis: distance, moving / stopped time, stops of 5 min or more, top and average speed, speeding events and a per-day
 * breakdown (Riyadh days). GPS jumps faster than 250 km/h are dropped from the distance so one bad fix does not add kilometres.
 */
function analyse(points, { speedLimit = 80 } = {}) {
  let km = 0; let movingMs = 0; let idleMs = 0; let maxSpeed = 0; let speedSum = 0; let speedN = 0;
  const days = new Map();
  const dayOf = (t) => { const k = riyadhDay(new Date(t)); if (!days.has(k)) days.set(k, { day: k, km: 0, movingMin: 0, maxSpeed: 0, firstMove: null, lastMove: null, points: 0 }); return days.get(k); };
  const stops = []; const speeding = [];
  let stopStart = null; let overStart = null; let overMax = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]; const d = dayOf(p.t); d.points += 1;
    if (p.speed > maxSpeed) maxSpeed = p.speed;
    if (p.speed > d.maxSpeed) d.maxSpeed = p.speed;
    if (p.speed > MOVING_KMH) { speedSum += p.speed; speedN += 1; d.lastMove = p.t; if (!d.firstMove) d.firstMove = p.t; }
    if (i > 0) {
      const q = points[i - 1]; const dt = p.t - q.t;
      const seg = haversineKm(q, p);
      const implied = dt > 0 ? seg / (dt / 3600000) : Infinity;
      if (implied < 250) { km += seg; d.km += seg; }
      // Gaps over 10 min are device silence, not driving or idling.
      if (dt > 0 && dt < 10 * 60000) {
        if (q.speed > MOVING_KMH || p.speed > MOVING_KMH) { movingMs += dt; d.movingMin += dt / 60000; } else if (q.ign) idleMs += dt;
      }
    }
    const still = p.speed <= MOVING_KMH;
    if (still && !stopStart) stopStart = p;
    if ((!still || i === points.length - 1) && stopStart) {
      const end = still ? p : points[i - 1] || p;
      const mins = (end.t - stopStart.t) / 60000;
      if (mins >= STOP_MIN) stops.push({ from: new Date(stopStart.t).toISOString(), to: new Date(end.t).toISOString(), minutes: Math.round(mins), lat: stopStart.lat, lng: stopStart.lng });
      stopStart = null;
    }
    const over = p.speed > speedLimit;
    if (over && !overStart) { overStart = p; overMax = p.speed; }
    if (over) overMax = Math.max(overMax, p.speed);
    if ((!over || i === points.length - 1) && overStart) {
      speeding.push({ at: new Date(overStart.t).toISOString(), maxSpeed: overMax, lat: overStart.lat, lng: overStart.lng, seconds: Math.round(((over ? p.t : points[i - 1].t) - overStart.t) / 1000) });
      overStart = null;
    }
  }
  const span = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
  const stopMs = stops.reduce((a, s) => a + s.minutes * 60000, 0);
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    km: r1(km), points: points.length,
    movingMinutes: Math.round(movingMs / 60000), idleMinutes: Math.round(idleMs / 60000), stoppedMinutes: Math.round(stopMs / 60000),
    spanMinutes: Math.round(span / 60000),
    maxSpeed: Math.round(maxSpeed), avgMovingSpeed: speedN ? Math.round(speedSum / speedN) : 0,
    speedLimit, speedingCount: speeding.length, speeding: speeding.slice(0, 300),
    stopsCount: stops.length, stops: stops.slice(0, 500),
    first: points[0] ? new Date(points[0].t).toISOString() : null,
    last: points.length ? new Date(points[points.length - 1].t).toISOString() : null,
    days: [...days.values()].map((d) => ({
      ...d, km: r1(d.km), movingMin: Math.round(d.movingMin),
      firstMove: d.firstMove ? new Date(d.firstMove).toISOString() : null, lastMove: d.lastMove ? new Date(d.lastMove).toISOString() : null,
    })),
  };
}

/** Thins a route for drawing (every stop and turn kept by spacing in time); analysis always runs on the full set. */
function thin(points, max = 6000) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Provider-side distance for a span (km), for the fleet ranking; cached like history windows. */
async function distance(imei, from, to) {
  const closed = Date.now() - to.getTime() > 10 * 60000;
  return cache.wrap(`express:dist:${imei}:${from.toISOString()}:${to.toISOString()}`, closed ? 6 * 3600000 : 5 * 60000, async () => {
    const r = await call('OBJECT_GET_DISTANCE', { iemi: imei, dtf: utcStamp(from), dtt: utcStamp(to) });
    return Math.round((Number(r?.distance) || 0) * 10) / 10;
  });
}

/** Distance of every unit over a span, 8 provider calls at a time. */
async function fleetDistance(imeis, from, to) {
  const out = new Map();
  for (let i = 0; i < imeis.length; i += 8) {
    // eslint-disable-next-line no-await-in-loop
    const part = await Promise.all(imeis.slice(i, i + 8).map((m) => distance(m, from, to).catch(() => null)));
    part.forEach((km, j) => out.set(imeis[i + j], km));
  }
  return out;
}

module.exports = { configured, units, history, analyse, thin, fleetDistance, plateOfName, riyadhDay, LIVE_MIN, OFFLINE_MIN };
