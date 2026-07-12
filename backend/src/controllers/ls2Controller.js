/**
 * ls2Controller — read/act API for the Location Solutions section. Reads the
 * mirrored snapshots the poll job keeps in Mongo (fast, no upstream round-trip),
 * computes the dashboard analytics + maintenance projections, and exposes the few
 * write actions (acknowledge an alert, mark a vehicle serviced, edit thresholds).
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Alert = require('../models/Ls2Alert');
const Ls2Settings = require('../models/Ls2Settings');
const Ls2ServiceLog = require('../models/Ls2ServiceLog');
const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
const reports = require('../services/ls2Reports');
const cfg = require('../config/ls2Config');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');

const CACHE_TTL = 5000;

function fail(res, error, fallback) {
  const status = error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error(`${fallback}:`, error.message);
  res.status(status).json({ message: error.message || fallback });
}

// Build the maintenance view the UI reads, straight from the mirrored Wialon
// fields the poll job already stored (no recompute — these are refreshed every
// tick). Kept as a nested `maintenance` object for backwards compatibility.
function withMaintenance(v) {
  return {
    ...v,
    maintenance: {
      statusLevel: v.maintenanceStatus || 'ok',
      kmToService: v.kmToService ?? null,
      nextServiceKm: v.nextServiceKm ?? null,
      nextServiceName: v.nextServiceName || '',
      upcomingKm: v.upcomingKm ?? null,
      upcomingServiceKm: v.upcomingServiceKm ?? null,
      upcomingServiceName: v.upcomingServiceName || '',
      overdueCount: v.maintenanceOverdueCount || 0,
      dueCount: v.maintenanceDueCount || 0,
      intervals: v.serviceIntervals || [],
    },
  };
}

// Cairo calendar helpers for period math (snapshots are keyed by Cairo day).
const cairoDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Epoch-second bounds (Cairo is UTC+2, no DST since 2015) for a Cairo day range.
const cairoEpoch = (ymd, endOfDay = false) => Math.floor(new Date(`${ymd}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00`).getTime() / 1000);

/**
 * Per-vehicle distance over [from, to] (inclusive Cairo days) from the daily
 * odometer snapshots — instant, and the numbers are Wialon's own counter.
 * km = odometer(end of `to`) − odometer(end of day before `from`).
 */
async function mileageByUnit(from, to) {
  const [ends, starts] = await Promise.all([
    // Latest snapshot on/before `to` per unit.
    Ls2OdometerDaily.aggregate([
      { $match: { date: { $lte: to } } },
      { $sort: { unitId: 1, date: 1 } },
      { $group: { _id: '$unitId', odo: { $last: '$odometerKm' }, date: { $last: '$date' } } },
    ]),
    // Baseline: latest snapshot strictly before `from` per unit.
    Ls2OdometerDaily.aggregate([
      { $match: { date: { $lt: from } } },
      { $sort: { unitId: 1, date: 1 } },
      { $group: { _id: '$unitId', odo: { $last: '$odometerKm' }, date: { $last: '$date' } } },
    ]),
  ]);
  // Earliest snapshot within the range — the fallback baseline when a unit has no
  // history before `from` (measure from its first reading inside the window).
  const firstIn = await Ls2OdometerDaily.aggregate([
    { $match: { date: { $gte: from, $lte: to } } },
    { $sort: { unitId: 1, date: 1 } },
    { $group: { _id: '$unitId', odo: { $first: '$odometerKm' }, date: { $first: '$date' }, days: { $sum: 1 } } },
  ]);
  const endMap = new Map(ends.map((e) => [e._id, e]));
  const startMap = new Map(starts.map((s) => [s._id, s]));
  const firstMap = new Map(firstIn.map((f) => [f._id, f]));
  const out = new Map();
  for (const [unitId, end] of endMap) {
    const baseline = startMap.get(unitId) || firstMap.get(unitId);
    if (!baseline) continue;
    const km = Math.max(0, Math.round((end.odo - baseline.odo) * 10) / 10);
    out.set(unitId, {
      km,
      odoStart: baseline.odo,
      odoEnd: end.odo,
      activeDays: firstMap.get(unitId)?.days || 0,
      clipped: !startMap.has(unitId), // no pre-range baseline → first day may be partial
    });
  }
  return out;
}

