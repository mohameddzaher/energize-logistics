const { FleetVehicle, FleetDriver, FleetCustomer, FleetShipment, FleetEvent, FleetConfig } = require('../models/FleetModels');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const User = require('../models/User');
const { createNotification } = require('../services/notificationService');
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

const cache = require('../utils/ttlCache');
// Every fleet mutation flows through emit() → also drop the cached board and
// dashboard so the socket-triggered refetch returns the post-mutation state.
const emit = (event, payload = {}) => {
  try { emitToAll(event, payload); } catch (e) {}
  cache.clear('fleet:');
};

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
  // حقول الحمولة/البوليصة:
  'rentType', 'paymentType', 'loadType', 'price', 'fullRent', 'customerType',
  'driverExpense', 'driverAdvance', 'fridayBonus', 'branch',
];

// The fleet settings singleton — created on first read with sensible defaults.
const getFleetConfig = async () => {
  // Atomic upsert — find-then-create raced on first concurrent access (the key
  // is unique, so the loser threw E11000 and 500'd). setDefaultsOnInsert fills
  // fridayBonusAmount/defaultMonthlyTarget from the schema on first insert.
  return FleetConfig.findOneAndUpdate(
    { key: 'fleet' },
    { $setOnInsert: { key: 'fleet' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

// Add the configured Friday bonus to the driver expense when the flag is set.
const applyFridayBonus = async (data) => {
  if (data.fridayBonus) {
    const cfg = await getFleetConfig();
    data.driverExpense = (Number(data.driverExpense) || 0) + (Number(cfg.fridayBonusAmount) || 0);
  }
};

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
    data.vehicleBrand = veh?.brand || '';
    data.vehicleColor = veh?.color || '';
    // مشرف الحمولة = المشرف المعيَّن على السيارة نفسها (نظام التوزيع)، فتظهر
    // الحمولة تلقائيًا ضمن نطاق مشرفها في القوائم واللوحة والتحليلات.
    if (veh?.supervisor) {
      data.supervisor = veh.supervisor;
      data.supervisorName = veh.supervisorName || '';
    }
  }
  const vehicleId = data.vehicle !== undefined ? data.vehicle : existing?.vehicle;

  for (const key of ['driver', 'secondDriver']) {
    if (data[key] === undefined) continue;
    if (!data[key]) {
      data[key === 'driver' ? 'driverName' : 'secondDriverName'] = '';
      if (key === 'driver') { data.driverPhone = ''; data.driverIqama = ''; data.driverNationality = ''; }
      continue;
    }
    const seated = await seatDriver(data[key], vehicleId);
    if (seated?.moved) notes.push(seated.moved);
    if (seated?.driver) {
      if (key === 'driver') {
        data.driverName = seated.driver.name;
        data.driverPhone = seated.driver.phone || '';
        data.driverIqama = seated.driver.iqama || '';
        data.driverNationality = seated.driver.nationality || '';
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
    // إثراء البوليصة ببيانات السائق (الإقامة/الجوال) من سجل السائق — الحقول دي
    // مش مخزّنة على الشحنة نفسها لكن البوليصة محتاجاها فتطلع فاضية.
    const driverIds = [...new Set(shipments.map((s) => s.driver).filter(Boolean).map(String))];
    if (driverIds.length) {
      const drivers = await FleetDriver.find({ _id: { $in: driverIds } }).select('iqama phone nationality').lean();
      const dmap = new Map(drivers.map((d) => [String(d._id), d]));
      for (const s of shipments) {
        const d = s.driver ? dmap.get(String(s.driver)) : null;
        if (d) {
          if (!s.driverIqama) s.driverIqama = d.iqama || '';
          if (!s.driverNationality) s.driverNationality = d.nationality || '';
          if (!s.driverPhone) s.driverPhone = d.phone || '';
        }
      }
    }
    const vehIds = [...new Set(shipments.filter((s) => !s.vehicleBrand && !s.vehicleColor).map((s) => s.vehicle).filter(Boolean).map(String))];
    if (vehIds.length) {
      const vehs = await FleetVehicle.find({ _id: { $in: vehIds } }).select('brand color').lean();
      const vmap = new Map(vehs.map((v) => [String(v._id), v]));
      for (const s of shipments) {
        const v = s.vehicle ? vmap.get(String(s.vehicle)) : null;
        if (v) { if (!s.vehicleBrand) s.vehicleBrand = v.brand || ''; if (!s.vehicleColor) s.vehicleColor = v.color || ''; }
      }
    }
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
      const c = await FleetCustomer.findById(data.customer).select('name customerType').lean();
      if (c) {
        data.customerName = c.name;
        // لقطة نوع العميل على الحمولة إن لم يُحدَّد صراحةً (للتقارير).
        if (!data.customerType && c.customerType) data.customerType = c.customerType;
      }
    }

    // بونص الجمعة: يُضاف مبلغ الإعدادات لمصروف السائق مرة واحدة عند الإنشاء.
    await applyFridayBonus(data);

    const moveNotes = await resolveAssignments(req, data);

    // المشرف: يأتي من السيارة المعيَّنة (resolveAssignments أعلاه)؛ وإن لم يكن
    // للسيارة مشرف بعد، يُختم بمنشئ الحمولة.
    if (!data.supervisor) {
      data.supervisor = req.user._id;
      data.supervisorName = fullName(req.user);
    }
    data.createdBy = req.user._id;

    const shipment = await FleetShipment.create(data);
    await logEvent(req, shipment._id, 'created', { waybillNumber: shipment.waybillNumber });
    for (const line of moveNotes) await logEvent(req, shipment._id, 'driver_change', { text: line });

    emit('fleet:updated', { id: String(shipment._id) });
    // Notify the load's supervisor (assigned via the vehicle) — never the actor.
    if (shipment.supervisor && String(shipment.supervisor) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: shipment.supervisor,
          type: 'shipment_update',
          title: 'شحنة جديدة',
          message: `بوليصة ${shipment.waybillNumber} — ${shipment.fromCity || ''} ← ${shipment.toCity || ''}`,
          relatedEntity: 'FleetShipment',
          relatedEntityId: shipment._id,
        });
      } catch (e) {}
    }
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
    // Status change → tell the load's supervisor (unless they made the change).
    if (shipment.supervisor && String(shipment.supervisor) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: shipment.supervisor,
          type: 'status_changed',
          title: 'تغيّرت حالة الشحنة',
          message: `بوليصة ${shipment.waybillNumber} — ${from} → ${shipment.status}`,
          relatedEntity: 'FleetShipment',
          relatedEntityId: shipment._id,
        });
      } catch (e) {}
    }
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
        .populate('vehicle', 'plate trailerType gpsType brand color')
        .populate('driver secondDriver', 'name phone iqama nationality working onSponsorship')
        .lean(),
      FleetEvent.find({ shipment: req.params.id }).sort({ createdAt: -1 }).limit(500).lean(),
    ]);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    // للبوليصة: املأ الحقول من السجلات لو مش متسنابة على الشحنة (شحنات قديمة).
    if (shipment.driver && typeof shipment.driver === 'object') {
      if (!shipment.driverIqama) shipment.driverIqama = shipment.driver.iqama || '';
      if (!shipment.driverNationality) shipment.driverNationality = shipment.driver.nationality || '';
      if (!shipment.driverPhone) shipment.driverPhone = shipment.driver.phone || '';
    }
    if (shipment.vehicle && typeof shipment.vehicle === 'object') {
      if (!shipment.vehicleBrand) shipment.vehicleBrand = shipment.vehicle.brand || '';
      if (!shipment.vehicleColor) shipment.vehicleColor = shipment.vehicle.color || '';
    }
    res.json({ shipment, events });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the shipment' });
  }
};

