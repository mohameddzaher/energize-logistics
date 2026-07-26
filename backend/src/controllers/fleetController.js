const { FleetVehicle, FleetDriver, FleetCustomer, FleetShipment, FleetEvent } = require('../models/FleetModels');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const User = require('../models/User');
// The fleet's trucks ARE the Location Solutions trucks — the maintenance state
// on the board comes from that mirror, joined by normalized plate digits.
const Ls2Vehicle = require('../models/Ls2Vehicle');
const { plateKey, vehiclePlateKey } = require('../utils/plateKey');
// Live GPS → "السيارة داخل نطاق جدة الآن" (and: reached its trip's destination).
const { cityForPoint, sameCity } = require('../utils/saCities');

// A fleet_supervisor sees HIS trucks only — everywhere in the section. The
// manager assigns vehicles to supervisors; every read funnels through this.
// Returns null for every other role (no restriction).
const supervisorVehicleIds = async (req) => {
  if (req.user.role !== 'fleet_supervisor') return null;
  const vs = await FleetVehicle.find({ supervisor: req.user._id }).select('_id').lean();
  return vs.map((v) => v._id);
};

// إدارة الأسطول — our own trucks. The booking rules that matter:
//   · picking a vehicle answers most of the form (its drivers, trailer, GPS);
//   · picking a driver who sits on ANOTHER truck MOVES him here — that is the
//     easy-swap the user asked for, no drivers-page detour;
//   · a vehicle carries at most two drivers;
//   · everything that happens to a shipment lands in its event log.

const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

const logEvent = async (req, shipmentId, type, data = {}) => {
  try {
    await FleetEvent.create({ shipment: shipmentId, type, data, by: req.user._id, byName: fullName(req.user) });
  } catch (e) {
    console.error('[fleet] failed to log', type, 'for', String(shipmentId), e.message);
  }
};

const SHIPMENT_EDITABLE = [
  'customer', 'vehicle', 'driver', 'secondDriver',
  'loadDate', 'fromCity', 'toCity', 'status', 'expectedArrival', 'notes',
];

// Move a driver onto a vehicle, enforcing the two-seat rule. Returns a line
// for the event log when he actually moved.
const seatDriver = async (driverId, vehicleId) => {
  if (!driverId) return null;
  const driver = await FleetDriver.findById(driverId);
  if (!driver) return null;
  if (String(driver.vehicle || '') === String(vehicleId || '')) return { driver, moved: null };
  const fromVehicle = driver.vehicle ? await FleetVehicle.findById(driver.vehicle).select('plate').lean() : null;
  if (vehicleId) {
    const seated = await FleetDriver.countDocuments({ vehicle: vehicleId, isActive: { $ne: false }, _id: { $ne: driver._id } });
    if (seated >= 2) {
      const veh = await FleetVehicle.findById(vehicleId).select('plate').lean();
      const err = new Error(`السيارة ${veh?.plate || ''} عليها سائقان بالفعل — أنزِل أحدهما أولاً`);
      err.status = 400;
      throw err;
    }
  }
  driver.vehicle = vehicleId || null;
  await driver.save();
  return {
    driver,
    moved: fromVehicle
      ? `نُقل السائق ${driver.name} من السيارة ${fromVehicle.plate}`
      : `أُسند السائق ${driver.name}`,
  };
};

// Resolve the vehicle + drivers into snapshots on the shipment payload, moving
// drivers as needed. Shared by create and update.
const resolveAssignments = async (req, data, existing = null) => {
  const notes = [];
  if (data.vehicle !== undefined) {
    const veh = data.vehicle ? await FleetVehicle.findById(data.vehicle).lean() : null;
    data.vehiclePlate = veh?.plate || '';
    data.trailerType = veh?.trailerType || '';
    data.gpsType = veh?.gpsType || '';
  }
  const vehicleId = data.vehicle !== undefined ? data.vehicle : existing?.vehicle;

  for (const key of ['driver', 'secondDriver']) {
    if (data[key] === undefined) continue;
    if (!data[key]) {
      data[key === 'driver' ? 'driverName' : 'secondDriverName'] = '';
      if (key === 'driver') data.driverPhone = '';
      continue;
    }
    const seated = await seatDriver(data[key], vehicleId);
    if (seated?.moved) notes.push(seated.moved);
    if (seated?.driver) {
      if (key === 'driver') {
        data.driverName = seated.driver.name;
        data.driverPhone = seated.driver.phone || '';
      } else {
        data.secondDriverName = seated.driver.name;
      }
    }
  }
  return notes;
};

