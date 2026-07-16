/**
 * ls2Poll — the live heartbeat of the Location Solutions section.
 *
 * Every tick (~20s) it: pulls all units from Wialon, decodes each into clean
 * telemetry, evaluates alert conditions against the editable thresholds +
 * maintenance plan, upserts the per-vehicle snapshot, reconciles the open alerts
 * (raise new ones, resolve cleared ones), and broadcasts `ls2:updated` so open
 * dashboards refresh without a manual reload. Everything is automatic — no human
 * step between the sensor and the screen.
 */
const client = require('../services/ls2Client');
const { normalize } = require('../services/ls2Sensors');
const { evaluate } = require('../services/ls2AlertEngine');
const Ls2ServiceLog = require('../models/Ls2ServiceLog');
const { syncIdentity } = require('../services/ls2Identity');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Alert = require('../models/Ls2Alert');
const Ls2DriverAssignment = require('../models/Ls2DriverAssignment');
const Ls2Settings = require('../models/Ls2Settings');
const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

// Cairo-local calendar day as 'YYYY-MM-DD' — the key for daily odometer snapshots.
const cairoDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

let timer = null;
let running = false;
let tickCount = 0;
// Re-sync vehicle identity (VIN/brand/plate/SIM…) every ~30 min (identity is
// near-static). At a 20s poll that's every 90 ticks.
const IDENTITY_EVERY_TICKS = 90;
// Backdate a truck's FIRST observed driver to before any data we hold, so their
// historical km is attributed to them (see the driver-assignment comment above).
const HISTORY_START = new Date('2020-01-01T00:00:00Z');

const VEHICLE_FIELDS = [
  'name', 'plate', 'driver', 'position', 'lastMessageAt', 'ignition', 'moving', 'speed', 'rpm',
  'coolantC', 'fuelPct', 'totalFuelUsedL', 'weightKg', 'mainPowerV', 'backupBatteryV', 'gsmSignal',
  'odometerKm', 'engineHours', 'tires', 'tireCount', 'maxTireTempC', 'minTireTempC', 'maxTirePressurePsi', 'minTirePressurePsi', 'tireFaults',
];

