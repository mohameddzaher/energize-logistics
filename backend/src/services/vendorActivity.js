/**
 * Vendor activity, read live from the shipments.
 * A shipment names its carrier by reference (newer rows) or only by the name the platform wrote, in many spellings,
 * so every row is resolved to one register row through the folded name and the register's aliases. Our own trucks
 * (owner named تنشيط, or a plate in the LS2 fleet) are "fleet", never a vendor.
 */
const ShipmentOrder = require('../models/ShipmentOrder');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const cache = require('../utils/ttlCache');
const { startOfDay, endOfDay, todayKey } = require('../utils/companyDay');

const fold = ShipmentOrderSupplier.foldName;
const TZ = 'Asia/Riyadh';
const FLEET_RX = /تنشيط/;
const COMPANY_RX = /(شركة|شركه|مؤسسة|مؤسسه|مكتب|للنقل|النقليات|نقليات|logist|transport|trading|co\.|est\.)/i;

/** Register rows by folded name, and our fleet's plates. Cached briefly; any register write clears `so:registry:`. */
async function resolver() {
  return cache.wrap('so:registry:vendor-resolver', 60 * 1000, async () => {
    const rows = await ShipmentOrderSupplier.find({ mergedInto: null })
      .select('name type inMaster masterNo followOwner contractStatus vendorSigned ourSigned taxClass headOffice destinations vehicleTypes fleetSize phone representative energizeRep aliasKeys isActive leadPriority rating')
      .lean();
    const byKey = new Map();
    const byId = new Map();
    // Master carriers claim their names first: the same carrier often has older register rows under other spellings, and its trips belong to the master row.
    const ordered = [...rows.filter((r) => r.inMaster), ...rows.filter((r) => !r.inMaster)];
    for (const r of ordered) {
      byId.set(String(r._id), r);
      for (const k of [fold(r.name), ...(r.aliasKeys || [])]) if (k && !byKey.has(k)) byKey.set(k, r);
    }
    // A non-master row whose name a master carrier claims is that carrier.
    for (const r of rows) {
      if (r.inMaster) continue;
      const m = [fold(r.name), ...(r.aliasKeys || [])].map((k) => byKey.get(k)).find((x) => x && x.inMaster);
      if (m) byId.set(String(r._id), m);
    }
    // Merged rows point at their survivor; their names still resolve to it.
    const merged = await ShipmentOrderSupplier.find({ mergedInto: { $ne: null } }).select('name mergedInto aliasKeys').lean();
    for (const m of merged) {
      const target = byId.get(String(m.mergedInto));
      if (!target) continue;
      byId.set(String(m._id), target);
      for (const k of [fold(m.name), ...(m.aliasKeys || [])]) if (k && !byKey.has(k)) byKey.set(k, target);
    }
    let plates = new Set();
    try {
      const { canonicalPlateKey } = require('../utils/plateKey');
      const Ls2Vehicle = require('../models/Ls2Vehicle');
      const vs = await Ls2Vehicle.find({}).select('plate plateNumber').lean();
      plates = new Set(vs.map((v) => canonicalPlateKey ? canonicalPlateKey(v.plate || v.plateNumber || '') : '').filter(Boolean));
    } catch (_) { /* no fleet register: the name rule still applies */ }
    return { byKey, byId, plates };
  });
}

/** Who carried a shipment: { kind: fleet|master|outside|freelancer|none, vendor (register row or null), name }. */
function classify(R, supplierId, supplierName, plate) {
  const name = String(supplierName || '').trim();
  let plateKey = '';
  try { plateKey = plate ? require('../utils/plateKey').canonicalPlateKey(plate) : ''; } catch (_) { /* */ }
  if (FLEET_RX.test(name) || (plateKey && R.plates.has(plateKey))) return { kind: 'fleet', vendor: null, name: 'أسطول تنشيط' };
  const byName = name ? R.byKey.get(fold(name)) : null;
  const byRef = supplierId ? R.byId.get(String(supplierId)) : null;
  // The master carrier wins when either the reference or the written name points at it.
  const v = (byName && byName.inMaster ? byName : null) || byRef || byName;
  if (v) {
    if (FLEET_RX.test(v.name)) return { kind: 'fleet', vendor: null, name: 'أسطول تنشيط' };
    // Platform owners were all registered as companies; a non-master row named like a person is a freelance driver.
    const kind = v.inMaster ? 'master' : (v.type === 'freelancer' || !COMPANY_RX.test(v.name)) ? 'freelancer' : 'outside';
    return { kind, vendor: v, name: v.name };
  }
  if (!name) return { kind: 'none', vendor: null, name: '' };
  return { kind: COMPANY_RX.test(name) ? 'outside' : 'freelancer', vendor: null, name };
}

/** A carrier's trend from its monthly trips, as the vendors team reads it. */
function trendOf(mon, firstMonthIdx, total, curMonth) {
  if (!total) return 'never';
  if (firstMonthIdx >= curMonth - 2) return 'new';
  const last3 = (mon[curMonth] || 0) + (mon[curMonth - 1] || 0) + (mon[curMonth - 2] || 0);
  if (!last3) return 'stopped';
  const recent = ((mon[curMonth - 1] || 0) + (mon[curMonth - 2] || 0) + (mon[curMonth - 3] || 0)) / 3;
  const early = mon.slice(0, Math.max(1, curMonth - 3));
  const base = early.reduce((a, b) => a + b, 0) / Math.max(1, early.length);
  if (!base) return 'new';
  const ch = (recent - base) / base;
  return ch >= 0.2 ? 'up' : ch <= -0.2 ? 'down' : 'steady';
}