// البوليصة كـ PDF — نفس الملف بالظبط اللي بيطلع من الويب (Puppeteer + نفس القالب
// + نفس الترويسة) عشان الموبايل والسايت يطبعوا نفس البوليصة.
exports.getWaybillPdf = async (req, res) => {
  try {
    const { renderWaybillPdf, rowFromShipment } = require('../utils/waybillPdf');
    const shipment = await FleetShipment.findById(req.params.id)
      .populate('vehicle', 'plate trailerType gpsType brand color')
      .populate('driver secondDriver', 'name phone iqama nationality working onSponsorship')
      .lean();
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.driver && typeof shipment.driver === 'object') {
      if (!shipment.driverIqama) shipment.driverIqama = shipment.driver.iqama || '';
      if (!shipment.driverNationality) shipment.driverNationality = shipment.driver.nationality || '';
      if (!shipment.driverPhone) shipment.driverPhone = shipment.driver.phone || '';
    }
    if (shipment.vehicle && typeof shipment.vehicle === 'object') {
      if (!shipment.vehicleBrand) shipment.vehicleBrand = shipment.vehicle.brand || '';
      if (!shipment.vehicleColor) shipment.vehicleColor = shipment.vehicle.color || '';
    }
    // نوع الإيجار/الدفع/الحمولة مخزَّنة كمفاتيح قوائم (forward/general…) — نحوّلها
    // إلى الاسم المعروض بلغة الطلب حتى لا تظهر بالإنجليزية في بوليصة عربية.
    const Lookup = require('../models/Lookup');
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const lut = await Lookup.find({ type: { $in: ['fleet_rent_type', 'fleet_payment_type', 'fleet_load_type'] } })
      .select('type key nameAr nameEn').lean();
    const nameOf = (type, key) => {
      if (!key) return '';
      const it = lut.find((x) => x.type === type && x.key === key);
      return it ? (lang === 'en' ? (it.nameEn || it.nameAr) : (it.nameAr || it.nameEn)) : key;
    };
    shipment.rentType = nameOf('fleet_rent_type', shipment.rentType);
    shipment.paymentType = nameOf('fleet_payment_type', shipment.paymentType);
    shipment.loadType = nameOf('fleet_load_type', shipment.loadType);
    const pdf = await renderWaybillPdf(rowFromShipment(shipment));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="waybill-${shipment.waybillNumber || shipment._id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('waybill pdf error:', error.message);
    res.status(500).json({ message: 'تعذّر توليد البوليصة' });
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

const DRIVER_EDITABLE = ['name', 'phone', 'iqama', 'working', 'onSponsorship', 'nationality', 'vehicle', 'notes', 'isActive', 'offReason', 'offNote'];

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

const VEHICLE_EDITABLE = ['plate', 'name', 'trailerType', 'gpsType', 'brand', 'color', 'monthlyTarget', 'notes', 'isActive'];

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
    // (live GPS → city), what it is already carrying, and whether it entered
    // its destination's zone. ONLY in-flight statuses make a truck "busy" here:
    // a load marked وصلت/أُرسلت البوليصة is DONE dispatch-wise — the truck is
    // free for the next trip and must not keep wearing its old destination.
    const PICKER_BUSY = ['requesting', 'loading', 'uploaded', 'on_way', 'late'];
    const [ls2, trips] = await Promise.all([
      Ls2Vehicle.find({}).select('plate name position status lastMessageAt').lean(),
      FleetShipment.find({ vehicle: { $in: vehicles.map((v) => v._id) }, status: { $in: PICKER_BUSY } })
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

const CUSTOMER_EDITABLE = ['name', 'phone', 'email', 'customerType', 'rating', 'routes', 'notes', 'isActive'];

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
    // ~5 queries + joins recomputed per client otherwise; the board is the
    // same for everyone with the same scope, so a short TTL absorbs the herd.
    const scope = await supervisorVehicleIds(req);
    const cacheKey = `fleet:board:${scope ? String(req.user._id) : 'all'}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return res.json(hit);

    const vFilter = { isActive: { $ne: false } };
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
    const body = {
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
    };
    cache.set(cacheKey, body, 12000);
    res.json(body);
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

// ── Section settings (Friday bonus, default monthly target) ─────────────────
exports.getConfig = async (req, res) => {
  try {
    const cfg = await getFleetConfig();
    res.json({ config: { fridayBonusAmount: cfg.fridayBonusAmount, defaultMonthlyTarget: cfg.defaultMonthlyTarget } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load fleet settings' });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const cfg = await getFleetConfig();
    if (req.body.fridayBonusAmount != null) cfg.fridayBonusAmount = Number(req.body.fridayBonusAmount) || 0;
    if (req.body.defaultMonthlyTarget != null) cfg.defaultMonthlyTarget = Number(req.body.defaultMonthlyTarget) || 0;
    cfg.updatedBy = req.user._id;
    await cfg.save();
    emit('fleet:updated', {});
    res.json({ config: { fridayBonusAmount: cfg.fridayBonusAmount, defaultMonthlyTarget: cfg.defaultMonthlyTarget } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to save fleet settings' });
  }
};

// ── Rich analytics (income, targets, rankings, trends) with many filters ────
const _multi = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const _monthIndex = (d) => d.getFullYear() * 12 + d.getMonth();

exports.getAnalytics = async (req, res) => {
  try {
    const scope = await supervisorVehicleIds(req); // null = no restriction
    // Every open dashboard/analytics screen refetches on each `fleet:updated`
    // socket event, so a burst of clients × mutations would each re-run this
    // full aggregation. A short TTL collapses the herd; emit() clears the
    // whole `fleet:` prefix on any mutation, so the data never goes stale.
    const cacheKey = `fleet:analytics:${scope ? String(req.user._id) : 'all'}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    const { from, to, month, q, includeCancelled } = req.query;
    const customerTypes = _multi(req.query.customerType);
    const supervisors = _multi(req.query.supervisor);
    const vehicleF = _multi(req.query.vehicle);
    const trailerTypes = _multi(req.query.trailerType);
    const statuses = _multi(req.query.status);

    // Resolve the period. month=YYYY-MM is a shortcut; else from/to; else this month.
    let start, end;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      start = new Date(`${month}-01T00:00:00`);
      end = new Date(start); end.setMonth(end.getMonth() + 1);
    } else {
      const now = new Date();
      start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
      end = to ? new Date(new Date(to).getTime() + 86400000) : new Date(now.getTime() + 86400000);
    }
    const monthsInRange = Math.max(1, _monthIndex(new Date(end.getTime() - 1)) - _monthIndex(start) + 1);

    // Build the Mongo filter: effective date (loadDate else createdAt) in range,
    // supervisor scope, plus the explicit multi-value filters.
    const inRange = {
      $or: [
        { loadDate: { $gte: start, $lt: end } },
        { $and: [{ loadDate: null }, { createdAt: { $gte: start, $lt: end } }] },
      ],
    };
    const filter = { $and: [inRange] };
    if (scope) filter.$and.push({ vehicle: { $in: scope } });
    if (vehicleF.length) filter.$and.push({ vehicle: { $in: vehicleF } });
    if (supervisors.length) filter.$and.push({ supervisor: { $in: supervisors } });
    if (customerTypes.length) filter.$and.push({ customerType: { $in: customerTypes } });
    if (trailerTypes.length) filter.$and.push({ trailerType: { $in: trailerTypes } });
    if (statuses.length) filter.$and.push({ status: { $in: statuses } });
    if (!includeCancelled && !statuses.length) filter.$and.push({ status: { $ne: 'cancelled' } });
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and.push({ $or: [{ customerName: rx }, { vehiclePlate: rx }, { driverName: rx }, { fromCity: rx }, { toCity: rx }, { loadType: rx }] });
    }

    const [shipments, vehicles, customers, cfg] = await Promise.all([
      FleetShipment.find(filter).select('price fullRent customerType trailerType vehicle vehiclePlate driverName driver supervisor supervisorName customer customerName status loadDate createdAt fromCity toCity').lean(),
      FleetVehicle.find(scope ? { _id: { $in: scope } } : {}).select('plate name trailerType monthlyTarget supervisor supervisorName').lean(),
      FleetCustomer.find({}).select('name customerType rating').lean(),
      getFleetConfig(),
    ]);
    // Vehicles created before monthlyTarget existed have none — fall back to the
    // section default so every truck is still measured against a target (this is
    // exactly the "who hit 27,000" analytic the section asked for).
    const defaultTarget = Number(cfg.defaultMonthlyTarget) || 0;

    // إيجار السيارة (price) = دخل قسم الأسطول. الفرق بين «الإيجار كامل» وإيجار
    // السيارة (عند وجوده) = حصة قسم الفروع — يُعرض منفصلًا، ولا يدخل دخل القسم.
    const income = (s) => Number(s.price) || 0;
    const totalIncome = shipments.reduce((a, s) => a + income(s), 0);
    const totalFullRent = shipments.reduce((a, s) => a + (Number(s.fullRent) || 0), 0);
    const branchShare = shipments.reduce((a, s) => {
      const fr = Number(s.fullRent) || 0; return a + (fr > 0 ? Math.max(0, fr - income(s)) : 0);
    }, 0);
    const tripCount = shipments.length;

    // Trips by trailer type (كام سطحة/ستارة…) + by customer type.
    const byTrailerType = {}; const byCustomerType = { heavy: { count: 0, income: 0 }, branch: { count: 0, income: 0 } };
    for (const s of shipments) {
      const t = s.trailerType || '—'; byTrailerType[t] = (byTrailerType[t] || 0) + 1;
      const ct = s.customerType === 'branch' ? 'branch' : (s.customerType === 'heavy' ? 'heavy' : null);
      if (ct) { byCustomerType[ct].count += 1; byCustomerType[ct].income += income(s); }
    }

    // Per-vehicle achieved vs target (target scaled by months in the period).
    const vById = new Map(vehicles.map((v) => [String(v._id), v]));
    const vehAgg = new Map();
    for (const s of shipments) {
      const id = s.vehicle ? String(s.vehicle) : `plate:${s.vehiclePlate || '—'}`;
      const cur = vehAgg.get(id) || { trips: 0, income: 0, plate: s.vehiclePlate || (vById.get(id)?.plate) || '—' };
      cur.trips += 1; cur.income += income(s); vehAgg.set(id, cur);
    }
    const vehiclesOut = [...vById.entries()].map(([id, v]) => {
      const a = vehAgg.get(id) || { trips: 0, income: 0 };
      const monthlyTarget = (Number(v.monthlyTarget) || 0) || defaultTarget;
      const target = monthlyTarget * monthsInRange;
      return {
        _id: id, plate: v.plate, name: v.name, trailerType: v.trailerType,
        supervisorName: v.supervisorName, trips: a.trips, income: a.income,
        monthlyTarget, periodTarget: target, target,
        achievedPct: target > 0 ? Math.round((a.income / target) * 100) : null,
        achieved: target > 0 ? a.income >= target : null,
      };
    }).sort((x, y) => y.income - x.income);
    const vehiclesAchieved = vehiclesOut.filter((v) => v.achieved === true).length;
    const vehiclesBelow = vehiclesOut.filter((v) => v.achieved === false).length;

    // Top drivers.
    const drvAgg = new Map();
    for (const s of shipments) {
      const key = s.driverName || (s.driver && String(s.driver)) || '—';
      const cur = drvAgg.get(key) || { name: s.driverName || '—', trips: 0, income: 0 };
      cur.trips += 1; cur.income += income(s); drvAgg.set(key, cur);
    }
    const topDrivers = [...drvAgg.values()].sort((a, b) => b.income - a.income).slice(0, 20);

    // Supervisors performance (loads created / income through them).
    const supAgg = new Map();
    for (const s of shipments) {
      const key = s.supervisor ? String(s.supervisor) : (s.supervisorName || '—');
      const cur = supAgg.get(key) || { name: s.supervisorName || '—', trips: 0, income: 0 };
      cur.trips += 1; cur.income += income(s); supAgg.set(key, cur);
    }
    const supervisorsOut = [...supAgg.values()].sort((a, b) => b.income - a.income);

    // Customers ranking (+ split heavy vs branch), enriched with our rating.
    const cById = new Map(customers.map((c) => [String(c._id), c]));
    const custAgg = new Map();
    for (const s of shipments) {
      const key = s.customer ? String(s.customer) : (s.customerName || '—');
      const c = s.customer ? cById.get(String(s.customer)) : null;
      const cur = custAgg.get(key) || { _id: s.customer ? String(s.customer) : null, name: s.customerName || (c && c.name) || '—', customerType: (c && c.customerType) || s.customerType || '', rating: (c && c.rating) || 0, trips: 0, income: 0 };
      cur.trips += 1; cur.income += income(s); custAgg.set(key, cur);
    }
    const customersOut = [...custAgg.values()].sort((a, b) => b.income - a.income);
    const topHeavyCustomers = customersOut.filter((c) => c.customerType === 'heavy').slice(0, 15);
    const topBranchCustomers = customersOut.filter((c) => c.customerType === 'branch').slice(0, 15);

    // 12-month trend (income + trips) — respects scope + customerType, ignores the date window.
    const trendStart = new Date(); trendStart.setMonth(trendStart.getMonth() - 11); trendStart.setDate(1); trendStart.setHours(0, 0, 0, 0);
    const trendFilter = { $and: [{ $or: [{ loadDate: { $gte: trendStart } }, { $and: [{ loadDate: null }, { createdAt: { $gte: trendStart } }] }] }, { status: { $ne: 'cancelled' } }] };
    if (scope) trendFilter.$and.push({ vehicle: { $in: scope } });
    if (customerTypes.length) trendFilter.$and.push({ customerType: { $in: customerTypes } });
    const trendDocs = await FleetShipment.find(trendFilter).select('price loadDate createdAt').lean();
    const trendMap = new Map();
    for (let i = 0; i < 12; i++) { const d = new Date(trendStart); d.setMonth(d.getMonth() + i); trendMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, income: 0, trips: 0 }); }
    for (const s of trendDocs) {
      const d = new Date(s.loadDate || s.createdAt); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (trendMap.has(k)) { const m = trendMap.get(k); m.income += Number(s.price) || 0; m.trips += 1; }
    }
    const monthlyTrend = [...trendMap.values()];

    const body = {
      period: { from: start, to: end, monthsInRange },
      totals: {
        totalIncome, totalFullRent, branchShare, tripCount,
        vehicleCount: vehiclesOut.length, customerCount: customersOut.length,
        vehiclesAchieved, vehiclesBelow,
        avgTripIncome: tripCount ? Math.round(totalIncome / tripCount) : 0,
      },
      byTrailerType, byCustomerType,
      vehicles: vehiclesOut,
      topDrivers, supervisors: supervisorsOut,
      customers: customersOut, topHeavyCustomers, topBranchCustomers,
      monthlyTrend,
    };
    cache.set(cacheKey, body, 12000);
    res.json(body);
  } catch (error) {
    console.error('fleet analytics error:', error);
    res.status(500).json({ message: 'Failed to load fleet analytics' });
  }
};

