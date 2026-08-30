/**
 * ls2Controller — read/act API for the Location Solutions section. Reads the
 * mirrored snapshots the poll job keeps in Mongo (fast, no upstream round-trip),
 * computes the dashboard analytics + maintenance projections, and exposes the few
 * write actions (acknowledge an alert, mark a vehicle serviced, edit thresholds).
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const { startOfDay, endOfDay } = require('../utils/companyDay');
const Ls2Alert = require('../models/Ls2Alert');
const Ls2Settings = require('../models/Ls2Settings');
const Ls2ServiceLog = require('../models/Ls2ServiceLog');
const Ls2Repair = require('../models/Ls2Repair');
const Ls2DriverAssignment = require('../models/Ls2DriverAssignment');
const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
const reports = require('../services/ls2Reports');
const tireSensors = require('../services/ls2TireSensors');
const cfg = require('../config/ls2Config');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');

const CACHE_TTL = 15000; // = دورة التحديث (poll) 15ث — البيانات لا تتغيّر أسرع من كده

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
      .sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt)).slice(0, 12)
      .map((a) => ({ id: a._id, key: a.key, unitId: a.unitId, plate: a.plate, type: a.type, severity: a.severity, message: a.message, value: a.value, unit: a.unit, lastSeenAt: a.lastSeenAt }));

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
      // مهرَّبٌ ومقصوص: نصُّ البحث يصير تعبيرًا نمطيًّا يُنفَّذ في القاعدة على
      // المجموعة كاملة، فنصٌّ خبيثٌ واحد يشغلها دهرًا.
      const rx = new RegExp(String(q).trim().slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ plate: rx }, { driver: rx }, { name: rx }];
    }
    // Maintenance filter is a stored field now — filter in Mongo, not in memory.
    if (maintFilter === 'due') filter.maintenanceStatus = 'due';
    else if (maintFilter === 'overdue') filter.maintenanceStatus = 'overdue';
    else if (maintFilter === 'due_or_overdue') filter.maintenanceStatus = { $ne: 'ok' };

    // Each ls2vehicle doc is heavy (telemetry snapshot + tires[] + sensors), so
    // the raw fetch costs ~2s. The poller refreshes every 15s, so an 8s cache
    // keyed by the filter collapses many concurrent LS2-page loads into one query
    // without ever showing meaningfully-stale data.
    const cacheKey = `ls2:vehicles:${status || ''}:${alertLevel || ''}:${maintFilter || ''}:${q || ''}`;
    const rawVehicles = await cache.wrap(cacheKey, 15000, () => Ls2Vehicle.find(filter).lean());
    // تغطية حسّاسات الكاوتش تُحسب هنا لا في المتصفّح: الشاشتان وتطبيق الهاتف
    // تقرأ الرقم نفسه من مصدرٍ واحد، فلا يختلف «٧ / ٥ / ٢» من شاشةٍ لأخرى.
    let vehicles = await tireSensors.attachToVehicles(rawVehicles.map((v) => withMaintenance(v)));

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
    const [alerts, serviceLog, driverHistory] = await Promise.all([
      Ls2Alert.find({ unitId: v.unitId }).sort({ status: 1, firstSeenAt: -1 }).limit(50).lean(),
      Ls2ServiceLog.find({ unitId: v.unitId }).sort({ createdAt: -1 }).limit(20).lean(),
      Ls2DriverAssignment.find({ unitId: v.unitId }).sort({ from: -1 }).limit(50).lean(),
    ]);
    res.json({ vehicle: await tireSensors.attachToVehicle(withMaintenance(v)), alerts, serviceLog, driverHistory });
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

    // بلا سقف: القارئ يرقّم حتى يستوفي المدى مهما طال. والسقف القديم (عشرون
    // ألفًا) كان يكفي اليوم ويضيق مع أوّل زيادةٍ في معدّل الإرسال أو في المدى
    // المطلوب — ويقصّ حينها بصمت، فيبدو المسار الناقص مسارًا كاملًا لشاحنةٍ وقفت.
    const data = await client.loadMessages(unitId, cairoEpoch(from), cairoEpoch(to, true));
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
    // القصُّ يُعلَن للشاشة لا يُدفَن في السجلّ: مسارٌ ناقصٌ يبدو مسارًا كاملًا
    // لشاحنةٍ وقفت — والفرق بينهما قرارٌ يُتّخذ.
    const payload = { unitId, from, to, count: points.length, points };
    if (data && data.truncated) {
      payload.truncated = true;
      payload.coveredUntil = data.actualTo ? new Date(data.actualTo * 1000).toISOString() : null;
    }
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
      .sort({ status: 1, firstSeenAt: -1 }).limit(500).lean();
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
    // A tire-sensor-change notice exists to be REVIEWED; acknowledging it is
    // that review — clear the notice so the alert resolves on the next poll.
    if (a.type === 'tire_sensor_change') {
      await Ls2Vehicle.updateOne({ unitId: a.unitId }, { $set: { sensorChangeNotice: null } });
    }
    emitToAll('ls2:alert', { at: Date.now(), acknowledged: String(a._id) });
    // كل شاشات ls2 بتسمع ls2:updated — فنبعته كمان عشان الإقرار يظهر لحظيًا في كل مكان.
    emitToAll('ls2:updated', { at: Date.now(), acknowledged: String(a._id) });
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

// Average km/day per unit over the last `days`, from the daily odometer
// snapshots — what turns "774 km left" into "≈ يومين من الآن".
async function avgKmPerDayByUnit(unitIds, days = 14) {
  const since = addDays(cairoDate(), -days);
  const rows = await Ls2OdometerDaily.aggregate([
    { $match: { unitId: { $in: unitIds }, date: { $gte: since } } },
    { $sort: { unitId: 1, date: 1 } },
    { $group: {
      _id: '$unitId',
      first: { $first: '$odometerKm' }, last: { $last: '$odometerKm' },
      firstDate: { $first: '$date' }, lastDate: { $last: '$date' },
    } },
  ]);
  const out = new Map();
  for (const r of rows) {
    const span = Math.max(1, (new Date(r.lastDate) - new Date(r.firstDate)) / 86400000);
    const km = Math.max(0, (r.last || 0) - (r.first || 0));
    // Below ~10 km/day the truck is effectively parked — an ETA from that pace
    // would read "due in 3 years" and mislead more than it informs.
    if (km / span >= 10) out.set(r._id, km / span);
  }
  return out;
}

// Attach the day-estimate to each deferral: remaining km ÷ that truck's real
// daily pace → estimatedDaysLeft + estimatedDueDate (null when parked/no data).
function attachDayEstimates(deferrals, rates) {
  const today = cairoDate();
  for (const d of deferrals) {
    const rate = rates.get(d.unitId);
    if (rate && d.remainingKm != null && d.remainingKm > 0) {
      const daysLeft = Math.max(0, Math.round(d.remainingKm / rate));
      d.estimatedDaysLeft = daysLeft;
      d.estimatedDueDate = addDays(today, daysLeft);
    } else {
      d.estimatedDaysLeft = null;
      d.estimatedDueDate = null;
    }
  }
  return deferrals;
}

// Open deferred checklist tasks for a vehicle ("good for another N km"), with how
// far they are from their due odometer — the basis for the pre-emptive warning.
function openDeferrals(history, currentOdo) {
  const out = [];
  for (const log of history) {
    for (const c of log.checklist || []) {
      if (c.status !== 'deferred' || c.resolved || c.dueAtOdometerKm == null) continue;
      out.push({
        unitId: log.unitId,
        label: c.label,
        labelAr: c.labelAr || '',
        note: c.note || '',
        deferKm: c.deferKm,
        dueAtOdometerKm: c.dueAtOdometerKm,
        currentOdometerKm: currentOdo, // العداد الآن — بجانب "الاستحقاق عند"
        remainingKm: currentOdo != null ? Math.round(c.dueAtOdometerKm - currentOdo) : null,
        intervalId: log.intervalId,
        intervalName: log.intervalName,
        deferredAt: log.serviceDate || log.createdAt,
        deferredAtOdometerKm: log.odometerKm,
        logId: log._id,
      });
    }
  }
  return out.sort((a, b) => (a.remainingKm ?? 1e9) - (b.remainingKm ?? 1e9));
}

// ---- Full maintenance view for one vehicle -----------------------------------
// The fleet's real service plan reduced to the FOUR types that actually exist —
// Group A/B/C and TR Wheels. Wialon gives each truck its own interval ids (the
// same "Group B" is id 2 on 56 trucks and id 5 or 17 on one each), so the id is
// per-vehicle noise; the leading number in the NAME is the stable key, and it is
// the same key the checklists in Settings are stored under.
//
// Exposed so the workshop can tag a work order with a real service type instead
// of keeping its own parallel list of the same four things.
exports.getServiceTypes = async (req, res) => {
  try {
    const [vehicles, settings] = await Promise.all([
      Ls2Vehicle.find({}).select('serviceIntervals').lean(),
      Ls2Settings.getOrCreate(),
    ]);

    // Group on the name WITHOUT its leading number: one truck carries the TR
    // Wheels service numbered "5-" while the other 56 call it "4-". Same service,
    // a typo in the plan — grouping on the number alone would report five types
    // where the workshop knows four. Lowest number wins as the canonical key.
    const bare = (n) => String(n).replace(/^\s*\d+\s*-\s*/, '').trim().toLowerCase();
    const byName = new Map();
    vehicles.forEach((v) => (v.serviceIntervals || []).forEach((si) => {
      const name = si.name || si.n;
      if (!name) return;
      const k = bare(name);
      const num = (String(name).match(/^\s*(\d+)/) || [])[1] || name;
      if (!byName.has(k)) {
        byName.set(k, { key: num, name, intervalKm: si.intervalKm ?? si.im ?? null, vehicles: 0 });
      }
      const row = byName.get(k);
      // Keep the numbering the fleet actually agrees on.
      if (String(num).localeCompare(String(row.key), undefined, { numeric: true }) < 0) {
        row.key = num;
        row.name = name;
      }
      row.vehicles += 1;
    }));

    const checklists = settings.checklists || {};
    const types = Array.from(byName.values())
      .sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }))
      // Checklists are keyed by serviceTemplateKey(name); the numeric key is only
      // a legacy fallback for docs saved before the keying was unified.
      .map((t) => ({ ...t, checklist: checklists[cfg.serviceTemplateKey(t.name)] || checklists[t.key] || [] }));

    res.json({ types });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load service types' });
  }
};

