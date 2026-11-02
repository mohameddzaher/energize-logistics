const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/apiKey');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const Ls2Alert = require('../models/Ls2Alert');
const Ls2TireAsset = require('../models/Ls2TireAsset');
const cache = require('../utils/ttlCache');

/**
 * Read-only API for automation: the live fleet for external systems.
 * Why it reads from our database, not Wialon directly: the section's pulse (jobs/ls2Poll) pulls all units from Wialon every twenty seconds, decodes sensor readings and stores a snapshot per vehicle. So the data is already ours: reading here is faster, does not consume our tracking-provider quota however often it is called, and carries what we add (tire registry and status) that the provider does not know.
 * Read-only: no writes at all. Automation watches and alerts; whoever may change something signs in as a person with their own permissions.
 * Key: `x-api-key` header, set in `FLEET_API_KEY` on the server.
 */
router.use(requireApiKey('FLEET_API_KEY', 'Fleet automation API'));

/** Age of the reading in seconds, so automation can tell fresh from stale. */
const ageSec = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 1000) : null);

/**
 * One vehicle shape in every response, with everything the live fleet screen shows.
 * Partial export forced consumers to build conditions on what was missing (maintenance status, alert level, fuel used, static vehicle data), and an API that gives part of the screen gets read as the whole.
 */
const shape = (v, tires, crew) => ({
  // Identity.
  plate: v.plate || null,
  name: v.name || null,
  unitId: v.unitId,
  driver: v.driver || null,
  // The phone number comes with the name: the name says who, the number says how to reach him. Automation that alerts on a tire temperature without the driver's number sends people searching by hand while the truck is moving.
  // Source is the fleet driver register (FleetDriver); the tracking system does not know it. See `crewIndex`: match by the driver name the device reports; if the name is unknown use the truck driver's number only when there is exactly one, never guess between two.
  driverPhone: crew ? crew.phone : null,
  driverPhoneSource: crew ? crew.source : null,
  // The truck's crew as registered with us, for whoever wants the second driver or wants to choose.
  crew: crew ? crew.list : [],

  // Reading freshness.
  online: v.online ?? null,
  status: v.status || null,
  lastMessageAt: v.lastMessageAt || null,
  // Seconds since the last message. A one-hour-old reading is not a current reading, and without this number automation decides on a dead value unknowingly.
  dataAgeSeconds: ageSec(v.lastMessageAt),
  lastSyncedAt: v.lastSyncedAt || null,

  // Position and movement.
  position: v.position ? {
    lat: v.position.lat ?? null, lng: v.position.lng ?? null,
    speed: v.position.speed ?? null, course: v.position.course ?? null,
    altitude: v.position.altitude ?? null,
  } : null,

  // Engine.
  engine: {
    ignition: v.ignition ?? null,
    moving: v.moving ?? null,
    speedKmh: v.speed ?? null,
    rpm: v.rpm ?? null,
    coolantC: v.coolantC ?? null,
    engineHours: v.engineHours ?? null,
  },

  // Counters.
  odometerKm: v.odometerKm ?? null,
  fuelPct: v.fuelPct ?? null,
  totalFuelUsedL: v.totalFuelUsedL ?? null,
  weightKg: v.weightKg ?? null,

  // Electrical and transmission.
  power: {
    mainV: v.mainPowerV ?? null,
    backupV: v.backupBatteryV ?? null,
    gsmSignal: v.gsmSignal ?? null,
  },

  // Tires.
  tyres: {
    count: v.tireCount ?? 0,
    faults: v.tireFaults ?? 0,
    brand: v.tireBrand || null,
    maxTempC: v.maxTireTempC ?? null,
    minTempC: v.minTireTempC ?? null,
    maxPressurePsi: v.maxTirePressurePsi ?? null,
    minPressurePsi: v.minTirePressurePsi ?? null,
    // Each tire set by its position; automation builds its conditions on this.
    readings: (v.tires || []).map((t) => ({
      axle: t.axle ?? null, position: t.position ?? null,
      tempC: t.tempC ?? null, pressurePsi: t.pressurePsi ?? null, fault: !!t.fault,
    })),
    // What we know and the provider does not: what is actually installed per the asset registry.
    registered: tires ? { mounted: tires.mounted, spare: tires.spare, withSensor: tires.withSensor } : null,
    sensorChangeNotice: v.sensorChangeNotice ?? null,
  },

  // Alerts and maintenance.
  alerts: {
    level: v.alertLevel ?? null,
    activeCount: v.activeAlertCount ?? 0,
  },
  maintenance: {
    status: v.maintenanceStatus ?? null,
    overdueCount: v.maintenanceOverdueCount ?? 0,
    dueCount: v.maintenanceDueCount ?? 0,
    kmToService: v.kmToService ?? null,
    nextServiceKm: v.nextServiceKm ?? null,
    nextServiceName: v.nextServiceName || null,
    upcomingServiceKm: v.upcomingServiceKm ?? null,
    upcomingServiceName: v.upcomingServiceName || null,
  },

  // Static vehicle data.
  profile: v.profile ? {
    vin: v.profile.vin || null,
    brand: v.profile.brand || null,
    modelYear: v.profile.modelYear ?? null,
    vehicleType: v.profile.vehicleType || null,
    registrationPlate: v.profile.registrationPlate || null,
    installDate: v.profile.installDate || null,
  } : null,
});