// ── One customer's full profile + trip history + stats ──────────────────────
exports.getCustomerProfile = async (req, res) => {
  try {
    const customer = await FleetCustomer.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const scope = await supervisorVehicleIds(req);
    const q = { customer: customer._id };
    if (scope) q.vehicle = { $in: scope };
    const shipments = await FleetShipment.find(q)
      .select('waybillNumber vehiclePlate driverName fromCity toCity status price fullRent loadType rentType paymentType customerType loadDate createdAt supervisorName')
      .sort({ loadDate: -1, createdAt: -1 }).limit(1000).lean();
    const income = shipments.reduce((a, s) => a + (Number(s.price) || 0), 0);
    const byStatus = {};
    for (const s of shipments) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    res.json({
      customer,
      stats: {
        trips: shipments.length, income,
        avgTripIncome: shipments.length ? Math.round(income / shipments.length) : 0,
        byStatus,
        firstTrip: shipments.length ? shipments[shipments.length - 1].loadDate || shipments[shipments.length - 1].createdAt : null,
        lastTrip: shipments.length ? shipments[0].loadDate || shipments[0].createdAt : null,
      },
      shipments,
    });
  } catch (error) {
    console.error('fleet customer profile error:', error);
    res.status(500).json({ message: 'Failed to load customer profile' });
  }
};