// Intervals (from Wialon) + OUR history (checklists), open deferrals and the
// unscheduled repairs — everything the vehicle's maintenance profile shows.
exports.getVehicleMaintenance = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const v = await Ls2Vehicle.findOne({ unitId }).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const [history, repairs, settings] = await Promise.all([
      Ls2ServiceLog.find({ unitId }).sort({ serviceDate: -1, createdAt: -1 }).limit(200).lean(),
      Ls2Repair.find({ unitId }).sort({ repairDate: -1 }).limit(200).lean(),
      Ls2Settings.getOrCreate(),
    ]);
    res.json({
      vehicle: withMaintenance(v),
      history,
      repairs,
      deferrals: attachDayEstimates(openDeferrals(history, v.odometerKm), await avgKmPerDayByUnit([unitId])),
      checklists: settings.checklists || {},
    });
  } catch (error) {
    fail(res, error, 'Failed to load maintenance');
  }
};

// ---- Unscheduled / exceptional repairs --------------------------------------
exports.listRepairs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.unitId) filter.unitId = Number(req.query.unitId);
    if (req.query.category) filter.category = req.query.category;
    if (req.query.status) filter.status = req.query.status;
    const items = await Ls2Repair.find(filter).sort({ repairDate: -1 }).limit(500).lean();
    res.json({ items, total: items.length });
  } catch (error) {
    fail(res, error, 'Failed to load repairs');
  }
};