/**
 * Fleet driver index: plate key to crew, and folded name to phone number.
 * Built once per call rather than one query per vehicle, and cached for a minute: numbers change when one is written in a driver file, not every twenty seconds.
 */
async function crewIndex() {
  const hit = cache.get('fleetapi:crew');
  if (hit) return hit;

  const FleetModels = require('../models/FleetModels');
  const { plateKey } = require('../utils/plateKey');
  const { flexNormalize } = require('../utils/plateKey');
  const [vehicles, drivers] = await Promise.all([
    FleetModels.FleetVehicle.find({ isActive: { $ne: false } }).select('plate').lean(),
    // An archived driver is not on anyone's crew, as if deleted (by iqama number).
    (async () => FleetModels.FleetDriver.find({ isActive: { $ne: false },
      ...require('../utils/archivedHidden').notArchivedIdNumber(await require('../utils/endedStaff').endedStaff(), 'iqama') })
      .select('name phone vehicle working').lean())(),
  ]);

  const plateOf = new Map(vehicles.map((v) => [String(v._id), plateKey(v.plate)]));
  const byPlate = new Map();   // Plate key to [{name, phone, working}].
  const byName = new Map();    // Folded name to phone number.
  for (const d of drivers) {
    const person = {
      name: d.name,
      phone: String(d.phone || '').trim() || null,
      working: d.working !== false,
    };
    const k = d.vehicle ? plateOf.get(String(d.vehicle)) : null;
    if (k) {
      if (!byPlate.has(k)) byPlate.set(k, []);
      byPlate.get(k).push(person);
    }
    const n = flexNormalize(d.name);
    if (n && person.phone && !byName.has(n)) byName.set(n, person.phone);
  }

  const out = { byPlate, byName };
  cache.set('fleetapi:crew', out, 60000);
  return out;
}

/** A specific driver's number: by name first, then by truck if it has a single driver. */
function crewFor(v, index) {
  const { plateKey, flexNormalize } = require('../utils/plateKey');
  const key = plateKey(v.plate);
  const list = (index.byPlate.get(key) || []).map((p) => ({ ...p }));
  const reported = flexNormalize(v.driver || '');

  let phone = null;
  let source = null;
  if (reported) {
    const onTruck = list.find((p) => flexNormalize(p.name) === reported && p.phone);
    if (onTruck) { phone = onTruck.phone; source = 'driver_name'; }
    else if (index.byName.has(reported)) { phone = index.byName.get(reported); source = 'driver_name'; }
  }
  // Never guess between two. A truck sometimes has two drivers, and sending one's number as 'the driver' alerts someone who is not on the road. If the name is unknown and there are two drivers, leave it empty and let the reader choose from `crew`.
  if (!phone && list.length === 1 && list[0].phone) { phone = list[0].phone; source = 'vehicle_single_driver'; }
  return { phone, source, list };
}

