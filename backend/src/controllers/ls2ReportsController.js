/**
 * ls2ReportsController — the CEO-level reports for the Location Solutions
 * section: ONE row per truck for the whole fleet over a period, and the full
 * dossier for a single truck over that same period.
 *
 * Everything fleet-wide is answered from the mirrored Mongo snapshots (vehicles,
 * daily odometer, alerts, service logs, repairs) so the report returns in one
 * round-trip. The Wialon report engine takes ~2s PER UNIT and has to run
 * sequentially, so it is never touched here for the fleet — only for the single
 * vehicle, where two calls (trips + fuel) are an acceptable cost.
 */
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Alert = require('../models/Ls2Alert');
const Ls2Repair = require('../models/Ls2Repair');
const Ls2ServiceLog = require('../models/Ls2ServiceLog');
const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
const Ls2DriverAssignment = require('../models/Ls2DriverAssignment');
const reports = require('../services/ls2Reports');
const cache = require('../utils/ttlCache');

const CACHE_TTL = 30000; // a report is a heavy read but never urgent to the second

function fail(res, error, fallback) {
  const status = error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error(`${fallback}:`, error.message);
  res.status(status).json({ message: error.message || fallback });
}

// Cairo calendar helpers — snapshots are keyed by Cairo day, and Cairo is UTC+2
// with no DST since 2015, so the epoch/Date bounds are plain offsets.
const cairoDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const cairoEpoch = (ymd, endOfDay = false) => Math.floor(new Date(`${ymd}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00`).getTime() / 1000);
const cairoStart = (ymd) => new Date(`${ymd}T00:00:00+02:00`);
const cairoEnd = (ymd) => new Date(`${ymd}T23:59:59.999+02:00`);
const dayCount = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
const round1 = (n) => Math.round(n * 10) / 10;

// Resolve the [from, to] Cairo window a report was asked for, defaulting to the
// current month to date (the same default the dashboard uses).
function period(req) {
  const today = cairoDate();
  const to = req.query.to || today;
  const from = req.query.from || `${today.slice(0, 7)}-01`;
  return { from, to };
}

/**
 * Per-unit distance AND engine hours over [from, to] (inclusive Cairo days),
 * from the daily snapshots — instant, and the counters are Wialon's own.
 *
 * Both metrics are monotonic counters, so the period value is
 * counter(end of `to`) − counter(end of the day before `from`). A unit with no
 * reading before `from` falls back to its first reading INSIDE the window, which
 * clips its first day — flagged as `clipped` so the UI can say so instead of
 * quietly under-reporting. Engine hours are optional per snapshot, so they get
 * their own null-filtered passes rather than riding on the odometer's.
 */
async function periodByUnit(from, to) {
  const endStage = (field) => [
    { $match: { date: { $lte: to }, [field]: { $ne: null } } },
    { $sort: { unitId: 1, date: 1 } },
    { $group: { _id: '$unitId', v: { $last: `$${field}` } } },
  ];
  const startStage = (field) => [
    { $match: { date: { $lt: from }, [field]: { $ne: null } } },
    { $sort: { unitId: 1, date: 1 } },
    { $group: { _id: '$unitId', v: { $last: `$${field}` } } },
  ];
  const firstInStage = (field) => [
    { $match: { date: { $gte: from, $lte: to }, [field]: { $ne: null } } },
    { $sort: { unitId: 1, date: 1 } },
    { $group: { _id: '$unitId', v: { $first: `$${field}` }, days: { $sum: 1 } } },
  ];

  const [odoEnd, odoStart, odoFirst, ehEnd, ehStart, ehFirst] = await Promise.all([
    Ls2OdometerDaily.aggregate(endStage('odometerKm')),
    Ls2OdometerDaily.aggregate(startStage('odometerKm')),
    Ls2OdometerDaily.aggregate(firstInStage('odometerKm')),
    Ls2OdometerDaily.aggregate(endStage('engineHours')),
    Ls2OdometerDaily.aggregate(startStage('engineHours')),
    Ls2OdometerDaily.aggregate(firstInStage('engineHours')),
  ]);
  const map = (rows) => new Map(rows.map((r) => [r._id, r]));
  const [eMap, sMap, fMap, ehE, ehS, ehF] = [odoEnd, odoStart, odoFirst, ehEnd, ehStart, ehFirst].map(map);

  const out = new Map();
  for (const [unitId, end] of eMap) {
    const base = sMap.get(unitId) || fMap.get(unitId);
    if (!base) continue;
    // Engine hours only count when both ends of the span are known.
    const ehe = ehE.get(unitId);
    const ehb = ehS.get(unitId) || ehF.get(unitId);
    out.set(unitId, {
      km: Math.max(0, round1(end.v - base.v)),
      odoStart: base.v,
      odoEnd: end.v,
      activeDays: fMap.get(unitId)?.days || 0,
      clipped: !sMap.has(unitId), // no pre-range baseline → the first day is partial
      engineHours: ehe && ehb ? Math.max(0, round1(ehe.v - ehb.v)) : null,
    });
  }
  return out;
}