exports.createRepair = async (req, res) => {
  try {
    const unitId = Number(req.body.unitId);
    const v = await Ls2Vehicle.findOne({ unitId }).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return res.status(400).json({ message: 'A title is required' });
    const item = await Ls2Repair.create({
      // «السائق وقتها» يدويًا إن أُدخل، وإلا سائق العربية الحالي.
      unitId, plate: v.plate, driver: (b.driver != null && String(b.driver).trim()) ? String(b.driver).trim() : v.driver,
      title: String(b.title).trim(),
      category: b.category || 'other',
      severity: b.severity || 'medium',
      status: b.status || 'done',
      repairDate: b.repairDate ? new Date(b.repairDate) : new Date(),
      odometerKm: b.odometerKm != null ? Number(b.odometerKm) : v.odometerKm,
      cost: b.cost != null ? Number(b.cost) : null,
      workshop: b.workshop || '',
      partsReplaced: b.partsReplaced || '',
      description: b.description || '',
      performedBy: req.user._id,
      performedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), repair: unitId });
    res.status(201).json({ item });
  } catch (error) {
    fail(res, error, 'Failed to create repair');
  }
};

exports.updateRepair = async (req, res) => {
  try {
    const allowed = ['title', 'category', 'severity', 'status', 'repairDate', 'odometerKm', 'cost', 'workshop', 'partsReplaced', 'description', 'driver'];
    const set = {};
    for (const k of allowed) if (req.body[k] !== undefined) set[k] = req.body[k];
    const item = await Ls2Repair.findByIdAndUpdate(req.params.repairId, { $set: set }, { new: true });
    if (!item) return res.status(404).json({ message: 'Repair not found' });
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), repair: item.unitId });
    res.json({ item });
  } catch (error) {
    fail(res, error, 'Failed to update repair');
  }
};

exports.deleteRepair = async (req, res) => {
  try {
    const item = await Ls2Repair.findByIdAndDelete(req.params.repairId);
    if (!item) return res.status(404).json({ message: 'Repair not found' });
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), repair: item.unitId });
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'Failed to delete repair');
  }
};