// ── تقييم أداء السائقين — driver KPIs from the shipments they actually ran ────
//
// The Location Solutions section scores drivers on TELEMETRY (how they drive).
// This scores them on the BUSINESS side of the same work: how many loads they
// carried, what those loads earned, whether they arrived instead of going late,
// how much they cost, and whether the follow-up calls on their trips happened.
// The two are complementary — same person, different question.
const DRIVER_KPI_WEIGHTS = {
  trips: 30,       // عدد الحمولات
  income: 25,      // الدخل المحقق
  onTime: 25,      // نسبة الوصول في الموعد (بدل «متأخر»)
  completion: 10,  // نسبة الحمولات المكتملة (بدل الملغاة)
  followUp: 10,    // انتظام متابعة السائق (كل 3 ساعات)
};
const DRIVER_KPI_BANDS = [
  { min: 90, key: 'excellent', ar: 'ممتاز', en: 'Excellent', color: '#16a34a' },
  { min: 75, key: 'very_good', ar: 'جيد جدًا', en: 'Very good', color: '#22c55e' },
  { min: 60, key: 'good', ar: 'جيد', en: 'Good', color: '#eab308' },
  { min: 45, key: 'fair', ar: 'مقبول', en: 'Fair', color: '#f97316' },
  { min: 0, key: 'weak', ar: 'ضعيف', en: 'Needs improvement', color: '#ef4444' },
];
// Statuses that mean the load reached its end successfully, and the one that
// means it did not arrive when it should have.
const DONE_STATUSES = ['arrived', 'bond_sent', 'bond_received', 'invoiced'];
const FOLLOWUP_TARGET_HOURS = 3; // the section's follow-up cadence