// ---- Dashboard: the big analytical overview -------------------------------
exports.getDashboard = async (req, res) => {
  try {
    // Period for the distance panel — defaults to "this month so far" (Cairo).
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    const cacheKey = `ls2:dash:${from}:${to}`;
    const hit = cache.get(cacheKey);
    if (hit) return res.json(hit);

    const settings = await Ls2Settings.getOrCreate();
    const maint = settings.maintenance;
    const th = settings.thresholds;
    const [vehiclesRaw, openAlerts] = await Promise.all([
      Ls2Vehicle.find({}).lean(),
      Ls2Alert.find({ status: 'open' }).lean(),
    ]);
    const vehicles = vehiclesRaw.map((v) => withMaintenance(v));

    // Fleet status distribution
    const statusCounts = { moving: 0, idle: 0, stopped: 0, offline: 0 };
    for (const v of vehicles) statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;

    // Alert breakdowns
    const bySeverity = { critical: 0, warning: 0, info: 0 };
    const byType = {};
    for (const a of openAlerts) {
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      byType[a.type] = (byType[a.type] || 0) + 1;
    }
    const vehiclesWithAlerts = new Set(openAlerts.map((a) => a.unitId)).size;

    // Maintenance summary
    const overdue = vehicles.filter((v) => v.maintenance && v.maintenance.statusLevel === 'overdue');
    const due = vehicles.filter((v) => v.maintenance && v.maintenance.statusLevel === 'due');

    // Temperature analytics
    const tireTemps = vehicles.map((v) => v.maxTireTempC).filter((x) => x != null);
    const coolants = vehicles.map((v) => v.coolantC).filter((x) => x != null);
    const hotTires = vehicles.filter((v) => v.maxTireTempC != null && v.maxTireTempC >= th.tireTempC).length;
    const hotEngines = vehicles.filter((v) => v.coolantC != null && v.coolantC >= th.coolantTempC).length;
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

    // Top offenders (hottest tires / most alerts / closest to service)
    const topHotTires = [...vehicles].filter((v) => v.maxTireTempC != null)
      .sort((a, b) => b.maxTireTempC - a.maxTireTempC).slice(0, 8)
      .map((v) => ({ unitId: v.unitId, plate: v.plate, driver: v.driver, value: v.maxTireTempC }));
    const nearestService = [...vehicles].filter((v) => v.maintenance && v.maintenance.kmToService != null)
      .sort((a, b) => a.maintenance.kmToService - b.maintenance.kmToService).slice(0, 8)
      .map((v) => ({ unitId: v.unitId, plate: v.plate, driver: v.driver, kmToService: v.maintenance.kmToService, odometerKm: v.odometerKm, statusLevel: v.maintenance.statusLevel }));

    // Latest critical/warning alerts feed
    const latestAlerts = [...openAlerts]
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)).slice(0, 12)
      .map((a) => ({ id: a._id, unitId: a.unitId, plate: a.plate, type: a.type, severity: a.severity, message: a.message, value: a.value, unit: a.unit, lastSeenAt: a.lastSeenAt }));

    // Distance travelled over the selected period (from daily odometer snapshots).
    const mileMap = await mileageByUnit(from, to);
    const plateById = new Map(vehicles.map((v) => [v.unitId, v]));
    const mileRows = [...mileMap.entries()].map(([unitId, m]) => ({
      unitId, plate: plateById.get(unitId)?.plate || '', driver: plateById.get(unitId)?.driver || '', ...m,
    }));
    const totalKm = mileRows.reduce((s, r) => s + r.km, 0);
    const movedVehicles = mileRows.filter((r) => r.km > 0).length;
    const topMovers = [...mileRows].sort((a, b) => b.km - a.km).slice(0, 8);

    const payload = {
      generatedAt: Date.now(),
      fleet: {
        total: vehicles.length,
        online: vehicles.length - statusCounts.offline,
        statusCounts,
      },
      alerts: {
        totalOpen: openAlerts.length,
        vehiclesWithAlerts,
        bySeverity,
        byType,
        latest: latestAlerts,
      },
      maintenance: {
        overdueCount: overdue.length,
        dueCount: due.length,
        overdue: overdue.map((v) => ({ unitId: v.unitId, plate: v.plate, driver: v.driver, odometerKm: v.odometerKm, kmToService: v.maintenance.kmToService, nextServiceKm: v.maintenance.nextServiceKm })),
        due: due.map((v) => ({ unitId: v.unitId, plate: v.plate, driver: v.driver, odometerKm: v.odometerKm, kmToService: v.maintenance.kmToService, nextServiceKm: v.maintenance.nextServiceKm })),
        nearest: nearestService,
      },
      temperature: {
        avgTireTempC: avg(tireTemps),
        maxTireTempC: tireTemps.length ? Math.max(...tireTemps) : null,
        avgCoolantC: avg(coolants),
        maxCoolantC: coolants.length ? Math.max(...coolants) : null,
        hotTires,
        hotEngines,
        topHotTires,
      },
      distance: {
        from, to,
        totalKm: Math.round(totalKm),
        movedVehicles,
        avgKm: mileRows.length ? Math.round(totalKm / mileRows.length) : 0,
        topMovers,
        hasData: mileRows.length > 0,
      },
      thresholds: th,
      maintenancePlan: maint,
    };
    cache.set(cacheKey, payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load LS2 dashboard');
  }
};