// ---- Register a completed service on ONE interval → writes to Location -------
// Solutions (Wialon) AND keeps our own richer record (real date, who, notes).
exports.registerServiceInterval = async (req, res) => {
  try {
    const client = require('../services/ls2Client');
    const unitId = Number(req.params.id);
    const v = await Ls2Vehicle.findOne({ unitId });
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });

    const { intervalId, odometerKm, serviceDate, engineHours, cost, notes = '', checklist } = req.body || {};
    if (intervalId == null) return res.status(400).json({ message: 'intervalId is required' });
    const odo = odometerKm != null ? Number(odometerKm) : v.odometerKm;
    if (odo == null || Number.isNaN(odo)) return res.status(400).json({ message: 'A valid odometer is required' });

    const iv = (v.serviceIntervals || []).find((s) => Number(s.id) === Number(intervalId));
    const intervalName = iv ? iv.name : '';

    // Our checklist: a deferred task ("still good for another N km") gets a due
    // odometer so we can warn before those km are used up.
    const checklistRows = (Array.isArray(checklist) ? checklist : []).map((c) => {
      const status = ['done', 'deferred', 'na'].includes(c.status) ? c.status : 'done';
      const deferKm = status === 'deferred' && c.deferKm != null ? Number(c.deferKm) : null;
      return {
        label: String(c.label || '').trim(),
        labelAr: String(c.labelAr || '').trim(),
        status,
        deferKm,
        dueAtOdometerKm: deferKm != null ? Math.round(odo + deferKm) : null,
        resolved: false,
        note: String(c.note || '').trim(),
      };
    }).filter((c) => c.label);

    // A task done now clears any earlier deferral of the same task on this truck.
    // Match on BOTH language variants: logs written before labels were canonical
    // carry whichever language the registrar's UI was in at the time.
    const doneLabels = checklistRows
      .filter((c) => c.status === 'done')
      .flatMap((c) => [c.label, c.labelAr])
      .filter(Boolean);
    if (doneLabels.length) {
      await Ls2ServiceLog.updateMany(
        { unitId, 'checklist.label': { $in: doneLabels }, 'checklist.status': 'deferred', 'checklist.resolved': false },
        { $set: { 'checklist.$[el].resolved': true } },
        { arrayFilters: [{ 'el.label': { $in: doneLabels }, 'el.status': 'deferred' }] }
      );
    }

    // The real service date, as entered — used both for our record and for the
    // Wialon write, so "last service" reads back as the date the user picked.
    const performedAt = serviceDate ? new Date(serviceDate) : new Date();

    // 1) Write it into Location Solutions (sets pm + bumps the executions count).
    let synced = false;
    try {
      await client.registerService(unitId, Number(intervalId), odo, engineHours, performedAt);
      synced = true;
    } catch (e) {
      // Surface the upstream reason but still keep our own record below.
      console.error('registerService (Wialon) failed:', e.message, e.wialonError);
    }

    // 2) Our own record — the REAL service date, exactly as entered.
    const log = await Ls2ServiceLog.create({
      unitId, plate: v.plate, action: 'serviced',
      odometerKm: odo, intervalId: Number(intervalId), intervalName,
      serviceDate: performedAt,
      engineHours: engineHours != null ? Number(engineHours) : null,
      cost: cost != null ? Number(cost) : null,
      checklist: checklistRows,
      notes, serviceType: 'periodic', syncedToWialon: synced,
      performedBy: req.user._id, performedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });

    // 3) Refresh our mirror from Wialon so the new "km left" shows soon — in the
    // BACKGROUND: a full 57-truck poll takes seconds, and the user was sitting
    // in the modal waiting for it. The tick's own ls2:updated emit refreshes
    // every open screen when the mirror catches up.
    if (synced) { require('../jobs/ls2Poll').tick().catch(() => {}); }
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), serviced: unitId, intervalId });

    const fresh = await Ls2Vehicle.findOne({ unitId }).lean();
    res.status(201).json({
      ok: true, syncedToWialon: synced,
      message: synced ? 'Service registered in Location Solutions' : 'Saved locally, but Location Solutions write failed',
      vehicle: fresh ? withMaintenance(fresh) : null, log,
    });
  } catch (error) {
    fail(res, error, 'Failed to register service');
  }
};