// ── Shipments ───────────────────────────────────────────────────────────────

exports.listShipments = async (req, res) => {
  try {
    const { q, status, supervisor, customer, toCity, from, to, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (supervisor) filter.supervisor = supervisor;
    if (customer) filter.customer = customer;
    if (toCity) filter.toCity = toCity;
    const scope = await supervisorVehicleIds(req);
    if (scope) filter.vehicle = { $in: scope };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00`);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59`);
    }
    if (q && q.trim()) {
      const r = rx(q);
      const or = [
        { customerName: r }, { driverName: r }, { secondDriverName: r },
        { vehiclePlate: r }, { fromCity: r }, { toCity: r }, { supervisorName: r },
      ];
      const n = Number(String(q).trim());
      if (Number.isFinite(n)) or.push({ waybillNumber: n });
      filter.$or = or;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    // "الرايح جدة كام سيارة" — destinations of the loads currently in motion,
    // under the SAME filter (minus the status/city drill-down itself).
    const destMatch = { ...filter, status: { $in: ['requesting', 'loading', 'uploaded', 'on_way', 'late'] } };
    delete destMatch.toCity;
    const [shipments, total, statusAgg, destAgg] = await Promise.all([
      FleetShipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      FleetShipment.countDocuments(filter),
      FleetShipment.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      FleetShipment.aggregate([
        { $match: destMatch },
        { $group: { _id: '$toCity', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);
    const byStatus = {};
    statusAgg.forEach((r) => { byStatus[r._id] = r.n; });
    const byDestination = destAgg.filter((r) => r._id).map((r) => ({ city: r._id, n: r.n }));
    res.json({ shipments, total, stats: { byStatus, byDestination } });
  } catch (error) {
    console.error('Error listing fleet shipments:', error);
    res.status(500).json({ message: 'Failed to load fleet shipments' });
  }
};

exports.createShipment = async (req, res) => {
  try {
    const data = pick(req.body, SHIPMENT_EDITABLE);

    if (!data.customer && req.body.newCustomer && String(req.body.newCustomer.name || '').trim()) {
      const c = await FleetCustomer.create({
        name: String(req.body.newCustomer.name).trim(),
        phone: String(req.body.newCustomer.phone || '').trim(),
        createdBy: req.user._id,
      });
      data.customer = c._id;
      emit('fleet:customers', {});
    }
    if (data.customer) {
      const c = await FleetCustomer.findById(data.customer).select('name').lean();
      if (c) data.customerName = c.name;
    }

    const moveNotes = await resolveAssignments(req, data);

    data.supervisor = req.user._id;            // المشرف — من الحساب، لا يُكتب
    data.supervisorName = fullName(req.user);
    data.createdBy = req.user._id;

    const shipment = await FleetShipment.create(data);
    await logEvent(req, shipment._id, 'created', { waybillNumber: shipment.waybillNumber });
    for (const line of moveNotes) await logEvent(req, shipment._id, 'driver_change', { text: line });

    emit('fleet:updated', { id: String(shipment._id) });
    await logAudit({
      user: req.user, action: 'create', entity: 'FleetShipment', entityId: shipment._id,
      changes: { waybillNumber: shipment.waybillNumber, customerName: shipment.customerName },
      ipAddress: req.ip,
    });
    res.status(201).json({ shipment });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Error creating fleet shipment:', error);
    res.status(500).json({ message: 'Failed to create the shipment' });
  }
};

exports.updateShipment = async (req, res) => {
  try {
    const shipment = await FleetShipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const data = pick(req.body, SHIPMENT_EDITABLE);

    // An edit can switch the حمولة to a first-time customer, exactly like create.
    if (!data.customer && req.body.newCustomer && String(req.body.newCustomer.name || '').trim()) {
      const c = await FleetCustomer.create({
        name: String(req.body.newCustomer.name).trim(),
        phone: String(req.body.newCustomer.phone || '').trim(),
        createdBy: req.user._id,
      });
      data.customer = c._id;
      emit('fleet:customers', {});
    }
    if (data.customer && String(data.customer) !== String(shipment.customer)) {
      const c = await FleetCustomer.findById(data.customer).select('name').lean();
      if (c) data.customerName = c.name;
    }

    // Replacing a driver is a SWAP: the outgoing one steps off this truck so
    // the incoming one has a seat — otherwise the two-seat rule would refuse
    // every substitution.
    const moveNotes = [];
    const vehicleId = data.vehicle !== undefined ? data.vehicle : shipment.vehicle;
    for (const key of ['driver', 'secondDriver']) {
      const oldId = shipment[key] ? String(shipment[key]) : '';
      const newId = data[key] !== undefined ? String(data[key] || '') : oldId;
      if (oldId && newId !== oldId) {
        const stillUsed = [data.driver !== undefined ? String(data.driver || '') : String(shipment.driver || ''),
          data.secondDriver !== undefined ? String(data.secondDriver || '') : String(shipment.secondDriver || '')]
          .includes(oldId);
        if (!stillUsed) {
          const old = await FleetDriver.findById(oldId);
          if (old && String(old.vehicle || '') === String(vehicleId || '')) {
            old.vehicle = null;
            await old.save();
            moveNotes.push(`أُنزل السائق ${old.name} من السيارة ${shipment.vehiclePlate || ''}`.trim());
          }
        }
      }
    }
    moveNotes.push(...await resolveAssignments(req, data, shipment));

    const changed = Object.keys(data).filter((k) => String(shipment[k] ?? '') !== String(data[k] ?? ''));
    Object.assign(shipment, data);
    await shipment.save();

    if (changed.length) await logEvent(req, shipment._id, 'updated', { fields: changed });
    for (const line of moveNotes) await logEvent(req, shipment._id, 'driver_change', { text: line });

    emit('fleet:updated', { id: String(shipment._id) });
    res.json({ shipment });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Failed to update the shipment' });
  }
};

exports.patchStatus = async (req, res) => {
  try {
    const shipment = await FleetShipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    const from = shipment.status;
    shipment.status = req.body.status;
    await shipment.save();
    await logEvent(req, shipment._id, 'status', { from, to: shipment.status });
    emit('fleet:updated', { id: String(shipment._id) });
    res.json({ shipment });
  } catch (error) {
    res.status(400).json({ message: 'Invalid status' });
  }
};

exports.getShipment = async (req, res) => {
  try {
    const [shipment, events] = await Promise.all([
      FleetShipment.findById(req.params.id)
        .populate('customer', 'name phone routes')
        .populate('vehicle', 'plate trailerType gpsType')
        .populate('driver secondDriver', 'name phone working onSponsorship')
        .lean(),
      FleetEvent.find({ shipment: req.params.id }).sort({ createdAt: -1 }).limit(500).lean(),
    ]);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    res.json({ shipment, events });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the shipment' });
  }
};

exports.deleteShipment = async (req, res) => {
  try {
    const shipment = await FleetShipment.findByIdAndDelete(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await FleetEvent.deleteMany({ shipment: shipment._id });
    emit('fleet:updated', { id: String(req.params.id) });
    await logAudit({
      user: req.user, action: 'delete', entity: 'FleetShipment', entityId: req.params.id,
      changes: { waybillNumber: shipment.waybillNumber, customerName: shipment.customerName },
      ipAddress: req.ip,
    });
    res.json({ message: 'Shipment deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete the shipment' });
  }
};

// The follow-up call: "كلمناه الساعة كذا، هو فين، وحالته إيه". Appends to the
// story and refreshes the two list-level fields everyone scans for.
exports.addFollowUp = async (req, res) => {
  try {
    const shipment = await FleetShipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const contactTime = req.body.contactTime ? new Date(req.body.contactTime) : new Date();
    const data = {
      contactTime,
      currentLocation: String(req.body.currentLocation || '').trim(),
      note: String(req.body.note || '').trim(),
      expectedArrival: req.body.expectedArrival ? new Date(req.body.expectedArrival) : null,
    };
    await logEvent(req, shipment._id, 'followup', data);

    if (!shipment.lastContactAt || contactTime > shipment.lastContactAt) shipment.lastContactAt = contactTime;
    if (data.expectedArrival) shipment.expectedArrival = data.expectedArrival;
    await shipment.save();

    emit('fleet:updated', { id: String(shipment._id) });
    res.status(201).json({ shipment });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record the follow-up' });
  }
};

// ── Drivers ─────────────────────────────────────────────────────────────────

const DRIVER_EDITABLE = ['name', 'phone', 'iqama', 'working', 'onSponsorship', 'vehicle', 'notes', 'isActive', 'offReason', 'offNote'];

exports.listDrivers = async (req, res) => {
  try {
    const dFilter = { isActive: { $ne: false } };
    const scope = await supervisorVehicleIds(req);
    if (scope) dFilter.vehicle = { $in: scope };
    const drivers = await FleetDriver.find(dFilter)
      .populate('vehicle', 'plate trailerType gpsType')
      .sort({ name: 1 })
      .limit(1000)
      .lean();
    res.json({ drivers });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load drivers' });
  }
};

exports.createDriver = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Driver name is required' });
    const data = pick(req.body, DRIVER_EDITABLE);
    const vehicleId = data.vehicle;
    delete data.vehicle;
    const driver = await FleetDriver.create(data);
    if (vehicleId) await seatDriver(driver._id, vehicleId);
    emit('fleet:drivers', {});
    res.status(201).json({ driver });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Failed to create the driver' });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const driver = await FleetDriver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    const data = pick(req.body, DRIVER_EDITABLE);
    // Vehicle moves go through the two-seat rule, not a raw write.
    if (data.vehicle !== undefined) {
      await seatDriver(driver._id, data.vehicle || null);
      delete data.vehicle;
    }
    // Reason and availability move together: naming a reason means he is off;
    // marking him working again clears the reason.
    if (data.offReason) data.working = false;
    if (data.working === true) { data.offReason = ''; data.offNote = ''; }
    Object.assign(driver, data);
    await driver.save();
    emit('fleet:drivers', {});
    res.json({ driver });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Failed to update the driver' });
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const driver = await FleetDriver.findByIdAndUpdate(req.params.id, { isActive: false, vehicle: null }, { new: true });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    emit('fleet:drivers', {});
    res.json({ message: 'Driver removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the driver' });
  }
};

// ── Vehicles ────────────────────────────────────────────────────────────────

const VEHICLE_EDITABLE = ['plate', 'name', 'trailerType', 'gpsType', 'notes', 'isActive'];

exports.listVehicles = async (req, res) => {
  try {
    const vFilter = { isActive: { $ne: false } };
    const scope = await supervisorVehicleIds(req);
    if (scope) vFilter._id = { $in: scope };
    const [vehicles, drivers] = await Promise.all([
      FleetVehicle.find(vFilter).sort({ plate: 1 }).limit(500).lean(),
      FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null } }).select('name phone working vehicle').lean(),
    ]);
    const byVehicle = {};
    drivers.forEach((d) => {
      const k = String(d.vehicle);
      (byVehicle[k] = byVehicle[k] || []).push({ _id: d._id, name: d.name, phone: d.phone, working: d.working });
    });

    // What the dispatcher needs WHILE PICKING a truck: where it is right now
    // (live GPS → city), what it is already carrying (active trip → toCity +
    // ETA), and whether it has already entered its destination's zone.
    const [ls2, trips] = await Promise.all([
      Ls2Vehicle.find({}).select('plate name position status lastMessageAt').lean(),
      FleetShipment.find({ vehicle: { $in: vehicles.map((v) => v._id) }, status: { $in: BOARD_ACTIVE } })
        .sort({ createdAt: -1 })
        .select('vehicle status fromCity toCity expectedArrival waybillNumber')
        .lean(),
    ]);
    const liveByKey = new Map();
    for (const lv of ls2) {
      const k = vehiclePlateKey(lv);
      if (k) liveByKey.set(k, lv);
    }
    const tripByVehicle = new Map();
    for (const s of trips) {
      const k = String(s.vehicle);
      if (!tripByVehicle.has(k)) tripByVehicle.set(k, s);
    }

    res.json({
      vehicles: vehicles.map((v) => {
        const lv = liveByKey.get(plateKey(v.plate)) || null;
        const liveCity = lv?.position ? cityForPoint(lv.position.lat, lv.position.lng) : null;
        const trip = tripByVehicle.get(String(v._id)) || null;
        return {
          ...v,
          drivers: byVehicle[String(v._id)] || [],
          live: lv ? { city: liveCity, status: lv.status || null, lastMessageAt: lv.lastMessageAt || null } : null,
          trip: trip && {
            waybillNumber: trip.waybillNumber, status: trip.status,
            fromCity: trip.fromCity, toCity: trip.toCity, expectedArrival: trip.expectedArrival,
          },
          atDestination: !!(trip && liveCity && sameCity(liveCity, trip.toCity)),
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load vehicles' });
  }
};

exports.createVehicle = async (req, res) => {
  try {
    if (!req.body.plate || !String(req.body.plate).trim()) return res.status(400).json({ message: 'Plate is required' });
    const vehicle = await FleetVehicle.create(pick(req.body, VEHICLE_EDITABLE));
    emit('fleet:vehicles', {});
    res.status(201).json({ vehicle });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create the vehicle' });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const vehicle = await FleetVehicle.findByIdAndUpdate(req.params.id, pick(req.body, VEHICLE_EDITABLE), { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    emit('fleet:vehicles', {});
    res.json({ vehicle });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the vehicle' });
  }
};

exports.deleteVehicle = async (req, res) => {
  try {
    const vehicle = await FleetVehicle.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    // Its drivers go back to the bench rather than pointing at a ghost.
    await FleetDriver.updateMany({ vehicle: vehicle._id }, { vehicle: null });
    emit('fleet:vehicles', {});
    res.json({ message: 'Vehicle removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the vehicle' });
  }
};

// ── Customers ───────────────────────────────────────────────────────────────

const CUSTOMER_EDITABLE = ['name', 'phone', 'email', 'routes', 'notes', 'isActive'];

exports.listCustomers = async (req, res) => {
  try {
    const customers = await FleetCustomer.find({ isActive: { $ne: false } }).sort({ name: 1 }).limit(500).lean();
    res.json({ customers });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load customers' });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Customer name is required' });
    const customer = await FleetCustomer.create({ ...pick(req.body, CUSTOMER_EDITABLE), createdBy: req.user._id });
    emit('fleet:customers', {});
    res.status(201).json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create the customer' });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customer = await FleetCustomer.findByIdAndUpdate(req.params.id, pick(req.body, CUSTOMER_EDITABLE), { new: true });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    await FleetShipment.updateMany({ customer: customer._id }, { customerName: customer.name });
    emit('fleet:customers', {});
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update the customer' });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await FleetCustomer.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    emit('fleet:customers', {});
    res.json({ message: 'Customer removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the customer' });
  }
};

// ── Dashboard ───────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    // The 3-hour cadence: an in-flight load nobody has called in 3+ hours is
    // exactly what the operations lead wants shoved in their face.
    const staleCut = new Date(now.getTime() - 3 * 3600 * 1000);
    const IN_FLIGHT = ['loading', 'uploaded', 'on_way'];

    // A supervisor's analytics cover HIS trucks only — same scope as every list.
    const scope = await supervisorVehicleIds(req);
    const shipScope = scope ? { vehicle: { $in: scope } } : {};
    const vehScope = scope ? { _id: { $in: scope } } : {};
    const drvScope = scope ? { vehicle: { $in: scope } } : {};

    const [
      byStatusAgg, today, week, bySupervisorAgg,
      drivers, vehicles, followupsToday, needFollowUp,
    ] = await Promise.all([
      FleetShipment.aggregate([{ $match: shipScope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      FleetShipment.countDocuments({ ...shipScope, createdAt: { $gte: dayStart } }),
      FleetShipment.countDocuments({ ...shipScope, createdAt: { $gte: weekStart } }),
      FleetShipment.aggregate([
        { $match: { ...shipScope, createdAt: { $gte: weekStart } } },
        { $group: { _id: '$supervisorName', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      FleetDriver.find({ isActive: { $ne: false }, ...drvScope }).select('working vehicle offReason').lean(),
      FleetVehicle.countDocuments({ isActive: { $ne: false }, ...vehScope }),
      FleetEvent.countDocuments({ type: 'followup', createdAt: { $gte: dayStart } }),
      FleetShipment.find({
        ...shipScope,
        status: { $in: IN_FLIGHT },
        $or: [{ lastContactAt: null }, { lastContactAt: { $lt: staleCut } }],
      }).select('waybillNumber customerName driverName vehiclePlate lastContactAt fromCity toCity').sort({ lastContactAt: 1 }).limit(20).lean(),
    ]);

    const byStatus = {};
    byStatusAgg.forEach((r) => { byStatus[r._id] = r.n; });
    const seatCounts = {};
    drivers.forEach((d) => { if (d.vehicle) seatCounts[String(d.vehicle)] = (seatCounts[String(d.vehicle)] || 0) + 1; });
    const seated = Object.values(seatCounts);

    res.json({
      byStatus,
      shipmentsToday: today,
      shipmentsWeek: week,
      bySupervisor: bySupervisorAgg.map((r) => ({ name: r._id || '—', count: r.n })),
      drivers: {
        total: drivers.length,
        working: drivers.filter((d) => d.working).length,
        off: drivers.filter((d) => !d.working).length,
        sick: drivers.filter((d) => d.offReason === 'sick').length,
        onLeave: drivers.filter((d) => d.offReason === 'leave').length,
        unassigned: drivers.filter((d) => !d.vehicle).length,
      },
      vehicles: {
        total: vehicles,
        withTwoDrivers: seated.filter((n) => n >= 2).length,
        withOneDriver: seated.filter((n) => n === 1).length,
        withNoDriver: vehicles - seated.length,
      },
      followupsToday,
      needFollowUp,
    });
  } catch (error) {
    console.error('Error building fleet dashboard:', error);
    res.status(500).json({ message: 'Failed to load the dashboard' });
  }
};

// ── Seed ────────────────────────────────────────────────────────────────────
// Vehicles + their drivers mirror in from Location Solutions once; after that
// this register is the source of truth for the section. Idempotent by plate
// and by driver name; never overwrites an edit; never blocks boot.

exports.ensureFleetDefaults = async () => {
  try {
    const Ls2Vehicle = require('../models/Ls2Vehicle');
    const live = await Ls2Vehicle.find({}).select('plate name driver').lean();
    for (const v of live) {
      const plate = String(v.plate || '').trim() || String(v.name || '').trim();
      if (!plate) continue;
      try {
        // Upserts, not find-then-create: two processes seeding at once (server
        // boot + a script) raced the find and tripped the unique index.
        // eslint-disable-next-line no-await-in-loop
        await FleetVehicle.updateOne(
          { plate },
          { $setOnInsert: { plate, trailerType: 'سطحة', gpsType: 'LS', notes: 'من لوكيشن سوليوشن' } },
          { upsert: true },
        );
        // eslint-disable-next-line no-await-in-loop
        const veh = await FleetVehicle.findOne({ plate }).select('_id').lean();
        const driverName = String(v.driver || '').trim();
        if (driverName && veh) {
          // eslint-disable-next-line no-await-in-loop
          await FleetDriver.updateOne(
            { name: driverName },
            { $setOnInsert: { name: driverName, vehicle: veh._id, working: true } },
            { upsert: true },
          );
        }
      } catch (e) {
        // One bad row must not abort the other 56.
        if (e.code !== 11000) console.error('[fleet] seed row failed:', plate, e.message);
      }
    }
  } catch (e) {
    console.error('[fleet] LS2 seed skipped:', e.message);
  }

  if (await FleetCustomer.countDocuments({}) === 0) {
    await FleetCustomer.create([
      { name: 'مصنع اليمامة لانتاج ابراج الطاقة الكهربائية', routes: [{ fromCity: 'جدة', toCity: 'الرياض', price: 1100 }], notes: 'عميل تجريبي' },
      { name: 'شركة البحر الأحمر للتنمية', routes: [{ fromCity: 'جدة', toCity: 'ينبع', price: 900 }], notes: 'عميل تجريبي' },
    ]);
  }
};

// ── اللوحة الرئيسية: كل سيارة كبطاقة، مجمّعة بالمشرف، بحالة تلقائية ─────────
// The manager's landing view: every truck as one card, grouped under its
// supervisor, colored by its CURRENT trip (late / arrived / moving / preparing
// / idle) with the Location Solutions maintenance state riding on each card —
// so nobody hunts through lists to know who is late or due for service.
const BOARD_ACTIVE = ['requesting', 'loading', 'uploaded', 'on_way', 'late', 'arrived', 'bond_sent'];
const ARRIVED_FAMILY = ['arrived', 'bond_sent'];

exports.getBoard = async (req, res) => {
  try {
    const vFilter = { isActive: { $ne: false } };
    const scope = await supervisorVehicleIds(req);
    if (scope) vFilter._id = { $in: scope };

    const vehicles = await FleetVehicle.find(vFilter).sort({ plate: 1 }).lean();
    const [ships, drivers, ls2] = await Promise.all([
      FleetShipment.find({ vehicle: { $in: vehicles.map((v) => v._id) }, status: { $in: BOARD_ACTIVE } })
        .sort({ createdAt: -1 })
        .select('vehicle status fromCity toCity expectedArrival loadDate waybillNumber customerName driverName lastContactAt')
        .lean(),
      FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null } }).select('name vehicle working').lean(),
      Ls2Vehicle.find({}).select('plate name maintenanceStatus kmToService nextServiceName odometerKm position status').lean(),
    ]);

    // Latest active trip per vehicle (list is newest-first).
    const tripByVehicle = new Map();
    for (const s of ships) {
      const k = String(s.vehicle);
      if (!tripByVehicle.has(k)) tripByVehicle.set(k, s);
    }
    const driversByVehicle = new Map();
    for (const d of drivers) {
      const k = String(d.vehicle);
      if (!driversByVehicle.has(k)) driversByVehicle.set(k, []);
      driversByVehicle.get(k).push({ name: d.name, working: d.working });
    }
    const maintByKey = new Map();
    for (const lv of ls2) {
      const k = vehiclePlateKey(lv);
      if (k) maintByKey.set(k, lv);
    }

    const now = Date.now();
    const cards = vehicles.map((v) => {
      const trip = tripByVehicle.get(String(v._id)) || null;
      const m = maintByKey.get(plateKey(v.plate)) || null;
      // أين هي الآن جغرافيًا — وهل دخلت نطاق وجهتها بالفعل؟
      const liveCity = m?.position ? cityForPoint(m.position.lat, m.position.lng) : null;
      const atDestination = !!(trip && liveCity && !ARRIVED_FAMILY.includes(trip.status) && sameCity(liveCity, trip.toCity));
      // The card's automatic state:
      //   late (متأخرة عن الوصول المتوقع) > arrived (وصلت موقع التنزيل) >
      //   moving (في الطريق) > preparing (تحميل/تجهيز) > idle (بدون حمولة).
      let state = 'idle';
      if (trip) {
        const lateByTime = trip.expectedArrival
          && new Date(trip.expectedArrival).getTime() < now
          && !ARRIVED_FAMILY.includes(trip.status);
        if (ARRIVED_FAMILY.includes(trip.status)) state = 'arrived';
        else if (trip.status === 'late' || lateByTime) state = 'late';
        else if (trip.status === 'on_way') state = 'moving';
        else state = 'preparing';
      }
      return {
        _id: v._id,
        plate: v.plate,
        name: v.name,
        trailerType: v.trailerType,
        supervisor: v.supervisor ? String(v.supervisor) : null,
        supervisorName: v.supervisorName || '',
        drivers: driversByVehicle.get(String(v._id)) || [],
        trip: trip && {
          _id: trip._id, waybillNumber: trip.waybillNumber, status: trip.status,
          fromCity: trip.fromCity, toCity: trip.toCity,
          expectedArrival: trip.expectedArrival, loadDate: trip.loadDate,
          customerName: trip.customerName, driverName: trip.driverName,
          lastContactAt: trip.lastContactAt,
        },
        state,
        liveCity,
        atDestination,
        maintenance: m ? {
          status: m.maintenanceStatus || 'ok',
          kmToService: m.kmToService ?? null,
          nextServiceName: m.nextServiceName || '',
          odometerKm: m.odometerKm ?? null,
        } : null,
      };
    });

    const count = (st) => cards.filter((c) => c.state === st).length;
    const byDestination = {};
    for (const c of cards) {
      if (c.trip && !ARRIVED_FAMILY.includes(c.trip.status) && c.trip.toCity) {
        byDestination[c.trip.toCity] = (byDestination[c.trip.toCity] || 0) + 1;
      }
    }
    res.json({
      cards,
      summary: {
        total: cards.length,
        moving: count('moving'),
        late: count('late'),
        arrived: count('arrived'),
        preparing: count('preparing'),
        idle: count('idle'),
        maintOverdue: cards.filter((c) => c.maintenance?.status === 'overdue').length,
        maintDue: cards.filter((c) => c.maintenance?.status === 'due').length,
        byDestination: Object.entries(byDestination).map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n),
      },
    });
  } catch (error) {
    console.error('Error building fleet board:', error);
    res.status(500).json({ message: 'Failed to load the fleet board' });
  }
};

// ── تعيين المشرفين ───────────────────────────────────────────────────────────
// The people the manager can assign trucks to.
exports.listSupervisors = async (req, res) => {
  try {
    const users = await User.find({ role: { $in: ['fleet_supervisor', 'fleet_manager'] }, isActive: { $ne: false } })
      .select('firstName lastName email role').lean();
    users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load supervisors' });
  }
};

// PATCH /vehicles/:id/supervisor { supervisor: userId|null } — manager only
// (route-gated). Moving a truck between supervisors is exactly this.
exports.assignVehicleSupervisor = async (req, res) => {
  try {
    const v = await FleetVehicle.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'Vehicle not found' });
    const { supervisor } = req.body || {};
    if (supervisor) {
      const u = await User.findById(supervisor).select('firstName lastName role').lean();
      if (!u) return res.status(404).json({ message: 'Supervisor not found' });
      v.supervisor = u._id;
      v.supervisorName = fullName(u);
    } else {
      v.supervisor = null;
      v.supervisorName = '';
    }
    await v.save();
    emit('fleet:vehicles', {});
    emit('fleet:updated', {});
    await logAudit({
      user: req.user, action: 'assign_supervisor', entity: 'FleetVehicle', entityId: v._id,
      changes: { plate: v.plate, supervisorName: v.supervisorName || null },
      ipAddress: req.ip,
    });
    res.json({ vehicle: v });
  } catch (error) {
    res.status(500).json({ message: 'Failed to assign the supervisor' });
  }
};

// POST /vehicles/assign-supervisor-bulk { supervisor: userId|null, vehicleIds: [] }
// The manager's checklist flow: tick a set of trucks, hand them to a supervisor
// in ONE save (or null to unassign). Manager/admin only (route-gated).
exports.assignVehicleSupervisorBulk = async (req, res) => {
  try {
    const { supervisor = null, vehicleIds } = req.body || {};
    if (!Array.isArray(vehicleIds) || vehicleIds.length === 0) {
      return res.status(400).json({ message: 'حدد السيارات أولًا' });
    }
    let supName = '';
    let supId = null;
    if (supervisor) {
      const u = await User.findById(supervisor).select('firstName lastName').lean();
      if (!u) return res.status(404).json({ message: 'Supervisor not found' });
      supId = u._id;
      supName = fullName(u);
    }
    const r = await FleetVehicle.updateMany(
      { _id: { $in: vehicleIds } },
      { $set: { supervisor: supId, supervisorName: supName } }
    );
    emit('fleet:vehicles', {});
    emit('fleet:updated', {});
    await logAudit({
      user: req.user, action: 'assign_supervisor_bulk', entity: 'FleetVehicle', entityId: vehicleIds[0],
      changes: { vehicles: r.modifiedCount, supervisorName: supName || null },
      ipAddress: req.ip,
    });
    res.json({ ok: true, modified: r.modifiedCount, supervisorName: supName });
  } catch (error) {
    res.status(500).json({ message: 'Failed to assign vehicles' });
  }
};