/** GET /vehicles: all vehicles with their latest snapshot. */
router.get('/vehicles', async (req, res) => {
  try {
    const key = `ls2:api:vehicles:${req.query.plate || 'all'}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const filter = {};
    if (req.query.plate) filter.plate = String(req.query.plate).trim();
    const [vehicles, crew] = await Promise.all([Ls2Vehicle.find(filter).lean(), crewIndex()]);

    // Tire registry for all plates in one query, not one per vehicle.
    const assets = await Ls2TireAsset.find({ status: { $in: ['mounted', 'spare'] } })
      .select('plateKey status sensor').lean();
    const byPlate = new Map();
    for (const a of assets) {
      const k = a.plateKey || '';
      if (!k) continue;
      const e = byPlate.get(k) || { mounted: 0, spare: 0, withSensor: 0 };
      if (a.status === 'mounted') e.mounted += 1; else e.spare += 1;
      if (a.sensor === 'yes') e.withSensor += 1;
      byPlate.set(k, e);
    }

    const body = {
      generatedAt: new Date().toISOString(),
      count: vehicles.length,
      // The plate key is derived, not read. It used to read `v.plateKey` from the tracking record, a field that does not exist there (zero of 58), so `tyres.registered` came out `null` on every vehicle and the promised tire registry never reached the consumer, with no error. Derive it from the plate as the rest of the system does (utils/plateKey).
      vehicles: vehicles.map((v) => shape(v, byPlate.get(require('../utils/plateKey').plateKey(v.plate) || ''), crewFor(v, crew))),
    };
    cache.set(key, body, 10000);
    res.json(body);
  } catch (e) {
    console.error('[fleet-api] vehicles', e);
    res.status(500).json({ message: 'تعذّر جلب المركبات' });
  }
});

/** GET /vehicles/:plate: one vehicle. */
router.get('/vehicles/:plate', async (req, res) => {
  try {
    const v = await Ls2Vehicle.findOne({ plate: String(req.params.plate).trim() }).lean();
    if (!v) return res.status(404).json({ message: 'المركبة غير موجودة' });
    const { plateKey } = require('../utils/plateKey');
    const [assets, crew] = await Promise.all([
      Ls2TireAsset.find({ plateKey: plateKey(v.plate), status: { $in: ['mounted', 'spare'] } }).select('status sensor').lean(),
      crewIndex(),
    ]);
    const tires = assets.length ? {
      mounted: assets.filter((a) => a.status === 'mounted').length,
      spare: assets.filter((a) => a.status !== 'mounted').length,
      withSensor: assets.filter((a) => a.sensor === 'yes').length,
    } : null;
    res.json({ generatedAt: new Date().toISOString(), vehicle: shape(v, tires, crewFor(v, crew)) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر جلب المركبة' });
  }
});

/**
 * GET /alerts: open alerts as the system sees them.
 * Automation may build its own conditions, but thresholds here are editable from the screen, so reading from here means a threshold change reaches automation without code changes.
 */
router.get('/alerts', async (req, res) => {
  try {
    const filter = { resolvedAt: null };
    if (req.query.plate) filter.plate = String(req.query.plate).trim();
    if (req.query.type) filter.type = { $in: String(req.query.type).split(',').map((s) => s.trim()).filter(Boolean) };
    const [alerts, crew, units] = await Promise.all([
      Ls2Alert.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
      crewIndex(),
      Ls2Vehicle.find({}).select('plate driver').lean(),
    ]);
    // An alert says who to notify. 'Truck 3449 tire at 94 degrees' is incomplete without who drives it now and which number to call, which used to be looked up by hand while the truck moved. So both are sent with the alert (see `crewFor`; no number is guessed between two drivers).
    const byPlate = new Map(units.map((u) => [String(u.plate || '').trim(), u]));
    res.json({
      generatedAt: new Date().toISOString(),
      count: alerts.length,
      alerts: alerts.map((a) => {
        const unit = byPlate.get(String(a.plate || '').trim());
        const c = unit ? crewFor(unit, crew) : null;
        return {
          plate: a.plate, type: a.type, severity: a.severity ?? null,
          message: a.message ?? null, value: a.value ?? null,
          raisedAt: a.createdAt, ageSeconds: ageSec(a.createdAt),
          driver: unit?.driver || null,
          driverPhone: c ? c.phone : null,
          driverPhoneSource: c ? c.source : null,
          crew: c ? c.list : [],
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر جلب التنبيهات' });
  }
});

/**
 * Supervisor assignment: who supervises which truck.
 * Why in this API: the 'assign vehicles to supervisors' screen is read by eye only occasionally, but the questions built on it are daily: which truck has no supervisor, who carries more than capacity, when a truck moved from one supervisor to another. These are asked at their own time, not when someone opens the screen, so alerts are built from here.
 * Read-only: assignment is the section manager's decision; it is read here, not written, and whoever distributes signs in with their own permission.
 */

const FleetModels = require('../models/FleetModels');
const FleetVehicle = FleetModels.FleetVehicle;
const FleetDriver = FleetModels.FleetDriver;
const User = require('../models/User');

const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || '';

/** Reads vehicles, their drivers and supervisors once; all responses are derived from it. */
async function assignmentSnapshot() {
  const [vehicles, drivers, sups] = await Promise.all([
    FleetVehicle.find({ isActive: { $ne: false } }).sort({ plate: 1 })
      .select('plate name trailerType gpsType brand color supervisor supervisorName notes monthlyTarget updatedAt').lean(),
    // An archived driver is not shown on a truck, as if deleted.
    (async () => FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null },
      ...require('../utils/archivedHidden').notArchivedIdNumber(await require('../utils/endedStaff').endedStaff(), 'iqama') })
      .select('name phone working offReason vehicle').lean())(),
    User.find({ role: { $in: ['fleet_supervisor', 'fleet_manager'] }, isActive: { $ne: false } })
      .select('firstName lastName email phone role').lean(),
  ]);

  const byVehicle = new Map();
  for (const d of drivers) {
    const k = String(d.vehicle);
    if (!byVehicle.has(k)) byVehicle.set(k, []);
    byVehicle.get(k).push({
      name: d.name, phone: d.phone || null,
      working: d.working !== false,
      offReason: d.working === false ? (d.offReason || null) : null,
    });
  }

  const supById = new Map(sups.map((u) => [String(u._id), u]));
  const rows = vehicles.map((v) => {
    const sid = v.supervisor ? String(v.supervisor) : null;
    const u = sid ? supById.get(sid) : null;
    return {
      plate: v.plate,
      name: v.name || null,
      trailerType: v.trailerType || null,
      gpsType: v.gpsType || null,
      brand: v.brand || null,
      color: v.color || null,
      monthlyTarget: v.monthlyTarget ?? null,
      notes: v.notes || null,
      // A supervisor is a name, id, email and phone: whoever builds an alert needs someone to send it to, not a name to look up.
      supervisor: u ? {
        id: String(u._id), name: fullName(u), email: u.email || null,
        phone: u.phone || null, role: u.role,
      } : null,
      // Name stored on the vehicle; it stays even if the user is deleted.
      supervisorName: v.supervisorName || null,
      unassigned: !sid,
      drivers: byVehicle.get(String(v._id)) || [],
      updatedAt: v.updatedAt || null,
    };
  });

  // The section manager's scope is the whole fleet. Vehicles are not assigned to him individually, so counting those with his name gives zero, which reads as 'not working'. State his scope explicitly.
  const counts = new Map();
  for (const r of rows) {
    const k = r.supervisor ? r.supervisor.id : 'none';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const supervisors = sups.map((u) => {
    const id = String(u._id);
    const isManager = u.role === 'fleet_manager';
    return {
      id,
      name: fullName(u),
      email: u.email || null,
      phone: u.phone || null,
      role: u.role,
      isDepartmentManager: isManager,
      scope: isManager ? 'whole_fleet' : 'assigned_vehicles',
      vehicleCount: isManager ? rows.length : (counts.get(id) || 0),
      plates: isManager
        ? rows.map((r) => r.plate)
        : rows.filter((r) => r.supervisor && r.supervisor.id === id).map((r) => r.plate),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  return {
    summary: {
      vehicles: rows.length,
      supervisors: supervisors.filter((s) => !s.isDepartmentManager).length,
      departmentManagers: supervisors.filter((s) => s.isDepartmentManager).length,
      assigned: rows.filter((r) => !r.unassigned).length,
      unassigned: counts.get('none') || 0,
      vehiclesWithoutDriver: rows.filter((r) => r.drivers.length === 0).length,
    },
    supervisors,
    vehicles: rows,
  };
}

/**
 * GET /supervisor-assignment: the whole screen in one response.
 * `?unassignedOnly=true` narrows to vehicles without a supervisor, the most common basis for alerts: a working truck nobody is responsible for.
 * `?supervisor=<id|name>` limits to one supervisor.
 */
router.get('/supervisor-assignment', async (req, res) => {
  try {
    const hit = cache.get('fleetapi:assign');
    const snap = hit || await assignmentSnapshot();
    if (!hit) cache.set('fleetapi:assign', snap, 15000);

    let vehicles = snap.vehicles;
    if (String(req.query.unassignedOnly || '') === 'true') vehicles = vehicles.filter((v) => v.unassigned);
    const who = String(req.query.supervisor || '').trim();
    if (who) {
      const k = who.toLowerCase();
      vehicles = vehicles.filter((v) => v.supervisor
        && (v.supervisor.id === who
          || v.supervisor.name.toLowerCase().includes(k)
          || String(v.supervisor.email || '').toLowerCase() === k));
    }

    res.json({
      generatedAt: new Date().toISOString(),
      summary: snap.summary,
      supervisors: snap.supervisors,
      count: vehicles.length,
      vehicles,
    });
  } catch (e) {
    console.error('[fleet-api] supervisor-assignment', e);
    res.status(500).json({ message: 'تعذّر جلب توزيع المشرفين' });
  }
});

/** GET /supervisors: supervisors with their vehicle counts and plates, without vehicle details. */
router.get('/supervisors', async (req, res) => {
  try {
    const hit = cache.get('fleetapi:assign');
    const snap = hit || await assignmentSnapshot();
    if (!hit) cache.set('fleetapi:assign', snap, 15000);
    res.json({
      generatedAt: new Date().toISOString(),
      summary: snap.summary,
      count: snap.supervisors.length,
      supervisors: snap.supervisors,
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر جلب المشرفين' });
  }
});

/** GET /health: lets automation verify the key and the pulse before relying on it. */
router.get('/health', async (req, res) => {
  const newest = await Ls2Vehicle.findOne({}).sort({ lastMessageAt: -1 }).select('lastMessageAt').lean();
  const age = ageSec(newest?.lastMessageAt);
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    // The pulse runs every twenty seconds, so a reading newer than five minutes means it is alive.
    pollHealthy: age != null && age < 300,
    newestReadingAgeSeconds: age,
  });
});

module.exports = router;