// ---- Act on ONE deferred checklist task -------------------------------------
// A task deferred at a service ("AC filter good for another 2,000 km") can later
// be settled on its own — WITHOUT registering a new full service (the interval
// itself isn't due). Three actions:
//   done  → it was actually done now; close it, its alert clears.
//   skip  → we've decided not to do it at all; close it (won't-do), alert clears.
//   defer → still fine, grant it another `addKm`; push its due odometer forward.
// The periodic interval in Wialon is never touched by any of these.
exports.resolveDeferral = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const { logId, label, action = 'done', odometerKm, addKm, note } = req.body || {};
    if (!logId || !label) return res.status(400).json({ message: 'logId and label are required' });
    if (!['done', 'skip', 'defer'].includes(action)) return res.status(400).json({ message: 'Invalid action' });

    const log = await Ls2ServiceLog.findOne({ _id: logId, unitId });
    if (!log) return res.status(404).json({ message: 'Deferral not found' });

    const item = (log.checklist || []).find(
      (c) => c.label === label && c.status === 'deferred' && !c.resolved
    );
    if (!item) return res.status(404).json({ message: 'Open deferral not found on this log' });

    const who = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    const today = new Date().toISOString().slice(0, 10);
    const at = odometerKm != null && odometerKm !== '' ? Number(odometerKm) : null;

    if (action === 'defer') {
      // Re-grant more km from where the truck is NOW (fall back to its odometer).
      const extra = Number(addKm);
      if (!(extra > 0)) return res.status(400).json({ message: 'A positive addKm is required to defer again' });
      const v0 = await Ls2Vehicle.findOne({ unitId }).lean();
      const fromOdo = at != null ? at : (v0 ? v0.odometerKm : null);
      if (fromOdo == null) return res.status(400).json({ message: 'Current odometer unknown — enter it to defer' });
      item.deferKm = extra;
      item.dueAtOdometerKm = Math.round(fromOdo + extra);
      const stamp = [today, `+${extra} km`, `@ ${Math.round(fromOdo)} km`, who || null, note || null].filter(Boolean).join(' · ');
      item.note = [item.note, `↻ ${stamp}`].filter(Boolean).join(' — ');
    } else {
      // done / skip both close the task; the mark records which.
      item.resolved = true;
      const mark = action === 'skip' ? '✗ won\'t do' : '✔ done';
      const stamp = [today, at != null ? `${at} km` : null, who || null, note || null].filter(Boolean).join(' · ');
      item.note = [item.note, `${mark} ${stamp}`].filter(Boolean).join(' — ');
    }
    await log.save();

    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), resolvedDeferral: unitId });

    const v = await Ls2Vehicle.findOne({ unitId }).lean();
    const history = await Ls2ServiceLog.find({ unitId }).sort({ serviceDate: -1, createdAt: -1 }).limit(200).lean();
    res.json({ ok: true, deferrals: attachDayEstimates(openDeferrals(history, v ? v.odometerKm : null), await avgKmPerDayByUnit([unitId])) });
  } catch (error) {
    fail(res, error, 'Failed to resolve deferral');
  }
};

// ---- Fleet-wide open deferrals ----------------------------------------------
// Every outstanding deferred task across ALL trucks, so the Maintenance page can
// act on them in one place without opening each vehicle profile.
exports.listDeferrals = async (req, res) => {
  try {
    const [logs, vehicles] = await Promise.all([
      Ls2ServiceLog.find({ checklist: { $elemMatch: { status: 'deferred', resolved: false } } })
        .select('unitId plate intervalId intervalName checklist serviceDate createdAt odometerKm').lean(),
      Ls2Vehicle.find({}).select('unitId plate driver odometerKm').lean(),
    ]);
    const vById = new Map(vehicles.map((v) => [v.unitId, v]));
    const out = [];
    for (const log of logs) {
      const v = vById.get(log.unitId);
      const currentOdo = v ? v.odometerKm : null;
      for (const c of log.checklist || []) {
        if (c.status !== 'deferred' || c.resolved || c.dueAtOdometerKm == null) continue;
        out.push({
          unitId: log.unitId,
          plate: (v && v.plate) || log.plate || String(log.unitId),
          driver: (v && v.driver) || '',
          label: c.label,
          labelAr: c.labelAr || '',
          note: c.note || '',
          deferKm: c.deferKm,
          dueAtOdometerKm: c.dueAtOdometerKm,
          remainingKm: currentOdo != null ? Math.round(c.dueAtOdometerKm - currentOdo) : null,
          currentOdometerKm: currentOdo,
          intervalId: log.intervalId,
          intervalName: log.intervalName,
          deferredAt: log.serviceDate || log.createdAt,
          deferredAtOdometerKm: log.odometerKm,
          logId: log._id,
        });
      }
    }
    // Most urgent first (most overdue → soonest due).
    out.sort((a, b) => (a.remainingKm ?? 1e9) - (b.remainingKm ?? 1e9));
    // "774 كم" تبقى "≈ يومين" — بحسب معدل مشي كل شاحنة فعليًا.
    attachDayEstimates(out, await avgKmPerDayByUnit([...new Set(out.map((d) => d.unitId))]));
    res.json({ deferrals: out });
  } catch (error) {
    fail(res, error, 'Failed to list deferrals');
  }
};