// Service logs whose REAL date falls in the window. `serviceDate` is the date the
// work was actually done and may predate the log row, so only fall back to
// `createdAt` for the older rows that never carried one.
const serviceLogFilter = (from, to) => ({
  $or: [
    { serviceDate: { $gte: cairoStart(from), $lte: cairoEnd(to) } },
    { serviceDate: null, createdAt: { $gte: cairoStart(from), $lte: cairoEnd(to) } },
  ],
});

const inPeriodRepairs = (from, to) => ({ repairDate: { $gte: cairoStart(from), $lte: cairoEnd(to) } });

// Group rows by unitId into a Map of arrays.
function groupByUnit(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.unitId)) m.set(r.unitId, []);
    m.get(r.unitId).push(r);
  }
  return m;
}

const sum = (arr, pick) => arr.reduce((s, x) => s + (Number(pick(x)) || 0), 0);

// ---- Fleet report: one row per vehicle over the period ---------------------
exports.getFleetReport = async (req, res) => {
  try {
    const { from, to } = period(req);
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });
    const cacheKey = `ls2:rep:fleet:${from}:${to}`;
    const hit = cache.get(cacheKey);
    if (hit) return res.json(hit);

    const [vehicles, metrics, openAlerts, services, repairs] = await Promise.all([
      Ls2Vehicle.find({}).lean(),
      periodByUnit(from, to),
      // التنبيهات المفتوحة سبعةٌ وأربعون ألفًا، وأكثرُها على مركبةٍ واحدة ألفٌ
      // وثلاثمئة — فسقفُ الألف كان يبتر تقرير مركبةٍ نشطة بلا أن يقول.
      Ls2Alert.find({ status: 'open' }).sort({ severity: 1, firstSeenAt: -1 }).limit(50000).lean(),
      Ls2ServiceLog.find(serviceLogFilter(from, to)).sort({ serviceDate: -1, createdAt: -1 }).lean(),
      Ls2Repair.find(inPeriodRepairs(from, to)).sort({ repairDate: -1 }).lean(),
    ]);

    const alertsBy = groupByUnit(openAlerts);
    const servicesBy = groupByUnit(services);
    const repairsBy = groupByUnit(repairs);
    const days = dayCount(from, to);

    const items = vehicles.map((v) => {
      const m = metrics.get(v.unitId);
      const a = alertsBy.get(v.unitId) || [];
      const svc = servicesBy.get(v.unitId) || [];
      const rep = repairsBy.get(v.unitId) || [];
      const km = m ? m.km : 0;
      const p = v.profile || {};
      return {
        unitId: v.unitId,
        plate: v.plate || v.name || String(v.unitId),
        name: v.name || '',
        driver: v.driver || '',
        brand: (p.brand || '').trim(),
        vehicleType: (p.vehicleType || '').trim(),
        modelYear: p.modelYear || '',
        vin: p.vin || '',
        simIccid: p.simIccid || '',
        status: v.status,
        lastMessageAt: v.lastMessageAt || null,

        // Distance & usage over the period (from the daily snapshots).
        km,
        odoStart: m ? m.odoStart : null,
        odoEnd: m ? m.odoEnd : null,
        activeDays: m ? m.activeDays : 0,
        clipped: m ? m.clipped : true,
        avgKmPerDay: days > 0 ? round1(km / days) : 0,
        engineHoursPeriod: m ? m.engineHours : null,
        odometerKm: v.odometerKm ?? null,
        engineHoursTotal: v.engineHours ?? null,

        // Fuel is CAN data that only Wialon's report engine can attribute to a
        // period (~2s per unit, sequential) — fanning it out over 57 trucks would
        // block the request for two minutes. It stays null here and the page
        // fills it in on demand, per truck; a null must never be shown as 0.
        fuelL: null,
        kmPerL: null,

        // Maintenance state (mirrored from Wialon's own service plan).
        maintenanceStatus: v.maintenanceStatus || 'ok',
        kmToService: v.kmToService ?? null,
        nextServiceKm: v.nextServiceKm ?? null,
        nextServiceName: v.nextServiceName || '',
        maintenanceOverdueCount: v.maintenanceOverdueCount || 0,
        maintenanceDueCount: v.maintenanceDueCount || 0,

        // Open alerts right now, by severity.
        alertsCritical: a.filter((x) => x.severity === 'critical').length,
        alertsWarning: a.filter((x) => x.severity === 'warning').length,
        alertsInfo: a.filter((x) => x.severity === 'info').length,
        alertsTotal: a.length,

        // Work recorded in the period.
        servicesInPeriod: svc.length,
        serviceCost: svc.some((s) => s.cost != null) ? sum(svc, (s) => s.cost) : null,
        repairsInPeriod: rep.length,
        repairCost: rep.some((r) => r.cost != null) ? sum(rep, (r) => r.cost) : null,
        openRepairs: rep.filter((r) => r.status !== 'done').length,
      };
    }).sort((a, b) => b.km - a.km);

    const totalKm = sum(items, (i) => i.km);
    const ehRows = items.filter((i) => i.engineHoursPeriod != null);
    const payload = {
      generatedAt: Date.now(),
      from, to, days,
      summary: {
        vehicles: items.length,
        totalKm: Math.round(totalKm),
        movedVehicles: items.filter((i) => i.km > 0).length,
        idleVehicles: items.filter((i) => i.km === 0).length,
        avgKm: items.length ? Math.round(totalKm / items.length) : 0,
        maxKm: items.length ? Math.max(...items.map((i) => i.km)) : 0,
        totalEngineHours: ehRows.length ? Math.round(sum(ehRows, (i) => i.engineHoursPeriod)) : null,
        overdueVehicles: items.filter((i) => i.maintenanceStatus === 'overdue').length,
        dueVehicles: items.filter((i) => i.maintenanceStatus === 'due').length,
        openAlerts: openAlerts.length,
        criticalAlerts: openAlerts.filter((a) => a.severity === 'critical').length,
        warningAlerts: openAlerts.filter((a) => a.severity === 'warning').length,
        services: services.length,
        repairs: repairs.length,
        repairCost: repairs.some((r) => r.cost != null) ? sum(repairs, (r) => r.cost) : null,
        // Some trucks have no snapshot before `from` — say so rather than let the
        // reader assume every number covers the full window.
        partialVehicles: items.filter((i) => i.clipped).length,
      },
      items,
      // The detail sheets that ride along with the fleet workbook.
      alerts: openAlerts,
      services,
      repairs,
    };
    cache.set(cacheKey, payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to build fleet report');
  }
};