// ---- Fleet mileage over a period (per vehicle, from daily snapshots) -------
exports.getMileage = async (req, res) => {
  try {
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });

    const [mileMap, vehicles] = await Promise.all([
      mileageByUnit(from, to),
      Ls2Vehicle.find({}).select('unitId plate driver name odometerKm status').lean(),
    ]);
    const items = vehicles.map((v) => {
      const m = mileMap.get(v.unitId) || { km: 0, odoStart: null, odoEnd: v.odometerKm, activeDays: 0, clipped: true };
      return { unitId: v.unitId, plate: v.plate, driver: v.driver, name: v.name, odometerKm: v.odometerKm, ...m };
    }).sort((a, b) => b.km - a.km);

    const totalKm = items.reduce((s, r) => s + r.km, 0);
    res.json({
      from, to,
      days: Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1,
      totalKm: Math.round(totalKm),
      movedVehicles: items.filter((r) => r.km > 0).length,
      items,
    });
  } catch (error) {
    fail(res, error, 'Failed to load mileage');
  }
};

// ---- Vehicles list (with filters) -----------------------------------------
exports.listVehicles = async (req, res) => {
  try {
    const { status, alertLevel, maintenance: maintFilter, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (alertLevel) filter.alertLevel = alertLevel;
    if (q) {
      const rx = new RegExp(String(q).trim(), 'i');
      filter.$or = [{ plate: rx }, { driver: rx }, { name: rx }];
    }
    // Maintenance filter is a stored field now — filter in Mongo, not in memory.
    if (maintFilter === 'due') filter.maintenanceStatus = 'due';
    else if (maintFilter === 'overdue') filter.maintenanceStatus = 'overdue';
    else if (maintFilter === 'due_or_overdue') filter.maintenanceStatus = { $ne: 'ok' };

    let vehicles = (await Ls2Vehicle.find(filter).lean()).map((v) => withMaintenance(v));

    // Optional: attach per-vehicle distance for a period (fleet mileage view).
    const { from, to } = req.query;
    if (from || to) {
      const t = to || cairoDate();
      const f = from || `${t.slice(0, 7)}-01`;
      const mileMap = await mileageByUnit(f, t);
      vehicles = vehicles.map((v) => ({ ...v, periodKm: mileMap.get(v.unitId)?.km ?? 0, periodFrom: f, periodTo: t }));
    }

    // Sort: by period distance when requested, else by plate.
    if (from || to) vehicles.sort((a, b) => (b.periodKm || 0) - (a.periodKm || 0));
    else vehicles.sort((a, b) => (a.plate || '').localeCompare(b.plate || ''));
    res.json({ items: vehicles, total: vehicles.length });
  } catch (error) {
    fail(res, error, 'Failed to list vehicles');
  }
};

// ---- Single vehicle (+ its alerts + service history) ----------------------
exports.getVehicle = async (req, res) => {
  try {
    const v = await Ls2Vehicle.findOne({ unitId: Number(req.params.id) }).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const [alerts, serviceLog] = await Promise.all([
      Ls2Alert.find({ unitId: v.unitId }).sort({ status: 1, lastSeenAt: -1 }).limit(50).lean(),
      Ls2ServiceLog.find({ unitId: v.unitId }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    res.json({ vehicle: withMaintenance(v), alerts, serviceLog });
  } catch (error) {
    fail(res, error, 'Failed to load vehicle');
  }
};

// ---- Per-vehicle distance for a period ------------------------------------
// Fast path = daily odometer snapshots. `source=report` fetches the authoritative
// number live from Wialon's report engine (slower ~2s, exact to the minute).
exports.getVehicleMileage = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const v = await Ls2Vehicle.findOne({ unitId }).select('unitId plate driver odometerKm').lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });

    if (req.query.source === 'report') {
      const cacheKey = `ls2:vmile:${unitId}:${from}:${to}`;
      const cached = cache.get(cacheKey);
      if (cached) return res.json(cached);
      const r = await reports.unitDistance(unitId, cairoEpoch(from), cairoEpoch(to, true));
      const out = { unitId, plate: v.plate, from, to, km: r.km, initialKm: r.initialKm, finalKm: r.finalKm, source: 'wialon-report' };
      cache.set(cacheKey, out, 60000); // reports are heavy — cache 60s
      return res.json(out);
    }

    const m = (await mileageByUnit(from, to)).get(unitId) || { km: 0, odoStart: null, odoEnd: v.odometerKm, activeDays: 0, clipped: true };
    res.json({ unitId, plate: v.plate, from, to, ...m, source: 'snapshots' });
  } catch (error) {
    fail(res, error, 'Failed to load vehicle mileage');
  }
};