exports.getDriverKpis = async (req, res) => {
  try {
    const scope = await supervisorVehicleIds(req);
    const cacheKey = `fleet:driverkpis:${scope ? String(req.user._id) : 'all'}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    const { from, to, month } = req.query;
    let start, end;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      start = new Date(`${month}-01T00:00:00`);
      end = new Date(start); end.setMonth(end.getMonth() + 1);
    } else {
      const now = new Date();
      start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
      end = to ? new Date(new Date(to).getTime() + 86400000) : new Date(now.getTime() + 86400000);
    }
    const monthsInRange = Math.max(1, _monthIndex(new Date(end.getTime() - 1)) - _monthIndex(start) + 1);

    const inRange = {
      $or: [
        { loadDate: { $gte: start, $lt: end } },
        { $and: [{ loadDate: null }, { createdAt: { $gte: start, $lt: end } }] },
      ],
    };
    const filter = { $and: [inRange] };
    if (scope) filter.$and.push({ vehicle: { $in: scope } });

    const [shipments, drivers, cfg] = await Promise.all([
      FleetShipment.find(filter)
        .select('_id waybillNumber driver driverName secondDriver secondDriverName vehiclePlate price fullRent driverExpense status loadDate createdAt lastContactAt expectedArrival customerName fromCity toCity')
        .lean(),
      FleetDriver.find(scope ? { $or: [{ vehicle: { $in: scope } }, { vehicle: null }] } : {})
        .populate('vehicle', 'plate name')
        .lean(),
      getFleetConfig(),
    ]);

    // Follow-up compliance needs the call log, and only for in-flight loads that
    // were actually meant to be followed up.
    const ids = shipments.map((s) => s._id);
    const followUps = ids.length
      ? await FleetEvent.find({ shipment: { $in: ids }, type: 'followup' }).select('shipment createdAt').lean()
      : [];
    const followUpCount = new Map();
    for (const f of followUps) {
      const k = String(f.shipment);
      followUpCount.set(k, (followUpCount.get(k) || 0) + 1);
    }

    // Aggregate per driver. A load with a second driver counts for BOTH of them —
    // they shared the wheel, so they share the credit and the on-time record.
    const agg = new Map();
    const bump = (id, name, s, share) => {
      const key = id ? String(id) : `name:${name || '—'}`;
      if (!agg.has(key)) {
        agg.set(key, {
          _id: id ? String(id) : null, name: name || '—',
          trips: 0, income: 0, fullRent: 0, expense: 0,
          done: 0, late: 0, cancelled: 0, inFlight: 0,
          followUpsDone: 0, followUpsExpected: 0,
          shared: 0, lastTrip: null, firstTrip: null,
        });
      }
      const a = agg.get(key);
      a.trips += 1;
      if (share) a.shared += 1;
      a.income += Number(s.price) || 0;
      a.fullRent += Number(s.fullRent) || 0;
      a.expense += Number(s.driverExpense) || 0;
      if (s.status === 'cancelled') a.cancelled += 1;
      else if (s.status === 'late') a.late += 1;
      else if (DONE_STATUSES.includes(s.status)) a.done += 1;
      else a.inFlight += 1;

      // Follow-up expectation: one call per FOLLOWUP_TARGET_HOURS from the load
      // date until the trip ended (or now, for a live one), capped so a forgotten
      // open shipment can't produce an absurd denominator.
      if (s.status !== 'cancelled') {
        const startedAt = new Date(s.loadDate || s.createdAt);
        const endedAt = DONE_STATUSES.includes(s.status) ? new Date(s.lastContactAt || s.loadDate || s.createdAt) : new Date();
        const hours = Math.max(0, (endedAt - startedAt) / 3600000);
        const expected = Math.min(24, Math.max(1, Math.round(hours / FOLLOWUP_TARGET_HOURS)));
        a.followUpsExpected += expected;
        a.followUpsDone += Math.min(expected, followUpCount.get(String(s._id)) || 0);
      }

      const eff = s.loadDate || s.createdAt;
      if (eff && (!a.lastTrip || eff > a.lastTrip)) a.lastTrip = eff;
      if (eff && (!a.firstTrip || eff < a.firstTrip)) a.firstTrip = eff;
    };

    for (const s of shipments) {
      const hasSecond = !!(s.secondDriver || s.secondDriverName);
      bump(s.driver, s.driverName, s, hasSecond);
      if (hasSecond) bump(s.secondDriver, s.secondDriverName, s, true);
    }

    // Benchmarks: a driver is scored against the fleet's own best, not an
    // invented number — "top of your peers" is the only fair target here.
    const rows = [...agg.values()];
    const maxTrips = Math.max(1, ...rows.map((r) => r.trips));
    const maxIncome = Math.max(1, ...rows.map((r) => r.income));

    const dById = new Map(drivers.map((d) => [String(d._id), d]));
    const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
    const r0 = (n) => Math.round(Number(n) || 0);

    const items = rows.map((a) => {
      const d = a._id ? dById.get(a._id) : null;
      const finished = a.done + a.late;
      const onTimeRate = finished ? a.done / finished : null;
      const completionRate = a.trips ? 1 - a.cancelled / a.trips : 1;
      const followUpRate = a.followUpsExpected ? a.followUpsDone / a.followUpsExpected : null;

      const breakdown = [
        { key: 'trips', ar: 'عدد الحمولات', en: 'Loads carried', weight: DRIVER_KPI_WEIGHTS.trips, value: r0(clamp01(a.trips / maxTrips) * 100), detail: { trips: a.trips, best: maxTrips } },
        { key: 'income', ar: 'الدخل المحقق', en: 'Income generated', weight: DRIVER_KPI_WEIGHTS.income, value: r0(clamp01(a.income / maxIncome) * 100), detail: { income: r0(a.income), best: r0(maxIncome) } },
        { key: 'onTime', ar: 'الوصول في الموعد', en: 'On-time arrival', weight: DRIVER_KPI_WEIGHTS.onTime, value: r0(clamp01(onTimeRate == null ? 0.7 : onTimeRate) * 100), detail: { done: a.done, late: a.late, rate: onTimeRate == null ? null : r0(onTimeRate * 100) } },
        { key: 'completion', ar: 'إتمام الحمولات', en: 'Completion', weight: DRIVER_KPI_WEIGHTS.completion, value: r0(clamp01(completionRate) * 100), detail: { cancelled: a.cancelled, trips: a.trips } },
        { key: 'followUp', ar: 'انتظام المتابعة', en: 'Follow-up discipline', weight: DRIVER_KPI_WEIGHTS.followUp, value: r0(clamp01(followUpRate == null ? 0.7 : followUpRate) * 100), detail: { done: a.followUpsDone, expected: a.followUpsExpected, everyHours: FOLLOWUP_TARGET_HOURS } },
      ];
      const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
      const score = r0(breakdown.reduce((s, b) => s + (b.value / 100) * b.weight, 0) * (100 / totalWeight));
      const band = DRIVER_KPI_BANDS.find((b) => score >= b.min) || DRIVER_KPI_BANDS[DRIVER_KPI_BANDS.length - 1];

      return {
        _id: a._id, name: a.name,
        phone: d?.phone || '', iqama: d?.iqama || '', nationality: d?.nationality || '',
        working: d ? d.working !== false : null,
        offReason: d?.offReason || '',
        onSponsorship: d ? d.onSponsorship !== false : null,
        vehicle: d?.vehicle ? { _id: String(d.vehicle._id), plate: d.vehicle.plate, name: d.vehicle.name } : null,
        trips: a.trips, sharedTrips: a.shared,
        income: r0(a.income), fullRent: r0(a.fullRent), expense: r0(a.expense),
        net: r0(a.income - a.expense),
        avgTripIncome: a.trips ? r0(a.income / a.trips) : 0,
        tripsPerMonth: Math.round((a.trips / monthsInRange) * 10) / 10,
        done: a.done, late: a.late, cancelled: a.cancelled, inFlight: a.inFlight,
        onTimeRate: onTimeRate == null ? null : r0(onTimeRate * 100),
        completionRate: r0(completionRate * 100),
        followUpRate: followUpRate == null ? null : r0(followUpRate * 100),
        followUpsDone: a.followUpsDone, followUpsExpected: a.followUpsExpected,
        firstTrip: a.firstTrip, lastTrip: a.lastTrip,
        score, band: band.key, bandAr: band.ar, bandEn: band.en, bandColor: band.color,
        breakdown,
      };
    });

    // Drivers on the books who carried nothing in the period still belong on the
    // list — "who did no work this month" is half the point of the page.
    const seen = new Set(items.map((i) => i._id).filter(Boolean));
    for (const d of drivers) {
      if (seen.has(String(d._id)) || d.isActive === false) continue;
      items.push({
        _id: String(d._id), name: d.name, phone: d.phone || '', iqama: d.iqama || '',
        nationality: d.nationality || '', working: d.working !== false, offReason: d.offReason || '',
        onSponsorship: d.onSponsorship !== false,
        vehicle: d.vehicle ? { _id: String(d.vehicle._id), plate: d.vehicle.plate, name: d.vehicle.name } : null,
        trips: 0, sharedTrips: 0, income: 0, fullRent: 0, expense: 0, net: 0, avgTripIncome: 0, tripsPerMonth: 0,
        done: 0, late: 0, cancelled: 0, inFlight: 0,
        onTimeRate: null, completionRate: 100, followUpRate: null, followUpsDone: 0, followUpsExpected: 0,
        firstTrip: null, lastTrip: null,
        score: 0, band: 'weak', bandAr: 'ضعيف', bandEn: 'Needs improvement', bandColor: '#ef4444',
        breakdown: [], noActivity: true,
      });
    }

    items.sort((a, b) => b.score - a.score || b.income - a.income);
    const active = items.filter((i) => i.trips > 0);
    const body = {
      period: { from: start, to: end, monthsInRange },
      weights: DRIVER_KPI_WEIGHTS,
      bands: DRIVER_KPI_BANDS,
      followUpTargetHours: FOLLOWUP_TARGET_HOURS,
      fridayBonusAmount: Number(cfg.fridayBonusAmount) || 0,
      summary: {
        drivers: items.length,
        activeDrivers: active.length,
        idleDrivers: items.length - active.length,
        totalTrips: items.reduce((s, i) => s + i.trips, 0),
        totalIncome: items.reduce((s, i) => s + i.income, 0),
        totalExpense: items.reduce((s, i) => s + i.expense, 0),
        averageScore: active.length ? Math.round(active.reduce((s, i) => s + i.score, 0) / active.length) : 0,
        lateTrips: items.reduce((s, i) => s + i.late, 0),
      },
      items,
    };
    cache.set(cacheKey, body, 12000);
    res.json(body);
  } catch (error) {
    console.error('fleet driver KPIs error:', error);
    res.status(500).json({ message: 'Failed to load driver KPIs' });
  }
};
