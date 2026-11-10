const mongoose = require('mongoose');
const { describeMongooseError, sendMongooseError } = require('../utils/mongooseError');
const { FleetVehicle, FleetDriver, FleetCustomer, FleetShipment, FleetEvent, FleetConfig } = require('../models/FleetModels');
const { startOfDay, endOfDay, todayKey, dayKeyOf } = require('../utils/companyDay');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');
const User = require('../models/User');
const { createNotification } = require('../services/notificationService');
// The fleet's trucks ARE the Location Solutions trucks — the maintenance state
// on the board comes from that mirror, joined by normalized plate digits.
const Ls2Vehicle = require('../models/Ls2Vehicle');
const { plateKey, vehiclePlateKey, canonicalPlateKey } = require('../utils/plateKey');
// Fleet customers and CRM companies are separate registers joined only by the normalized name.
const CrmCompany = require('../models/CrmCompany');
const CrmActivity = require('../models/CrmActivity');
const CrmDeal = require('../models/CrmDeal');
const { nameKey } = require('../utils/nameKey');
const { endedStaff, idNumberEnded, employeeEnded } = require('../utils/endedStaff');
// An archived person (service ended and left the system) disappears from every list here as if deleted: by his file reference if the driver is linked, else by his written residence number.
const { notArchivedRow } = require('../utils/archivedHidden');
const noArchDrv = async () => notArchivedRow(await endedStaff(), 'employee', 'iqama');
// The truck comes from the vehicle register and the driver from the HR file; see utils/fleetIdentity.
const FI = require('../utils/fleetIdentity');
const vehicleRef = require('../utils/vehicleRef');
// Live GPS gives whether the vehicle is currently inside the Jeddah zone (and whether it reached its trip's destination).
const { cityForPoint, sameCity } = require('../utils/saCities');

/**
 * A supervisor owns his vehicles and sees others': ownership is kept, hiding was dropped. `FleetVehicle.supervisor` is shown in a column and assignment stays with the fleet manager; hiding a colleague's data cost more than it protected (covering a colleague on leave).
 * Writing is not opened: `forWrite` keeps the restriction in `createVehicleLog` and `updateVehicleLog` only.
 * The policy is one flag, so reversing it is one line.
 */
const SUPERVISORS_SEE_EACH_OTHER = true;

const supervisorVehicleIds = async (req, { forWrite = false } = {}) => {
  if (req.user.role !== 'fleet_supervisor') return null;
  if (!forWrite && SUPERVISORS_SEE_EACH_OTHER) return null;   // No restriction on reads
  const vs = await FleetVehicle.find({ supervisor: req.user._id }).select('_id').lean();
  return vs.map((v) => v._id);
};

// Fleet management: our own trucks. Booking rules: picking a vehicle answers most of the form (drivers, trailer, GPS);
// picking a driver who sits on ANOTHER truck MOVES him here (easy swap);
// a vehicle carries at most two drivers; everything that happens to a shipment lands in its event log.

const cache = require('../utils/ttlCache');
const { cappedFind, askedLimit, CAP_NOTE_AR } = require('../utils/capped');
// Every fleet mutation flows through emit() and also drops the cached board and dashboard so the socket-triggered refetch returns the post-mutation state.
// Invalidate before announcing, not after: the event wakes every open screen to refetch, and if announced first the refetch reads the cache not yet cleared, showing the pre-edit state (seen as lagging one change behind, not as a logic error).
const emit = (event, payload = {}) => {
  cache.clear('fleet:');
  try { emitToAll(event, payload); } catch (e) {}
};

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// Search tolerant of Arabic spelling variants and Indian digits: plates, cities and driver names are written in various forms across sources, and matching raw text made search return an empty table on a one-hamza difference.
// Spaces become `\s*` because plates are written both joined and spaced.
const arRx = (s) => {
  const west = String(s).trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const body = west
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[اأإآٱ]/g, '[اأإآٱ]')
    .replace(/[هة]/g, '[هة]')
    .replace(/[يىئ]/g, '[يىئ]')
    .replace(/\s+/g, '\\s*');
  return new RegExp(body, 'i');
};

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
  // Load/waybill fields:
  'rentType', 'paymentType', 'paymentSubtype', 'loadType', 'blNumber', 'containerNumber', 'price', 'fullRent', 'customerType',
  'driverExpense', 'driverAdvance', 'fridayBonus', 'branch',
];

/** Load form choices shared with shipment orders: the four payment types and the From/To cities. */
exports.getFormOptions = async (req, res) => {
  try {
    const { paymentSubtypeOptions } = require('../utils/shipmentOrderPayment');
    const cities = await require('./shipmentOrdersController').cityOptions();
    res.json({ paymentSubtypes: paymentSubtypeOptions(), cities });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر تحميل خيارات النموذج' });
  }
};

/** The chosen payment type sets the cash/tax family; anything outside the four is dropped. */
const applyPaymentSubtype = (data) => {
  if (data.paymentSubtype === undefined) return;
  const PT = require('../utils/paymentType');
  const k = String(data.paymentSubtype || '').trim();
  data.paymentSubtype = PT.isSubtype(k) ? k : '';
  if (data.paymentSubtype) data.paymentType = PT.subtypeFamily(k);
};
/** A customer's agreed cash/tax as one of the four: our own trucks, so cash is cash HT. */
const subtypeOfCustomer = (paymentType) => ({ tax: 'deferred_invoice', cash: 'cash_ht' }[String(paymentType || '')] || '');

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

/**
 * A truck never keeps a second driver without a first
 * Called after every step-down from a truck. If the first seat empties while the second holds a man, he is promoted to first: second driver is a rank relative to an existing first, and without one the word is meaningless; the screen would show a truck with an empty first driver and a named second, and nobody could tell if it is bad data or a short crew.
 */
const promoteSeats = async (vehicleId) => {
  if (!vehicleId) return;
  const live = { vehicle: vehicleId, isActive: { $ne: false } };
  const seated = await FleetDriver.find(live).select('seat').sort({ seat: 1 }).lean();
  if (!seated.length) return;
  if (!seated.some((d) => d.seat === 1)) {
    await FleetDriver.updateOne({ _id: seated[0]._id }, { $set: { seat: 1 } });
    if (seated[1]) await FleetDriver.updateOne({ _id: seated[1]._id }, { $set: { seat: 2 } });
  }
};

/**
 * Move a driver onto a vehicle, enforcing the two-seat rule. Returns a line for the event log when he actually moved.
 * The seat is requested or given at first free
 * `seat` is explicit when the user says this is the second driver on this truck, and left out when assigned with no order, taking the first free seat. If the requested seat is held by another they swap: the user asked this one to be first, so the other becomes second, closer to what he meant than an error.
 */
const seatDriver = async (driverId, vehicleId, seat = null) => {
  if (!driverId) return null;
  const driver = await FleetDriver.findById(driverId);
  if (!driver) return null;
  const sameVehicle = String(driver.vehicle || '') === String(vehicleId || '');
  const want = seat === 1 || seat === 2 ? seat : null;
  if (sameVehicle && (!want || driver.seat === want)) return { driver, moved: null };
  const fromVehicle = driver.vehicle && !sameVehicle
    ? await FleetVehicle.findById(driver.vehicle).select('plate').lean() : null;

  let mates = [];
  if (vehicleId) {
    mates = await FleetDriver
      .find({ vehicle: vehicleId, isActive: { $ne: false }, _id: { $ne: driver._id } })
      .select('seat name').lean();
    if (mates.length >= 2) {
      const veh = await FleetVehicle.findById(vehicleId).select('plate').lean();
      const err = new Error(`السيارة ${veh?.plate || ''} عليها سائقان بالفعل — أنزِل أحدهما أولاً`);
      err.status = 400;
      throw err;
    }
  }

  const taken = new Set(mates.map((m) => m.seat || 1));
  const target = want || (taken.has(1) ? 2 : 1);
  // Rank swap: whoever held the requested seat moves to the other.
  const holder = mates.find((m) => (m.seat || 1) === target);
  if (holder) await FleetDriver.updateOne({ _id: holder._id }, { $set: { seat: target === 1 ? 2 : 1 } });

  const leftBehind = sameVehicle ? null : driver.vehicle;
  driver.vehicle = vehicleId || null;
  // A seat means nothing without a truck, so it returns to first to avoid reading as a false remainder.
  driver.seat = vehicleId ? target : 1;
  await driver.save();
  if (leftBehind) await promoteSeats(leftBehind);
  return {
    driver,
    moved: fromVehicle
      ? `نُقل السائق ${driver.name} من السيارة ${fromVehicle.plate}`
      : (sameVehicle
        ? `صار السائق ${driver.name} السائقَ ${target === 1 ? 'الأول' : 'الثاني'}`
        : `أُسند السائق ${driver.name} سائقًا ${target === 1 ? 'أول' : 'ثانيًا'}`),
  };
};