// ---- Per-vehicle daily distance series (for the trend chart) ---------------
exports.getVehicleHistory = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const days = Math.min(180, Math.max(7, parseInt(req.query.days, 10) || 30));
    const to = req.query.to || cairoDate();
    const from = req.query.from || addDays(to, -(days - 1));
    // Need one snapshot before `from` to compute the first day's delta.
    const snaps = await Ls2OdometerDaily.find({ unitId, date: { $lte: to } })
      .sort({ date: 1 }).select('date odometerKm').lean();
    const inRange = snaps.filter((s) => s.date >= addDays(from, -1));
    const series = [];
    for (let i = 1; i < inRange.length; i++) {
      if (inRange[i].date < from) continue;
      const km = Math.max(0, Math.round((inRange[i].odometerKm - inRange[i - 1].odometerKm) * 10) / 10);
      series.push({ date: inRange[i].date, km });
    }
    res.json({ unitId, from, to, series });
  } catch (error) {
    fail(res, error, 'Failed to load vehicle history');
  }
};

// ---- Per-vehicle trips + derived stops (Wialon report, on-demand) ---------
exports.getVehicleTrips = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });
    const cacheKey = `ls2:trips:${unitId}:${from}:${to}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const out = await reports.unitTrips(unitId, cairoEpoch(from), cairoEpoch(to, true));
    const payload = { unitId, from, to, ...out };
    cache.set(cacheKey, payload, 60000);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load trips');
  }
};

// ---- Per-vehicle fuel consumption (CAN, Wialon report, on-demand) ----------
exports.getVehicleFuel = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });
    const cacheKey = `ls2:fuel:${unitId}:${from}:${to}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const fuel = await reports.unitFuel(unitId, cairoEpoch(from), cairoEpoch(to, true));
    const payload = { unitId, from, to, ...fuel };
    cache.set(cacheKey, payload, 60000);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load fuel');
  }
};