// ---- Drivers: who drove what, and how far --------------------------------
// Attribution: each DAY's distance for a truck (from the daily odometer
// snapshots) is credited to whichever driver was assigned to that truck on that
// day (Ls2DriverAssignment). That keeps a driver's km honest even when they
// switch trucks mid-period.
async function driverStats(from, to) {
  const [snaps, assigns] = await Promise.all([
    // One day before `from` too, so the first day's delta has a baseline.
    Ls2OdometerDaily.find({ date: { $gte: addDays(from, -1), $lte: to } }).sort({ unitId: 1, date: 1 }).lean(),
    Ls2DriverAssignment.find({
      $or: [{ to: null }, { to: { $gte: startOfDay(from) } }],
      from: { $lte: endOfDay(to) },
    }).lean(),
  ]);

  // Daily km per unit: odo(day) − odo(previous snapshot for that unit).
  const dayKm = []; // { unitId, date, km }
  let prev = null;
  for (const s of snaps) {
    if (prev && prev.unitId === s.unitId && s.date >= from) {
      const km = Math.max(0, Math.round((s.odometerKm - prev.odometerKm) * 10) / 10);
      if (km > 0) dayKm.push({ unitId: s.unitId, date: s.date, km });
    }
    prev = s;
  }

  // Who was on a unit on a given day?
  const byUnit = new Map();
  for (const a of assigns) {
    if (!byUnit.has(a.unitId)) byUnit.set(a.unitId, []);
    byUnit.get(a.unitId).push(a);
  }
  const driverOn = (unitId, date) => {
    const day = new Date(date + 'T12:00:00Z'); // midday → unambiguous
    const list = byUnit.get(unitId) || [];
    const hit = list.find((a) => new Date(a.from) <= day && (!a.to || new Date(a.to) >= day));
    return hit ? hit.driver : null;
  };

  const out = new Map(); // driver -> { driver, km, days:Set, units:Map(unitId->km) }
  for (const d of dayKm) {
    const drv = driverOn(d.unitId, d.date);
    if (!drv) continue;
    if (!out.has(drv)) out.set(drv, { driver: drv, km: 0, days: new Set(), units: new Map() });
    const rec = out.get(drv);
    rec.km += d.km;
    rec.days.add(d.date);
    rec.units.set(d.unitId, Math.round(((rec.units.get(d.unitId) || 0) + d.km) * 10) / 10);
  }
  return { stats: out, assigns };
}

exports.listDrivers = async (req, res) => {
  try {
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });

    const [{ stats, assigns }, vehicles] = await Promise.all([
      driverStats(from, to),
      Ls2Vehicle.find({}).select('unitId plate driver').lean(),
    ]);
    const plateOf = new Map(vehicles.map((v) => [v.unitId, v.plate]));

    // Every driver we know of: currently on a truck, or seen in the period.
    const names = new Set([...stats.keys()]);
    for (const v of vehicles) if (v.driver) names.add(v.driver);

    const currentUnitOf = new Map();
    for (const v of vehicles) if (v.driver) currentUnitOf.set(v.driver, { unitId: v.unitId, plate: v.plate });

    const items = [...names].map((name) => {
      const s = stats.get(name);
      const cur = currentUnitOf.get(name) || null;
      return {
        driver: name,
        km: s ? Math.round(s.km * 10) / 10 : 0,
        activeDays: s ? s.days.size : 0,
        vehicleCount: s ? s.units.size : 0,
        vehicles: s ? [...s.units.entries()].map(([unitId, km]) => ({ unitId, plate: plateOf.get(unitId) || '', km })) : [],
        currentVehicle: cur,
        assignmentCount: assigns.filter((a) => a.driver === name).length,
      };
    }).sort((a, b) => b.km - a.km);

    res.json({ from, to, items, total: items.length });
  } catch (error) {
    fail(res, error, 'Failed to load drivers');
  }
};

// One driver: their km, the trucks they drove, and their full assignment history.
exports.getDriver = async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.driver || '');
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;

    const [{ stats }, history, vehicles] = await Promise.all([
      driverStats(from, to),
      Ls2DriverAssignment.find({ driver: name }).sort({ from: -1 }).limit(100).lean(),
      Ls2Vehicle.find({}).select('unitId plate driver odometerKm').lean(),
    ]);
    const plateOf = new Map(vehicles.map((v) => [v.unitId, v.plate]));
    const s = stats.get(name);
    const current = vehicles.find((v) => v.driver === name) || null;

    res.json({
      from, to,
      driver: name,
      km: s ? Math.round(s.km * 10) / 10 : 0,
      activeDays: s ? s.days.size : 0,
      vehicles: s ? [...s.units.entries()].map(([unitId, km]) => ({ unitId, plate: plateOf.get(unitId) || '', km })).sort((a, b) => b.km - a.km) : [],
      currentVehicle: current ? { unitId: current.unitId, plate: current.plate, odometerKm: current.odometerKm } : null,
      history: history.map((h) => ({ unitId: h.unitId, plate: h.plate || plateOf.get(h.unitId) || '', from: h.from, to: h.to })),
    });
  } catch (error) {
    fail(res, error, 'Failed to load driver');
  }
};