/**
 * Per-vendor yearly picture: trips per month, purchase, first and last trip, and the trend.
 * Executed shipments only (cancelled are not trips). `year` defaults to the current one; `curMonth` is the month of `asOf`.
 */
async function yearly({ year, asOf, extra = null } = {}) {
  const today = asOf || todayKey();
  const y = Number(year) || Number(today.slice(0, 4));
  // `extra`: the page's shipment filters (branch, customer, route, truck, ops rep, payment) as one match.
  const key = `so:analytics:vendor-yearly:${y}:${today}:${extra ? JSON.stringify(extra) : ''}`;
  return cache.wrapStale(key, 60 * 1000, 10 * 60 * 1000, async () => {
    const R = await resolver();
    const rows = await ShipmentOrder.aggregate([
      { $match: { pickupTime: { $gte: startOfDay(`${y}-01-01`), $lte: endOfDay(`${y}-12-31`) }, status: { $ne: 'cancelled' }, ...(extra || {}) } },
      { $group: {
        _id: { s: '$supplier', n: '$supplierName', p: '$vehiclePlate', m: { $month: { date: '$pickupTime', timezone: TZ } } },
        trips: { $sum: 1 }, buy: { $sum: { $ifNull: ['$buyPrice', 0] } },
        first: { $min: '$pickupTime' }, last: { $max: '$pickupTime' },
      } },
    ]).allowDiskUse(true);
    // Every-time first trip per name, to tell a newly activated carrier from an old one.
    const firstEver = await ShipmentOrder.aggregate([
      { $match: { status: { $ne: 'cancelled' }, pickupTime: { $ne: null } } },
      { $group: { _id: { s: '$supplier', n: '$supplierName' }, first: { $min: '$pickupTime' } } },
    ]).allowDiskUse(true);
    const vendors = new Map();
    const get = (c) => {
      const id = c.vendor ? String(c.vendor._id) : `name:${fold(c.name)}`;
      let v = vendors.get(id);
      if (!v) {
        v = { id, vendorId: c.vendor ? String(c.vendor._id) : null, name: c.name, kind: c.kind, mon: new Array(12).fill(0), buyMon: new Array(12).fill(0), trips: 0, buy: 0, first: null, last: null, firstEver: null, names: new Set() };
        vendors.set(id, v);
      }
      return v;
    };
    let fleet = { trips: 0, buy: 0, mon: new Array(12).fill(0) };
    for (const r of rows) {
      const c = classify(R, r._id.s, r._id.n, r._id.p);
      const m = (r._id.m || 1) - 1;
      if (c.kind === 'fleet') { fleet.trips += r.trips; fleet.buy += r.buy; fleet.mon[m] += r.trips; continue; }
      if (c.kind === 'none') continue;
      const v = get(c);
      v.mon[m] += r.trips; v.buyMon[m] += r.buy; v.trips += r.trips; v.buy += r.buy;
      if (!v.first || r.first < v.first) v.first = r.first;
      if (!v.last || r.last > v.last) v.last = r.last;
      if (r._id.n) v.names.add(String(r._id.n).trim());
    }
    for (const r of firstEver) {
      const c = classify(R, r._id.s, r._id.n, '');
      if (c.kind === 'fleet' || c.kind === 'none') continue;
      const id = c.vendor ? String(c.vendor._id) : `name:${fold(c.name)}`;
      const v = vendors.get(id);
      if (v && (!v.firstEver || r.first < v.firstEver)) v.firstEver = r.first;
    }
    const curMonth = Number(today.slice(5, 7)) - 1;
    const sameYear = Number(today.slice(0, 4)) === y;
    const cm = sameYear ? curMonth : 11;
    const list = [...vendors.values()].map((v) => {
      const firstIdx = v.first ? new Date(v.first).getUTCMonth() : 12;
      const out = { ...v, names: [...v.names], trend: trendOf(v.mon, firstIdx, v.trips, cm) };
      out.activeLast3 = (v.mon[cm] || 0) + (v.mon[cm - 1] || 0) + (v.mon[cm - 2] || 0) > 0;
      out.activeThisMonth = (v.mon[cm] || 0) > 0;
      out.activeMonths = v.mon.filter((x) => x > 0).length;
      return out;
    });
    return { year: y, curMonth: cm, vendors: list, fleet };
  });
}

/** Compact executed-and-cancelled rows of a span, for the daily page and the vendor card. */
async function spanRows({ from, to, branch, extra = {} }) {
  const match = { pickupTime: { $gte: startOfDay(from), $lte: endOfDay(to) }, ...extra };
  if (branch) match.branch = branch;
  return ShipmentOrder.find(match)
    .select('pickupTime createdAt branch customerName fromCity toCity status cancelReason buyPrice sellPrice supplier supplierName vehiclePlate driverName agentName paymentSubtype salesRepName truckType shipmentRequest waybillNumber createdBy')
    .lean();
}

module.exports = { resolver, classify, yearly, spanRows, fold, trendOf, FLEET_RX };
