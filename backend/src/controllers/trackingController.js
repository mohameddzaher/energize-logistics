/**
 * Live tracking of the Express GPS units (light transport / Media Go): the fleet map, one unit's route for any span with its
 * analysis, the fleet distance ranking, and the unit of a register vehicle (its profile). Read-only; mounted under both
 * /api/b2c/tracking and /api/vehicles/tracking.
 */
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');
const ex = require('../services/expressTracking');
const { canonicalPlateKey } = require('../utils/plateKey');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const startOf = (v) => (YMD.test(v) ? new Date(`${v}T00:00:00+03:00`) : new Date(v));
const endOf = (v) => (YMD.test(v) ? new Date(`${v}T23:59:59.999+03:00`) : new Date(v));
const fail = (res, e, msg) => res.status(e.status || 502).json({ message: e.status ? e.message : msg, code: e.status === 503 ? 'TRACKING_NOT_CONFIGURED' : 'TRACKING_FAILED' });

/** Unit → register vehicle (by device IMEI, else by plate) and its current rider; 5 min per worker. */
async function links() {
  return cache.wrap('express:links', 5 * 60000, async () => {
    const { VehicleMaster } = require('../models/VehicleMaster');
    const { LightTransportEmployee } = require('../models/LightTransport');
    const vms = await VehicleMaster.find({ archived: { $ne: true } })
      .select('plateNumber gps.serialImei gps.deviceId cityAr departmentAr mediaGo brandAr modelAr colorAr actualDriver serviceStatusAr').lean();
    const byImei = new Map(); const byPlate = new Map();
    for (const v of vms) {
      for (const id of [v.gps?.serialImei, v.gps?.deviceId]) { const k = String(id || '').replace(/\D/g, ''); if (k.length >= 10) byImei.set(k, v); }
      const pk = canonicalPlateKey(v.plateNumber || '');
      if (pk && !byPlate.has(pk)) byPlate.set(pk, v);
    }
    const riders = await LightTransportEmployee.find({ vehicle: { $in: vms.map((v) => v._id) } })
      .select('name phone projectAr cityAr vehicle idNumber workStatusAr').lean();
    const riderOf = new Map(riders.map((r) => [String(r.vehicle), r]));
    return { byImei, byPlate, riderOf };
  });
}

/** The B2C mount is the Media Go page: only vehicles flagged Media Go in the register. The vehicles mount sees every unit. */
const mediaGoScope = (req) => /\/b2c(\/|$)/.test(String(req.baseUrl || ''));

async function linkedUnits(req) {
  const [list, l] = await Promise.all([ex.units(), links()]);
  const all = list.map((u) => {
    const v = l.byImei.get(u.imei) || l.byPlate.get(canonicalPlateKey(u.plate)) || null;
    const r = v ? l.riderOf.get(String(v._id)) : null;
    return {
      ...u,
      // Media Go is the register's flag (light-transport vehicles / vehicle registry), never the provider's unit name.
      mediaGo: !!v?.mediaGo,
      vehicle: v ? { _id: String(v._id), plateNumber: v.plateNumber, city: v.cityAr || '', department: v.departmentAr || '', brand: [v.brandAr, v.modelAr].filter(Boolean).join(' '), color: v.colorAr || '', serviceStatus: v.serviceStatusAr || '', mediaGo: !!v.mediaGo } : null,
      rider: r ? { _id: String(r._id), name: r.name, phone: r.phone || '', project: r.projectAr || '', city: r.cityAr || '', idNumber: r.idNumber || '', workStatus: r.workStatusAr || '' } : (v?.actualDriver?.name ? { name: v.actualDriver.name } : null),
    };
  });
  return req && mediaGoScope(req) ? all.filter((u) => u.mediaGo) : all;
}

/** GET /tracking/units — every unit with its last position, state and links, plus state counts. */
exports.units = async (req, res) => {
  try {
    const list = await linkedUnits(req);
    const counts = { total: list.length, moving: 0, idling: 0, stopped: 0, late: 0, offline: 0, mediaGo: 0, linked: 0 };
    list.forEach((u) => { counts[u.state] += 1; if (u.mediaGo) counts.mediaGo += 1; if (u.vehicle) counts.linked += 1; });
    res.json({ units: list, counts, liveMinutes: ex.LIVE_MIN, at: new Date().toISOString() });
  } catch (e) { fail(res, e, 'تعذّر جلب مواقع المركبات من مزوّد التتبّع'); }
};