// ---- Per-vehicle GPS track (raw message history → polyline) ----------------
exports.getVehicleTrack = async (req, res) => {
  try {
    const client = require('../services/ls2Client');
    const unitId = Number(req.params.id);
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || today; // default: just today (tracks are large)
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });
    const cacheKey = `ls2:track:${unitId}:${from}:${to}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const data = await client.loadMessages(unitId, cairoEpoch(from), cairoEpoch(to, true), 20000);
    const msgs = (data && data.messages) || [];
    let points = [];
    for (const m of msgs) {
      if (m.pos && m.pos.y != null && m.pos.x != null) {
        points.push({ lat: m.pos.y, lng: m.pos.x, speed: Math.round(Number(m.pos.s) || 0), t: m.t });
      }
    }
    // Downsample to keep the payload light (~1200 points max).
    const MAX = 1200;
    if (points.length > MAX) {
      const step = Math.ceil(points.length / MAX);
      points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    }
    const payload = { unitId, from, to, count: points.length, points };
    cache.set(cacheKey, payload, 60000);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load track');
  }
};

// ---- Manual identity re-sync (admin) --------------------------------------
exports.refreshIdentity = async (req, res) => {
  try {
    const { syncIdentity } = require('../services/ls2Identity');
    const n = await syncIdentity();
    cache.clear('ls2:');
    res.json({ ok: true, synced: n });
  } catch (error) {
    fail(res, error, 'Failed to sync identity');
  }
};

// ---- Alerts list ----------------------------------------------------------
exports.listAlerts = async (req, res) => {
  try {
    const { status = 'open', severity, type, unitId } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (severity) filter.severity = severity;
    if (type) filter.type = type;
    if (unitId) filter.unitId = Number(unitId);
    const items = await Ls2Alert.find(filter)
      .sort({ status: 1, severity: 1, lastSeenAt: -1 }).limit(500).lean();
    res.json({ items, total: items.length });
  } catch (error) {
    fail(res, error, 'Failed to list alerts');
  }
};

exports.acknowledgeAlert = async (req, res) => {
  try {
    const a = await Ls2Alert.findByIdAndUpdate(req.params.id,
      { $set: { acknowledgedBy: req.user._id, acknowledgedAt: new Date() } }, { new: true });
    if (!a) return res.status(404).json({ message: 'Alert not found' });
    emitToAll('ls2:alert', { at: Date.now(), acknowledged: String(a._id) });
    res.json(a);
  } catch (error) {
    fail(res, error, 'Failed to acknowledge alert');
  }
};

// ---- Maintenance: mark a vehicle serviced (resets the service baseline) ----
exports.markServiced = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const v = await Ls2Vehicle.findOne({ unitId });
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const { serviceType = 'periodic', notes = '', odometerKm } = req.body || {};
    const odo = odometerKm != null ? Number(odometerKm) : v.odometerKm;
    v.lastServiceOdometerKm = odo;
    v.lastServiceAt = new Date();
    await v.save();
    // Clear the open maintenance alerts for this vehicle right away.
    await Ls2Alert.updateMany(
      { unitId, status: 'open', type: { $in: [cfg.ALERT_TYPES.MAINTENANCE_DUE, cfg.ALERT_TYPES.MAINTENANCE_OVERDUE] } },
      { $set: { status: 'resolved', resolvedAt: new Date() } }
    );
    const log = await Ls2ServiceLog.create({
      unitId, plate: v.plate, action: 'serviced', odometerKm: odo, serviceType, notes,
      performedBy: req.user._id, performedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), serviced: unitId });
    res.status(201).json({ vehicle: v, log });
  } catch (error) {
    fail(res, error, 'Failed to record service');
  }
};

// ---- Update editable per-vehicle metadata (manual — e.g. tire brand/type) ---
exports.updateVehicleMeta = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const set = {};
    if (req.body.tireBrand !== undefined) set.tireBrand = String(req.body.tireBrand).trim().slice(0, 80);
    if (!Object.keys(set).length) return res.status(400).json({ message: 'Nothing to update' });
    const v = await Ls2Vehicle.findOneAndUpdate({ unitId }, { $set: set }, { new: true });
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), meta: unitId });
    res.json({ vehicle: v });
  } catch (error) {
    fail(res, error, 'Failed to update vehicle');
  }
};

// ---- Settings (thresholds + maintenance plan) -----------------------------
exports.getSettings = async (req, res) => {
  try {
    const s = await Ls2Settings.getOrCreate();
    res.json({ thresholds: s.thresholds, maintenance: s.maintenance, defaults: { thresholds: cfg.DEFAULT_THRESHOLDS, maintenance: cfg.DEFAULT_MAINTENANCE } });
  } catch (error) {
    fail(res, error, 'Failed to load settings');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const s = await Ls2Settings.getOrCreate();
    const { thresholds, maintenance } = req.body || {};
    if (thresholds && typeof thresholds === 'object') s.thresholds = { ...s.thresholds, ...thresholds };
    if (maintenance && typeof maintenance === 'object') s.maintenance = { ...s.maintenance, ...maintenance };
    s.updatedBy = req.user._id;
    s.markModified('thresholds'); s.markModified('maintenance');
    await s.save();
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), settings: true });
    res.json({ thresholds: s.thresholds, maintenance: s.maintenance });
  } catch (error) {
    fail(res, error, 'Failed to update settings');
  }
};

// ---- Manual refresh (kick a poll tick) ------------------------------------
exports.refresh = async (req, res) => {
  try {
    const { tick } = require('../jobs/ls2Poll');
    tick().catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'Failed to refresh');
  }
};