// Resolve the vehicle + drivers into snapshots on the shipment payload, moving
// drivers as needed. Shared by create and update.
const resolveAssignments = async (req, data, existing = null) => {
  const notes = [];
  if (data.vehicle !== undefined) {
    // Make and colour in the snapshot come from the vehicle register: what prints today is what the register holds.
    const veh = data.vehicle ? await FI.vehicleIdentity(await FleetVehicle.findById(data.vehicle).lean()) : null;
    data.vehiclePlate = veh?.plate || '';
    data.trailerType = veh?.trailerType || '';
    data.gpsType = veh?.gpsType || '';
    data.vehicleBrand = veh?.brand || '';
    data.vehicleColor = veh?.color || '';
    // The load's supervisor is the one assigned to the vehicle itself (distribution system), so the load appears within its supervisor's scope in lists, dashboard and analytics.
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
    // The slot rank in the model is the seat rank on the truck: whoever is chosen as the load's primary driver is the first driver on it, or the two screens would disagree.
    const seated = await seatDriver(data[key], vehicleId, key === 'driver' ? 1 : 2);
    if (seated?.moved) notes.push(seated.moved);
    if (seated?.driver) {
      // His name, mobile, residence and nationality come from his HR file when linked.
      seated.driver = await FI.driverIdentity(seated.driver);
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

// Time period: one reference for all section pages. Each screen used to compute its own range, so the same question gave different numbers; the UI now sends the period name (preset), not boundaries.
// Boundaries are Riyadh time, not UTC: `new Date('2026-08-25')` is UTC midnight (shifts the day by three hours) and without a zone it is read in server time, which is GMT here. The server runs on GMT, so `new Date(y, m, d)` is 3 am Riyadh and loads between 12 and 3 am landed in the previous day.
// Every boundary is built from a "YYYY-MM-DD" Riyadh day key, then startOfDay.
const _keyShift = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const _monthKeyShift = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const _day = (ymd) => startOfDay(ymd);
const _month = (ym) => startOfDay(`${ym}-01`);
const _dayStart = (s) => startOfDay(String(s).slice(0, 10));

const PERIOD_PRESETS = [
  'today', 'yesterday', 'last_7', 'this_month', 'last_month',
  'tomorrow', 'next_7', 'next_30', 'day', 'range', 'all',
];

// (preset | month=YYYY-MM | day=YYYY-MM-DD | from/to) -> { start, end, preset }.
// `end` is always exclusive (`$lt`), so callers need not remember to add a day.
const resolvePeriod = (query = {}) => {
  const { preset, from, to, day, month } = query;
  const tk = todayKey();
  const tm = tk.slice(0, 7);
  const today = _day(tk);
  const at = (n) => _day(_keyShift(tk, n));
  const out = (start, end, key) => ({ start, end, preset: key });

  switch (preset) {
    case 'today': return out(today, at(1), 'today');
    case 'yesterday': return out(at(-1), today, 'yesterday');
    case 'last_7': return out(at(-6), at(1), 'last_7');
    case 'this_month': return out(_month(tm), _month(_monthKeyShift(tm, 1)), 'this_month');
    case 'last_month': return out(_month(_monthKeyShift(tm, -1)), _month(tm), 'last_month');
    // Future periods serve only the expected-arrival screen: what arrives tomorrow?
    case 'tomorrow': return out(at(1), at(2), 'tomorrow');
    case 'next_7': return out(today, at(7), 'next_7');
    case 'next_30': return out(today, at(30), 'next_30');
    // All: an explicit way out of every range. Its existence prevents the question of why everything is zero.
    case 'all': return out(new Date(0), new Date(8640000000000000), 'all');
    default: break;
  }
  if (day && /^\d{4}-\d{2}-\d{2}/.test(day)) return out(_dayStart(day), _day(_keyShift(String(day).slice(0, 10), 1)), 'day');
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    return out(_month(month), _month(_monthKeyShift(month, 1)), 'month');
  }
  if (from || to) {
    return out(
      from ? _dayStart(from) : new Date(0),
      to ? _day(_keyShift(String(to).slice(0, 10), 1)) : at(1),
      'range',
    );
  }
  // Default: the current month. The value is returned in the response (`period.preset`) so the UI shows it explicitly, and the user does not hunt for a load outside the month unaware.
  return out(_month(tm), _month(_monthKeyShift(tm, 1)), 'this_month');
};

// The load's effective date is the loading date, else the creation date. Every count in the section measures on this date alone, or the list would differ from analytics.
const effectiveDateMatch = (start, end) => ({
  $or: [
    { loadDate: { $gte: start, $lt: end } },
    { $and: [{ loadDate: null }, { createdAt: { $gte: start, $lt: end } }] },
  ],
});

// The same meaning inside aggregation pipelines: used in `$group` and `$sort` on the server.
const EFFECTIVE_DATE_EXPR = { $ifNull: ['$loadDate', '$createdAt'] };

/** A single id from text; see `_oids` for why it is needed. */
const _oid = (v) => (mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : v);

// ── Shipments ───────────────────────────────────────────────────────────────

/**
 * Excel-style column filters on the loads list: `cf_<field>` repeated per chosen value; '' means empty.
 * Day columns compare by the Riyadh day, money and flags by their stored value.
 */
const LOAD_FILTER_FIELDS = {
  waybillNumber: 'num', customerName: 'text', fromCity: 'text', toCity: 'text', branch: 'text',
  vehiclePlate: 'text', trailerType: 'text', vehicleBrand: 'text', vehicleColor: 'text',
  driverName: 'text', secondDriverName: 'text', driverNationality: 'text',
  paymentSubtype: 'text', customerType: 'text', loadType: 'text', status: 'text', supervisorName: 'text', blNumber: 'text', containerNumber: 'text',
  price: 'num', fullRent: 'num', driverExpense: 'num', fridayBonus: 'bool', driverExpensePaid: 'bool',
  loadDate: 'day', expectedArrival: 'day', createdAt: 'day',
};
const RIYADH_DAY = (f) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${f}`, timezone: 'Asia/Riyadh' } });
const valuesOf = (q, field) => {
  const v = q[`cf_${field}`];
  return v === undefined ? null : (Array.isArray(v) ? v : [v]).map((x) => String(x));
};
function columnClauses(q, skipField) {
  const out = [];
  for (const [f, kind] of Object.entries(LOAD_FILTER_FIELDS)) {
    if (f === skipField) continue;
    const vals = valuesOf(q, f);
    if (!vals) continue;
    const blank = vals.includes('');
    const rest = vals.filter((x) => x !== '');
    const or = [];
    if (blank) or.push({ [f]: { $in: [null, ''] } }, { [f]: { $exists: false } });
    if (rest.length) {
      if (kind === 'num') or.push({ [f]: { $in: rest.map(Number).filter(Number.isFinite) } });
      else if (kind === 'bool') or.push({ [f]: { $in: rest.map((x) => x === 'true') } });
      else if (kind === 'day') or.push({ $expr: { $in: [RIYADH_DAY(f), rest] } });
      else or.push({ [f]: { $in: rest } });
    }
    out.push(or.length ? { $or: or } : { _id: null });
  }
  return out;
}

exports.listShipments = async (req, res) => {
  try {
    const { q, status, supervisor, customer, vehicle, toCity, preset, from, to, day, month, page = 1, limit = 25 } = req.query;
    // Shared conditions are built separately from status and destination, because the destinations strip below answers another question: how many vehicles are heading to Jeddah within the same filter but without restricting destination or status, or the strip would count only what the user already filtered by.
    const base = [];
    // Ids, not strings: `base` is passed to `aggregate` (status counter and destination strip), not only to `find`, and `aggregate` does not cast strings to ids. A supervisor or customer filter used to show the rows and zero the cards above them.
    if (supervisor) base.push({ supervisor: _oid(supervisor) });
    if (customer) base.push({ customer: _oid(customer) });
    if (vehicle) base.push({ vehicle: _oid(vehicle) });
    if (req.query.excludeCancelled === '1') base.push({ status: { $ne: 'cancelled' } });
    const scope = await supervisorVehicleIds(req);
    if (scope) base.push({ vehicle: { $in: scope } });
    // Date range: requested by period name (today/yesterday/this month...) or an explicit range, and measured only on the load's effective date. It used to measure on creation date alone, so a load recorded yesterday for today's loading was missing from today's loads. No parameters at all means unrestricted here, not the current month: this is a browsable list.
    const periodAsked = !!(preset || from || to || day || month);
    const period = periodAsked ? resolvePeriod({ preset, from, to, day, month }) : null;
    if (period && period.preset !== 'all') base.push(effectiveDateMatch(period.start, period.end));
    if (q && q.trim()) {
      const r = arRx(q);
      const or = [
        { customerName: r }, { driverName: r }, { secondDriverName: r },
        { vehiclePlate: r }, { fromCity: r }, { toCity: r }, { supervisorName: r }, { blNumber: r }, { containerNumber: r },
      ];
      const n = Number(String(q).trim());
      if (Number.isFinite(n)) or.push({ waybillNumber: n });
      base.push({ $or: or });
    }
    const narrow = [];
    // One status or several
    // The cards on top group statuses (in progress is three statuses, arrived/complete is four). The filter used to accept a single one, so the card could not open onto its rows: it was read and led nowhere.
    if (status) {
      const keys = String(status).split(',').map((x) => x.trim()).filter(Boolean);
      if (keys.length === 1) narrow.push({ status: keys[0] });
      else if (keys.length) narrow.push({ status: { $in: keys } });
    }
    if (toCity) narrow.push({ toCity });
    base.push(...columnClauses(req.query));
    const all = [...base, ...narrow];
    const filter = all.length ? { $and: all } : {};

    const skip = (parseInt(page) - 1) * parseInt(limit);
    // Destinations of the loads currently in motion, under the same filter (minus the status/city drill-down itself).
    const destMatch = { $and: [...base, { status: { $in: ['requesting', 'loading', 'uploaded', 'on_way', 'late'] } }] };
    const [shipments, total, statusAgg, destAgg] = await Promise.all([
      FleetShipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      FleetShipment.countDocuments(filter),
      // The status counter is computed without restricting the status itself, or the top cards would zero every status except the chosen one; their purpose is to show the distribution so one can move between them.
      FleetShipment.aggregate([
        { $match: (() => { const c = [...base, ...(toCity ? [{ toCity }] : [])]; return c.length ? { $and: c } : {}; })() },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      FleetShipment.aggregate([
        { $match: destMatch },
        { $group: { _id: '$toCity', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);
    // Enrich the waybill with driver data (residence/mobile) from the driver record: these fields are not stored on the shipment itself but the waybill needs them, so they came out empty.
    const driverIds = [...new Set(shipments.map((s) => s.driver).filter(Boolean).map(String))];
    if (driverIds.length) {
      const drivers = await FleetDriver.find({ _id: { $in: driverIds } }).select('name iqama phone nationality employee').lean()
        .then(FI.decorateDrivers);
      const dmap = new Map(drivers.map((d) => [String(d._id), d]));
      for (const s of shipments) {
        const d = s.driver ? dmap.get(String(s.driver)) : null;
        if (d) {
          s.driverIqama = d.iqama || s.driverIqama || '';
          s.driverNationality = d.nationality || s.driverNationality || '';
          s.driverPhone = d.phone || s.driverPhone || '';
          s.driverName = d.name || s.driverName || '';
        }
      }
    }
    const vehIds = [...new Set(shipments.filter((s) => !s.vehicleBrand && !s.vehicleColor).map((s) => s.vehicle).filter(Boolean).map(String))];
    if (vehIds.length) {
      const vehs = await FleetVehicle.find({ _id: { $in: vehIds } }).select('brand color vehicleMaster').lean()
        .then(FI.decorateVehicles);
      const vmap = new Map(vehs.map((v) => [String(v._id), v]));
      for (const s of shipments) {
        const v = s.vehicle ? vmap.get(String(s.vehicle)) : null;
        if (v) { if (!s.vehicleBrand) s.vehicleBrand = v.brand || ''; if (!s.vehicleColor) s.vehicleColor = v.color || ''; }
      }
    }
    const byStatus = {};
    statusAgg.forEach((r) => { byStatus[r._id] = r.n; });
    const byDestination = destAgg.filter((r) => r._id).map((r) => ({ city: r._id, n: r.n }));
    // The period is returned as the server understood it, so the UI shows it explicitly instead of the user looking for a load outside the range unaware that a range exists.
    res.json({ shipments, total, period, stats: { byStatus, byDestination } });
  } catch (error) {
    console.error('Error listing fleet shipments:', error);
    res.status(500).json({ message: 'Failed to load fleet shipments' });
  }
};

// GET /shipments/filters?field=… — one column's values with counts, under every other filter on the list.
exports.shipmentFilterValues = async (req, res) => {
  try {
    const field = String(req.query.field || '');
    const kind = LOAD_FILTER_FIELDS[field];
    if (!kind) return res.status(400).json({ message: 'Unknown filter column' });
    const { q, status, supervisor, customer, toCity, preset, from, to, day, month } = req.query;
    const base = [];
    if (supervisor) base.push({ supervisor: _oid(supervisor) });
    if (customer) base.push({ customer: _oid(customer) });
    if (req.query.excludeCancelled === '1') base.push({ status: { $ne: 'cancelled' } });
    const scope = await supervisorVehicleIds(req);
    if (scope) base.push({ vehicle: { $in: scope } });
    if (preset || from || to || day || month) {
      const period = resolvePeriod({ preset, from, to, day, month });
      if (period && period.preset !== 'all') base.push(effectiveDateMatch(period.start, period.end));
    }
    if (q && q.trim()) {
      const r = arRx(q);
      // The list's own search fields, B/L and container included, or a column's values would not match the rows shown.
      const or = [{ customerName: r }, { driverName: r }, { secondDriverName: r }, { vehiclePlate: r }, { fromCity: r }, { toCity: r }, { supervisorName: r }, { blNumber: r }, { containerNumber: r }];
      const n = Number(String(q).trim());
      if (Number.isFinite(n)) or.push({ waybillNumber: n });
      base.push({ $or: or });
    }
    if (status && field !== 'status') {
      const keys = String(status).split(',').map((x) => x.trim()).filter(Boolean);
      if (keys.length) base.push({ status: { $in: keys } });
    }
    if (toCity && field !== 'toCity') base.push({ toCity });
    base.push(...columnClauses(req.query, field));
    const key = kind === 'day' ? RIYADH_DAY(field) : { $ifNull: [`$${field}`, ''] };
    const rows = await FleetShipment.aggregate([
      ...(base.length ? [{ $match: { $and: base } }] : []),
      { $group: { _id: key, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1000 },
    ]);
    const needle = String(req.query.q2 || req.query.search || '').trim();
    const values = rows.map((r) => ({ value: r._id == null ? '' : String(r._id), count: r.count }))
      .filter((v) => !needle || v.value.includes(needle));
    res.json({ filters: [{ key: field, values, truncated: rows.length >= 1000, distinct: values.length }] });
  } catch (error) {
    console.error('fleet filter values:', error);
    res.status(500).json({ message: 'تعذّر تحميل قيم الفلتر' });
  }
};

exports.createShipment = async (req, res) => {
  try {
    const data = pick(req.body, SHIPMENT_EDITABLE);

    if (!data.customer && req.body.newCustomer && String(req.body.newCustomer.name || '').trim()) {
      const nm = String(req.body.newCustomer.name).trim();
      const existing = await FleetCustomer.findOne({ nameKey: nameKey(nm) }).select('_id').lean();
      const c = existing || await createSharedCustomer({ name: nm, phone: String(req.body.newCustomer.phone || '').trim(), createdBy: req.user._id, ...(await linkCrm({ name: nm })) });
      data.customer = c._id;
      emit('fleet:customers', {});
    }
    if (data.customer) {
      const c = await FleetCustomer.findById(data.customer).select('name customerType paymentType').lean();
      if (c) {
        data.customerName = c.name;
        // Snapshot of the customer type on the load if not set explicitly (for reports).
        if (!data.customerType && c.customerType) data.customerType = c.customerType;
        // The payment type agreed with the customer is filled automatically, and what the UI sent always wins: the agreement is a default for a new load, not a constraint on this load.
        if (!data.paymentType && c.paymentType) data.paymentType = c.paymentType;
        if (!data.paymentSubtype && c.paymentType) data.paymentSubtype = subtypeOfCustomer(c.paymentType);
      }
    }
    applyPaymentSubtype(data);

    // Friday bonus: the settings amount is added to the driver's expense once, at creation.
    await applyFridayBonus(data);

    const moveNotes = await resolveAssignments(req, data);

    // No maintenance block before loading
    // A truck overdue for maintenance used to be blocked from loading until the maintenance manager approved it in fleet requests. The block was lifted on request: loading proceeds as before, and the red badge on the truck card and the maintenance reports remain, informing without blocking.

    // Supervisor: comes from the assigned vehicle (resolveAssignments above); if the vehicle has none yet, the load creator is stamped.
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
          message: `أمر نقل ${shipment.waybillNumber} — ${shipment.fromCity || ''} ← ${shipment.toCity || ''}`,
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
    sendMongooseError(res, error, 'Failed to create the shipment');
  }
};

exports.updateShipment = async (req, res) => {
  try {
    const shipment = await FleetShipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const data = pick(req.body, SHIPMENT_EDITABLE);
    applyPaymentSubtype(data);

    // The load price is the selling price of its workflow row; from these roles it goes to approval (config/sellingPriceRequests).
    let sellingRequest = null;
    // A branch customer's load, or one carrying a shipment order, prices what the company pays its fleet (a purchase), not a sale: no selling-price approval.
    const purchaseSide = shipment.shipmentOrder || (data.customerType || shipment.customerType) === 'branch';
    if (!purchaseSide && data.price !== undefined && require('../config/sellingPriceRequests').sellingByRequest(req.user)) {
      const v = data.price === '' || data.price === null ? 0 : Number(data.price);
      if (Math.round(v * 100) !== Math.round((Number(shipment.price) || 0) * 100)) {
        const link = require('../services/shipmentOrderWorkflowLink');
        await link.mirrorFleet(shipment._id);
        const row = await require('../models/OperationsWorkflow').findOne({ fleetShipment: shipment._id }).lean();
        if (!row) return res.status(409).json({ message: 'لا يوجد سطر في سير العمل لهذه الحمولة بعد — أعد المحاولة بعد قليل.' });
        const r = await require('../services/sellingPriceRequests').createRequest({ workflow: row, origin: 'workflow', raw: data.price, user: req.user });
        if (r.error) return res.status(r.error.status).json(r.error.body);
        sellingRequest = r.request || null;
      }
      delete data.price;
    }

    // An edit can switch the load to a first-time customer, exactly like create.
    if (!data.customer && req.body.newCustomer && String(req.body.newCustomer.name || '').trim()) {
      const nm = String(req.body.newCustomer.name).trim();
      const existing = await FleetCustomer.findOne({ nameKey: nameKey(nm) }).select('_id').lean();
      const c = existing || await createSharedCustomer({ name: nm, phone: String(req.body.newCustomer.phone || '').trim(), createdBy: req.user._id, ...(await linkCrm({ name: nm })) });
      data.customer = c._id;
      emit('fleet:customers', {});
    }
    if (data.customer && String(data.customer) !== String(shipment.customer)) {
      const c = await FleetCustomer.findById(data.customer).select('name').lean();
      if (c) data.customerName = c.name;
    }

    // No maintenance guard on truck swap either: the block was lifted from both sides together. Keeping it only here would reject a swap while creating on the same truck passes, a contradiction nothing on the screen explains.

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

    // Friday bonus on edit moves the amount as in create
    // Only the flag used to be saved: it wrote the added marker while the driver's expense stayed as is, and removing it left the paid bonus in. The expense shown in the form already includes it.
    if (data.fridayBonus !== undefined && !!data.fridayBonus !== !!shipment.fridayBonus) {
      const cfg = await getFleetConfig();
      const amount = Number(cfg.fridayBonusAmount) || 0;
      const base = Number(data.driverExpense !== undefined ? data.driverExpense : shipment.driverExpense) || 0;
      data.driverExpense = Math.max(0, base + (data.fridayBonus ? amount : -amount));
    }

    const fromStatus = shipment.status;
    const changed = Object.keys(data).filter((k) => String(shipment[k] ?? '') !== String(data[k] ?? ''));
    Object.assign(shipment, data);
    await shipment.save();

    if (changed.length) await logEvent(req, shipment._id, 'updated', { fields: changed });
    if (data.status !== undefined && data.status !== fromStatus) {
      await logEvent(req, shipment._id, 'status', { from: fromStatus, to: shipment.status });
      await notifyStatus(req, shipment, fromStatus);
    }
    for (const line of moveNotes) await logEvent(req, shipment._id, 'driver_change', { text: line });
    if (shipment.shipmentOrder) await require('../services/fleetOrderLink').fleetToOrder(shipment._id, req.user).catch((e) => console.error('[fleet-order-link]', e.message));
    emit('fleet:updated', { id: String(shipment._id) });
    if (sellingRequest) {
      return res.json({ shipment, sellingRequest, sellingRequestMessage: require('../services/sellingPriceRequests').PENDING_MESSAGE });
    }
    res.json({ shipment });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Failed to update the shipment' });
  }
};

// Status change → tell the load's supervisor (unless they made the change).
// From the status button and from the edit form alike.
async function notifyStatus(req, shipment, from) {
  if (!shipment.supervisor || String(shipment.supervisor) === String(req.user._id)) return;
  try {
    await createNotification({
      recipient: shipment.supervisor,
      type: 'status_changed',
      title: 'تغيّرت حالة الشحنة',
      message: `أمر نقل ${shipment.waybillNumber} — ${from} → ${shipment.status}`,
      relatedEntity: 'FleetShipment',
      relatedEntityId: shipment._id,
    });
  } catch (e) { /* the notification is extra; the save already happened */ }
}

exports.patchStatus = async (req, res) => {
  try {
    const shipment = await FleetShipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    const from = shipment.status;
    shipment.status = req.body.status;
    await shipment.save();
    await logEvent(req, shipment._id, 'status', { from, to: shipment.status });
    emit('fleet:updated', { id: String(shipment._id) });
    await notifyStatus(req, shipment, from);
    // A load carrying a shipment order moves the order too (services/fleetOrderLink).
    if (shipment.shipmentOrder) await require('../services/fleetOrderLink').fleetToOrder(shipment._id, req.user).catch((e) => console.error('[fleet-order-link]', e.message));
    res.json({ shipment });
  } catch (error) {
    res.status(400).json({ message: 'Invalid status' });
  }
};


/**
 * What a transport order prints, read at print time: the driver from his HR file when linked
 * (else his fleet record), the truck from the vehicle register, and list keys as names.
 * The stored snapshot is the fallback for anything the records leave empty.
 */
async function waybillReady(shipments, lang = '') {
  const people = shipments.flatMap((s) => [s.driver, s.secondDriver]).filter((d) => d && typeof d === 'object');
  await FI.decorateDrivers(people);
  await FI.decorateVehicles(shipments.map((s) => s.vehicle).filter((v) => v && typeof v === 'object'));
  for (const s of shipments) {
    const d = s.driver && typeof s.driver === 'object' ? s.driver : null;
    if (d) {
      s.driverName = d.name || s.driverName || '';
      s.driverPhone = d.phone || s.driverPhone || '';
      s.driverIqama = d.iqama || s.driverIqama || '';
      s.driverNationality = d.nationality || s.driverNationality || '';
    }
    if (s.secondDriver && typeof s.secondDriver === 'object') s.secondDriverName = s.secondDriver.name || s.secondDriverName || '';
    const v = s.vehicle && typeof s.vehicle === 'object' ? s.vehicle : null;
    if (v) {
      s.vehiclePlate = v.plate || s.vehiclePlate || '';
      s.trailerType = v.trailerType || s.trailerType || '';
      s.vehicleBrand = v.brand || s.vehicleBrand || '';
      s.vehicleColor = v.color || s.vehicleColor || '';
    }
  }
  if (!lang) return shipments;
  const Lookup = require('../models/Lookup');
  const lut = await Lookup.find({ type: { $in: ['fleet_rent_type', 'fleet_payment_type', 'fleet_load_type'] } })
    .select('type key nameAr nameEn').lean();
  const nameOf = (type, key) => {
    if (!key) return '';
    const it = lut.find((x) => x.type === type && x.key === key);
    return it ? (lang === 'en' ? (it.nameEn || it.nameAr) : (it.nameAr || it.nameEn)) : key;
  };
  for (const s of shipments) {
    s.rentType = nameOf('fleet_rent_type', s.rentType);
    s.paymentType = nameOf('fleet_payment_type', s.paymentType);
    s.loadType = nameOf('fleet_load_type', s.loadType);
  }
  return shipments;
}

exports.getShipment = async (req, res) => {
  try {
    const [shipment, events] = await Promise.all([
      FleetShipment.findById(req.params.id)
        .populate('customer', 'name phone routes')
        .populate('vehicle', 'plate trailerType gpsType brand color vehicleMaster')
        .populate('driver secondDriver', 'name phone iqama nationality working onSponsorship employee')
        .lean(),
      FleetEvent.find({ shipment: req.params.id }).sort({ createdAt: -1 }).limit(500).lean(),
    ]);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await waybillReady([shipment]);
    // The customs transaction this load is linked to, read from its workflow row (where the link lives).
    const wf = await require('../models/OperationsWorkflow').findOne({ fleetShipment: shipment._id }).select('customsLink reportNumber').lean();
    shipment.customsLink = require('../services/customsOpsLink').linkView(wf && wf.customsLink);
    res.json({ shipment, events });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the shipment' });
  }
};

// Waybill as PDF: exactly the same file the web produces (Puppeteer, same template, same letterhead) so mobile and site print the same waybill.
/**
 * Waybills of several shipments in one file - POST { ids: [...] }.
 * See renderWaybillsPdf: one call instead of thirty renders in the browser.
 */
exports.getWaybillsPdf = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ message: 'اختر شحنةً واحدةً على الأقلّ' });
    // Upper bound: each waybill is a render in a headless browser, and two hundred would take minutes.
    if (ids.length > 100) return res.status(400).json({ message: 'الحدُّ الأقصى مئةُ أمر نقل في المرّة' });

    const { renderWaybillsPdf, rowFromShipment } = require('../utils/waybillPdf');
    const shipments = await FleetShipment.find({ _id: { $in: ids } })
      .populate('vehicle', 'plate trailerType gpsType brand color vehicleMaster')
      .populate('driver secondDriver', 'name phone iqama nationality employee')
      .lean();
    if (!shipments.length) return res.status(404).json({ message: 'لا شحنات' });

    // Selection order is kept: the file reads in the order they were marked.
    const order = new Map(ids.map((id, i) => [String(id), i]));
    shipments.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

    await waybillReady(shipments, req.query.lang === 'en' ? 'en' : 'ar');
    const pdf = await renderWaybillsPdf(shipments.map(rowFromShipment));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="waybills-${shipments.length}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ message: 'تعذّر إصدارُ أوامر النقل', error: error.message });
  }
};

exports.getWaybillPdf = async (req, res) => {
  try {
    const { renderWaybillPdf, rowFromShipment } = require('../utils/waybillPdf');
    const shipment = await FleetShipment.findById(req.params.id)
      .populate('vehicle', 'plate trailerType gpsType brand color vehicleMaster')
      .populate('driver secondDriver', 'name phone iqama nationality working onSponsorship employee')
      .lean();
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    await waybillReady([shipment], req.query.lang === 'en' ? 'en' : 'ar');
    const pdf = await renderWaybillPdf(rowFromShipment(shipment));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="waybill-${shipment.waybillNumber || shipment._id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('waybill pdf error:', error.message);
    res.status(500).json({ message: 'تعذّر توليد أمر النقل' });
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

// The follow-up call: when we called him, where he is and his status. Appends to the story and refreshes the two list-level fields everyone scans for.
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
    if (shipment.shipmentOrder) await require('../services/fleetOrderLink').followUpToOrder(shipment._id, data, req.user).catch((e) => console.error('[fleet-order-link]', e.message));

    emit('fleet:updated', { id: String(shipment._id) });
    res.status(201).json({ shipment });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record the follow-up' });
  }
};

// ── Drivers ─────────────────────────────────────────────────────────────────

// `monthlyLoadsTarget` and `monthlyKmTarget` are one driver's target; `null` means use the section default, which differs from `0` meaning no target for him.
// `iban` too: driver expenses are transferred to it, and its source is the man's file, not the load row.
const DRIVER_EDITABLE = ['name', 'phone', 'iqama', 'iban', 'working', 'onSponsorship', 'nationality', 'vehicle', 'seat', 'notes', 'isActive', 'offReason', 'offNote', 'monthlyLoadsTarget', 'monthlyKmTarget'];

exports.listDrivers = async (req, res) => {
  try {
    const dFilter = { isActive: { $ne: false } };
    const scope = await supervisorVehicleIds(req);
    // A driver without a vehicle does not leave his supervisor's list. The scope used to be `vehicle: { $in: supervisor's vehicles }`, which never matches a driver with no vehicle, so stepping him down made him vanish and impossible to reassign.
    // Someone without a vehicle is exactly who is looked for at assignment: he is the stock.
    if (scope) {
      dFilter.$or = [
        { vehicle: { $in: scope } },
        { vehicle: null },
        { vehicle: { $exists: false } },
      ];
    }
    const drivers = await FleetDriver.find({ ...dFilter, ...(await noArchDrv()) })
      .populate('vehicle', 'plate trailerType gpsType')
      .sort({ name: 1 })
      .limit(1000)
      .lean();
    // Name, mobile, residence, nationality, IBAN and work status come from his file when linked.
    await FI.decorateDrivers(drivers);
    drivers.forEach((d) => { d.seat = d.vehicle ? (d.seat || 1) : null; });

    // Who shares his truck? Two seats is a section rule (the server blocks a third), but the list showed the vehicle and not with whom.
    // Computed here, not in each UI, so web and mobile read the same field and mobile need not fetch the vehicle register.
    const seats = new Map();
    for (const d of drivers) {
      const vid = d.vehicle && (d.vehicle._id || d.vehicle);
      if (!vid) continue;
      const k = String(vid);
      (seats.get(k) || seats.set(k, []).get(k)).push(d);
    }
    for (const d of drivers) {
      const vid = d.vehicle && (d.vehicle._id || d.vehicle);
      const mates = vid ? (seats.get(String(vid)) || []) : [];
      const other = mates.find((x) => String(x._id) !== String(d._id));
      d.mate = other
        ? {
          _id: other._id, name: other.name || '', phone: other.phone || '',
          working: other.working !== false, seat: other.seat || 1,
        }
        : null;
      d.seatMates = mates.length;
    }
    // His residence and driving licence expiry come from his file (utils/personDocDates).
    const docs = await require('../utils/personDocDates').docDatesFor(drivers.map((d) => ({ idNumber: d.iqama, employee: d.employee })));
    for (const d of drivers) Object.assign(d, docs({ idNumber: d.iqama, employee: d.employee }));
    res.json({ drivers });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load drivers' });
  }
};

/**
 * Linking a driver to his HR file
 * The employee exists, is not archived, and is not another current driver in the fleet. What is in the file is copied into the stored text at link time as a fallback that stays correct if unlinked. Throws an error with a `status` returned to the user as is.
 */
async function attachEmployee(driver, employeeId) {
  const Employee = require('../models/Employee');
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  if (!mongoose.Types.ObjectId.isValid(employeeId)) fail(400, 'معرّف الموظف غير صالح');
  const emp = await Employee.findById(employeeId).select(FI.HR_SELECT).lean();
  if (!emp) fail(404, 'الموظف غير موجود في الموارد البشرية');
  const sets = await endedStaff();
  if (sets.archivedIds.has(String(emp._id))) fail(400, 'هذا الموظف مؤرشف — لا يُربط');
  const other = await FleetDriver.findOne({ employee: emp._id, isActive: { $ne: false }, _id: { $ne: driver._id } })
    .select('name').lean();
  if (other) fail(409, `هذا الموظف مربوط بالسائق «${other.name}» — افكك ربطه أولاً`);
  driver.employee = emp._id;
  const name = FI.hrName(emp);
  if (name) driver.name = name;
  if (emp.phone) driver.phone = emp.phone;
  if (FI.hrIdNumber(emp)) driver.iqama = FI.hrIdNumber(emp);
  if (emp.nationality) driver.nationality = emp.nationality;
  if (emp.iban) driver.iban = emp.iban;
  return emp;
}

exports.createDriver = async (req, res) => {
  try {
    const employeeId = req.body.employee || null;
    if (!employeeId && (!req.body.name || !String(req.body.name).trim())) return res.status(400).json({ message: 'Driver name is required' });
    const data = pick(req.body, DRIVER_EDITABLE);
    const vehicleId = data.vehicle;
    const seat = Number(data.seat) || null;
    delete data.vehicle;
    delete data.seat;
    const driver = new FleetDriver({ name: '—', ...data });
    // Someone whose ID number is written but whose file was not chosen is linked to the file carrying that number, if exactly one and not linked to another driver.
    let link = employeeId;
    if (!link && data.iqama) {
      const hit = await FI.employeeByIdNumber(data.iqama);
      if (hit && !(await FleetDriver.exists({ employee: hit._id, isActive: { $ne: false } }))) link = hit._id;
    }
    if (link) await attachEmployee(driver, link);
    await driver.save();
    if (vehicleId) await seatDriver(driver._id, vehicleId, seat);
    emit('fleet:drivers', {});
    res.status(201).json({ driver });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Failed to create the driver' });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const driver = await FleetDriver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    const data = pick(req.body, DRIVER_EDITABLE);
    // Linked to his file: what is edited here is written to the file too
    // These five fields used to be silently dropped from the request with a saved response, and the list reads from HR, so the fleet manager saw his edit not take. Now the edit is written to the file itself (so the two copies stay one) and recorded as made from fleet.
    let hrWritten = null;
    if (driver.employee) {
      const Employee = require('../models/Employee');
      const emp = await Employee.findById(driver.employee).select('arabicName firstName lastName phone nationality iban idType iqamaNumber nationalId employmentStatus').lean();
      if (emp) {
        const S2 = (v) => String(v == null ? '' : v).trim();
        const hrSet = {};
        if (data.name !== undefined && S2(data.name) && S2(data.name) !== S2(emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`)) hrSet.arabicName = S2(data.name);
        if (data.phone !== undefined && S2(data.phone) !== S2(emp.phone)) hrSet.phone = S2(data.phone);
        if (data.nationality !== undefined && S2(data.nationality) !== S2(emp.nationality)) hrSet.nationality = S2(data.nationality);
        if (data.iban !== undefined && S2(data.iban) !== S2(emp.iban)) hrSet.iban = S2(data.iban);
        if (data.iqama !== undefined && S2(data.iqama)) {
          const col = emp.idType === 'national_id' ? 'nationalId' : 'iqamaNumber';
          if (S2(data.iqama) !== S2(emp[col])) hrSet[col] = S2(data.iqama);
        }
        if (Object.keys(hrSet).length) {
          await Employee.findByIdAndUpdate(emp._id, { $set: hrSet }, { runValidators: true });
          hrWritten = hrSet;
          try { emitToAll('hr:employee', { id: String(emp._id) }); emitToAll('hr:master', { at: Date.now() }); } catch (_) { /* */ }
        }
        // Work status: termination, suspension and approved leave are decided by HR. This is stated explicitly instead of a saved with no effect.
        if (data.working === true && ['terminated', 'suspended', 'on_leave'].includes(emp.employmentStatus)) {
          return res.status(409).json({
            code: 'HR_OWNS_STATUS',
            message: `حالة هذا السائق من الموارد البشرية (${emp.employmentStatus === 'terminated' ? 'انتهت خدمته' : emp.employmentStatus === 'suspended' ? 'موقوف' : 'في إجازة'}) — تُعدَّل من ملفّه هناك`,
          });
        }
      }
    }
    // Vehicle moves go through the two-seat rule, not a raw write.
    if (data.vehicle !== undefined || data.seat !== undefined) {
      const toVehicle = data.vehicle !== undefined ? (data.vehicle || null) : driver.vehicle;
      await seatDriver(driver._id, toVehicle, Number(data.seat) || null);
      delete data.vehicle;
      delete data.seat;
    }
    // Reason and availability move together: naming a reason means he is off;
    // marking him working again clears the reason.
    if (data.offReason) data.working = false;
    if (data.working === true) { data.offReason = ''; data.offNote = ''; }
    Object.assign(driver, data);
    await driver.save();
    emit('fleet:drivers', {});
    if (hrWritten) {
      logAudit({ user: req.user, action: 'update_from_fleet', entity: 'Employee', entityId: driver.employee, changes: { after: hrWritten, details: 'تعديل من صفحة سائقي الأسطول' }, ipAddress: req.ip }).catch(() => {});
    }
    // The row as the list shows it (with its file data) so the screen updates from the same response.
    const view = driver.toObject();
    await FI.decorateDrivers([view]);
    res.json({ driver: view, hrUpdated: !!hrWritten });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Failed to update the driver' });
  }
};

/**
 * PATCH /api/fleet/drivers/:id/employee  { employee: id | null }
 * Link to employee: links the driver to his HR file or unlinks.
 */
exports.setDriverEmployee = async (req, res) => {
  try {
    const driver = await FleetDriver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    const before = driver.employee ? String(driver.employee) : '';
    const target = req.body?.employee || null;
    if (target) await attachEmployee(driver, target);
    else driver.employee = null;
    await driver.save();
    emit('fleet:drivers', {});
    emit('fleet:vehicles', {});
    await logAudit({
      user: req.user, action: target ? 'link_employee' : 'unlink_employee', entity: 'FleetDriver', entityId: driver._id,
      changes: { employee: { from: before || null, to: target ? String(target) : null } }, ipAddress: req.ip,
    });
    const [row] = await FI.decorateDrivers([driver.toObject()]);
    res.json({ driver: row });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: 'هذا الموظف مربوط بسائق آخر' });
    res.status(500).json({ message: 'Failed to link the driver' });
  }
};

/**
 * GET /api/fleet/drivers/hr-candidates?driver=<id>&q=
 * Candidates for link to employee: heavy transport and fleet management employees first, ordered by name closeness to the written driver name, with ID-number matches at the top. With search (`q`) the whole file is searched by name, ID number or employee number.
 */
exports.driverHrCandidates = async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const Lookup = require('../models/Lookup');
    const { NOT_ARCHIVED } = require('../utils/hrEngagement');
    const { arabicSearchRegex, westernDigits } = require('../utils/arabicSearch');
    const driver = mongoose.Types.ObjectId.isValid(req.query.driver)
      ? await FleetDriver.findById(req.query.driver).select('name iqama employee').lean() : null;
    const q = String(req.query.q || '').trim();

    const deps = (await Lookup.find({ type: 'hr_department', key: { $in: ['heavy_transport', 'fleet'] }, deleted: { $ne: true } })
      .select('nameAr').lean()).map((r) => String(r.nameAr || '').trim()).filter(Boolean);
    if (!deps.length) deps.push('النقل الثقيل', 'إدارة الأسطول');

    let filter;
    if (q) {
      const rx = arabicSearchRegex(q);
      const digits = westernDigits(q).replace(/\s+/g, '');
      filter = { $or: [
        { firstName: rx }, { lastName: rx }, { arabicName: rx }, { employeeNumber: rx },
        ...(digits ? [{ iqamaNumber: digits }, { nationalId: digits }] : []),
      ] };
    } else {
      filter = { department: { $in: deps } };
    }
    const rows = await Employee.find({ $and: [filter, NOT_ARCHIVED] }).select(FI.HR_SELECT).limit(q ? 60 : 400).lean();
    // Someone with the ID number written on the driver is included even from another department.
    if (driver?.iqama) {
      const hit = await Employee.find({ $and: [{ $or: [{ iqamaNumber: driver.iqama }, { nationalId: driver.iqama }] }, NOT_ARCHIVED] })
        .select(FI.HR_SELECT).lean();
      for (const h of hit) if (!rows.some((r) => String(r._id) === String(h._id))) rows.push(h);
    }
    const taken = await FleetDriver.find({ employee: { $in: rows.map((r) => r._id) }, isActive: { $ne: false } })
      .select('name employee').lean();
    const takenBy = new Map(taken.map((t) => [String(t.employee), t]));

    const tokens = (s) => String(s || '').split(/\s+/).map(nameKey).filter((t) => t.length > 1);
    const want = tokens(driver?.name);
    const out = rows.map((e) => {
      const name = FI.hrName(e);
      const have = new Set(tokens(name));
      let score = want.filter((t) => have.has(t)).length * 10;
      if (driver?.iqama && FI.hrIdNumber(e) === String(driver.iqama).trim()) score += 100;
      if (deps.includes(String(e.department || '').trim())) score += 3;
      if (/سائق/.test(String(e.staffCategory || '') + String(e.jobTitle || ''))) score += 2;
      if (e.employmentStatus === 'terminated') score -= 20;
      const t = takenBy.get(String(e._id));
      const mine = t && driver && String(t._id) === String(driver._id);
      return {
        _id: e._id, name, idNumber: FI.hrIdNumber(e), employeeNumber: e.employeeNumber || '',
        department: e.department || '', jobTitle: e.jobTitle || '', phone: e.phone || '',
        nationality: e.nationality || '', employmentStatus: e.employmentStatus || 'active',
        linkedTo: t && !mine ? { _id: t._id, name: t.name } : null,
        score,
      };
    }).sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name, 'ar')).slice(0, 50);
    res.json({ candidates: out, departments: deps });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load HR candidates' });
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const before = await FleetDriver.findById(req.params.id).select('vehicle').lean();
    const driver = await FleetDriver.findByIdAndUpdate(
      req.params.id, { isActive: false, vehicle: null, seat: 1 }, { new: true },
    );
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    // His previous truck does not keep a second driver without a first.
    if (before?.vehicle) await promoteSeats(before.vehicle);
    emit('fleet:drivers', {});
    emit('fleet:vehicles', {});
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
      // Identity and documents come from the vehicle register and the driver from his file; see utils/fleetIdentity.
      FleetVehicle.find(vFilter).sort({ plate: 1 }).limit(500).lean().then(FI.decorateVehicles),
      FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null }, ...(await noArchDrv()) })
        .select('name phone working vehicle seat employee iqama offReason').sort({ seat: 1, name: 1 }).lean()
        .then(FI.decorateDrivers),
    ]);
    // Order is rank
    // `drivers[0]` is read in three screens as the first driver, and the shipment model seats him in the primary driver slot. Sorting by seat is a requirement, not cosmetics.
    const byVehicle = {};
    drivers.forEach((d) => {
      const k = String(d.vehicle);
      (byVehicle[k] = byVehicle[k] || []).push({
        _id: d._id, name: d.name, phone: d.phone, working: d.working, seat: d.seat || 1,
        hrLinked: !!d.hrLinked, offSource: d.offSource || '',
      });
    });
    Object.values(byVehicle).forEach((list) => list.sort((a, b) => a.seat - b.seat));

    // What the dispatcher needs while picking a truck: where it is right now (live GPS to city), what it is already carrying, and whether it entered its destination's zone. Only in-flight statuses make a truck busy here: a load marked arrived or waybill sent is done dispatch-wise; the truck is free for the next trip and must not keep its old destination.
    const PICKER_BUSY = ['requesting', 'loading', 'uploaded', 'on_way', 'late'];
    const [ls2, trips] = await Promise.all([
      // Maintenance status is read with location in the same call: the decision of which truck to load needs both, and a truck overdue for maintenance is shipped today and stops on the road tomorrow.
      Ls2Vehicle.find({}).select('plate name unitId position status lastMessageAt maintenanceStatus kmToService nextServiceName').lean(),
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
          maintenance: lv ? {
            status: lv.maintenanceStatus || 'ok',
            kmToService: lv.kmToService ?? null,
            nextServiceName: lv.nextServiceName || '',
            // The vehicle page in the Location Solutions platform is addressed by unit number.
            unitId: lv.unitId ?? null,
          } : null,
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

/**
 * Make and colour are written to the vehicle register
 * Once the truck is linked to the register, editing its identity from fleet is an edit to the register itself, through the model (`findByIdAndUpdate`) so its hooks run, then announced like the vehicles section. So two diverging copies do not remain.
 */
async function writeRegistryIdentity(vmId, body) {
  const set = {};
  if (body.brand !== undefined) set.brandAr = String(body.brand || '').trim();
  if (body.color !== undefined) set.colorAr = String(body.color || '').trim();
  if (!Object.keys(set).length) return false;
  const { VehicleMaster } = require('../models/VehicleMaster');
  const before = await VehicleMaster.findById(vmId).select('brandAr colorAr').lean();
  if (!before) return false;
  Object.keys(set).forEach((k) => { if (String(before[k] || '') === set[k]) delete set[k]; });
  if (!Object.keys(set).length) return false;
  await VehicleMaster.findByIdAndUpdate(vmId, { $set: set }, { new: true });
  FI.announceRegistry();
  return true;
}

/** The register vehicle for this plate, resolved by the unified key; if absent it is created there (a truck of ours cannot be outside the vehicle register). */
async function ensureRegistryVehicle(plate, body = {}) {
  const hit = await vehicleRef.resolve(plate);
  if (hit) return { id: hit._id, created: false };
  const { VehicleMaster } = require('../models/VehicleMaster');
  const vm = await VehicleMaster.create({
    plateNumber: plate,
    brandAr: String(body.brand || '').trim(),
    colorAr: String(body.color || '').trim(),
    sectorAr: 'النقل الثقيل',
    sectorCode: 'heavy_transport',
    departmentAr: 'النقل الثقيل',
    notesAr: 'أُضيفت من إدارة الأسطول',
  });
  return { id: vm._id, created: true };
}

exports.createVehicle = async (req, res) => {
  try {
    if (!req.body.plate || !String(req.body.plate).trim()) return res.status(400).json({ message: 'Plate is required' });
    const data = pick(req.body, VEHICLE_EDITABLE);
    // One fleet truck per register vehicle
    // Two spellings of the same plate were two rows for one truck. So the plate is matched by the unified key before create: an existing live one rejects the duplicate, and a removed one is restored instead of a second row being born.
    const key = vehicleRef.canonicalPlateKey(data.plate);
    const same = key ? (await FleetVehicle.find({}).select('plate isActive').lean())
      .find((v) => vehicleRef.canonicalPlateKey(v.plate) === key) : null;
    if (same && same.isActive !== false) {
      return res.status(409).json({ message: `الشاحنة ${same.plate} مسجّلة في الأسطول بالفعل` });
    }
    const reg = await ensureRegistryVehicle(data.plate, data);
    if (!reg.created) await writeRegistryIdentity(reg.id, data);
    else FI.announceRegistry();
    delete data.brand; delete data.color;
    let vehicle;
    if (same) {
      vehicle = await FleetVehicle.findByIdAndUpdate(same._id, { $set: { ...data, plate: same.plate, isActive: true, vehicleMaster: reg.id } }, { new: true });
    } else {
      vehicle = await FleetVehicle.create({ ...data, vehicleMaster: reg.id });
    }
    emit('fleet:vehicles', {});
    res.status(201).json({ vehicle });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'هذه المركبة مسجّلة في الأسطول بالفعل' });
    res.status(500).json({ message: 'Failed to create the vehicle' });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const current = await FleetVehicle.findById(req.params.id).select('plate vehicleMaster').lean();
    if (!current) return res.status(404).json({ message: 'Vehicle not found' });
    const data = pick(req.body, VEHICLE_EDITABLE);
    if (current.vehicleMaster) {
      // The plate is the vehicle's identity in the register: corrected there, not here.
      if (data.plate !== undefined
        && vehicleRef.canonicalPlateKey(data.plate) !== vehicleRef.canonicalPlateKey(current.plate)) {
        return res.status(400).json({ message: 'اللوحة تُعدَّل من سجل المركبات — هذه الشاحنة مربوطة به' });
      }
      delete data.plate;
      await writeRegistryIdentity(current.vehicleMaster, data);
      // The copy on the fleet row follows the register, or the old value returns when the register field is emptied (display reads the register or the fleet copy).
    } else if (data.plate !== undefined) {
      // An unlinked one is linked once its plate is in the register.
      const hit = await vehicleRef.resolve(data.plate);
      if (hit && !(await FleetVehicle.exists({ vehicleMaster: hit._id, _id: { $ne: current._id } }))) data.vehicleMaster = hit._id;
    }
    if (data.vehicleMaster) await writeRegistryIdentity(data.vehicleMaster, data);
    const vehicle = await FleetVehicle.findByIdAndUpdate(req.params.id, data, { new: true });
    emit('fleet:vehicles', {});
    res.json({ vehicle });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'هذه اللوحة مسجّلة لشاحنةٍ أخرى في الأسطول' });
    console.error('fleet updateVehicle:', error.message);
    res.status(500).json({ message: 'Failed to update the vehicle' });
  }
};

/**
 * Truck seats are edited from the truck page: PATCH /api/fleet/vehicles/:id/drivers  { first, second }
 * The supervisor looks at a truck and asks who is on it, so assignment is two fields in a truck row.
 * One call for both seats on purpose: separate writes would collide in a swap (two men in one seat or a truck rejected for already having two).
 * Omitted from a slot means step down: he returns to stock (`vehicle: null`), not deleted and not moved.
 */
exports.setVehicleDrivers = async (req, res) => {
  try {
    const vehicle = await FleetVehicle.findById(req.params.id).select('plate').lean();
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    const idOf = (v) => (v && mongoose.Types.ObjectId.isValid(v) ? String(v) : '');
    const first = idOf(req.body.first);
    const second = idOf(req.body.second);
    if (first && second && first === second) {
      return res.status(400).json({ message: 'لا يكون الرجلُ سائقَ الشاحنة الأولَ والثانيَ معًا' });
    }

    const current = await FleetDriver
      .find({ vehicle: vehicle._id, isActive: { $ne: false } }).select('name seat').lean();
    const keep = new Set([first, second].filter(Boolean));

    // Someone coming from another truck has that truck's seats promoted after him
    // Assigning a second driver is mostly pulling him from someone else's truck. Without promoting that truck's seats, it would keep a second driver with no first.
    const incoming = await FleetDriver
      .find({ _id: { $in: [first, second].filter(Boolean) } }).select('vehicle').lean();
    const vacated = incoming
      .map((d) => d.vehicle).filter((v) => v && String(v) !== String(vehicle._id));

    // 1. Step down those not mentioned, before assigning, or the new one is rejected over the two-seat limit.
    for (const d of current) {
      if (!keep.has(String(d._id))) {
        await FleetDriver.updateOne({ _id: d._id }, { $set: { vehicle: null, seat: 1 } });
      }
    }
    // 2. Clear the affected seats then write them, so the rule never sees two men in one seat and an assignment is not rejected by write order.
    if (first) await FleetDriver.updateOne({ _id: first }, { $set: { vehicle: vehicle._id, seat: 1 } });
    if (second) await FleetDriver.updateOne({ _id: second }, { $set: { vehicle: vehicle._id, seat: 2 } });
    // 3. A second without a first is promoted, here and on every truck a man left.
    await promoteSeats(vehicle._id);
    for (const v of vacated) await promoteSeats(v);

    const seated = await FleetDriver
      .find({ vehicle: vehicle._id, isActive: { $ne: false } })
      .select('name phone working seat').sort({ seat: 1 }).lean();
    emit('fleet:drivers', {});
    emit('fleet:vehicles', {});
    res.json({ plate: vehicle.plate, drivers: seated });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Failed to set the vehicle drivers' });
  }
};

exports.deleteVehicle = async (req, res) => {
  try {
    const vehicle = await FleetVehicle.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    // Its drivers go back to the bench rather than pointing at a ghost.
    await FleetDriver.updateMany({ vehicle: vehicle._id }, { vehicle: null, seat: 1 });
    emit('fleet:vehicles', {});
    res.json({ message: 'Vehicle removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove the vehicle' });
  }
};

// ── Customers ───────────────────────────────────────────────────────────────

const CUSTOMER_EDITABLE = [
  'name', 'phone', 'email', 'customerType', 'rating', 'routes', 'notes', 'isActive',
  'paymentType', 'taxNumber', 'address', 'crmCompany',
];

/** Links the customer to the CRM company by normalized name and stores the key. The two registers were entered each in its own section with no shared id, so the name is the only link; nearly all follow-up sheet customers were found in the CRM this way. The link is not forced: one a user linked manually stays. */
/**
 * A customer added in the fleet joins the shared list: the shipment customer is created first (it is the identity seen in
 * shipment orders, sales and operations), then its fleet row carries the fleet's own fields.
 */
async function createSharedCustomer(body) {
  const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
  const sc = new ShipmentOrderCustomer({ name: body.name, phone: body.phone || '', email: body.email || '', address: body.address || '', crmCompany: body.crmCompany || undefined });
  sc.$locals.skipFleetMirror = true;
  await sc.save();
  const id = await require('../utils/customerSync').mirrorShipmentToFleet(sc.toObject());
  const own = pick(body, ['customerType', 'rating', 'paymentType', 'taxNumber', 'routes', 'notes', 'createdBy']);
  return FleetCustomer.findByIdAndUpdate(id, { $set: own }, { new: true });
}

async function linkCrm(doc) {
  const key = nameKey(doc.name || '');
  const patch = { nameKey: key };
  if (!doc.crmCompany && key) {
    const hit = await CrmCompany.findOne({ $or: [{ name: rx(doc.name) }, { arabicName: rx(doc.name) }] })
      .select('_id name arabicName').lean();
    // rx matches partially, so the normalized key must match exactly before linking.
    if (hit && (nameKey(hit.name) === key || nameKey(hit.arabicName) === key)) patch.crmCompany = hit._id;
  }
  return patch;
}

/**
 * Customer rows enriched with their numbers: one definition the list and the filter panel read from.
 * A table without numbers is an inventory, not analysis, so trips, income and last trip per customer are computed in one aggregation, not a query per row. One source guarantees the count beside a filter option equals what it actually opens.
 */
async function customerRows(req) {
  const customers = await FleetCustomer.find().sort({ name: 1 }).limit(5000).lean();

  const scope = await supervisorVehicleIds(req);
  const match = { customer: { $in: customers.map((c) => c._id) } };
  if (scope) match.vehicle = { $in: scope };
  const agg = await FleetShipment.aggregate([
    { $match: match },
    { $group: {
      _id: '$customer',
      trips: { $sum: 1 },
      income: { $sum: { $ifNull: ['$price', 0] } },
      lastTrip: { $max: { $ifNull: ['$loadDate', '$createdAt'] } },
      firstTrip: { $min: { $ifNull: ['$loadDate', '$createdAt'] } },
      openTrips: { $sum: { $cond: [{ $in: ['$status', ['requesting', 'loading', 'uploaded', 'on_way', 'late']] }, 1, 0] } },
    } },
  ]);
  const stats = new Map(agg.map((a) => [String(a._id), a]));

  // Linked companies are fetched in one batch, no query inside a loop.
  const crmIds = customers.map((c) => c.crmCompany).filter(Boolean);
  const crm = crmIds.length
    ? new Map((await CrmCompany.find({ _id: { $in: crmIds } }).select('name arabicName status rating').lean())
      .map((c) => [String(c._id), c]))
    : new Map();

  return customers.map((c) => {
    const st = stats.get(String(c._id)) || {};
    return {
      ...c,
      trips: st.trips || 0,
      income: st.income || 0,
      openTrips: st.openTrips || 0,
      lastTrip: st.lastTrip || null,
      firstTrip: st.firstTrip || null,
      avgTrip: st.trips ? Math.round((st.income || 0) / st.trips) : 0,
      crm: c.crmCompany ? crm.get(String(c.crmCompany)) || null : null,
    };
  });
}

/** Each filter defined once: its name, its value from the row, and its option ordering. */
const CUSTOMER_FILTERS = [
  { key: 'paymentType', ar: 'نوع الدفع', en: 'Payment type',
    of: (c) => (c.paymentType === 'tax' ? 'ضريبي' : c.paymentType === 'cash' ? 'كاش' : '—') },
  { key: 'customerType', ar: 'فئة العميل', en: 'Customer category',
    of: (c) => (c.customerType === 'heavy' ? 'نقل ثقيل' : c.customerType === 'branch' ? 'فروع' : '—') },
  { key: 'state', ar: 'الحالة', en: 'State', of: (c) => (c.isActive === false ? 'معطَّل' : 'نشط') },
  { key: 'crmLink', ar: 'الربط بالـCRM', en: 'CRM link', of: (c) => (c.crmCompany ? 'مرتبط' : 'غير مرتبط') },
  { key: 'activity', ar: 'الحركة', en: 'Activity',
    of: (c) => (c.openTrips > 0 ? 'له حمولةٌ جارية' : c.trips > 0 ? 'تعامَلنا معه' : 'بلا حمولات') },
  { key: 'routesSet', ar: 'أسعار المسارات', en: 'Route prices',
    of: (c) => ((c.routes || []).length ? 'مسجَّلة' : 'غير مسجَّلة') },
  { key: 'rating', ar: 'التقييم', en: 'Rating', of: (c) => (c.rating ? `${c.rating} ★` : 'بلا تقييم') },
];

/** Applies multi-value filters (values comma separated) and free text search. */
function applyCustomerFilters(rows, query) {
  let out = rows;
  for (const d of CUSTOMER_FILTERS) {
    const raw = query[d.key];
    if (raw == null || raw === '') continue;
    const want = new Set(String(raw).split(',').map((x) => x.trim()).filter(Boolean));
    if (!want.size) continue;
    out = out.filter((c) => want.has(d.of(c)));
  }
  const q = nameKey(query.search || '');
  if (q) {
    out = out.filter((c) => [c.customerCode, c.name, c.phone, c.email, c.taxNumber, c.crm?.name, c.crm?.arabicName]
      .some((v) => nameKey(String(v || '')).includes(q)));
  }
  return out;
}

exports.listCustomers = async (req, res) => {
  try {
    await require('../utils/customerSync').syncAll().catch((e) => console.error('[customerSync]', e.message));
    const rows = await customerRows(req);
    // Default hides disabled ones, unless explicitly requested or filtered by status.
    const all = req.query.includeInactive === '1' || req.query.includeInactive === 'true' || !!req.query.state;
    const base = all ? rows : rows.filter((c) => c.isActive !== false);
    res.json({ customers: applyCustomerFilters(base, req.query), total: base.length });
  } catch (error) {
    console.error('fleet listCustomers error:', error);
    res.status(500).json({ message: 'Failed to load customers' });
  }
};

/** Filter options, each count computed after the other filters, so what you see is what you get and no zero-count option is shown that opens an empty screen. */
exports.customerFilterOptions = async (req, res) => {
  try {
    const rows = await customerRows(req);
    const filters = CUSTOMER_FILTERS.map((d) => {
      const others = { ...req.query };
      delete others[d.key];
      const scoped = applyCustomerFilters(rows, others);
      const counts = new Map();
      for (const c of scoped) { const v = d.of(c); counts.set(v, (counts.get(v) || 0) + 1); }
      return {
        key: d.key, ar: d.ar, en: d.en,
        values: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      };
    }).filter((f) => f.values.length > 1);
    res.json({ filters });
  } catch (error) {
    console.error('fleet customerFilterOptions error:', error);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Customer name is required' });
    // A duplicate name creates two customers for one company, splitting its loads over two files.
    const clash = await FleetCustomer.findOne({ nameKey: nameKey(name) }).select('_id name').lean();
    if (clash) return res.status(400).json({ message: `عميلٌ بهذا الاسم موجود: «${clash.name}»` });

    const body = { ...pick(req.body, CUSTOMER_EDITABLE), name, createdBy: req.user._id };
    Object.assign(body, await linkCrm(body));
    const customer = await createSharedCustomer(body);
    await logAudit({ user: req.user, action: 'create', entity: 'FleetCustomer', entityId: customer._id, changes: { name }, ipAddress: req.ip });
    emit('fleet:customers', {});
    res.status(201).json({ customer });
  } catch (error) {
    console.error('fleet createCustomer error:', error);
    res.status(500).json({ message: 'Failed to create the customer' });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const body = pick(req.body, CUSTOMER_EDITABLE);
    if (body.name !== undefined) {
      body.name = String(body.name).trim();
      if (!body.name) return res.status(400).json({ message: 'Customer name is required' });
      const clash = await FleetCustomer.findOne({ nameKey: nameKey(body.name), _id: { $ne: req.params.id } }).select('name').lean();
      if (clash) return res.status(400).json({ message: `عميلٌ بهذا الاسم موجود: «${clash.name}»` });
      Object.assign(body, await linkCrm({ ...body, crmCompany: req.body.crmCompany }));
    }
    const before = await FleetCustomer.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ message: 'Customer not found' });
    // Identity fields belong to the shared customer: written there and mirrored back, so shipment orders, sales and the CRM see the same.
    const sync = require('../utils/customerSync');
    const shared = await sync.shipmentForFleet(before);
    const idPatch = {};
    for (const k of ['phone', 'email', 'address']) if (body[k] !== undefined) idPatch[k] = String(body[k] || '').trim();
    if (Object.keys(idPatch).length) await require('../models/ShipmentOrderCustomer').findByIdAndUpdate(shared._id, { $set: idPatch });
    if (body.name && body.name !== shared.name) await sync.renameCustomer(shared._id, shared.name, body.name);
    const customer = await FleetCustomer.findByIdAndUpdate(req.params.id, body, { new: true });
    if (body.name) await FleetShipment.updateMany({ customer: customer._id }, { customerName: customer.name });
    await logAudit({ user: req.user, action: 'update', entity: 'FleetCustomer', entityId: customer._id, changes: body, ipAddress: req.ip });
    emit('fleet:customers', {});
    res.json({ customer });
  } catch (error) {
    console.error('fleet updateCustomer error:', error);
    res.status(500).json({ message: 'Failed to update the customer' });
  }
};

/** Removal is deactivation, not deletion: its past loads reference it and deleting leaves dangling files. `?purge=1` is a real delete allowed only when it has no loads at all (a customer entered by mistake), so nothing is orphaned. */
exports.deleteCustomer = async (req, res) => {
  try {
    const purge = req.query.purge === '1' || req.query.purge === 'true';
    const customer = await FleetCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    if (purge) {
      const n = await FleetShipment.countDocuments({ customer: customer._id });
      if (n) return res.status(400).json({ message: `لا يُحذف نهائيًّا: له ${n} حمولة. عطِّله بدل ذلك.` });
      await FleetCustomer.deleteOne({ _id: customer._id });
      await logAudit({ user: req.user, action: 'delete', entity: 'FleetCustomer', entityId: customer._id, changes: { name: customer.name, purge: true }, ipAddress: req.ip });
      emit('fleet:customers', {});
      return res.json({ message: 'Customer deleted' });
    }

    customer.isActive = false;
    await customer.save();
    await logAudit({ user: req.user, action: 'delete', entity: 'FleetCustomer', entityId: customer._id, changes: { name: customer.name }, ipAddress: req.ip });
    emit('fleet:customers', {});
    res.json({ message: 'Customer removed' });
  } catch (error) {
    console.error('fleet deleteCustomer error:', error);
    res.status(500).json({ message: 'Failed to remove the customer' });
  }
};

/** Reactivate a disabled customer, because deactivation is a decision that gets reviewed. */
exports.restoreCustomer = async (req, res) => {
  try {
    const customer = await FleetCustomer.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    emit('fleet:customers', {});
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Failed to restore the customer' });
  }
};

// ── Dashboard ───────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const dayStart = _day(todayKey()); // Riyadh midnight, not GMT
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
      allDrivers, vehicles, followupsToday, needFollowUp, ended,
    ] = await Promise.all([
      FleetShipment.aggregate([{ $match: shipScope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      FleetShipment.countDocuments({ ...shipScope, createdAt: { $gte: dayStart } }),
      FleetShipment.countDocuments({ ...shipScope, createdAt: { $gte: weekStart } }),
      FleetShipment.aggregate([
        { $match: { ...shipScope, createdAt: { $gte: weekStart } } },
        { $group: { _id: '$supervisorName', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      FleetDriver.find({ isActive: { $ne: false }, ...drvScope }).select('working vehicle offReason iqama employee').lean()
        .then(FI.decorateDrivers),
      FleetVehicle.countDocuments({ isActive: { $ne: false }, ...vehScope }),
      FleetEvent.countDocuments({ type: 'followup', createdAt: { $gte: dayStart } }),
      FleetShipment.find({
        ...shipScope,
        status: { $in: IN_FLIGHT },
        $or: [{ lastContactAt: null }, { lastContactAt: { $lt: staleCut } }],
      }).select('waybillNumber customerName driverName vehiclePlate lastContactAt fromCity toCity').sort({ lastContactAt: 1 }).limit(20).lean(),
      endedStaff(),
    ]);
    // Someone whose service HR ended is not counted on the dashboard, neither in drivers nor in vehicle seats. He stays in the list; only the count drops him. A linked person's end is known from his file, others by their written residence number.
    const drivers = allDrivers.filter((d) => !(d.employee ? employeeEnded(ended, d.employee) : idNumberEnded(ended, d.iqama)));

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
    // A truck is identified by its unified key, not its plate text
    // It used to be matched character by character, so when written with a dash in Location Solutions and without here, a second row was born for the same truck at boot.
    const known = new Map();
    for (const f of await FleetVehicle.find({}).select('plate').lean()) {
      const k = canonicalPlateKey(f.plate);
      if (k && !known.has(k)) known.set(k, f._id);
    }
    for (const v of live) {
      const plate = String(v.plate || '').trim() || String(v.name || '').trim();
      if (!plate) continue;
      try {
        const key = canonicalPlateKey(plate);
        let vehId = key ? known.get(key) : null;
        // A Location Solutions driver is copied with his truck only on the day it is born here; afterwards he is linked to his file and his full name is read from HR. Matching on his first name at every boot would create a second row for him.
        const isNew = !vehId;
        if (!vehId) {
          // Upserts, not find-then-create: two processes seeding at once (server
          // boot + a script) raced the find and tripped the unique index.
          // eslint-disable-next-line no-await-in-loop
          const reg = await vehicleRef.resolve(plate);
          // eslint-disable-next-line no-await-in-loop
          await FleetVehicle.updateOne(
            { plate },
            { $setOnInsert: { plate, trailerType: 'سطحة', gpsType: 'LS', notes: 'من لوكيشن سوليوشن', vehicleMaster: reg?._id || null } },
            { upsert: true },
          );
          // eslint-disable-next-line no-await-in-loop
          vehId = (await FleetVehicle.findOne({ plate }).select('_id').lean())?._id || null;
          if (key && vehId) known.set(key, vehId);
        }
        const veh = vehId ? { _id: vehId } : null;
        const driverName = String(v.driver || '').trim();
        if (driverName && veh && isNew) {
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

// Main board: every truck as one card, grouped under its supervisor, coloured by its current trip (late / arrived / moving / preparing / idle) with the Location Solutions maintenance state on each card, so nobody hunts through lists to see who is late or due for service.
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
      FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null }, ...(await noArchDrv()) }).select('name vehicle working employee').lean()
        .then(FI.decorateDrivers),
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
      // Where it is now geographically, and has it already entered its destination zone?
      const liveCity = m?.position ? cityForPoint(m.position.lat, m.position.lng) : null;
      const atDestination = !!(trip && liveCity && !ARRIVED_FAMILY.includes(trip.status) && sameCity(liveCity, trip.toCity));
      // The card's automatic state:
      // late (past expected arrival) > arrived (at unloading site) > moving > preparing (loading/prep) > idle (no load).
      // Arrived is not unloaded: they used to be one state covering `arrived` and `bond_sent`. They are different questions: an arrived truck awaits unloading and is chased, an unloaded one sent its bond and is being prepared for the next load. Merging them hides which needs a call now.
      let state = 'idle';
      if (trip) {
        const lateByTime = trip.expectedArrival
          && new Date(trip.expectedArrival).getTime() < now
          && !ARRIVED_FAMILY.includes(trip.status);
        if (trip.status === 'bond_sent') state = 'unloaded';
        else if (trip.status === 'arrived') state = 'arrived';
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
    // Destination is a filter, not passing news
    // It used to be computed for moving trucks only, missing arrived and unloaded ones. It is now a filter the number cards above are measured on (a city with its count, how many in transit, how many late), so it is computed for every truck with a load to that city.
    const byDestination = {};
    for (const c of cards) {
      if (c.trip && c.trip.toCity) {
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
        unloaded: count('unloaded'),
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

// Supervisor assignment: the people the manager can assign trucks to.
exports.listSupervisors = async (req, res) => {
  try {
    // An archived person is neither picked nor assigned to, as if deleted.
    const archSets = await endedStaff();
    const users = (await User.find({ role: { $in: ['fleet_supervisor', 'fleet_manager'] }, isActive: { $ne: false } })
      .select('firstName lastName email role').lean()).filter((u) => !require('../utils/endedStaff').userArchived(archSets, u));
    users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load supervisors' });
  }
};

// The new supervisor takes over the truck's open loads
// The supervisor is copied onto the load at creation, so moving a truck used to leave its running loads under the old supervisor, in his filters and status notifications. Closed ones (invoiced/cancelled) stay under whoever ran them.
const moveOpenLoads = (vehicleIds, supervisor, supervisorName) => FleetShipment.updateMany(
  { vehicle: { $in: vehicleIds }, status: { $nin: ['invoiced', 'cancelled'] } },
  { $set: { supervisor, supervisorName } },
);

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
    await moveOpenLoads([v._id], v.supervisor, v.supervisorName);
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
    await moveOpenLoads(vehicleIds, supId, supName);
    emit('fleet:vehicles', {});
    emit('fleet:updated', {});
    await logAudit({
      user: req.user, action: 'assign_supervisor_bulk', entity: 'FleetVehicle', entityId: vehicleIds[0],
      changes: { vehicles: r.modifiedCount, supervisorName: supName || null },
      ipAddress: req.ip,
    });
    res.json({ ok: true, modified: r.modifiedCount, supervisorName: supName });
  } catch (error) {
    sendMongooseError(res, error, 'Failed to assign vehicles');
  }
};

// ── Section settings (Friday bonus, default monthly target) ─────────────────
exports.getConfig = async (req, res) => {
  try {
    const cfg = await getFleetConfig();
    res.json({ config: { fridayBonusAmount: cfg.fridayBonusAmount, defaultMonthlyTarget: cfg.defaultMonthlyTarget, targetBasis: cfg.targetBasis, defaultDriverMonthlyLoads: cfg.defaultDriverMonthlyLoads, defaultDriverMonthlyKm: cfg.defaultDriverMonthlyKm } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load fleet settings' });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const cfg = await getFleetConfig();
    if (req.body.fridayBonusAmount != null) cfg.fridayBonusAmount = Number(req.body.fridayBonusAmount) || 0;
    if (req.body.defaultMonthlyTarget != null) cfg.defaultMonthlyTarget = Number(req.body.defaultMonthlyTarget) || 0;
    // Driver target: loads and distance per month; the default for anyone without a specific target.
    if (req.body.defaultDriverMonthlyLoads != null) cfg.defaultDriverMonthlyLoads = Number(req.body.defaultDriverMonthlyLoads) || 0;
    if (req.body.defaultDriverMonthlyKm != null) cfg.defaultDriverMonthlyKm = Number(req.body.defaultDriverMonthlyKm) || 0;
    // A bare amount is incomplete unless it says whether it is income or after driver expense.
    if (req.body.targetBasis === 'gross' || req.body.targetBasis === 'net') cfg.targetBasis = req.body.targetBasis;
    cfg.updatedBy = req.user._id;
    await cfg.save();
    emit('fleet:updated', {});
    res.json({ config: { fridayBonusAmount: cfg.fridayBonusAmount, defaultMonthlyTarget: cfg.defaultMonthlyTarget, targetBasis: cfg.targetBasis, defaultDriverMonthlyLoads: cfg.defaultDriverMonthlyLoads, defaultDriverMonthlyKm: cfg.defaultDriverMonthlyKm } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to save fleet settings' });
  }
};

// ── Rich analytics (income, targets, rankings, trends) with many filters ────
const _multi = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
/**
 * Ids, not strings, because `aggregate` does not cast what `find` casts. The vehicle, customer and supervisor filters arrive from the URL as strings; `find` casts via its schema but `aggregate` passes the match to Mongo as is, so rows showed while totals were zero.
 * A value that is not a valid id stays as is (matches nothing), since forcing a cast would fail the request.
 */
const _oids = (arr) => arr.map((x) => (mongoose.Types.ObjectId.isValid(x) ? new mongoose.Types.ObjectId(x) : x));
// Current month in Riyadh; period boundaries are Riyadh midnight (21:00 GMT of the previous day).
const _monthIndex = (d) => { const [y, m] = dayKeyOf(d).split('-').map(Number); return y * 12 + (m - 1); };

/**
 * Options of each analytics filter with how many loads each value holds under every other filter (its own excluded).
 * Trucks are listed from the register so a truck without loads in the period can still be picked or excluded.
 */
async function analyticsFilterOptions({ buildFilter, searchClause, scope }) {
  const group = (omit, field, labelField) => {
    const and = [...buildFilter(omit), ...(searchClause ? [searchClause] : [])];
    const g = { _id: '$' + field, count: { $sum: 1 } };
    if (labelField) g.label = { $first: '$' + labelField };
    return FleetShipment.aggregate([...(and.length ? [{ $match: { $and: and } }] : []), { $group: g }]);
  };
  const [veh, cust, sup, trailer, ctype, status, register] = await Promise.all([
    group('vehicle', 'vehicle', 'vehiclePlate'),
    group('customer', 'customer', 'customerName'),
    group('supervisor', 'supervisor', 'supervisorName'),
    group('trailerType', 'trailerType'),
    group('customerType', 'customerType'),
    group('status', 'status'),
    FleetVehicle.find({ isActive: { $ne: false }, ...(scope ? { _id: { $in: scope } } : {}) }).select('plate').lean(),
  ]);
  const vCount = new Map(veh.map((r) => [String(r._id), r.count]));
  const inRegister = new Set(register.map((v) => String(v._id)));
  const vehicles = register
    .map((v) => ({ value: String(v._id), label: v.plate, count: vCount.get(String(v._id)) || 0 }))
    .concat(veh.filter((r) => r._id && !inRegister.has(String(r._id)))
      .map((r) => ({ value: String(r._id), label: r.label || String(r._id), count: r.count })))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  const byCount = (rows, withLabel) => rows.filter((r) => r._id != null && r._id !== '')
    .map((r) => ({ value: String(r._id), ...(withLabel ? { label: r.label || '—' } : {}), count: r.count }))
    .sort((a, b) => b.count - a.count);
  return {
    vehicle: vehicles,
    excludeVehicle: vehicles,
    customer: byCount(cust, true),
    supervisor: byCount(sup, true),
    trailerType: byCount(trailer),
    customerType: byCount(ctype),
    status: byCount(status),
  };
}

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

    const { q, includeCancelled } = req.query;
    const customerTypes = _multi(req.query.customerType);
    const supervisors = _multi(req.query.supervisor);
    const vehicleF = _multi(req.query.vehicle);
    // Everything except these trucks: the analysis of the fleet without one or two that would skew it.
    const vehicleX = _multi(req.query.excludeVehicle);
    const customersF = _multi(req.query.customer);
    const trailerTypes = _multi(req.query.trailerType);
    const statuses = _multi(req.query.status);

    // The period comes from the shared reference (resolvePeriod), not a local computation: `new Date(from)` used to be read as UTC here while day boundaries are local in the list, so the same from/to gave two different numbers on adjacent screens.
    const period = resolvePeriod(req.query);
    const { start, end } = period;
    const monthsInRange = period.preset === 'all'
      ? 1
      : Math.max(1, _monthIndex(new Date(end.getTime() - 1)) - _monthIndex(start) + 1);

    // Build the Mongo filter: effective date (loadDate else createdAt) in range,
    // supervisor scope, plus the explicit multi-value filters.
    // Built per omitted key too: each filter's option counts use every other filter but its own, so a picked value never hides the rest.
    const buildFilter = (omit = '') => {
      const and = [];
      if (period.preset !== 'all') and.push(effectiveDateMatch(start, end));
      if (scope) and.push({ vehicle: { $in: scope } });
      if (omit !== 'vehicle' && vehicleF.length) and.push({ vehicle: { $in: _oids(vehicleF) } });
      if (omit !== 'vehicle' && vehicleX.length) and.push({ vehicle: { $nin: _oids(vehicleX) } });
      if (omit !== 'customer' && customersF.length) and.push({ customer: { $in: _oids(customersF) } });
      if (omit !== 'supervisor' && supervisors.length) and.push({ supervisor: { $in: _oids(supervisors) } });
      if (omit !== 'customerType' && customerTypes.length) and.push({ customerType: { $in: customerTypes } });
      if (omit !== 'trailerType' && trailerTypes.length) and.push({ trailerType: { $in: trailerTypes } });
      if (omit !== 'status' && statuses.length) and.push({ status: { $in: statuses } });
      if (!includeCancelled && !(omit !== 'status' && statuses.length)) and.push({ status: { $ne: 'cancelled' } });
      return and;
    };
    const filter = { $and: buildFilter() };
    // The same search tolerance as the list: a plate typed in Indian digits or with spaced letters used to fail here and the screen came out all zeros.
    const qRx = q && q.trim() ? arRx(q) : null;
    if (qRx) {
      // The same search scope as load analysis: second driver name, supervisor and waybill number; otherwise one text gives two results in adjacent tabs.
      const or = [{ customerName: qRx }, { vehiclePlate: qRx }, { driverName: qRx }, { secondDriverName: qRx },
        { fromCity: qRx }, { toCity: qRx }, { loadType: qRx }, { supervisorName: qRx }];
      const qn = Number(String(q).trim());
      if (Number.isFinite(qn)) or.push({ waybillNumber: qn });
      filter.$and.push({ $or: or });
    }
    const searchClause = qRx ? filter.$and[filter.$and.length - 1] : null;

    if (!filter.$and.length) delete filter.$and; // Mongo rejects `$and: []`

    // The vehicle table obeys the same filters that concern the vehicle itself.
    // The table used to be built from the whole fleet however narrow the user's search: searching by one plate returned every vehicle as zero rows with yours among them, which was the complaint of a search by vehicle giving everything zero. The counters (vehicle count, below target) also counted the whole fleet and not what the user filtered.
    const vFilter = { isActive: { $ne: false } }; // Deleted ones are not counted as below target
    if (scope) vFilter._id = { $in: scope };
    if (vehicleF.length) vFilter._id = { $in: vehicleF.filter((v) => !scope || scope.some((s) => String(s) === v)) };
    if (vehicleX.length) vFilter._id = { ...(vFilter._id || {}), $nin: vehicleX };
    if (supervisors.length) vFilter.supervisor = { $in: supervisors };
    if (trailerTypes.length) vFilter.trailerType = { $in: trailerTypes };

    const [shipments, vehicles, customers, cfg] = await Promise.all([
      FleetShipment.find(filter).select('price fullRent driverExpense customerType trailerType vehicle vehiclePlate driverName driver supervisor supervisorName customer customerName status loadDate createdAt fromCity toCity').lean(),
      FleetVehicle.find(vFilter).select('plate name trailerType monthlyTarget supervisor supervisorName').lean(),
      FleetCustomer.find({}).select('name customerType rating').lean(),
      getFleetConfig(),
    ]);
    // Vehicles created before monthlyTarget existed have none — fall back to the
    // section default so every truck is still measured against a target (this is
    // exactly the "who hit 27,000" analytic the section asked for).
    const defaultTarget = Number(cfg.defaultMonthlyTarget) || 0;
    // gross = compared with income as is; net = after the driver expense is deducted.
    const targetBasis = cfg.targetBasis === 'net' ? 'net' : 'gross';

    // Vehicle rent (price) is the fleet section's income. The difference between full rent and vehicle rent (when present) is the branches section's share: shown separately and not part of the section income.
    const income = (s) => Number(s.price) || 0;
    const totalIncome = shipments.reduce((a, s) => a + income(s), 0);
    const totalFullRent = shipments.reduce((a, s) => a + (Number(s.fullRent) || 0), 0);
    const branchShare = shipments.reduce((a, s) => {
      const fr = Number(s.fullRent) || 0; return a + (fr > 0 ? Math.max(0, fr - income(s)) : 0);
    }, 0);
    // Driver expense within the period: the amount actually handed to drivers, shown in detail in load analysis.
    const totalDriverExpense = shipments.reduce((a, s) => a + (Number(s.driverExpense) || 0), 0);
    const tripCount = shipments.length;

    // Trips by trailer type (flatbed, curtain...) and by customer type.
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
      const cur = vehAgg.get(id) || {
        trips: 0, income: 0, driverExpense: 0, first: null, last: null,
        plate: s.vehiclePlate || (vById.get(id)?.plate) || '—',
      };
      cur.trips += 1;
      cur.income += income(s);
      cur.driverExpense += Number(s.driverExpense) || 0;
      const at = s.loadDate || s.createdAt;
      if (at) {
        if (!cur.first || new Date(at) < new Date(cur.first)) cur.first = at;
        if (!cur.last || new Date(at) > new Date(cur.last)) cur.last = at;
      }
      vehAgg.set(id, cur);
    }
    // Free search also narrows the table: a vehicle stays if the text matches its plate or it has trips in the results, not the whole fleet.
    const vehicleRows = qRx
      ? [...vById.entries()].filter(([id, v]) => vehAgg.has(id) || qRx.test(v.plate || '') || qRx.test(v.name || ''))
      : [...vById.entries()];
    const vehiclesOut = vehicleRows.map(([id, v]) => {
      const a = vehAgg.get(id) || { trips: 0, income: 0, driverExpense: 0, first: null, last: null };
      const monthlyTarget = (Number(v.monthlyTarget) || 0) || defaultTarget;
      const target = monthlyTarget * monthsInRange;
      // The measure is stated with the number
      // The target is measured on income as is, or income after driver expense, per section setting. Without stating the measure the number is misread: a vehicle seems to achieve while falling short by thousands.
      const achievedValue = targetBasis === 'net'
        ? Math.round((a.income - a.driverExpense) * 100) / 100
        : a.income;
      return {
        _id: id, plate: v.plate, name: v.name, trailerType: v.trailerType,
        supervisorName: v.supervisorName, trips: a.trips, income: a.income,
        driverExpense: Math.round((a.driverExpense || 0) * 100) / 100,
        // Achieved so far, by the configured measure, not always income.
        achievedValue,
        // And how much is missing? The question right after not achieved.
        shortfall: target > 0 ? Math.max(0, Math.round((target - achievedValue) * 100) / 100) : 0,
        monthlyTarget, periodTarget: target, target,
        achievedPct: target > 0 ? Math.round((achievedValue / target) * 100) : null,
        achieved: target > 0 ? achievedValue >= target : null,
        // Working from when to when: first and last load in the period.
        firstLoadAt: a.first || null,
        lastLoadAt: a.last || null,
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
    const trendStart = _month(_monthKeyShift(todayKey().slice(0, 7), -11)); // Start of month in Riyadh
    const trendFilter = { $and: [{ $or: [{ loadDate: { $gte: trendStart } }, { $and: [{ loadDate: null }, { createdAt: { $gte: trendStart } }] }] }, { status: { $ne: 'cancelled' } }] };
    if (scope) trendFilter.$and.push({ vehicle: { $in: scope } });
    if (customerTypes.length) trendFilter.$and.push({ customerType: { $in: customerTypes } });
    // The trend follows the truck and customer choice too, so "all but this truck" holds on every chart.
    if (vehicleF.length) trendFilter.$and.push({ vehicle: { $in: _oids(vehicleF) } });
    if (vehicleX.length) trendFilter.$and.push({ vehicle: { $nin: _oids(vehicleX) } });
    if (customersF.length) trendFilter.$and.push({ customer: { $in: _oids(customersF) } });
    if (supervisors.length) trendFilter.$and.push({ supervisor: { $in: _oids(supervisors) } });
    if (trailerTypes.length) trendFilter.$and.push({ trailerType: { $in: trailerTypes } });
    const trendDocs = await FleetShipment.find(trendFilter).select('price loadDate createdAt').lean();
    const trendMap = new Map();
    const firstMonth = _monthKeyShift(todayKey().slice(0, 7), -11);
    for (let i = 0; i < 12; i++) { const k = _monthKeyShift(firstMonth, i); trendMap.set(k, { month: k, income: 0, trips: 0 }); }
    for (const s of trendDocs) {
      const k = dayKeyOf(new Date(s.loadDate || s.createdAt)).slice(0, 7);
      if (trendMap.has(k)) { const m = trendMap.get(k); m.income += Number(s.price) || 0; m.trips += 1; }
    }
    const monthlyTrend = [...trendMap.values()];

    const body = {
      period: { from: start, to: end, monthsInRange, preset: period.preset },
      totals: {
        totalIncome, totalFullRent, branchShare, tripCount, totalDriverExpense,
        vehicleCount: vehiclesOut.length, customerCount: customersOut.length,
        vehiclesAchieved, vehiclesBelow, targetBasis,
        avgTripIncome: tripCount ? Math.round(totalIncome / tripCount) : 0,
      },
      byTrailerType, byCustomerType,
      vehicles: vehiclesOut,
      topDrivers, supervisors: supervisorsOut,
      customers: customersOut, topHeavyCustomers, topBranchCustomers,
      monthlyTrend,
      filterOptions: await analyticsFilterOptions({ buildFilter, searchClause, scope }),
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
    // The cap announces itself: an old customer with many loads will exceed the thousand-day limit, and then the file shows the last thousand and looks like its whole history, reading its income as low.
    const { rows: shipments, truncated: shipmentsTruncated } = await cappedFind(
      FleetShipment.find(q)
        .select('waybillNumber vehiclePlate driverName fromCity toCity status price fullRent driverExpense loadType rentType paymentType customerType loadDate createdAt supervisorName')
        .sort({ loadDate: -1, createdAt: -1 }),
      askedLimit(req.query, 1000, 20000),
    );
    const num = (v) => Number(v) || 0;
    const income = shipments.reduce((a, s) => a + num(s.price), 0);
    const fullRent = shipments.reduce((a, s) => a + num(s.fullRent), 0);
    const byStatus = {};
    for (const s of shipments) byStatus[s.status] = (byStatus[s.status] || 0) + 1;

    // File aggregations: by month (curve), by route and by vehicle (ranking). All from rows already loaded, no extra query per angle.
    const bump = (map, key, s) => {
      if (!key) return;
      const cur = map.get(key) || { key, trips: 0, income: 0 };
      cur.trips += 1; cur.income += num(s.price);
      map.set(key, cur);
    };
    const months = new Map(); const routes = new Map(); const vehicles = new Map(); const pay = new Map();
    for (const s of shipments) {
      const d = s.loadDate || s.createdAt;
      if (d) bump(months, dayKeyOf(new Date(d)).slice(0, 7), s); // Riyadh month
      bump(routes, [s.fromCity, s.toCity].filter(Boolean).join(' ← '), s);
      bump(vehicles, s.vehiclePlate, s);
      bump(pay, s.paymentType || '—', s);
    }
    const top = (map, n) => [...map.values()].sort((a, b) => b.income - a.income || b.trips - a.trips).slice(0, n);

    // CRM card: the linked company and its activity. Linked to CRM must mean something readable on the page, not just a link in the database.
    let crm = null;
    if (customer.crmCompany) {
      const company = await CrmCompany.findById(customer.crmCompany)
        .select('name arabicName status type rating score industry city phone email owner').lean();
      if (company) {
        const [activities, deals] = await Promise.all([
          CrmActivity.countDocuments({ company: company._id }).catch(() => 0),
          CrmDeal.countDocuments({ company: company._id }).catch(() => 0),
        ]);
        crm = { company, activities, deals };
      }
    }

    res.json({
      ...(shipmentsTruncated && { truncated: true, note: CAP_NOTE_AR }),
      customer,
      crm,
      stats: {
        trips: shipments.length, income, fullRent,
        // The difference between full rent and rent is the branches section's share in the 3PL scenario.
        branchShare: Math.max(0, fullRent - shipments.filter((s) => num(s.fullRent) > 0).reduce((a, s) => a + num(s.price), 0)),
        driverExpense: shipments.reduce((a, s) => a + num(s.driverExpense), 0),
        avgTripIncome: shipments.length ? Math.round(income / shipments.length) : 0,
        byStatus,
        openTrips: shipments.filter((s) => ['requesting', 'loading', 'uploaded', 'on_way', 'late'].includes(s.status)).length,
        firstTrip: shipments.length ? shipments[shipments.length - 1].loadDate || shipments[shipments.length - 1].createdAt : null,
        lastTrip: shipments.length ? shipments[0].loadDate || shipments[0].createdAt : null,
        byMonth: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
        topRoutes: top(routes, 8),
        topVehicles: top(vehicles, 8),
        byPaymentType: [...pay.values()],
      },
      shipments,
    });
  } catch (error) {
    console.error('fleet customer profile error:', error);
    res.status(500).json({ message: 'Failed to load customer profile' });
  }
};

// Driver performance evaluation: driver KPIs from the shipments they actually ran.
// The Location Solutions section scores drivers on telemetry (how they drive). This scores the business side of the same work: how many loads they carried, what those earned, whether they arrived instead of going late, what they cost, and whether the follow-up calls on their trips happened. The two are complementary: same person, different question.
const DRIVER_KPI_WEIGHTS = {
  trips: 30,       // Load count
  income: 25,      // Achieved income
  onTime: 25,      // On-time arrival rate (versus late)
  completion: 10,  // Completed load rate (versus cancelled)
  followUp: 10,    // Regularity of driver follow-up (every 3 hours)
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

/**
 * Kilometres each driver covered in the period, from the vehicle's own odometer (`Ls2OdometerDaily`, read daily by Location Solutions; vehicles match fleet vehicles by plate). There is no city distance table, so estimating a route would be an invented number.
 * Attribution: a load names its driver so its days are his (a second driver splits it); remaining days go to the driver seated on the vehicle today.
 * Loads alone attribute a small share, so the seat is read where loads are silent; with no load and no seat, nobody.
 */
async function driverKmInPeriod(shipments, drivers, start, end) {
  // The driver key is the same grouping key as in `bump`: the id if present, else his name.
  const byDriver = new Map();
  const fromLoads = new Map();
  const add = (map, key, km) => map.set(key, (map.get(key) || 0) + km);
  const empty = { byDriver, fromLoads, attributed: 0, unattributed: 0 };

  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const Ls2OdometerDaily = require('../models/Ls2OdometerDaily');

  // Plates are written with different spacing in the two registers, so they are normalized before matching.
  const norm = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
  const ls2 = await Ls2Vehicle.find({}).select('unitId plate').lean();
  const unitOfPlate = new Map();
  const plateOfUnit = new Map();
  for (const v of ls2) {
    if (v.unitId == null) continue;
    unitOfPlate.set(norm(v.plate), v.unitId);
    plateOfUnit.set(v.unitId, norm(v.plate));
  }
  if (!unitOfPlate.size) return empty;

  const day = (d) => {
    const x = new Date(d);
    return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  // One day before the start: the first day's kilometres are a difference from the day before.
  const fromDay = day(new Date(start.getTime() - 86400000));
  const endDay = day(new Date(end.getTime() - 1));

  const rows = await Ls2OdometerDaily.find({ date: { $gte: fromDay, $lte: endDay } })
    .select('unitId date odometerKm').sort({ unitId: 1, date: 1 }).lean();
  if (!rows.length) return empty;

  // Unit to its days, and each day's kilometres from odometer differences.
  const byUnit = new Map();
  for (const r of rows) {
    if (!byUnit.has(r.unitId)) byUnit.set(r.unitId, []);
    byUnit.get(r.unitId).push(r);
  }
  const kmPerDay = new Map();                  // `plate|day` to that day's kilometres
  for (const [unit, list] of byUnit) {
    const plate = plateOfUnit.get(unit);
    if (!plate) continue;
    for (let i = 1; i < list.length; i += 1) {
      // The odometer never decreases; any decrease is an odometer replacement or a bad reading, so it is ignored. A jump over three thousand km in a day is a reading fault, not travel.
      const d = list[i].odometerKm - list[i - 1].odometerKm;
      if (d > 0 && d < 3000) kmPerDay.set(`${plate}|${list[i].date}`, d);
    }
  }

  // Who holds each vehicle's seat today.
  const seatOf = new Map();                    // plate to [driver key]
  for (const d of drivers) {
    const plate = norm(d.vehicle && d.vehicle.plate);
    if (!plate) continue;
    if (!seatOf.has(plate)) seatOf.set(plate, []);
    seatOf.get(plate).push(String(d._id));
  }

  // Load days: who was explicitly on the vehicle that day.
  const loadDayDrivers = new Map();            // `plate|day` to [driver key]
  const byPlate = new Map();
  for (const sh of shipments) {
    const p = norm(sh.vehiclePlate);
    if (!p) continue;
    if (!byPlate.has(p)) byPlate.set(p, []);
    byPlate.get(p).push(sh);
  }
  for (const [plate, list] of byPlate) {
    list.sort((a, b) => new Date(a.loadDate || a.createdAt) - new Date(b.loadDate || b.createdAt));
    for (let i = 0; i < list.length; i += 1) {
      const sh = list[i];
      const keys = [];
      keys.push(sh.driver ? String(sh.driver) : `name:${sh.driverName || '—'}`);
      if (sh.secondDriver || sh.secondDriverName) {
        keys.push(sh.secondDriver ? String(sh.secondDriver) : `name:${sh.secondDriverName || '—'}`);
      }
      const from = day(sh.loadDate || sh.createdAt);
      const next = list[i + 1];
      // Last day of this load: the day before the next load on the vehicle, else the end of the period.
      const until = next
        ? day(new Date(new Date(next.loadDate || next.createdAt).getTime() - 86400000))
        : endDay;
      for (let d = new Date(`${from}T00:00:00Z`); day(d) <= until && day(d) <= endDay; d = new Date(d.getTime() + 86400000)) {
        loadDayDrivers.set(`${plate}|${day(d)}`, keys);
      }
    }
  }

  let attributed = 0;
  let unattributed = 0;
  for (const [key, km] of kmPerDay) {
    const owners = loadDayDrivers.get(key);
    const viaLoad = !!owners;
    const list = owners || seatOf.get(key.split('|')[0]) || [];
    if (!list.length) { unattributed += km; continue; }
    const share = km / list.length;
    for (const k of list) {
      add(byDriver, k, share);
      if (viaLoad) add(fromLoads, k, share);
    }
    attributed += km;
  }
  return { byDriver, fromLoads, attributed: Math.round(attributed), unattributed: Math.round(unattributed) };
}

exports.getDriverKpis = async (req, res) => {
  try {
    const scope = await supervisorVehicleIds(req);
    const cacheKey = `fleet:driverkpis:${scope ? String(req.user._id) : 'all'}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    // The same period reference as the list and analytics: the driver evaluation must be computed on the same month the user reads in the other screens.
    const period = resolvePeriod(req.query);
    const { start, end } = period;
    const monthsInRange = period.preset === 'all'
      ? 1
      : Math.max(1, _monthIndex(new Date(end.getTime() - 1)) - _monthIndex(start) + 1);

    const filter = { $and: [] };
    if (period.preset !== 'all') filter.$and.push(effectiveDateMatch(start, end));
    if (scope) filter.$and.push({ vehicle: { $in: scope } });
    if (!filter.$and.length) delete filter.$and;

    const [shipments, drivers, cfg, ended] = await Promise.all([
      FleetShipment.find(filter)
        .select('_id waybillNumber driver driverName secondDriver secondDriverName vehiclePlate price fullRent driverExpense status loadDate createdAt lastContactAt expectedArrival customerName fromCity toCity')
        .lean(),
      FleetDriver.find(scope ? { $or: [{ vehicle: { $in: scope } }, { vehicle: null }] } : {})
        .populate('vehicle', 'plate name')
        .lean()
        .then(FI.decorateDrivers),
      getFleetConfig(),
      endedStaff(),
    ]);
    // Someone whose service ended: his row stays if he worked in the period (his loads are history), but he is not today's crew, so he is not counted idle, nor in driver counts or targets.
    const isEnded = (d) => !!d && (d.employee ? employeeEnded(ended, d.employee) : idNumberEnded(ended, d.iqama));

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

    // Distance is read from the vehicle odometer and attributed by load then by seat; see driverKmInPeriod.
    const kmInfo = await driverKmInPeriod(shipments, drivers, start, end);
    const kmOf = (id, name) => kmInfo.byDriver.get(id ? String(id) : `name:${name || '—'}`) || 0;
    const kmFromLoadsOf = (id, name) => kmInfo.fromLoads.get(id ? String(id) : `name:${name || '—'}`) || 0;

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
          km: 0,
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

    // Distance is computed for the driver in full (by load and by seat), so it is put on his row.
    for (const [key, a] of agg) {
      a.km = kmInfo.byDriver.get(key) || 0;
      a.kmFromLoads = kmInfo.fromLoads.get(key) || 0;
    }

    // Benchmarks: a driver is scored against the fleet's own best, not an
    // invented number — "top of your peers" is the only fair target here.
    const rows = [...agg.values()];
    const maxTrips = Math.max(1, ...rows.map((r) => r.trips));
    const maxIncome = Math.max(1, ...rows.map((r) => r.income));

    const dById = new Map(drivers.map((d) => [String(d._id), d]));
    const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
    const r0 = (n) => Math.round(Number(n) || 0);

    // Driver target: his own if set, else the section default. `0` means no target for him, which differs from `null` meaning use the default.
    const defLoads = Number(cfg.defaultDriverMonthlyLoads) || 0;
    const defKm = Number(cfg.defaultDriverMonthlyKm) || 0;
    const targetLoadsOf = (d) => (d && d.monthlyLoadsTarget != null ? Number(d.monthlyLoadsTarget) : defLoads);
    const targetKmOf = (d) => (d && d.monthlyKmTarget != null ? Number(d.monthlyKmTarget) : defKm);
    const targetPctOf = (d, a, months) => {
      const tl = targetLoadsOf(d) * months;
      const tk = targetKmOf(d) * months;
      const parts = [];
      if (tl > 0) parts.push(clamp01(a.trips / tl));
      if (tk > 0) parts.push(clamp01(a.km / tk));
      if (!parts.length) return null;                 // No target, so no achievement
      return r0((parts.reduce((x, y) => x + y, 0) / parts.length) * 100);
    };
    // Achieved means reaching both targets, not either one.
    const achievedOf = (d, a, months) => {
      const tl = targetLoadsOf(d) * months;
      const tk = targetKmOf(d) * months;
      if (tl <= 0 && tk <= 0) return null;
      return (tl <= 0 || a.trips >= tl) && (tk <= 0 || a.km >= tk);
    };

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
        // The driver target is loads and distance
        // A vehicle is measured on income, but the driver does not own the price: he owns carrying and driving. So the target is what he owns. Achievement is the mean of the two ratios: someone who carried all his loads and drove half the distance did not achieve, nor did one who drove the distance with a single load.
        km: r0(a.km),
        // How much came from a named load, the rest from his seat on the vehicle.
        kmFromLoads: r0(a.kmFromLoads || 0),
        kmPerMonth: Math.round((a.km / monthsInRange) * 10) / 10,
        targetLoads: r0(targetLoadsOf(d) * monthsInRange),
        targetKm: r0(targetKmOf(d) * monthsInRange),
        loadsPct: targetLoadsOf(d) > 0 ? r0((a.trips / (targetLoadsOf(d) * monthsInRange)) * 100) : null,
        kmPct: targetKmOf(d) > 0 ? r0((a.km / (targetKmOf(d) * monthsInRange)) * 100) : null,
        shortfallLoads: Math.max(0, r0(targetLoadsOf(d) * monthsInRange - a.trips)),
        shortfallKm: Math.max(0, r0(targetKmOf(d) * monthsInRange - a.km)),
        targetPct: targetPctOf(d, a, monthsInRange),
        achieved: achievedOf(d, a, monthsInRange),
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
        ...(isEnded(d) ? { ended: true } : {}),
      };
    });

    // Drivers on the books who carried nothing in the period still belong on the
    // list — "who did no work this month" is half the point of the page.
    const seen = new Set(items.map((i) => i._id).filter(Boolean));
    for (const d of drivers) {
      if (seen.has(String(d._id)) || d.isActive === false || isEnded(d)) continue;
      items.push({
        _id: String(d._id), name: d.name, phone: d.phone || '', iqama: d.iqama || '',
        nationality: d.nationality || '', working: d.working !== false, offReason: d.offReason || '',
        onSponsorship: d.onSponsorship !== false,
        vehicle: d.vehicle ? { _id: String(d.vehicle._id), plate: d.vehicle.plate, name: d.vehicle.name } : null,
        trips: 0, sharedTrips: 0, income: 0, fullRent: 0, expense: 0, net: 0, avgTripIncome: 0, tripsPerMonth: 0,
        // Someone who did not work is below target, not no target
        // The row used to be built by hand here without target fields, so achievement read empty and he was counted as no target, though he is the first to ask about: a target set and nothing covered.
        // He has no load, but his vehicle moved with him on it, so the distance counts.
        km: r0(kmOf(d._id, d.name)), kmFromLoads: 0,
        kmPerMonth: Math.round((kmOf(d._id, d.name) / monthsInRange) * 10) / 10,
        targetLoads: r0(targetLoadsOf(d) * monthsInRange),
        targetKm: r0(targetKmOf(d) * monthsInRange),
        loadsPct: targetLoadsOf(d) > 0 ? 0 : null,
        kmPct: targetKmOf(d) > 0 ? r0((kmOf(d._id, d.name) / (targetKmOf(d) * monthsInRange)) * 100) : null,
        shortfallLoads: r0(targetLoadsOf(d) * monthsInRange),
        shortfallKm: Math.max(0, r0(targetKmOf(d) * monthsInRange - kmOf(d._id, d.name))),
        targetPct: targetPctOf(d, { trips: 0, km: kmOf(d._id, d.name) }, monthsInRange),
        achieved: achievedOf(d, { trips: 0, km: kmOf(d._id, d.name) }, monthsInRange),
        done: 0, late: 0, cancelled: 0, inFlight: 0,
        onTimeRate: null, completionRate: 100, followUpRate: null, followUpsDone: 0, followUpsExpected: 0,
        firstTrip: null, lastTrip: null,
        score: 0, band: 'weak', bandAr: 'ضعيف', bandEn: 'Needs improvement', bandColor: '#ef4444',
        breakdown: [], noActivity: true,
      });
    }

    items.sort((a, b) => b.score - a.score || b.income - a.income);
    // The counters are for the current crew only; totals (loads/income/distance) stay as they are.
    const roster = items.filter((i) => !i.ended);
    const active = roster.filter((i) => i.trips > 0);
    const body = {
      period: { from: start, to: end, monthsInRange, preset: period.preset },
      weights: DRIVER_KPI_WEIGHTS,
      bands: DRIVER_KPI_BANDS,
      followUpTargetHours: FOLLOWUP_TARGET_HOURS,
      fridayBonusAmount: Number(cfg.fridayBonusAmount) || 0,
      summary: {
        drivers: roster.length,
        activeDrivers: active.length,
        idleDrivers: roster.length - active.length,
        totalTrips: items.reduce((s, i) => s + i.trips, 0),
        totalIncome: items.reduce((s, i) => s + i.income, 0),
        totalExpense: items.reduce((s, i) => s + i.expense, 0),
        averageScore: active.length ? Math.round(active.reduce((s, i) => s + i.score, 0) / active.length) : 0,
        lateTrips: items.reduce((s, i) => s + i.late, 0),
        // Who achieved and who did not, as a count
        // The first question on the screen, whose answer used to be counted by eye row by row.
        totalKm: items.reduce((s, i) => s + (i.km || 0), 0),
        // How much of the fleet's kilometres found an owner, and how much stayed without a ratio.
        kmAttributed: kmInfo.attributed,
        kmUnattributed: kmInfo.unattributed,
        driversAchieved: roster.filter((i) => i.achieved === true).length,
        driversBelow: roster.filter((i) => i.achieved === false).length,
        driversNoTarget: roster.filter((i) => i.achieved == null).length,
        defaultDriverMonthlyLoads: Number(cfg.defaultDriverMonthlyLoads) || 0,
        defaultDriverMonthlyKm: Number(cfg.defaultDriverMonthlyKm) || 0,
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

// Expected arrival and empty vehicles: which trucks arrive on a given day in a city and which will be empty then. Both tables come out together because the supervisor's decision is one.
// Empty means the vehicle has no active load at all (not moving, loading or headed anywhere), so it is computed from the absence of a load, not from a status.
const ARRIVAL_ACTIVE = ['requesting', 'loading', 'uploaded', 'on_way', 'late'];

exports.getArrivals = async (req, res) => {
  try {
    const scope = await supervisorVehicleIds(req);
    const cacheKey = `fleet:arrivals:${scope ? String(req.user._id) : 'all'}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    // Default is the next seven days: the screen is forward-looking, and whoever opens it asks about what is coming, not what passed. Inheriting the general default (current month) would open on half a past month where an expected arrival means nothing.
    const period = resolvePeriod(req.query.preset || req.query.from || req.query.to || req.query.day || req.query.month
      ? req.query : { preset: 'next_7' });
    const { toCity, supervisor, q } = req.query;

    const base = [{ status: { $in: ARRIVAL_ACTIVE } }];
    if (scope) base.push({ vehicle: { $in: scope } });
    if (supervisor) base.push({ supervisor });
    if (q && q.trim()) {
      const r = arRx(q);
      base.push({ $or: [{ customerName: r }, { driverName: r }, { vehiclePlate: r }, { fromCity: r }, { toCity: r }] });
    }
    // Destination is matched with Arabic spelling tolerance: two spellings of Jeddah are one city.
    const cityClause = toCity && toCity.trim() ? [{ toCity: arRx(toCity) }] : [];

    // All periods means every recorded appointment, not every moving load: without requiring the appointment, loads with none would appear in both tables, counting the thing twice.
    const inWindow = period.preset === 'all'
      ? [{ expectedArrival: { $ne: null } }]
      : [{ expectedArrival: { $gte: period.start, $lt: period.end } }];

    const [arriving, noEta, activeVehicleIds, cityAgg] = await Promise.all([
      FleetShipment.find({ $and: [...base, ...cityClause, ...inWindow] })
        .sort({ expectedArrival: 1 })
        .select('waybillNumber customerName customer vehicle vehiclePlate trailerType driverName driverPhone secondDriverName fromCity toCity status loadDate expectedArrival lastContactAt supervisorName supervisor price loadType')
        .limit(500).lean(),
      // Moving loads with no recorded expected arrival appear in no time window, and hiding them leaves a vehicle counted as neither arriving nor empty, lost from planning entirely.
      FleetShipment.find({ $and: [...base, ...cityClause, { $or: [{ expectedArrival: null }, { expectedArrival: { $exists: false } }] }] })
        .sort({ loadDate: -1, createdAt: -1 })
        .select('waybillNumber customerName customer vehicle vehiclePlate trailerType driverName driverPhone secondDriverName fromCity toCity status loadDate expectedArrival lastContactAt supervisorName supervisor price loadType')
        .limit(300).lean(),
      FleetShipment.distinct('vehicle', { $and: base }),
      FleetShipment.aggregate([
        { $match: { $and: [...base, ...inWindow] } },
        { $group: { _id: '$toCity', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);

    // Empty vehicles = the fleet register minus every vehicle with an active load.
    const busy = new Set(activeVehicleIds.filter(Boolean).map(String));
    const vFilter = { isActive: { $ne: false } };
    if (scope) vFilter._id = { $in: scope };
    const allVehicles = await FleetVehicle.find(vFilter).select('plate name trailerType gpsType supervisor supervisorName').sort({ plate: 1 }).lean();
    const idleVehicles = allVehicles.filter((v) => !busy.has(String(v._id)));
    const idleIds = idleVehicles.map((v) => v._id);

    // Last trip of each empty vehicle plus its drivers, computed on the server rather than pulling the whole collection.
    const [lastTrips, drivers] = await Promise.all([
      idleIds.length ? FleetShipment.aggregate([
        { $match: { vehicle: { $in: idleIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$vehicle', last: { $first: { waybillNumber: '$waybillNumber', toCity: '$toCity', status: '$status', customerName: '$customerName', at: EFFECTIVE_DATE_EXPR } } } },
      ]) : [],
      idleIds.length ? FleetDriver.find({ vehicle: { $in: idleIds }, isActive: { $ne: false }, ...(await noArchDrv()) }).select('name phone working vehicle employee').lean()
        .then(FI.decorateDrivers) : [],
    ]);
    const lastByVehicle = new Map(lastTrips.map((r) => [String(r._id), r.last]));
    const drvByVehicle = new Map();
    for (const d of drivers) {
      const k = String(d.vehicle);
      if (!drvByVehicle.has(k)) drvByVehicle.set(k, []);
      drvByVehicle.get(k).push({ _id: d._id, name: d.name, phone: d.phone, working: d.working });
    }
    const idle = idleVehicles.map((v) => ({
      ...v,
      drivers: drvByVehicle.get(String(v._id)) || [],
      lastTrip: lastByVehicle.get(String(v._id)) || null,
    }));

    // Busy was a number that did not open
    // It was computed by subtraction (all minus empty) and shown as a number in a card that leads nowhere: you read 39 busy with no way to know which or on what load. So the names come with it: each busy vehicle and its current load. It is asked as one query and not read from the two tables above, which are filtered by destination and period; reading them would show a busy vehicle with no load because its load is to another city.
    const busyVehicles = allVehicles.filter((v) => busy.has(String(v._id)));
    const busyIds = busyVehicles.map((v) => v._id);
    const busyTrips = busyIds.length ? await FleetShipment.aggregate([
      { $match: { vehicle: { $in: busyIds }, status: { $in: ARRIVAL_ACTIVE } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$vehicle',
          t: {
            $first: {
              _id: '$_id', waybillNumber: '$waybillNumber', customerName: '$customerName',
              fromCity: '$fromCity', toCity: '$toCity', status: '$status',
              expectedArrival: '$expectedArrival', driverName: '$driverName',
            },
          },
        },
      },
    ]) : [];
    const tripOfVehicle = new Map(busyTrips.map((r) => [String(r._id), r.t]));
    const busyList = busyVehicles.map((v) => ({ ...v, trip: tripOfVehicle.get(String(v._id)) || null }));

    const body = {
      period: { from: period.start, to: period.end, preset: period.preset },
      arriving,
      noEta,
      idle,
      busyList,
      byCity: cityAgg.filter((r) => r._id).map((r) => ({ city: r._id, n: r.n })),
      summary: {
        arriving: arriving.length,
        noEta: noEta.length,
        idle: idle.length,
        vehicles: allVehicles.length,
        busy: allVehicles.length - idle.length,
      },
    };
    cache.set(cacheKey, body, 12000);
    res.json(body);
  } catch (error) {
    console.error('fleet arrivals error:', error);
    res.status(500).json({ message: 'Failed to load expected arrivals' });
  }
};

// Analysis of one vehicle across a period
// Click the vehicle and get its full analysis: how many trips, price and so on. Every number is aggregated on the server and the returned log is capped: one vehicle over a year may carry hundreds of loads, and pulling them all to the browser to count there is a repeated mistake.
exports.getVehicleAnalytics = async (req, res) => {
  try {
    const scope = await supervisorVehicleIds(req);
    const vehicle = await FleetVehicle.findById(req.params.id).lean();
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    // A supervisor sees only his vehicles: without this condition the analysis link becomes a back door to another supervisor's numbers.
    if (scope && !scope.some((s) => String(s) === String(vehicle._id))) {
      return res.status(403).json({ message: 'Not your vehicle' });
    }

    const cacheKey = `fleet:vehicle-analytics:${req.params.id}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(cacheKey);
    // Identity and documents are read from the register on every request, not stored with the numbers, so an edit in the vehicles section shows here at once.
    if (cached !== undefined) {
      await FI.decorateVehicles([cached.vehicle]);
      return res.json(cached);
    }
    await FI.decorateVehicles([vehicle]);

    const period = resolvePeriod(req.query);
    const { start, end } = period;
    const monthsInRange = period.preset === 'all'
      ? 1
      : Math.max(1, _monthIndex(new Date(end.getTime() - 1)) - _monthIndex(start) + 1);

    const match = { $and: [{ vehicle: vehicle._id }] };
    if (period.preset !== 'all') match.$and.push(effectiveDateMatch(start, end));
    if (!req.query.includeCancelled) match.$and.push({ status: { $ne: 'cancelled' } });

    const sums = {
      trips: { $sum: 1 },
      income: { $sum: { $ifNull: ['$price', 0] } },
      fullRent: { $sum: { $ifNull: ['$fullRent', 0] } },
      driverExpense: { $sum: { $ifNull: ['$driverExpense', 0] } },
    };

    // Twelve-month trend: deliberately ignores the period, since whether the vehicle is improving cannot be answered from within the chosen month.
    const trendStart = _month(_monthKeyShift(todayKey().slice(0, 7), -11)); // Start of month in Riyadh

    const [totalsAgg, byRoute, byCustomer, byStatus, byMonth, trips, cfg, seatDrivers, currentTrip] = await Promise.all([
      FleetShipment.aggregate([{ $match: match }, { $group: { _id: null, ...sums } }]),
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { from: '$fromCity', to: '$toCity' }, ...sums } },
        { $sort: { trips: -1 } }, { $limit: 40 },
      ]),
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { id: '$customer', name: '$customerName' }, ...sums } },
        { $sort: { income: -1 } }, { $limit: 40 },
      ]),
      FleetShipment.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      FleetShipment.aggregate([
        { $match: { vehicle: vehicle._id, status: { $ne: 'cancelled' }, $expr: { $gte: [EFFECTIVE_DATE_EXPR, trendStart] } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: EFFECTIVE_DATE_EXPR, timezone: 'Asia/Riyadh' } }, ...sums } },
        { $sort: { _id: 1 } },
      ]),
      FleetShipment.find(match)
        .sort({ loadDate: -1, createdAt: -1 })
        .select('waybillNumber customer customerName customerType driverName secondDriverName supervisorName supervisor fromCity toCity loadType price fullRent driverExpense status loadDate expectedArrival createdAt')
        .limit(1000).lean(),
      getFleetConfig(),
      FleetDriver.find({ vehicle: vehicle._id, isActive: { $ne: false }, ...(await noArchDrv()) }).select('name phone working offReason employee').lean()
        .then(FI.decorateDrivers),
      FleetShipment.findOne({ vehicle: vehicle._id, status: { $in: ARRIVAL_ACTIVE } })
        .sort({ createdAt: -1 })
        .select('waybillNumber status fromCity toCity expectedArrival customerName loadDate').lean(),
    ]);

    const t = totalsAgg[0] || { trips: 0, income: 0, fullRent: 0, driverExpense: 0 };
    const monthlyTarget = (Number(vehicle.monthlyTarget) || 0) || (Number(cfg.defaultMonthlyTarget) || 0);
    const periodTarget = monthlyTarget * monthsInRange;
    // Branches share = difference between full rent and vehicle rent, computed only when the full rent was actually recorded; otherwise every lone rent would become a negative share.
    const branchShare = trips.reduce((a, s) => {
      const fr = Number(s.fullRent) || 0;
      return a + (fr > 0 ? Math.max(0, fr - (Number(s.price) || 0)) : 0);
    }, 0);

    // Truck technical state from Location Solutions and the heavy transport store: the sections describe the same truck but never met, so a truck with overdue maintenance could be run.
    // Joined by the numeric plate key, not the text, because the plate is written in different formats in each place.
    const vKey = plateKey(vehicle.plate) || vehiclePlateKey(vehicle.plate);
    let tech = null;
    if (vKey) {
      const Ls2TireAsset = require('../models/Ls2TireAsset');
      const Ls2ServiceLog = require('../models/Ls2ServiceLog');
      const Ls2Repair = require('../models/Ls2Repair');
      const { Ls2StoreMovement } = require('../models/Ls2Store');
      const plateRx = new RegExp(String(vehicle.plate).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const digits = String(vehicle.plate).replace(/\D/g, '');
      const digitsRx = digits ? new RegExp(`(^|\\D)${digits}(\\D|$)`) : plateRx;

      const [ls2v, tires, services, repairs, issued] = await Promise.all([
        // `Ls2Vehicle` has no `plateKey`: the condition asked about a field that does not exist, so it matched only by text. So the unit is matched by the vehicle register reference if it has one, then by the plate's unified key, then by its digits (the plate there may carry the driver's name).
        Ls2Vehicle.find({})
          .select('plate name unitId maintenanceStatus kmToService nextServiceName nextServiceKm odometerKm lastMessageAt status services vehicleMaster').lean()
          .then((all) => {
            const canon = canonicalPlateKey(vehicle.plate);
            return all.find((lv) => vehicle.vehicleMaster && lv.vehicleMaster && String(lv.vehicleMaster) === String(vehicle.vehicleMaster))
              || all.find((lv) => canon && canonicalPlateKey(lv.plate) === canon)
              || all.find((lv) => vehiclePlateKey(lv) === vKey)
              || null;
          })
          .catch(() => null),
        Ls2TireAsset.countDocuments({ plateKey: vKey, status: 'mounted' }).catch(() => 0),
        Ls2ServiceLog.find({ plate: plateRx }).sort({ createdAt: -1 }).limit(10)
          .select('plate createdAt items note byName odometerKm').lean().catch(() => []),
        Ls2Repair.find({ plate: plateRx, status: { $ne: 'done' } }).sort({ createdAt: -1 }).limit(20)
          .select('plate category status description cost createdAt').lean().catch(() => []),
        // What the store issued to this truck: parts actually installed on it. The store plate is written in a third format (letters plus 5096 or just 2708) while here it is "5096 VXA", so the join is by digits alone, bounded so 1082 does not match 21082.
        // `date` is the issue day picked on the request (shown instead of the entry time); the request number lets the reader find its signed sheet.
        Ls2StoreMovement.find({ type: 'out', warehouse: { $ne: 'light' }, reversed: { $ne: true }, vehiclePlate: digitsRx })
          .sort({ date: -1, createdAt: -1 }).limit(50)
          .select('itemName quantity reason issueReason date issueRequestNo createdAt performedByName').lean()
          // The issue reason by name (periodic maintenance / accident...) is read in the vehicle file.
          .then((rows) => rows.map((m) => ({ ...m, issueReasonLabel: require('../utils/storeIssueReasons').issueReasonLabel(m.issueReason) })))
          // Rims fitted to this truck from the tire side count as parts issued too.
          .then(async (rows) => {
            const { Ls2RimMovement } = require('../models/Ls2Rim');
            const rims = await Ls2RimMovement.find({ plateKey: vKey, type: 'out', reason: 'mounted', reversed: { $ne: true }, legacy: { $ne: true } })
              .sort({ at: -1 }).limit(50).select('rimName quantity issueReason notes at performedByName').lean().catch(() => []);
            const { issueReasonLabel } = require('../utils/storeIssueReasons');
            return [...rows, ...rims.map((m) => ({
              _id: m._id, itemName: m.rimName, quantity: m.quantity, reason: m.notes || '', issueReason: m.issueReason || '',
              issueReasonLabel: issueReasonLabel(m.issueReason), createdAt: m.at, performedByName: m.performedByName,
            }))].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)).slice(0, 50);
          })
          .catch(() => []),
      ]);

      tech = {
        ls2: ls2v ? {
          plate: ls2v.plate,
          unitId: ls2v.unitId ?? null,
          maintenanceStatus: ls2v.maintenanceStatus || 'ok',
          kmToService: ls2v.kmToService,
          nextServiceName: ls2v.nextServiceName || '',
          nextServiceKm: ls2v.nextServiceKm,
          odometerKm: ls2v.odometerKm,
          lastMessageAt: ls2v.lastMessageAt || null,
        } : null,
        mountedTires: tires,
        openRepairs: repairs,
        recentServices: services,
        partsIssued: issued,
        partsCount: issued.length,
      };
    }

    const body = {
      vehicle: { ...vehicle, drivers: seatDrivers, currentTrip: currentTrip || null },
      tech,
      period: { from: start, to: end, monthsInRange, preset: period.preset },
      totals: {
        trips: t.trips, income: t.income, fullRent: t.fullRent, driverExpense: t.driverExpense,
        branchShare,
        net: t.income - t.driverExpense,
        avgTripIncome: t.trips ? Math.round(t.income / t.trips) : 0,
        avgTripExpense: t.trips ? Math.round(t.driverExpense / t.trips) : 0,
        monthlyTarget, periodTarget,
        achievedPct: periodTarget > 0 ? Math.round((t.income / periodTarget) * 100) : null,
        achieved: periodTarget > 0 ? t.income >= periodTarget : null,
      },
      byRoute: byRoute.map((r) => ({ fromCity: r._id.from || '—', toCity: r._id.to || '—', trips: r.trips, income: r.income, driverExpense: r.driverExpense })),
      byCustomer: byCustomer.map((r) => ({ _id: r._id.id ? String(r._id.id) : null, name: r._id.name || '—', trips: r.trips, income: r.income, driverExpense: r.driverExpense })),
      byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
      monthlyTrend: byMonth.map((r) => ({ month: r._id, trips: r.trips, income: r.income, driverExpense: r.driverExpense })),
      shipments: trips,
      truncated: trips.length >= 1000,
    };
    cache.set(cacheKey, body, 12000);
    res.json(body);
  } catch (error) {
    console.error('fleet vehicle analytics error:', error);
    res.status(500).json({ message: 'Failed to load vehicle analytics' });
  }
};