/** GET /tracking/units/:imei/history?from&to&speedLimit — the route (thinned for the map) and its full analysis; at most 31 days. */
exports.history = async (req, res) => {
  try {
    const imei = String(req.params.imei || '').replace(/\D/g, '');
    if (imei.length < 10) return res.status(400).json({ message: 'رقم الجهاز غير صالح' });
    const from = startOf(String(req.query.from || ex.riyadhDay(new Date())));
    const to = endOf(String(req.query.to || req.query.from || ex.riyadhDay(new Date())));
    if (!(from < to)) return res.status(400).json({ message: 'الفترة غير صحيحة' });
    if (to - from > 31.5 * 24 * 3600000) return res.status(400).json({ message: 'أقصى فترة 31 يومًا' });
    const end = to > new Date() ? new Date() : to;
    const unit = (await linkedUnits(req)).find((u) => u.imei === imei);
    if (!unit) return res.status(404).json({ message: mediaGoScope(req) ? 'هذه المركبة ليست من مركبات Media Go' : 'الجهاز غير موجود لدى مزوّد التتبّع' });
    const pts = await ex.history(imei, from, end);
    const speedLimit = Math.min(200, Math.max(20, Number(req.query.speedLimit) || 80));
    res.json({
      unit, from: from.toISOString(), to: end.toISOString(),
      stats: ex.analyse(pts, { speedLimit }),
      points: ex.thin(pts).map((p) => [p.t, p.lat, p.lng, p.speed]),
    });
  } catch (e) { fail(res, e, 'تعذّر جلب خط السير'); }
};

/** GET /tracking/summary?from&to — kilometres of every unit over a span (provider distance), for the ranking; at most 62 days. */
exports.summary = async (req, res) => {
  try {
    const today = ex.riyadhDay(new Date());
    const from = startOf(String(req.query.from || today));
    const to = endOf(String(req.query.to || req.query.from || today));
    if (!(from < to) || to - from > 62.5 * 24 * 3600000) return res.status(400).json({ message: 'الفترة غير صحيحة (أقصى 62 يومًا)' });
    const end = to > new Date() ? new Date() : to;
    const list = await linkedUnits(req);
    const imeis = list.map((u) => u.imei);
    // Closed days come from the stored copies (one query); only today, and units missing a stored day, ask the provider.
    const days = ex.daysBetween(ex.riyadhDay(from), ex.riyadhDay(end));
    const closed = days.filter((d) => d < today);
    const stored = await ex.storedKm(imeis, closed);
    const complete = imeis.filter((m) => closed.every((d) => stored.get(m)?.has(d)));
    const partial = imeis.filter((m) => !complete.includes(m));
    const todayStart = new Date(`${today}T00:00:00+03:00`);
    const [todayKm, fullKm] = await Promise.all([
      days.includes(today) && complete.length ? ex.fleetDistance(complete, todayStart > from ? todayStart : from, end) : new Map(),
      partial.length ? ex.fleetDistance(partial, from, end) : new Map(),
    ]);
    const km = new Map();
    for (const m of complete) {
      const t = todayKm.get(m);
      km.set(m, Math.round((closed.reduce((x, d) => x + (stored.get(m)?.get(d) || 0), 0) + (t || 0)) * 10) / 10);
    }
    for (const m of partial) km.set(m, fullKm.get(m));
    const rows = list.map((u) => ({
      imei: u.imei, name: u.name, plate: u.plate, mediaGo: u.mediaGo, state: u.state, at: u.at,
      vehicleId: u.vehicle?._id || null, city: u.vehicle?.city || u.rider?.city || '', rider: u.rider?.name || '', project: u.rider?.project || '',
      km: km.get(u.imei),
    })).sort((a, b) => (b.km || 0) - (a.km || 0));
    const valid = rows.filter((r) => r.km != null);
    const total = Math.round(valid.reduce((a, r) => a + r.km, 0) * 10) / 10;
    const active = valid.filter((r) => r.km >= 1).length;
    res.json({
      from: from.toISOString(), to: end.toISOString(), rows,
      totals: { km: total, units: rows.length, activeUnits: active, idleUnits: rows.length - active, avgKmActive: active ? Math.round((total / active) * 10) / 10 : 0 },
    });
  } catch (e) { fail(res, e, 'تعذّر حساب المسافات'); }
};

/** GET /tracking/by-vehicle/:vehicleId — the unit tracking a register vehicle, or null. */
exports.byVehicle = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(String(req.params.vehicleId))) return res.status(400).json({ message: 'معرّف غير صالح' });
    if (!ex.configured()) return res.json({ unit: null, configured: false });
    const unit = (await linkedUnits(req)).find((u) => u.vehicle && u.vehicle._id === String(req.params.vehicleId)) || null;
    res.json({ unit, configured: true });
  } catch (e) { fail(res, e, 'تعذّر جلب موقع المركبة'); }
};
