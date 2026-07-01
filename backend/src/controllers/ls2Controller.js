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
const { maintenanceState } = require('../services/ls2AlertEngine');
const cfg = require('../config/ls2Config');
const cache = require('../utils/ttlCache');
const { emitToAll } = require('../websocket/socketManager');

const CACHE_TTL = 5000;

function fail(res, error, fallback) {
  const status = error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error(`${fallback}:`, error.message);
  res.status(status).json({ message: error.message || fallback });
}

// Attach the computed maintenance projection to a lean vehicle doc.
function withMaintenance(v, maint) {
  const m = maintenanceState({ odometerKm: v.odometerKm }, v, maint);
  return { ...v, maintenance: m };
}

// ---- Dashboard: the big analytical overview -------------------------------
exports.getDashboard = async (req, res) => {
  try {
    const hit = cache.get('ls2:dash');
    if (hit) return res.json(hit);

    const settings = await Ls2Settings.getOrCreate();
    const maint = settings.maintenance;
    const th = settings.thresholds;
    const [vehiclesRaw, openAlerts] = await Promise.all([
      Ls2Vehicle.find({}).lean(),
      Ls2Alert.find({ status: 'open' }).lean(),
    ]);
    const vehicles = vehiclesRaw.map((v) => withMaintenance(v, maint));

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
      thresholds: th,
      maintenancePlan: maint,
    };
    cache.set('ls2:dash', payload, CACHE_TTL);
    res.json(payload);
  } catch (error) {
    fail(res, error, 'Failed to load LS2 dashboard');
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
    const settings = await Ls2Settings.getOrCreate();
    let vehicles = (await Ls2Vehicle.find(filter).lean()).map((v) => withMaintenance(v, settings.maintenance));
    if (maintFilter === 'due') vehicles = vehicles.filter((v) => v.maintenance && v.maintenance.statusLevel === 'due');
    if (maintFilter === 'overdue') vehicles = vehicles.filter((v) => v.maintenance && v.maintenance.statusLevel === 'overdue');
    if (maintFilter === 'due_or_overdue') vehicles = vehicles.filter((v) => v.maintenance && v.maintenance.statusLevel !== 'ok');
    vehicles.sort((a, b) => (a.plate || '').localeCompare(b.plate || ''));
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
    const settings = await Ls2Settings.getOrCreate();
    const [alerts, serviceLog] = await Promise.all([
      Ls2Alert.find({ unitId: v.unitId }).sort({ status: 1, lastSeenAt: -1 }).limit(50).lean(),
      Ls2ServiceLog.find({ unitId: v.unitId }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    res.json({ vehicle: withMaintenance(v, settings.maintenance), alerts, serviceLog });
  } catch (error) {
    fail(res, error, 'Failed to load vehicle');
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