// ---- Single-vehicle report: the full dossier for one truck ------------------
// Composes what the per-vehicle endpoints each return, so the page (and its
// Excel export) makes ONE call. `heavy=0` skips the two Wialon report calls
// (trips + fuel) for a fast identity/distance-only refresh.
exports.getVehicleReport = async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    if (!Number.isFinite(unitId)) return res.status(400).json({ message: 'Invalid vehicle id' });
    const { from, to } = period(req);
    if (from > to) return res.status(400).json({ message: 'from must be on or before to' });
    const heavy = req.query.heavy !== '0';
    const cacheKey = `ls2:rep:unit:${unitId}:${from}:${to}:${heavy ? 'full' : 'lite'}`;
    const hit = cache.get(cacheKey);
    if (hit) return res.json(hit);

    const v = await Ls2Vehicle.findOne({ unitId }).lean();
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });

    const [metrics, alerts, services, repairs, drivers, snaps] = await Promise.all([
      periodByUnit(from, to),
      Ls2Alert.find({ unitId, $or: [{ status: 'open' }, { lastSeenAt: { $gte: cairoStart(from), $lte: cairoEnd(to) } }] })
        .sort({ status: 1, firstSeenAt: -1 }).limit(500).lean(),
      Ls2ServiceLog.find({ unitId, ...serviceLogFilter(from, to) }).sort({ serviceDate: -1, createdAt: -1 }).lean(),
      Ls2Repair.find({ unitId, ...inPeriodRepairs(from, to) }).sort({ repairDate: -1 }).lean(),
      Ls2DriverAssignment.find({ unitId }).sort({ from: -1 }).limit(50).lean(),
      // One extra day before `from`, so the first day in the series has a baseline.
      Ls2OdometerDaily.find({ unitId, date: { $lte: to } }).sort({ date: 1 }).select('date odometerKm engineHours').lean(),
    ]);

    const m = metrics.get(unitId) || { km: 0, odoStart: null, odoEnd: v.odometerKm ?? null, activeDays: 0, clipped: true, engineHours: null };

    // Daily distance series over the window (deltas between consecutive snapshots).
    // When a truck went unpolled for a while its delta covers several days at once
    // — `spanDays` says so, so a spike reads as a gap rather than a record day.
    const daily = [];
    for (let i = 1; i < snaps.length; i++) {
      if (snaps[i].date < from) continue;
      daily.push({
        date: snaps[i].date,
        km: Math.max(0, round1(snaps[i].odometerKm - snaps[i - 1].odometerKm)),
        spanDays: dayCount(snaps[i - 1].date, snaps[i].date) - 1,
      });
    }

    // The two Wialon reports — heavy but authoritative. Either may be unavailable
    // (no CAN fuel on the truck, upstream hiccup); a failure must degrade to null
    // rather than fail the whole report.
    let trips = null; let fuel = null;
    if (heavy) {
      const f = cairoEpoch(from); const t2 = cairoEpoch(to, true);
      try { trips = await reports.unitTrips(unitId, f, t2); } catch (e) { console.error('report trips failed:', e.message); }
      try { fuel = await reports.unitFuel(unitId, f, t2); } catch (e) { console.error('report fuel failed:', e.message); }
    }
    // A CAN-less truck answers the fuel report with blanks — that is "no data",
    // not "zero litres".
    if (fuel && fuel.fuelL == null && fuel.distanceKm == null) fuel = null;

    const payload = {
      generatedAt: Date.now(),
      from, to, days: dayCount(from, to),
      vehicle: {
        unitId: v.unitId, name: v.name || '', plate: v.plate || v.name || String(v.unitId), driver: v.driver || '',
        status: v.status, lastMessageAt: v.lastMessageAt || null,
        odometerKm: v.odometerKm ?? null, engineHoursTotal: v.engineHours ?? null,
        tireBrand: v.tireBrand || '', tireCount: v.tireCount || 0,
        profile: v.profile || null,
      },
      distance: {
        km: m.km, odoStart: m.odoStart, odoEnd: m.odoEnd,
        activeDays: m.activeDays, clipped: m.clipped,
        avgKmPerDay: dayCount(from, to) > 0 ? round1(m.km / dayCount(from, to)) : 0,
        engineHours: m.engineHours,
        daily,
      },
      trips,
      fuel,
      maintenance: {
        statusLevel: v.maintenanceStatus || 'ok',
        kmToService: v.kmToService ?? null,
        nextServiceKm: v.nextServiceKm ?? null,
        nextServiceName: v.nextServiceName || '',
        upcomingKm: v.upcomingKm ?? null,
        upcomingServiceName: v.upcomingServiceName || '',
        overdueCount: v.maintenanceOverdueCount || 0,
        dueCount: v.maintenanceDueCount || 0,
        intervals: v.serviceIntervals || [],
      },
      services,
      repairs,
      alerts,
      drivers: drivers.map((d) => ({ driver: d.driver, from: d.from, to: d.to })),
      totals: {
        services: services.length,
        serviceCost: services.some((s) => s.cost != null) ? sum(services, (s) => s.cost) : null,
        repairs: repairs.length,
        repairCost: repairs.some((r) => r.cost != null) ? sum(repairs, (r) => r.cost) : null,
        openAlerts: alerts.filter((a) => a.status === 'open').length,
        criticalAlerts: alerts.filter((a) => a.status === 'open' && a.severity === 'critical').length,
      },
    };
    cache.set(cacheKey, payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to build vehicle report');
  }
};