// Load analysis
// This is a screen for paying out driver expenses before it is a reports screen: the supervisor stands on it to know how much to hand each driver for today's loads. So the expense is a column in every row and a total per driver, and both are aggregated on the server from the same match, so the page total never differs from the rows' total when loads exceed the display cap.
exports.getLoadsAnalysis = async (req, res) => {
  try {
    const scope = await supervisorVehicleIds(req);
    const cacheKey = `fleet:loads-analysis:${scope ? String(req.user._id) : 'all'}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    const period = resolvePeriod(req.query);
    const { start, end } = period;
    const { q, includeCancelled } = req.query;
    const supervisors = _multi(req.query.supervisor);
    const customersF = _multi(req.query.customer);
    const vehicleF = _multi(req.query.vehicle);
    const statuses = _multi(req.query.status);
    const customerTypes = _multi(req.query.customerType);
    const limit = Math.min(3000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

    const and = [];
    if (period.preset !== 'all') and.push(effectiveDateMatch(start, end));
    if (scope) and.push({ vehicle: { $in: scope } });
    // Ids, not strings: this match is also used in `aggregate` (see `_oids`).
    if (vehicleF.length) and.push({ vehicle: { $in: _oids(vehicleF) } });
    const vehicleX = _multi(req.query.excludeVehicle);
    if (vehicleX.length) and.push({ vehicle: { $nin: _oids(vehicleX) } });
    if (supervisors.length) and.push({ supervisor: { $in: _oids(supervisors) } });
    if (customersF.length) and.push({ customer: { $in: _oids(customersF) } });
    if (customerTypes.length) and.push({ customerType: { $in: customerTypes } });
    if (statuses.length) and.push({ status: { $in: statuses } });
    if (!includeCancelled && !statuses.length) and.push({ status: { $ne: 'cancelled' } });
    if (q && q.trim()) {
      const r = arRx(q);
      const or = [{ customerName: r }, { vehiclePlate: r }, { driverName: r }, { secondDriverName: r }, { fromCity: r }, { toCity: r }, { loadType: r }, { supervisorName: r }];
      const n = Number(String(q).trim());
      if (Number.isFinite(n)) or.push({ waybillNumber: n });
      and.push({ $or: or });
    }
    const match = and.length ? { $and: and } : {};

    const sums = {
      loads: { $sum: 1 },
      income: { $sum: { $ifNull: ['$price', 0] } },
      fullRent: { $sum: { $ifNull: ['$fullRent', 0] } },
      driverExpense: { $sum: { $ifNull: ['$driverExpense', 0] } },
    };

    const [totalsAgg, byDay, bySupervisor, byCustomer, byVehicle, byDriver, byStatus, rows] = await Promise.all([
      FleetShipment.aggregate([{ $match: match }, { $group: { _id: null, ...sums, fridayBonuses: { $sum: { $cond: ['$fridayBonus', 1, 0] } } } }]),
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: EFFECTIVE_DATE_EXPR, timezone: 'Asia/Riyadh' } }, ...sums } },
        { $sort: { _id: 1 } },
      ]),
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { id: '$supervisor', name: '$supervisorName' }, ...sums } },
        { $sort: { loads: -1 } },
      ]),
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { id: '$customer', name: '$customerName' }, ...sums } },
        { $sort: { income: -1 } }, { $limit: 100 },
      ]),
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { id: '$vehicle', plate: '$vehiclePlate' }, ...sums } },
        { $sort: { income: -1 } }, { $limit: 200 },
      ]),
      // Total expense per driver: the number actually paid out.
      FleetShipment.aggregate([
        { $match: match },
        { $group: { _id: { id: '$driver', name: '$driverName' }, ...sums } },
        { $sort: { driverExpense: -1 } }, { $limit: 200 },
      ]),
      FleetShipment.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      FleetShipment.find(match)
        .sort({ loadDate: -1, createdAt: -1 })
        .select('waybillNumber customer customerName customerType vehicle vehiclePlate trailerType driver driverName driverPhone secondDriverName supervisor supervisorName fromCity toCity loadType rentType paymentType branch price fullRent driverExpense fridayBonus status loadDate expectedArrival createdAt')
        .limit(limit).lean(),
    ]);

    const t = totalsAgg[0] || { loads: 0, income: 0, fullRent: 0, driverExpense: 0, fridayBonuses: 0 };
    const body = {
      period: { from: start, to: end, preset: period.preset },
      totals: {
        loads: t.loads, income: t.income, fullRent: t.fullRent, driverExpense: t.driverExpense,
        fridayBonuses: t.fridayBonuses,
        branchShare: Math.max(0, t.fullRent - t.income),
        net: t.income - t.driverExpense,
        avgIncome: t.loads ? Math.round(t.income / t.loads) : 0,
        avgExpense: t.loads ? Math.round(t.driverExpense / t.loads) : 0,
      },
      byDay: byDay.map((r) => ({ day: r._id, loads: r.loads, income: r.income, driverExpense: r.driverExpense })),
      bySupervisor: bySupervisor.map((r) => ({ _id: r._id.id ? String(r._id.id) : null, name: r._id.name || '—', loads: r.loads, income: r.income, driverExpense: r.driverExpense })),
      byCustomer: byCustomer.map((r) => ({ _id: r._id.id ? String(r._id.id) : null, name: r._id.name || '—', loads: r.loads, income: r.income, driverExpense: r.driverExpense })),
      byVehicle: byVehicle.map((r) => ({ _id: r._id.id ? String(r._id.id) : null, plate: r._id.plate || '—', loads: r.loads, income: r.income, driverExpense: r.driverExpense })),
      byDriver: byDriver.map((r) => ({ _id: r._id.id ? String(r._id.id) : null, name: r._id.name || '—', loads: r.loads, income: r.income, driverExpense: r.driverExpense })),
      byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
      shipments: rows,
      // Rows are capped and totals are not: the truth is stated explicitly so the reader does not assume what is in front of him is everything and sum it by hand to a different total than the screen.
      truncated: t.loads > rows.length,
      shown: rows.length,
    };
    cache.set(cacheKey, body, 12000);
    res.json(body);
  } catch (error) {
    console.error('fleet loads analysis error:', error);
    res.status(500).json({ message: 'Failed to load the loads analysis' });
  }
};

// Vehicle logs: the full monthly log of each vehicle. A load follow-up answers where a shipment is; this answers what happened to a vehicle this month. Neither is read in place of the other.
// The log is composed, not written: loads and events are derived from the shipments, plus what has no home except here (breakdown, maintenance, violation, note), so it cannot lag the truth.

const FleetVehicleLog = require('../models/FleetVehicleLog');

/** Resolves the vehicle from an id or plate. */
async function resolveVehicle(idOrPlate) {
  const s = String(idOrPlate || '').trim();
  if (!s) return null;
  if (/^[0-9a-f]{24}$/i.test(s)) {
    const byId = await FleetVehicle.findById(s).lean();
    if (byId) return byId;
  }
  const key = plateKey(s);
  const all = await FleetVehicle.find({}).select('plate name trailerType supervisor supervisorName monthlyTarget').lean();
  return all.find((v) => v.plate === s) || all.find((v) => plateKey(v.plate) === key) || null;
}

/**
 * Time range from the query. Accepts four forms:
 * ?month=YYYY-MM   a whole month (the closing unit)
 * ?date=YYYY-MM-DD a specific day
 * ?from&to         a free range; nothing means the current month
 */
function logRange(query) {
  const { month, date, from, to } = query || {};
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      from: startOfDay(date),
      to: endOfDay(date),
      monthKey: date.slice(0, 7),
      label: date,
      scope: 'day',
    };
  }
  if (from || to) {
    const f = from ? startOfDay(from) : new Date('2000-01-01T00:00:00.000Z');
    // An open `to` means until now, not until midnight today; otherwise today's entries vanish from the result of someone who asked from the start of the month.
    const tt = to ? endOfDay(to) : new Date();
    return { from: f, to: tt, monthKey: '', label: `${from || '—'} → ${to || ''}`, scope: 'range' };
  }
  const mk = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : FleetVehicleLog.monthKeyOf(new Date());
  const r = FleetVehicleLog.monthRange(mk);
  return { ...r, monthKey: mk, label: mk, scope: 'month' };
}

/**
 * GET /api/fleet/vehicle-logs?vehicle=<id|plate>&month=YYYY-MM
 * The composed log of one vehicle: manual entries plus the period's loads and their events, ordered by time, with the month summary and its closing state.
 */
exports.getVehicleLog = async (req, res) => {
  try {
    const vehicle = await resolveVehicle(req.query.vehicle || req.params.vehicle);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    // A supervisor sees only his vehicles.
    const scope = await supervisorVehicleIds(req);
    if (scope && !scope.some((id) => String(id) === String(vehicle._id))) {
      return res.status(403).json({ message: 'Not your vehicle' });
    }

    const range = logRange(req.query);
    const ck = `fleet:vlog:${vehicle._id}:${range.from.toISOString()}:${range.to.toISOString()}`;
    const payload = await cache.wrap(ck, 20000, async () => {
      const [entries, shipments] = await Promise.all([
        FleetVehicleLog.find({ vehicle: vehicle._id, at: { $gte: range.from, $lte: range.to } })
          .sort({ at: -1 }).limit(1000).lean(),
        FleetShipment.find({
          vehicle: vehicle._id,
          $or: [
            { loadDate: { $gte: range.from, $lte: range.to } },
            { loadDate: null, createdAt: { $gte: range.from, $lte: range.to } },
          ],
        }).select('waybillNumber loadDate createdAt customerName fromCity toCity price driverExpense driverName status expectedArrival deliveredAt')
          .sort({ loadDate: -1 }).limit(500).lean(),
      ]);

      // Events of those loads: follow-ups and status changes belong to the vehicle as they belong to the shipment, and the monthly log is where they are read together.
      const ids = shipments.map((s) => s._id);
      const events = ids.length
        ? await FleetEvent.find({ shipment: { $in: ids }, createdAt: { $gte: range.from, $lte: range.to } })
          .sort({ createdAt: -1 }).limit(2000).lean()
        : [];
      const wbOf = new Map(shipments.map((s) => [String(s._id), s.waybillNumber]));

      const timeline = [
        ...entries.map((e) => ({
          id: String(e._id), source: 'entry', at: e.at, kind: e.kind,
          text: e.text, location: e.location, cost: e.cost,
          waybillNumber: e.waybillNumber, shipment: e.shipment ? String(e.shipment) : null,
          driverName: e.driverName, byName: e.byName, lateEntry: e.lateEntry,
        })),
        ...shipments.map((s) => ({
          id: String(s._id), source: 'shipment', at: s.loadDate || s.createdAt, kind: 'load',
          text: [s.customerName, [s.fromCity, s.toCity].filter(Boolean).join(' ← ')].filter(Boolean).join(' · '),
          waybillNumber: s.waybillNumber, shipment: String(s._id),
          driverName: s.driverName, price: s.price, driverExpense: s.driverExpense, status: s.status,
        })),
        ...events.map((e) => ({
          id: String(e._id), source: 'event', at: e.createdAt, kind: `event:${e.type}`,
          text: e.type === 'followup'
            ? [e.data?.currentLocation, e.data?.note].filter(Boolean).join(' — ')
            : e.type === 'status'
              ? `${e.data?.from || '—'} → ${e.data?.to || '—'}`
              : (e.data?.text || ''),
          waybillNumber: wbOf.get(String(e.shipment)) || null,
          shipment: String(e.shipment), byName: e.byName,
        })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at));

      const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
      const summary = {
        loads: shipments.length,
        income: money(shipments.reduce((a, s) => a + (Number(s.price) || 0), 0)),
        driverExpense: money(shipments.reduce((a, s) => a + (Number(s.driverExpense) || 0), 0)),
        logCost: money(entries.reduce((a, e) => a + (Number(e.cost) || 0), 0)),
        entries: entries.length,
        followups: events.filter((e) => e.type === 'followup').length,
        byKind: FleetVehicleLog.LOG_KINDS.reduce((acc, k) => {
          const n = entries.filter((e) => e.kind === k).length;
          if (n) acc[k] = n;
          return acc;
        }, {}),
        // With no target of its own, the default from settings, as in analytics.
        target: (Number(vehicle.monthlyTarget) || 0) || (Number((await getFleetConfig()).defaultMonthlyTarget) || 0),
      };
      summary.net = money(summary.income - summary.driverExpense - summary.logCost);

      return { timeline, summary };
    });

    res.json({
      vehicle: { _id: vehicle._id, plate: vehicle.plate, name: vehicle.name, trailerType: vehicle.trailerType, supervisorName: vehicle.supervisorName, monthlyTarget: vehicle.monthlyTarget },
      period: { from: range.from, to: range.to, monthKey: range.monthKey, label: range.label, scope: range.scope },
      closed: FleetVehicleLog.isClosed(range.monthKey),
      kinds: FleetVehicleLog.LOG_KINDS.map((k) => ({ key: k, ...FleetVehicleLog.KIND_LABELS[k] })),
      ...payload,
      // The same rule that guards saving: a supervisor reads all vehicles and writes only his own, so a button that would be rejected is not shown.
      canWrite: await (async () => { const w = await supervisorVehicleIds(req, { forWrite: true }); return !w || w.some((id) => String(id) === String(vehicle._id)); })(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load the vehicle log' });
  }
};

/**
 * GET /api/fleet/vehicle-logs/summary?month=YYYY-MM
 * A row per vehicle: its loads, income, entry count and breakdowns in the period. The vehicle logs page is built on it.
 */
exports.getVehicleLogsSummary = async (req, res) => {
  try {
    const range = logRange(req.query);
    const scope = await supervisorVehicleIds(req);
    const vFilter = { isActive: { $ne: false } };
    if (scope) vFilter._id = { $in: scope };

    const ck = `fleet:vlogsum:${range.from.toISOString()}:${range.to.toISOString()}:${scope ? String(req.user._id) : 'all'}`;
    const rows = await cache.wrap(ck, 20000, async () => {
      const vehicles = await FleetVehicle.find(vFilter).select('plate name trailerType supervisorName monthlyTarget').sort({ plate: 1 }).lean();
      const defaultTarget = Number((await getFleetConfig()).defaultMonthlyTarget) || 0;
      const ids = vehicles.map((v) => v._id);
      const [loadAgg, entryAgg] = await Promise.all([
        FleetShipment.aggregate([
          { $match: { vehicle: { $in: ids }, loadDate: { $gte: range.from, $lte: range.to } } },
          { $group: { _id: '$vehicle', loads: { $sum: 1 }, income: { $sum: '$price' }, driverExpense: { $sum: '$driverExpense' } } },
        ]),
        FleetVehicleLog.aggregate([
          { $match: { vehicle: { $in: ids }, at: { $gte: range.from, $lte: range.to } } },
          { $group: { _id: { v: '$vehicle', k: '$kind' }, n: { $sum: 1 }, cost: { $sum: '$cost' } } },
        ]),
      ]);
      const byV = new Map(loadAgg.map((r) => [String(r._id), r]));
      const kindsByV = new Map();
      for (const r of entryAgg) {
        const k = String(r._id.v);
        if (!kindsByV.has(k)) kindsByV.set(k, { entries: 0, cost: 0, byKind: {} });
        const cur = kindsByV.get(k);
        cur.entries += r.n;
        cur.cost += r.cost || 0;
        cur.byKind[r._id.k] = r.n;
      }
      const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
      return vehicles.map((v) => {
        const l = byV.get(String(v._id)) || {};
        const e = kindsByV.get(String(v._id)) || { entries: 0, cost: 0, byKind: {} };
        const income = money(l.income);
        const driverExpense = money(l.driverExpense);
        const logCost = money(e.cost);
        return {
          _id: v._id, plate: v.plate, name: v.name, trailerType: v.trailerType,
          supervisorName: v.supervisorName, target: (Number(v.monthlyTarget) || 0) || defaultTarget,
          loads: l.loads || 0, income, driverExpense, logCost,
          net: money(income - driverExpense - logCost),
          entries: e.entries, byKind: e.byKind,
          breakdowns: (e.byKind.breakdown || 0) + (e.byKind.maintenance || 0),
        };
      });
    });

    res.json({
      period: { from: range.from, to: range.to, monthKey: range.monthKey, label: range.label, scope: range.scope },
      closed: FleetVehicleLog.isClosed(range.monthKey),
      kinds: FleetVehicleLog.LOG_KINDS.map((k) => ({ key: k, ...FleetVehicleLog.KIND_LABELS[k] })),
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load vehicle logs' });
  }
};

const CLOSED_OVERRIDE = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'fleet_manager'];

/** POST /api/fleet/vehicle-logs - a new entry on a vehicle. */
exports.createVehicleLog = async (req, res) => {
  try {
    const vehicle = await resolveVehicle(req.body.vehicle);
    if (!vehicle) return res.status(400).json({ message: 'اختر السيارة' });

    const scope = await supervisorVehicleIds(req, { forWrite: true });
    if (scope && !scope.some((id) => String(id) === String(vehicle._id))) {
      return res.status(403).json({ message: 'Not your vehicle' });
    }

    const at = req.body.at ? new Date(req.body.at) : new Date();
    if (Number.isNaN(at.getTime())) return res.status(400).json({ message: 'تاريخ غير صالح' });

    const monthKey = FleetVehicleLog.monthKeyOf(at);
    const closed = FleetVehicleLog.isClosed(monthKey);
    if (closed && !CLOSED_OVERRIDE.includes(req.user.role)) {
      return res.status(400).json({ message: `سجلّ ${monthKey} مقفل — لا يُضاف إليه إلّا من مدير القسم` });
    }

    const kind = FleetVehicleLog.LOG_KINDS.includes(req.body.kind) ? req.body.kind : 'note';
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ message: 'اكتب ما حدث' });

    let shipment = null;
    let waybillNumber = null;
    if (req.body.shipment) {
      shipment = await FleetShipment.findById(req.body.shipment).select('waybillNumber vehicle driverName').lean();
      if (shipment) {
        // A linked load must belong to this vehicle; otherwise the entry hangs on an unrelated shipment, which is worse than not linking.
        if (String(shipment.vehicle) !== String(vehicle._id)) {
          return res.status(400).json({ message: 'هذه أمر النقل ليست على هذه السيارة' });
        }
        waybillNumber = shipment.waybillNumber;
      }
    }

    const doc = await FleetVehicleLog.create({
      vehicle: vehicle._id,
      vehiclePlate: vehicle.plate,
      at,
      kind,
      text,
      location: String(req.body.location || '').trim(),
      cost: Number.isFinite(Number(req.body.cost)) ? Number(req.body.cost) : 0,
      shipment: shipment ? shipment._id : null,
      waybillNumber,
      driverName: String(req.body.driverName || shipment?.driverName || '').trim(),
      lateEntry: closed,
      by: req.user._id,
      byName: fullName(req.user),
    });

    await logAudit({ user: req.user._id, action: 'create_fleet_vehicle_log', entity: 'FleetVehicleLog', entityId: doc._id, changes: { after: { plate: vehicle.plate, kind, at } }, ipAddress: req.ip });
    emit('fleet:updated', { vehicleLog: String(doc._id) });
    res.status(201).json({ entry: doc, lateEntry: closed });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to add the log entry' });
  }
};

/** PUT /api/fleet/vehicle-logs/:id */
exports.updateVehicleLog = async (req, res) => {
  try {
    const doc = await FleetVehicleLog.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Entry not found' });

    const scope = await supervisorVehicleIds(req, { forWrite: true });
    if (scope && !scope.some((id) => String(id) === String(doc.vehicle))) {
      return res.status(403).json({ message: 'Not your vehicle' });
    }
    if (FleetVehicleLog.isClosed(doc.monthKey) && !CLOSED_OVERRIDE.includes(req.user.role)) {
      return res.status(400).json({ message: `سجلّ ${doc.monthKey} مقفل — لا يُعدَّل` });
    }

    if (req.body.at !== undefined) {
      const at = new Date(req.body.at);
      if (Number.isNaN(at.getTime())) return res.status(400).json({ message: 'تاريخ غير صالح' });
      const mk = FleetVehicleLog.monthKeyOf(at);
      if (FleetVehicleLog.isClosed(mk) && !CLOSED_OVERRIDE.includes(req.user.role)) {
        return res.status(400).json({ message: `لا يُنقل القيد إلى شهرٍ مقفل (${mk})` });
      }
      doc.at = at;
    }
    if (req.body.kind !== undefined && FleetVehicleLog.LOG_KINDS.includes(req.body.kind)) doc.kind = req.body.kind;
    if (req.body.text !== undefined) doc.text = String(req.body.text).trim();
    if (req.body.location !== undefined) doc.location = String(req.body.location).trim();
    if (req.body.cost !== undefined) doc.cost = Number.isFinite(Number(req.body.cost)) ? Number(req.body.cost) : 0;
    if (req.body.driverName !== undefined) doc.driverName = String(req.body.driverName).trim();

    await doc.save();
    emit('fleet:updated', { vehicleLog: String(doc._id) });
    res.json({ entry: doc });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update the entry' });
  }
};

/** DELETE /api/fleet/vehicle-logs/:id */
exports.deleteVehicleLog = async (req, res) => {
  try {
    const doc = await FleetVehicleLog.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Entry not found' });
    const scope = await supervisorVehicleIds(req, { forWrite: true });
    if (scope && !scope.some((id) => String(id) === String(doc.vehicle))) {
      return res.status(403).json({ message: 'Not your vehicle' });
    }
    if (FleetVehicleLog.isClosed(doc.monthKey) && !CLOSED_OVERRIDE.includes(req.user.role)) {
      return res.status(400).json({ message: `سجلّ ${doc.monthKey} مقفل — لا يُحذف منه` });
    }
    await doc.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_fleet_vehicle_log', entity: 'FleetVehicleLog', entityId: doc._id, changes: { before: { plate: doc.vehiclePlate, kind: doc.kind } }, ipAddress: req.ip });
    emit('fleet:updated', { vehicleLog: String(doc._id) });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete the entry' });
  }
};

// Vehicle health - GET /api/fleet/health
// The trucks are ours and fleet tracks them, but their live numbers (tyre pressure and temperature, coolant, maintenance, alerts) were in a section fleet supervisors do not open. The source is one, not a copy: it is read from `Ls2Vehicle` on every call.
// A supervisor sees only his vehicles via `supervisorVehicleIds`, the same one used across the section.
exports.getFleetHealth = async (req, res) => {
  try {
    const Ls2Alert = require('../models/Ls2Alert');

    const vFilter = { isActive: { $ne: false } };
    const scope = await supervisorVehicleIds(req);
    if (scope) vFilter._id = { $in: scope };

    const vehicles = await FleetVehicle.find(vFilter).sort({ plate: 1 }).limit(500).lean();

    const [ls2, drivers, openAlerts] = await Promise.all([
      Ls2Vehicle.find({})
        .select([
          'unitId plate name status lastMessageAt position moving speed',
          'coolantC fuelPct odometerKm engineHours mainPowerV',
          'tires tireCount maxTireTempC minTireTempC maxTirePressurePsi minTirePressurePsi tireFaults tiresCarriedOver',
          'maintenanceStatus kmToService nextServiceName lastServiceKm',
        ].join(' ')).lean(),
      FleetDriver.find({ isActive: { $ne: false }, vehicle: { $ne: null }, ...(await noArchDrv()) })
        .select('name phone working vehicle employee').lean()
        .then(FI.decorateDrivers),
      // Open ones only: a closed alert is finished work, and showing it mixes what must be done today with what was done last week.
      Ls2Alert.find({ status: 'open' })
        .select('unitId type severity message firstSeenAt value threshold unit').lean(),
    ]);

    const liveByKey = new Map();
    for (const lv of ls2) {
      const k = vehiclePlateKey(lv);
      if (k) liveByKey.set(k, lv);
    }
    const alertsByUnit = new Map();
    for (const a of openAlerts) {
      const arr = alertsByUnit.get(a.unitId) || [];
      arr.push(a);
      alertsByUnit.set(a.unitId, arr);
    }
    const driversByVehicle = new Map();
    for (const d of drivers) {
      const k = String(d.vehicle);
      const arr = driversByVehicle.get(k) || [];
      arr.push({ name: d.name, phone: d.phone, working: d.working });
      driversByVehicle.set(k, arr);
    }

    // Cold threshold is two hours
    // The device reports every few minutes, so two hours of silence is an outage, not calm; a two-hour-old reading is shown as last received, not now, or a decision would rest on a dead number.
    const STALE_MS = 2 * 3600 * 1000;
    const now = Date.now();

    const rows = vehicles.map((v) => {
      const lv = liveByKey.get(plateKey(v.plate)) || null;
      const alerts = lv ? (alertsByUnit.get(lv.unitId) || []) : [];
      const lastAt = lv?.lastMessageAt ? new Date(lv.lastMessageAt).getTime() : 0;
      const stale = !lastAt || now - lastAt > STALE_MS;
      return {
        _id: v._id,
        plate: v.plate,
        name: v.name || '',
        trailerType: v.trailerType || '',
        supervisorName: v.supervisorName || '',
        drivers: driversByVehicle.get(String(v._id)) || [],
        // A truck without a device is stated, not hidden
        // Hiding it makes the screen look complete when it is not, and every truck would be assumed monitored. It is the first thing to fix: a device gets installed.
        tracked: !!lv,
        stale,
        lastMessageAt: lv?.lastMessageAt || null,
        moving: lv?.moving ?? null,
        speed: lv?.speed ?? null,
        coolantC: lv?.coolantC ?? null,
        fuelPct: lv?.fuelPct ?? null,
        odometerKm: lv?.odometerKm ?? null,
        engineHours: lv?.engineHours ?? null,
        mainPowerV: lv?.mainPowerV ?? null,
        tires: {
          count: lv?.tireCount ?? 0,
          maxTempC: lv?.maxTireTempC ?? null,
          minTempC: lv?.minTireTempC ?? null,
          maxPressurePsi: lv?.maxTirePressurePsi ?? null,
          minPressurePsi: lv?.minTirePressurePsi ?? null,
          faults: lv?.tireFaults ?? 0,
          // A reading carried over from an earlier heartbeat: shown but no alarm is built on it.
          carriedOver: !!lv?.tiresCarriedOver,
          list: (lv?.tires || []).map((t) => ({
            position: t.position || '', tempC: t.tempC ?? null, pressurePsi: t.pressurePsi ?? null, fault: !!t.fault,
          })),
        },
        maintenance: lv ? {
          status: lv.maintenanceStatus || 'ok',
          kmToService: lv.kmToService ?? null,
          nextServiceName: lv.nextServiceName || '',
        } : null,
        alerts: alerts.map((a) => ({
          type: a.type, severity: a.severity, message: a.message, firstSeenAt: a.firstSeenAt,
          value: a.value, threshold: a.threshold, unit: a.unit,
        })),
        alertCount: alerts.length,
        unitId: lv?.unitId ?? null,
      };
    });

    // Order: what needs work first
    // The screen is read from the top, so a truck with an alert or overdue maintenance precedes one with nothing. Alphabetical order turns reading into searching.
    const weight = (r) => (r.alerts.some((a) => a.severity === 'critical') ? 5 : r.alertCount ? 3 : 0)
      + (r.maintenance?.status === 'overdue' ? 2 : r.maintenance?.status === 'due' ? 1 : 0)
      + (r.tires.faults ? 2 : 0);
    rows.sort((a, b) => weight(b) - weight(a) || String(a.plate).localeCompare(String(b.plate)));

    res.json({
      vehicles: rows,
      totals: {
        total: rows.length,
        untracked: rows.filter((r) => !r.tracked).length,
        stale: rows.filter((r) => r.tracked && r.stale).length,
        alerts: rows.reduce((s, r) => s + r.alertCount, 0),
        withAlerts: rows.filter((r) => r.alertCount).length,
        critical: rows.filter((r) => r.alerts.some((a) => a.severity === 'critical')).length,
        maintenanceOverdue: rows.filter((r) => r.maintenance?.status === 'overdue').length,
        maintenanceDue: rows.filter((r) => r.maintenance?.status === 'due').length,
        tireFaults: rows.filter((r) => r.tires.faults > 0).length,
        moving: rows.filter((r) => r.moving).length,
      },
    });
  } catch (error) {
    console.error('getFleetHealth error:', error);
    res.status(500).json({ message: 'تعذّر تحميل حالة المركبات' });
  }
};

// Driver expenses: what the man is owed per load and whether it was paid
/**
 * The page answers one accounting question: who do we transfer to today and how much?
 * It creates no data: the amount is `driverExpense` written at load creation, with the Friday bonus already added (see `createShipment`), so a paid number is never recomputed if the bonus setting changes.
 * The IBAN is read from the driver's file; with two drivers only the first's IBAN shows, as recipient.
 */
exports.getDriverExpenses = async (req, res) => {
  try {
    const q = req.query || {};
    const match = { driverExpense: { $gt: 0 } };

    // A day, range or month, measured on loading date and not the row creation instant.
    const monthRange = (mk) => {
      const [y, m] = String(mk).split('-').map(Number);
      if (!y || !m) return null;
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      return [_month(ym), _month(_monthKeyShift(ym, 1))]; // Riyadh month
    };
    let from = null; let to = null;
    if (q.month && monthRange(q.month)) [from, to] = monthRange(q.month);
    else {
      if (q.from) from = _dayStart(q.from);
      if (q.to) to = _day(_keyShift(String(q.to).slice(0, 10), 1));
    }
    if (from || to) {
      match.loadDate = {};
      if (from) match.loadDate.$gte = from;
      if (to) match.loadDate.$lt = to;
    }
    if (q.paid === '1') match.driverExpensePaid = true;
    if (q.paid === '0') match.driverExpensePaid = { $ne: true };
    if (q.driver && mongoose.isValidObjectId(q.driver)) match.driver = new mongoose.Types.ObjectId(String(q.driver));
    if (q.search) {
      const rx = require('../utils/arabicSearch').arabicSearchRegex(String(q.search));
      const asNum = Number(q.search);
      match.$or = [
        { driverName: rx }, { vehiclePlate: rx }, { secondDriverName: rx },
        ...(Number.isFinite(asNum) ? [{ waybillNumber: asNum }] : []),
      ];
    }
    // A supervisor reads everything now (see supervisorVehicleIds), and the restriction stays defined in one place, so if the policy is reversed it is reversed here with it.
    const scope = await supervisorVehicleIds(req);
    if (scope) match.vehicle = { $in: scope };

    // The IBAN is joined in the database, not in Node: a thousand rows times a call per driver would be a thousand queries over a throughput-limited link.
    const rows = await FleetShipment.aggregate([
      { $match: match },
      { $sort: { loadDate: -1, waybillNumber: -1 } },
      { $limit: 5000 },
      { $lookup: { from: 'fleetdrivers', localField: 'driver', foreignField: '_id', as: '_d' } },
      { $project: {
        waybillNumber: 1, vehiclePlate: 1, loadDate: 1, driverExpense: 1,
        driverName: 1, secondDriverName: 1, fridayBonus: 1,
        fromCity: 1, toCity: 1, supervisorName: 1, status: 1,
        driverExpensePaid: 1, driverExpensePaidAt: 1, driverExpensePaidByName: 1,
        driverIban: { $ifNull: [{ $first: '$_d.iban' }, ''] },
        driverPhone: { $ifNull: [{ $first: '$_d.phone' }, '$driverPhone'] },
      } },
    ]).allowDiskUse(true);

    // Cards are computed over the whole match, not the page, which is the reason they exist.
    const [sum] = await FleetShipment.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        loads: { $sum: 1 },
        total: { $sum: '$driverExpense' },
        paid: { $sum: { $cond: ['$driverExpensePaid', '$driverExpense', 0] } },
        unpaid: { $sum: { $cond: ['$driverExpensePaid', 0, '$driverExpense'] } },
        paidLoads: { $sum: { $cond: ['$driverExpensePaid', 1, 0] } },
        fridays: { $sum: { $cond: ['$fridayBonus', 1, 0] } },
        drivers: { $addToSet: '$driver' },
      } },
      { $project: { loads: 1, total: 1, paid: 1, unpaid: 1, paidLoads: 1, fridays: 1, driverCount: { $size: '$drivers' } } },
    ]);

    res.json({
      rows,
      summary: sum || { loads: 0, total: 0, paid: 0, unpaid: 0, paidLoads: 0, fridays: 0, driverCount: 0 },
      capped: rows.length >= 5000,
    });
  } catch (e) {
    console.error('getDriverExpenses', e);
    res.status(500).json({ message: 'تعذّر تحميل مصاريف السوّاق' });
  }
};

/**
 * Mark as paid out - the accounting action.
 * Accepts one row or several: accounting transfers to twenty drivers in one batch, and marking row by row would be twenty calls and twenty chances to forget one.
 */
exports.setDriverExpensePaid = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.params.id])
      .filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length) return res.status(400).json({ message: 'لا صفوفَ محدَّدة' });
    const paid = req.body.paid !== false;
    const me = await User.findById(req.user._id).select('firstName lastName').lean();
    const $set = paid
      ? {
        driverExpensePaid: true,
        driverExpensePaidAt: new Date(),
        driverExpensePaidBy: req.user._id,
        driverExpensePaidByName: [me?.firstName, me?.lastName].filter(Boolean).join(' '),
      }
      // Clearing the flag erases its trace: paid by someone under an unpaid row is false.
      : { driverExpensePaid: false, driverExpensePaidAt: null, driverExpensePaidBy: null, driverExpensePaidByName: '' };
    const r = await FleetShipment.updateMany({ _id: { $in: ids } }, { $set });
    await logAudit({
      user: req.user._id, action: paid ? 'pay_driver_expense' : 'unpay_driver_expense',
      entity: 'FleetShipment', changes: { after: { count: ids.length } }, ipAddress: req.ip,
    });
    emit('fleet:driverExpense', {});
    res.json({ updated: r.modifiedCount ?? 0, paid });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر حفظ حالة السداد');
  }
};
