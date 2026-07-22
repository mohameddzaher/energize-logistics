const { FleetVehicle, FleetDriver, FleetCustomer, FleetShipment, FleetEvent } = require('../models/FleetModels');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

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
    const { q, status, supervisor, customer, from, to, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (supervisor) filter.supervisor = supervisor;
    if (customer) filter.customer = customer;
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
    const [shipments, total, statusAgg] = await Promise.all([
      FleetShipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      FleetShipment.countDocuments(filter),
      FleetShipment.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const byStatus = {};
    statusAgg.forEach((r) => { byStatus[r._id] = r.n; });
    res.json({ shipments, total, stats: { byStatus } });
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

const DRIVER_EDITABLE = ['name', 'phone', 'iqama', 'working', 'onSponsorship', 'vehicle', 'notes', 'isActive'];

exports.listDrivers = async (req, res) => {
  try {
    const drivers = await FleetDriver.find({ isActive: { $ne: false } })
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
    const [vehicles, drivers] = await Promise.all([
      FleetVehicle.find({ isActive: { $ne: false } }).sort({ plate: 1 }).limit(500).lean(),
      FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null } }).select('name phone working vehicle').lean(),
    ]);
    const byVehicle = {};
    drivers.forEach((d) => {
      const k = String(d.vehicle);
      (byVehicle[k] = byVehicle[k] || []).push({ _id: d._id, name: d.name, phone: d.phone, working: d.working });
    });
    res.json({ vehicles: vehicles.map((v) => ({ ...v, drivers: byVehicle[String(v._id)] || [] })) });
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

    const [
      byStatusAgg, today, week, bySupervisorAgg,
      drivers, vehicles, followupsToday, needFollowUp,
    ] = await Promise.all([
      FleetShipment.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      FleetShipment.countDocuments({ createdAt: { $gte: dayStart } }),
      FleetShipment.countDocuments({ createdAt: { $gte: weekStart } }),
      FleetShipment.aggregate([
        { $match: { createdAt: { $gte: weekStart } } },
        { $group: { _id: '$supervisorName', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      FleetDriver.find({ isActive: { $ne: false } }).select('working vehicle').lean(),
      FleetVehicle.countDocuments({ isActive: { $ne: false } }),
      FleetEvent.countDocuments({ type: 'followup', createdAt: { $gte: dayStart } }),
      FleetShipment.find({
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