async function tick() {
  if (running) return;
  if (!client.isConfigured()) return;
  running = true;
  try {
    const units = await client.searchUnits();
    if (!units.length) return;

    const settings = await Ls2Settings.getOrCreate();
    // Current vehicle docs (for maintenance baseline + so we only $set telemetry).
    const existing = await Ls2Vehicle.find({}).lean();
    const vById = new Map(existing.map((v) => [v.unitId, v]));
    // Open DEFERRED checklist tasks per unit (our own extension): tasks judged
    // "good for another N km" at a past service and not yet done. The engine warns
    // before those km run out. One query per tick, grouped by unit.
    const deferByUnit = new Map();
    const logsWithDefer = await Ls2ServiceLog.find({
      checklist: { $elemMatch: { status: 'deferred', resolved: false } },
    }).select('unitId intervalName checklist').lean();
    for (const log of logsWithDefer) {
      for (const c of log.checklist || []) {
        if (c.status !== 'deferred' || c.resolved || c.dueAtOdometerKm == null) continue;
        if (!deferByUnit.has(log.unitId)) deferByUnit.set(log.unitId, []);
        deferByUnit.get(log.unitId).push({
          logId: log._id, label: c.label, dueAtOdometerKm: c.dueAtOdometerKm, intervalName: log.intervalName,
        });
      }
    }

    // Open alerts grouped by unit for reconciliation.
    const openAlerts = await Ls2Alert.find({ status: 'open' }).lean();
    // Currently-open driver assignments (to: null) — one per unit at most.
    const openAssigns = await Ls2DriverAssignment.find({ to: null }).lean();
    const assignByUnit = new Map(openAssigns.map((a) => [a.unitId, a]));
    const driverOps = [];
    const openByUnit = new Map();
    for (const a of openAlerts) {
      if (!openByUnit.has(a.unitId)) openByUnit.set(a.unitId, []);
      openByUnit.get(a.unitId).push(a);
    }

    const vehicleOps = [];
    const alertOps = [];
    const odoOps = [];
    let newCritical = 0;
    let totalActive = 0;
    const now = new Date();
    const today = cairoDate(now);

    for (const unit of units) {
      const tel = normalize(unit);
      if (!tel) continue;
      const vehicleDoc = vById.get(tel.unitId) || null;
      const { conditions, status, alertLevel, maintenance } = evaluate(tel, vehicleDoc, settings, deferByUnit.get(tel.unitId) || []);
      totalActive += conditions.length;

      // --- Vehicle snapshot upsert ---
      const set = { status, alertLevel, activeAlertCount: conditions.length, lastSyncedAt: now };
      for (const f of VEHICLE_FIELDS) set[f] = tel[f];
      // Mirror Wialon's maintenance plan + its rollup for the fleet list.
      if (maintenance) {
        set.serviceIntervals = maintenance.intervals;
        set.maintenanceStatus = maintenance.statusLevel;
        set.maintenanceOverdueCount = maintenance.overdueCount;
        set.maintenanceDueCount = maintenance.dueCount;
        set.kmToService = maintenance.kmToService;
        set.nextServiceKm = maintenance.nextServiceKm;
        set.nextServiceName = maintenance.nextServiceName || '';
        set.upcomingKm = maintenance.upcomingKm;
        set.upcomingServiceKm = maintenance.upcomingServiceKm;
        set.upcomingServiceName = maintenance.upcomingServiceName || '';
      }

      // --- Daily odometer snapshot (keep the day's highest reading) ---
      if (tel.odometerKm != null) {
        odoOps.push({
          updateOne: {
            filter: { unitId: tel.unitId, date: today },
            update: {
              $max: { odometerKm: tel.odometerKm },
              $set: { engineHours: tel.engineHours, plate: tel.plate },
              $setOnInsert: { unitId: tel.unitId, date: today },
            },
            upsert: true,
          },
        });
      }
      vehicleOps.push({
        updateOne: {
          filter: { unitId: tel.unitId },
          update: { $set: set, $setOnInsert: { unitId: tel.unitId } },
          upsert: true,
        },
      });

      // --- Driver history: Wialon only gives the CURRENT driver, so record a
      // change the moment we see one (close the old assignment, open a new one).
      if (tel.driver) {
        const open = assignByUnit.get(tel.unitId);
        if (!open) {
          // First time we see this truck's driver: we have no evidence of an
          // earlier change, so credit them from the start of our history (they
          // are demonstrably the current driver). Real changes we OBSERVE from
          // here on get an accurate timestamp.
          driverOps.push({ insertOne: { document: { unitId: tel.unitId, plate: tel.plate, driver: tel.driver, from: HISTORY_START, to: null } } });
        } else if (open.driver !== tel.driver) {
          driverOps.push({ updateMany: { filter: { unitId: tel.unitId, to: null }, update: { $set: { to: now } } } });
          driverOps.push({ insertOne: { document: { unitId: tel.unitId, plate: tel.plate, driver: tel.driver, from: now, to: null } } });
        }
      }

      // --- Alert reconciliation ---
      const prior = openByUnit.get(tel.unitId) || [];
      const priorByKey = new Map(prior.map((a) => [`${a.type}|${a.key}`, a]));
      const seen = new Set();
      const ctx = { odometerKm: tel.odometerKm, position: tel.position, status };
      for (const c of conditions) {
        const k = `${c.type}|${c.key}`;
        seen.add(k);
        const ex = priorByKey.get(k);
        if (ex) {
          alertOps.push({ updateOne: { filter: { _id: ex._id }, update: { $set: {
            severity: c.severity, message: c.message, value: c.value, threshold: c.threshold, unit: c.unit,
            plate: tel.plate, driver: tel.driver, lastSeenAt: now, context: { ...ctx, ...(c.context || {}) },
          } } } });
        } else {
          if (c.severity === 'critical') newCritical += 1;
          alertOps.push({ insertOne: { document: {
            unitId: tel.unitId, plate: tel.plate, driver: tel.driver,
            type: c.type, key: c.key, severity: c.severity, status: 'open', message: c.message,
            value: c.value, threshold: c.threshold, unit: c.unit, context: { ...ctx, ...(c.context || {}) },
            firstSeenAt: now, lastSeenAt: now,
          } } });
        }
      }
      // Resolve open alerts no longer tripping.
      for (const a of prior) {
        if (!seen.has(`${a.type}|${a.key}`)) {
          alertOps.push({ updateOne: { filter: { _id: a._id }, update: { $set: { status: 'resolved', resolvedAt: now } } } });
        }
      }
    }

    if (vehicleOps.length) await Ls2Vehicle.bulkWrite(vehicleOps, { ordered: false });
    if (driverOps.length) await Ls2DriverAssignment.bulkWrite(driverOps, { ordered: false });
    if (alertOps.length) await Ls2Alert.bulkWrite(alertOps, { ordered: false });
    if (odoOps.length) await Ls2OdometerDaily.bulkWrite(odoOps, { ordered: false });

    // Bust the dashboard cache so the refetch triggered by ls2:updated returns the
    // snapshot we just wrote — no stale window, truly live.
    cache.clear('ls2:');
    emitToAll('ls2:updated', { at: Date.now(), vehicles: units.length, activeAlerts: totalActive, newCritical });
    if (newCritical > 0) emitToAll('ls2:alert', { at: Date.now(), newCritical });

    // Slow identity sync (first tick, then every ~30 min).
    if (tickCount % IDENTITY_EVERY_TICKS === 0) {
      syncIdentity().catch((e) => { if (process.env.NODE_ENV !== 'production') console.log('[ls2Poll] identity sync error:', e.message); });
    }
    tickCount += 1;
  } catch (e) {
    // transient token/network hiccup — retry next tick
    if (process.env.NODE_ENV !== 'production') console.log('[ls2Poll] tick error:', e.message);
  } finally {
    running = false;
  }
}

function startLs2Poll() {
  if (timer) return;
  // Kill switch: set LS2_POLL_ENABLED=false on the host to stop the live poll +
  // 20s socket broadcasts without removing the token or redeploying. Reversible.
  if (String(process.env.LS2_POLL_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[ls2Poll] disabled via LS2_POLL_ENABLED=false — live polling off');
    return;
  }
  if (!client.isConfigured()) {
    console.log('[ls2Poll] Location Solutions not configured (LS2_TOKEN missing) — polling disabled');
    return;
  }
  const ms = Math.max(10000, parseInt(process.env.LS2_POLL_INTERVAL_MS || '20000', 10));
  timer = setInterval(() => { tick().catch(() => {}); }, ms);
  setTimeout(() => { tick().catch(() => {}); }, 5000); // warm shortly after boot
  console.log(`[ls2Poll] live polling started — every ${ms}ms`);
}

module.exports = { startLs2Poll, tick };