// ---- Driver performance (تقييم أداء السائقين) ------------------------------
// Scores every driver on what the trucks reported: عدد الرحلات, مدة الوصول,
// مدة التحميل, أيام العمل, المسافة and الالتزام بالسرعة. See
// services/ls2DriverPerformance.js for the weights and why they are what they are.
const perf = require('../services/ls2DriverPerformance');

const periodDayCount = (from, to) =>
  Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);

const speedLimit = async () => {
  try {
    const s = await Ls2Settings.getOrCreate();
    return Number(s?.thresholds?.speedMaxKmh) || cfg.DEFAULT_THRESHOLDS.speedMaxKmh;
  } catch (e) {
    return cfg.DEFAULT_THRESHOLDS.speedMaxKmh;
  }
};

// Whole-fleet scorecard. `?deep=1` additionally runs the per-truck trip report so
// the trip/loading/speed components are real instead of omitted — that is one
// upstream report per truck, so it stays opt-in and is cached for 30 minutes.
exports.driverPerformance = async (req, res) => {
  try {
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });
    const deep = req.query.deep === '1' || req.query.deep === 'true';

    const key = `ls2:drvperf:list:${from}:${to}:${deep ? 'deep' : 'basic'}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const [{ stats }, vehicles, limit] = await Promise.all([
      driverStats(from, to),
      Ls2Vehicle.find({}).select('unitId plate driver').lean(),
      speedLimit(),
    ]);
    const plateOf = new Map(vehicles.map((v) => [v.unitId, v.plate]));
    const periodDays = periodDayCount(from, to);

    // Every driver we know: seen in the period, or sitting on a truck right now.
    const names = new Set([...stats.keys()]);
    for (const v of vehicles) if (v.driver) names.add(v.driver);
    const currentOf = new Map();
    for (const v of vehicles) if (v.driver) currentOf.set(v.driver, { unitId: v.unitId, plate: v.plate });

    const items = [];
    for (const name of names) {
      const s = stats.get(name);
      const units = s ? [...s.units.keys()] : (currentOf.has(name) ? [currentOf.get(name).unitId] : []);
      let deepMetrics = null;
      if (deep && units.length) {
        try { ({ merged: deepMetrics } = await perf.deepForDriver(units, from, to)); } catch (e) { deepMetrics = null; }
      }
      const km = s ? s.km : 0;
      const activeDays = s ? s.days.size : 0;
      const scored = perf.scoreDriver({ km, activeDays, periodDays, deep: deepMetrics, speedLimitKmh: limit });
      items.push({
        driver: name,
        km: perf.round(km, 1),
        activeDays,
        periodDays,
        vehicleCount: units.length,
        vehicles: s ? [...s.units.entries()].map(([unitId, k]) => ({ unitId, plate: plateOf.get(unitId) || '', km: k })) : [],
        currentVehicle: currentOf.get(name) || null,
        trips: deepMetrics ? deepMetrics.tripCount : null,
        avgTripHours: deepMetrics && deepMetrics.tripCount
          ? perf.round((deepMetrics.totalDriveSec / deepMetrics.tripCount) / 3600, 1) : null,
        avgLoadingHours: deepMetrics && deepMetrics.stopCount
          ? perf.round((deepMetrics.totalStopSec / deepMetrics.stopCount) / 3600, 1) : null,
        maxSpeed: deepMetrics ? perf.round(deepMetrics.maxSpeed, 0) : null,
        ...scored,
      });
    }
    items.sort((a, b) => b.score - a.score || b.km - a.km);

    const avg = items.length ? perf.round(items.reduce((s, d) => s + d.score, 0) / items.length, 0) : 0;
    const payload = {
      from, to, periodDays, depth: deep ? 'deep' : 'basic',
      speedLimitKmh: limit,
      weights: perf.WEIGHTS,
      targets: perf.TARGETS,
      bands: perf.BANDS,
      summary: {
        drivers: items.length,
        averageScore: avg,
        // Banded counts are only meaningful once the full model has run — a
        // basic pass measured two metrics, not six.
        excellent: deep ? items.filter((d) => d.score >= 90).length : null,
        weak: deep ? items.filter((d) => d.score < 45).length : null,
        provisional: !deep,
        activeDrivers: items.filter((d) => d.activeDays > 0).length,
        idleDrivers: items.filter((d) => d.activeDays === 0).length,
        totalKm: perf.round(items.reduce((s, d) => s + d.km, 0), 0),
        totalTrips: items.reduce((s, d) => s + (d.trips || 0), 0),
      },
      items,
    };
    // Deep runs are expensive; basic ones are cheap but hit on every page load.
    cache.set(key, payload, deep ? 30 * 60 * 1000 : 60 * 1000);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load driver performance');
  }
};

// One driver's full scorecard — always deep, plus the trips and turnarounds behind it.
exports.driverPerformanceDetail = async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.driver || '');
    if (!name) return res.status(400).json({ message: 'Driver is required' });
    const today = cairoDate();
    const to = req.query.to || today;
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });

    const [{ stats }, vehicles, history, limit] = await Promise.all([
      driverStats(from, to),
      Ls2Vehicle.find({}).select('unitId plate driver odometerKm').lean(),
      Ls2DriverAssignment.find({ driver: name }).sort({ from: -1 }).limit(100).lean(),
      speedLimit(),
    ]);
    const plateOf = new Map(vehicles.map((v) => [v.unitId, v.plate]));
    const s = stats.get(name);
    const current = vehicles.find((v) => v.driver === name) || null;
    const units = s ? [...s.units.keys()] : (current ? [current.unitId] : []);

    const { merged, perUnit } = units.length
      ? await perf.deepForDriver(units, from, to)
      : { merged: null, perUnit: [] };

    const km = s ? s.km : 0;
    const activeDays = s ? s.days.size : 0;
    const periodDays = periodDayCount(from, to);
    const scored = perf.scoreDriver({ km, activeDays, periodDays, deep: merged, speedLimitKmh: limit });

    // The actual trips + turnarounds, newest first, so the card can show the story.
    const trips = perUnit.flatMap((u) => (u.trips || []).map((t) => ({ ...t, unitId: u.unitId, plate: plateOf.get(u.unitId) || '' })))
      .sort((a, b) => String(b.beginTime || '').localeCompare(String(a.beginTime || '')))
      .slice(0, 200);
    const stops = perUnit.flatMap((u) => (u.stops || []).map((t) => ({ ...t, unitId: u.unitId, plate: plateOf.get(u.unitId) || '' })))
      .sort((a, b) => (b.durationSec || 0) - (a.durationSec || 0))
      .slice(0, 100);

    res.json({
      from, to, periodDays, driver: name,
      km: perf.round(km, 1),
      activeDays,
      speedLimitKmh: limit,
      currentVehicle: current ? { unitId: current.unitId, plate: current.plate, odometerKm: current.odometerKm } : null,
      vehicles: s ? [...s.units.entries()].map(([unitId, k]) => ({ unitId, plate: plateOf.get(unitId) || '', km: k })).sort((a, b) => b.km - a.km) : [],
      metrics: merged ? {
        tripCount: merged.tripCount,
        totalKm: merged.totalKm,
        drivingHours: perf.secToHours(merged.totalDriveSec),
        avgTripHours: merged.tripCount ? perf.round((merged.totalDriveSec / merged.tripCount) / 3600, 1) : 0,
        avgTripKm: merged.tripCount ? perf.round(merged.totalKm / merged.tripCount, 1) : 0,
        stopCount: merged.stopCount,
        loadingHours: perf.secToHours(merged.totalStopSec),
        avgLoadingHours: merged.stopCount ? perf.round((merged.totalStopSec / merged.stopCount) / 3600, 1) : 0,
        longestLoadingHours: perf.secToHours(merged.longestStopSec),
        maxSpeed: perf.round(merged.maxSpeed, 0),
      } : null,
      ...scored,
      trips,
      stops,
      history: history.map((h) => ({ unitId: h.unitId, plate: h.plate || plateOf.get(h.unitId) || '', from: h.from, to: h.to })),
    });
  } catch (error) {
    fail(res, error, 'Failed to load driver performance');
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
    res.json({ thresholds: s.thresholds, maintenance: s.maintenance, checklists: s.checklists || {}, alertBefore: s.alertBefore || {}, defaults: { thresholds: cfg.DEFAULT_THRESHOLDS, maintenance: cfg.DEFAULT_MAINTENANCE } });
  } catch (error) {
    fail(res, error, 'Failed to load settings');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const s = await Ls2Settings.getOrCreate();
    const { thresholds, maintenance, checklists, alertBefore } = req.body || {};
    if (thresholds && typeof thresholds === 'object') s.thresholds = { ...s.thresholds, ...thresholds };
    if (maintenance && typeof maintenance === 'object') s.maintenance = { ...s.maintenance, ...maintenance };
    // Our per-service checklist templates: replace wholesale (the editor sends the
    // full map), so removing a task actually removes it.
    if (checklists && typeof checklists === 'object') s.checklists = checklists;
    // Per-service warn windows: replace wholesale, and keep only real numbers so a
    // cleared box means "fall back to the default" rather than "warn at 0 km".
    if (alertBefore && typeof alertBefore === 'object') {
      s.alertBefore = Object.fromEntries(
        Object.entries(alertBefore).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])
      );
    }
    s.updatedBy = req.user._id;
    s.markModified('thresholds'); s.markModified('maintenance'); s.markModified('checklists'); s.markModified('alertBefore');
    await s.save();
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), settings: true });
    res.json({ thresholds: s.thresholds, maintenance: s.maintenance, checklists: s.checklists || {}, alertBefore: s.alertBefore || {} });
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
