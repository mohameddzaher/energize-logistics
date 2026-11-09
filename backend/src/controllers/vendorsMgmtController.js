/**
 * Vendors management: the carrier register as the vendors team works it, and its two analyses (the section picture
 * and the daily operation). Every activity figure is computed from the shipments (services/vendorActivity); the
 * register holds only what the team knows about a carrier (contract, contacts, follow-ups, approved prices).
 */
const mongoose = require('mongoose');
const ShipmentOrder = require('../models/ShipmentOrder');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const ShipmentOrderVehicle = require('../models/ShipmentOrderVehicle');
const ShipmentOrderDriver = require('../models/ShipmentOrderDriver');
const ShipmentRequest = require('../models/ShipmentRequest');
const { VendorFollowUp, VendorApprovedPrice, VendorSetting } = require('../models/VendorsMgmt');
const VA = require('../services/vendorActivity');
const PV = require('../config/priceView');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const { startOfDay, endOfDay, todayKey } = require('../utils/companyDay');
const { sendMongooseError } = require('../utils/mongooseError');

const EVENT = 'vendors:changed';
const fold = VA.fold;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (a, b) => (b ? r2((a / b) * 100) : 0);
const fullName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const announce = (payload = {}) => {
  cache.clear('so:registry:');
  cache.clear('so:analytics:vendor-yearly');
  cache.clear('so:analytics:vm-');
  try { emitToAll(EVENT, payload); } catch (_) { /* */ }
  try { emitToAll('shipmentOrders:fleet', {}); } catch (_) { /* */ }
};
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const signedOf = (v) => !!v && (/موقع/.test(v.contractStatus || '') || (v.vendorSigned && v.ourSigned));
/** The day the picture is read as of: the end of the asked month (YYYY-MM), never after today. */
const asOfOf = (q) => {
  const today = todayKey();
  const m = String(q.month || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return today;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
  return last < today ? last : today;
};
const yearOf = (q) => { const a = asOfOf(q); return { year: Number(a.slice(0, 4)), asOf: a }; };

/** The page filters on the shipments themselves (branch, customer, route, truck, ops rep, payment), as one match or null. */
async function shipmentFilter(q) {
  const and = await require('./shipmentInsightsController').filterMatch(q || {});
  return and.length ? { $and: and } : null;
}
const listOf = (v) => (v == null || v === '' ? [] : (Array.isArray(v) ? v : [v]).map(String).filter(Boolean));
/** Filters on the carrier itself: kind, follow-up owner, contract status. */
const carrierFilter = (q) => {
  const kinds = listOf(q.f_kind); const owners = listOf(q.f_owner); const contracts = listOf(q.f_contract);
  if (!kinds.length && !owners.length && !contracts.length) return null;
  return (kind, reg) => (!kinds.length || kinds.includes(kind))
    && (!owners.length || owners.includes(reg?.followOwner || '__none'))
    && (!contracts.length || contracts.includes(reg?.contractStatus || '__none'));
};

const KIND_AR = { fleet: 'أسطول تنشيط', master: 'معتمد', outside: 'غير معتمد (شركات)', freelancer: 'سائق فرد', none: 'غير محدّد' };

// ── Section picture ─────────────────────────────────────────────────────────

/** GET /overview?year= — the section as the vendors manager reads it. */
exports.overview = async (req, res) => {
  try {
    const extra = await shipmentFilter(req.query);
    const keepC = carrierFilter(req.query);
    const Y0 = await VA.yearly({ ...yearOf(req.query), extra });
    const R0 = keepC ? await VA.resolver() : null;
    const Y = keepC ? { ...Y0, vendors: Y0.vendors.filter((v) => keepC(v.kind, v.vendorId ? R0.byId.get(v.vendorId) : null)) } : Y0;
    const out = await cache.wrapStale(`so:analytics:vm-overview:${Y.year}:${Y.curMonth}:${JSON.stringify(req.query || {})}`, 60 * 1000, 10 * 60 * 1000, async () => {
      const master = (await ShipmentOrderSupplier.find({ inMaster: true, mergedInto: null })
        .select('name followOwner contractStatus vendorSigned ourSigned taxClass phone representative headOffice vehicleTypes fleetSize financeCode contractDate destinations masterNo').lean())
        .filter((m) => !keepC || keepC('master', m));
      const actById = new Map(Y.vendors.filter((v) => v.vendorId).map((v) => [v.vendorId, v]));
      const cm = Y.curMonth;
      const masterRows = master.map((m) => {
        const a = actById.get(String(m._id));
        return { ...m, trips: a?.trips || 0, mon: a?.mon || new Array(12).fill(0), trend: a?.trend || 'never', activeLast3: !!a?.activeLast3, activeThisMonth: !!a?.activeThisMonth, last: a?.last || null, signed: signedOf(m) };
      });
      const ext = Y.vendors.filter((v) => v.kind !== 'fleet');
      // Trips per month by kind and the master share of external trips.
      const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, master: 0, outside: 0, freelancer: 0, fleet: Y.fleet.mon[i] || 0 }));
      for (const v of ext) for (let i = 0; i < 12; i += 1) months[i][v.kind] = (months[i][v.kind] || 0) + (v.mon[i] || 0);
      for (const m of months) { const e = m.master + m.outside + m.freelancer; m.external = e; m.masterShare = pct(m.master, e); }
      // Carriers whose first ever trip fell in each month: how many are activated monthly.
      const activations = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, master: 0, outside: 0, freelancer: 0, list: [] }));
      for (const v of ext) {
        if (!v.firstEver) continue;
        const d = new Date(v.firstEver);
        if (d.getUTCFullYear() !== Y.year) continue;
        const a = activations[d.getUTCMonth()];
        a.total += 1; a[v.kind] = (a[v.kind] || 0) + 1;
        const reg = v.vendorId ? actById.get(v.vendorId) : null;
        const owner = v.vendorId ? (master.find((m) => String(m._id) === v.vendorId)?.followOwner || '') : '';
        a.list.push({ id: v.vendorId, name: v.name, kind: v.kind, owner, first: isoDay(v.firstEver), monthTrips: v.mon[d.getUTCMonth()] || 0, trips: v.trips, _r: !!reg });
      }
      for (const a of activations) { a.list.sort((x, y) => (x.first < y.first ? -1 : 1)); a.list.forEach((x) => delete x._r); }
      // The team: master carriers per follow-up owner, how many work, how much.
      const team = {};
      const masterTrips = masterRows.reduce((s, m) => s + m.trips, 0);
      for (const m of masterRows) {
        const k = m.followOwner || 'غير موزَّع';
        const t = team[k] || (team[k] = { owner: k, vendors: 0, active3: 0, activeMonth: 0, stopped: 0, never: 0, trips: 0, signed: 0, signedActive: 0, signedInactive: 0 });
        t.vendors += 1; t.trips += m.trips;
        if (m.activeLast3) t.active3 += 1; else if (m.trips) t.stopped += 1; else t.never += 1;
        if (m.activeThisMonth) t.activeMonth += 1;
        if (m.signed) { t.signed += 1; if (m.activeLast3) t.signedActive += 1; else t.signedInactive += 1; }
      }
      const teamRows = Object.values(team).map((t) => ({ ...t, activity: pct(t.active3, t.vendors), tripsShare: pct(t.trips, masterTrips) }))
        .sort((a, b) => b.vendors - a.vendors);
      const count = (arr, f) => arr.reduce((acc, x) => { const k = f(x) || '—'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
      const trendMaster = count(masterRows, (m) => m.trend);
      const leads = ext.filter((v) => v.kind === 'outside');
      const extTrips = ext.reduce((s, v) => s + v.trips, 0);
      const ym = Y.vendors.filter((v) => v.kind !== 'fleet' && v.activeThisMonth);
      return {
        year: Y.year, curMonth: cm + 1,
        kpis: {
          masterVendors: master.length,
          masterActive3: masterRows.filter((m) => m.activeLast3).length,
          masterActiveMonth: masterRows.filter((m) => m.activeThisMonth).length,
          masterSigned: masterRows.filter((m) => m.signed).length,
          signedInactive: masterRows.filter((m) => m.signed && !m.activeLast3).length,
          activeUnsigned: masterRows.filter((m) => !m.signed && m.activeLast3).length,
          masterStopped: masterRows.filter((m) => m.trend === 'stopped').length,
          masterNever: masterRows.filter((m) => !m.trips).length,
          leadsActive3: leads.filter((v) => v.activeLast3).length,
          freelancersActive3: ext.filter((v) => v.kind === 'freelancer' && v.activeLast3).length,
          vendorsActiveMonth: ym.length,
          externalTrips: extTrips,
          fleetTrips: Y.fleet.trips,
          masterShare: pct(ext.filter((v) => v.kind === 'master').reduce((s, v) => s + v.trips, 0), extTrips),
          purchase: r2(ext.reduce((s, v) => s + v.buy, 0)),
          avgTrip: extTrips ? r2(ext.reduce((s, v) => s + v.buy, 0) / extTrips) : 0,
          newThisMonth: activations[cm]?.total || 0,
        },
        months, activations, team: teamRows,
        trendMaster,
        contractStatus: count(master, (m) => m.contractStatus),
        taxClass: count(master, (m) => m.taxClass),
        kinds: ['master', 'outside', 'freelancer'].map((k) => {
          const vs = ext.filter((v) => v.kind === k);
          const trips = vs.reduce((s, v) => s + v.trips, 0);
          return { kind: k, label: KIND_AR[k], vendors: vs.length, active3: vs.filter((v) => v.activeLast3).length, trips, share: pct(trips, extTrips), buy: r2(vs.reduce((s, v) => s + v.buy, 0)) };
        }),
        topVendors: ext.slice().sort((a, b) => b.trips - a.trips).slice(0, 15).map((v) => ({ id: v.vendorId, name: v.name, kind: v.kind, trips: v.trips, buy: r2(v.buy), month: v.mon[cm] || 0, trend: v.trend, last: isoDay(v.last) })),
        signedInactiveList: masterRows.filter((m) => m.signed && !m.activeLast3).sort((a, b) => b.trips - a.trips)
          .map((m) => ({ id: String(m._id), name: m.name, owner: m.followOwner, trips: m.trips, last: isoDay(m.last), phone: m.phone, headOffice: m.headOffice })),
        activeLast3List: masterRows.filter((m) => m.activeLast3).sort((a, b) => b.trips - a.trips)
          .map((m) => ({ id: String(m._id), name: m.name, owner: m.followOwner, contractStatus: m.contractStatus, trips: m.trips, month: m.mon[cm] || 0, trend: m.trend, last: isoDay(m.last) })),
      };
    });
    res.json(PV.maskMoney(req.user, out));
  } catch (e) {
    console.error('[vendors] overview:', e);
    res.status(500).json({ message: 'تعذّر حساب تحليل القسم' });
  }
};

// ── Daily operation ─────────────────────────────────────────────────────────

/** Who a cancellation is on, in the vendors team's five buckets. */
const blameOf = (reason) => {
  const r = String(reason || '');
  if (!r) return 'none';
  if (/مندوب/.test(r)) return 'rep';
  if (/شاحن|سيار|تتوفر|تتوفّر|سطح/.test(r)) return 'noTruck';
  if (/سائق/.test(r)) return 'driver';
  if (/عميل/.test(r)) return 'customer';
  return 'other';
};

async function targets() {
  const s = await VendorSetting.findById('targets').lean();
  return { daily: Number(s?.value?.daily) || 0, monthly: Number(s?.value?.monthly) || 0, byBranch: s?.value?.byBranch || {} };
}

/** GET /daily?from&to&branch — the day-by-day operation as the vendors team follows it. */
exports.daily = async (req, res) => {
  try {
    const today = todayKey();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : `${today.slice(0, 7)}-01`;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : today;
    const branch = String(req.query.branch || '');
    const key = `so:analytics:vm-daily:${JSON.stringify(req.query || {})}:${from}:${to}`;
    const out = await cache.wrapStale(key, 45 * 1000, 10 * 60 * 1000, async () => {
      const R = await VA.resolver();
      const extra = await shipmentFilter(req.query);
      const keepC = carrierFilter(req.query);
      const [rows0, T] = await Promise.all([VA.spanRows({ from, to, branch, extra: extra || {} }), targets()]);
      const rows = keepC ? rows0.filter((o) => { const c = VA.classify(R, o.supplier, o.supplierName, o.vehiclePlate); return keepC(c.kind, c.vendor); }) : rows0;
      // Who on the vendors team placed each shipment: the request's placer, or a vendors-role creator.
      const reqIds = [...new Set(rows.map((o) => o.shipmentRequest && String(o.shipmentRequest)).filter(Boolean))];
      const reqs = reqIds.length ? await ShipmentRequest.find({ _id: { $in: reqIds } }).select('placed').lean() : [];
      const placer = new Map();
      for (const r of reqs) for (const p of r.placed || []) placer.set(String(p.order), p.byName || '');
      const creators = [...new Set(rows.map((o) => o.createdBy && String(o.createdBy)).filter(Boolean))];
      const users = creators.length ? await require('../models/User').find({ _id: { $in: creators }, role: { $in: PV.VENDOR_ROLES } }).select('firstName lastName').lean() : [];
      const vendorUser = new Map(users.map((u) => [String(u._id), fullName(u)]));

      const days = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1);
      const dayKey = (d) => new Date(new Date(d).getTime() + 3 * 3600000).toISOString().slice(0, 10);
      const byDay = new Map();
      const kinds = {};
      const payments = {};
      const blameBranch = {};
      const branchKinds = {};
      const branches = {};
      const customers = {};
      const vendors = {};
      const opsReps = {};
      const helpers = {};
      const helperBranch = {};
      const routes = {};
      const dests = {};
      const fleetBranch = {};
      const fleetCustomer = {};
      let total = 0; let done = 0; let buy = 0; let buyExt = 0; let fleetTrips = 0;
      const add = (obj, k, init) => (obj[k] || (obj[k] = init()));

      for (const o of rows) {
        const d = dayKey(o.pickupTime);
        const live = o.status !== 'cancelled';
        const price = Number(o.buyPrice) || 0;
        const c = VA.classify(R, o.supplier, o.supplierName, o.vehiclePlate);
        const br = o.branch || '—';
        total += 1;
        let day = byDay.get(d);
        if (!day) { day = { day: d, requests: 0, done: 0, failed: 0, buy: 0, buyExt: 0, fleet: 0 }; byDay.set(d, day); }
        day.requests += 1;
        const b = add(branches, br, () => ({ branch: br, requests: 0, done: 0, failed: 0, buy: 0, reasons: {} }));
        b.requests += 1;
        const cu = add(customers, fold(o.customerName) || '—', () => ({ name: o.customerName || '—', branch: {}, sales: {}, requests: 0, done: 0, failed: 0, buy: 0, reasons: {} }));
        cu.requests += 1;
        cu.branch[br] = (cu.branch[br] || 0) + 1;
        if (o.salesRepName) cu.sales[o.salesRepName] = (cu.sales[o.salesRepName] || 0) + 1;
        if (!live) {
          day.failed += 1; b.failed += 1; cu.failed += 1;
          const reason = o.cancelReason || 'بلا سبب مسجّل';
          b.reasons[reason] = (b.reasons[reason] || 0) + 1;
          cu.reasons[reason] = (cu.reasons[reason] || 0) + 1;
          const bl = add(blameBranch, br, () => ({ branch: br, failed: 0, rep: 0, noTruck: 0, driver: 0, customer: 0, none: 0, other: 0 }));
          bl.failed += 1; bl[blameOf(o.cancelReason)] += 1;
          continue;
        }
        done += 1; buy += price;
        day.done += 1; day.buy += price; b.done += 1; b.buy += price; cu.done += 1; cu.buy += price;
        const k = add(kinds, c.kind, () => ({ kind: c.kind, label: KIND_AR[c.kind], vendors: new Set(), trips: 0, buy: 0 }));
        k.trips += 1; k.buy += price; if (c.name) k.vendors.add(fold(c.name));
        const pay = add(payments, o.paymentSubtype || '—', () => ({ key: o.paymentSubtype || '', trips: 0, buy: 0 }));
        pay.trips += 1; pay.buy += price;
        const bk = add(branchKinds, br, () => ({ branch: br, done: 0, fleet: 0, master: 0, outside: 0, freelancer: 0, none: 0 }));
        bk.done += 1; bk[c.kind] = (bk[c.kind] || 0) + 1;
        if (c.kind === 'fleet') {
          fleetTrips += 1; day.fleet += 1;
          const fb = add(fleetBranch, br, () => ({ branch: br, trips: 0, buy: 0 })); fb.trips += 1; fb.buy += price;
          const fc = add(fleetCustomer, fold(o.customerName) || '—', () => ({ name: o.customerName || '—', trips: 0, buy: 0 })); fc.trips += 1; fc.buy += price;
        } else {
          buyExt += price; day.buyExt += price;
          if (c.kind !== 'none') {
            const v = add(vendors, c.vendor ? String(c.vendor._id) : `n:${fold(c.name)}`, () => ({ id: c.vendor ? String(c.vendor._id) : null, name: c.name, kind: c.kind, trips: 0, buy: 0, pay: {}, branch: {} }));
            v.trips += 1; v.buy += price;
            v.pay[o.paymentSubtype || '—'] = (v.pay[o.paymentSubtype || '—'] || 0) + 1;
            v.branch[br] = (v.branch[br] || 0) + 1;
          }
          const rep = o.agentName || '—';
          const op = add(opsReps, rep, () => ({ name: rep, trips: 0, buy: 0 })); op.trips += 1; op.buy += price;
        }
        const helper = o.sourcingRepName || placer.get(String(o._id)) || vendorUser.get(String(o.createdBy || '')) || '';
        if (helper) {
          const h = add(helpers, helper, () => ({ name: helper, trips: 0, buy: 0 })); h.trips += 1; h.buy += price;
          const hb = add(helperBranch, br, () => ({ branch: br, done: 0, byHelper: {} }));
          hb.byHelper[helper] = (hb.byHelper[helper] || 0) + 1;
        }
        add(helperBranch, br, () => ({ branch: br, done: 0, byHelper: {} })).done += 1;
        // Routes and their purchase prices: what each executor was paid per trip.
        const rk = `${(o.fromCity || '').trim()} → ${(o.toCity || '').trim()}`;
        const rt = add(routes, fold(rk), () => ({ route: rk, from: o.fromCity || '', to: o.toCity || '', branch: {}, done: 0, fleet: 0, master: 0, outside: 0, freelancer: 0, executors: new Set(), prices: {}, fleetPrices: {}, byVendor: {} }));
        rt.done += 1; rt[c.kind] = (rt[c.kind] || 0) + 1; rt.branch[br] = (rt.branch[br] || 0) + 1;
        if (c.kind === 'fleet') { if (price) rt.fleetPrices[price] = (rt.fleetPrices[price] || 0) + 1; }
        else {
          if (c.name) rt.executors.add(fold(c.name));
          if (price) {
            rt.prices[price] = (rt.prices[price] || 0) + 1;
            const bv = rt.byVendor[c.name] || (rt.byVendor[c.name] = { name: c.name, id: c.vendor ? String(c.vendor._id) : null, prices: [] });
            bv.prices.push(price);
          }
        }
        const dest = (o.toCity || '—').trim();
        dests[dest] = (dests[dest] || 0) + 1;
      }

      // Target: a daily figure for the company or the branch, from section settings.
      const dailyTarget = branch ? (Number(T.byBranch?.[branch]) || 0) : T.daily;
      const dayList = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => ({
        ...d, buy: r2(d.buy), buyExt: r2(d.buyExt), rate: pct(d.done, d.requests), target: dailyTarget, vsTarget: dailyTarget ? pct(d.done, dailyTarget) : null, fleetShare: pct(d.fleet, d.done),
      }));
      const mode = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0];
      const routeList = Object.values(routes).sort((a, b) => b.done - a.done).map((rt) => {
        const m = mode(rt.prices);
        const modePrice = m ? Number(m[0]) : null;
        const vendorsOn = Object.values(rt.byVendor).map((v) => ({ ...v, trips: v.prices.length, min: Math.min(...v.prices), atOrBelowMode: modePrice ? v.prices.filter((p) => p <= modePrice).length : 0 }));
        const cheapest = vendorsOn.slice().sort((a, b) => a.min - b.min)[0] || null;
        const best = vendorsOn.slice().sort((a, b) => b.atOrBelowMode - a.atOrBelowMode || b.trips - a.trips)[0] || null;
        return {
          route: rt.route, from: rt.from, to: rt.to, done: rt.done, fleet: rt.fleet, companies: (rt.master || 0) + (rt.outside || 0), freelancer: rt.freelancer || 0,
          executors: rt.executors.size, branches: Object.keys(rt.branch),
          prices: Object.entries(rt.prices).map(([p, n]) => ({ price: Number(p), n })).sort((a, b) => a.price - b.price),
          fleetPrices: Object.entries(rt.fleetPrices).map(([p, n]) => ({ price: Number(p), n })).sort((a, b) => a.price - b.price),
          modePrice,
          cheapest: cheapest ? { name: cheapest.name, id: cheapest.id, price: cheapest.min } : null,
          best: best && best.atOrBelowMode ? { name: best.name, id: best.id, trips: best.atOrBelowMode } : null,
        };
      });
      const top = (obj, n, f = () => true) => Object.values(obj).filter(f).sort((a, b) => b.trips - a.trips).slice(0, n)
        .map((x) => ({ ...x, buy: r2(x.buy), share: pct(x.trips, done) }));
      const extDone = done - fleetTrips;
      const custList = Object.values(customers).map((c) => ({
        name: c.name, requests: c.requests, done: c.done, failed: c.failed, rate: pct(c.done, c.requests), shareOfDone: pct(c.done, done), buy: r2(c.buy),
        branch: Object.entries(c.branch).sort((a, b) => b[1] - a[1])[0]?.[0] || '', sales: Object.keys(c.sales).join('، '),
        reasons: Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
        category: !c.failed ? 'full' : c.done ? 'partial' : 'none',
      })).sort((a, b) => b.requests - a.requests);
      const cat = (k) => { const l = custList.filter((c) => c.category === k); return { customers: l.length, requests: l.reduce((s, c) => s + c.requests, 0), done: l.reduce((s, c) => s + c.done, 0), failed: l.reduce((s, c) => s + c.failed, 0) }; };
      return {
        from, to, branch, days,
        target: { daily: dailyTarget, monthly: T.monthly, period: dailyTarget * days },
        totals: {
          requests: total, done, failed: total - done, rate: pct(done, total), perDay: r2(done / days),
          vsTarget: dailyTarget ? pct(done, dailyTarget * days) : null,
          buy: r2(buy), buyExt: r2(buyExt), fleet: fleetTrips, fleetShare: pct(fleetTrips, done), avgTrip: done ? r2(buy / done) : 0,
          freelancerShareExt: pct((kinds.freelancer?.trips || 0), extDone),
        },
        byDay: dayList,
        kinds: Object.values(kinds).map((k) => ({ kind: k.kind, label: k.label, vendors: k.kind === 'fleet' ? 1 : k.vendors.size, trips: k.trips, share: pct(k.trips, done), buy: r2(k.buy), buyShare: pct(k.buy, buy), avg: k.trips ? r2(k.buy / k.trips) : 0 }))
          .sort((a, b) => b.trips - a.trips),
        payments: Object.values(payments).map((p) => ({ ...p, buy: r2(p.buy), share: pct(p.trips, done), buyShare: pct(p.buy, buy), avg: p.trips ? r2(p.buy / p.trips) : 0 })).sort((a, b) => b.trips - a.trips),
        blame: Object.values(blameBranch).map((b) => ({ ...b, repShare: pct(b.rep, b.failed) })).sort((a, b) => b.failed - a.failed),
        branchKinds: Object.values(branchKinds).map((b) => {
          const external = b.done - b.fleet;
          return { ...b, companies: (b.master || 0) + (b.outside || 0), freelancerShareExt: pct(b.freelancer, external) };
        }).sort((a, b) => b.freelancerShareExt - a.freelancerShareExt),
        branches: Object.values(branches).map((b) => ({
          branch: b.branch, requests: b.requests, done: b.done, failed: b.failed, rate: pct(b.done, b.requests), share: pct(b.requests, total),
          perDay: r2(b.done / days), target: Number(T.byBranch?.[b.branch]) || 0,
          vsTarget: Number(T.byBranch?.[b.branch]) ? pct(b.done, Number(T.byBranch[b.branch]) * days) : null,
          buy: r2(b.buy), topReason: Object.entries(b.reasons).sort((x, y) => y[1] - x[1])[0]?.[0] || '',
        })).sort((a, b) => b.requests - a.requests),
        customerCats: { all: { customers: custList.length, requests: total, done, failed: total - done }, full: cat('full'), partial: cat('partial'), none: cat('none') },
        customers: custList,
        topVendors: top(vendors, 10, (v) => v.kind === 'master' || v.kind === 'outside'),
        topFreelancers: top(vendors, 10, (v) => v.kind === 'freelancer'),
        topOpsReps: top(opsReps, 10),
        opsReps: top(opsReps, 500).map((x) => ({ ...x, avg: x.trips ? r2(x.buy / x.trips) : 0, shareExt: pct(x.trips, extDone) })),
        helpers: Object.values(helpers).map((h) => ({ ...h, buy: r2(h.buy), share: pct(h.trips, done) })).sort((a, b) => b.trips - a.trips),
        helperBranches: Object.values(helperBranch).map((h) => ({ branch: h.branch, done: h.done, byHelper: h.byHelper, teamShare: pct(Object.values(h.byHelper).reduce((s, n) => s + n, 0), h.done) })),
        routes: routeList.slice(0, 300),
        destinations: Object.entries(dests).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([to, n]) => ({ to, n, share: pct(n, done) })),
        fleet: { branches: Object.values(fleetBranch).map((f) => ({ ...f, buy: r2(f.buy), share: pct(f.trips, branches[f.branch]?.done || 0) })), customers: Object.values(fleetCustomer).sort((a, b) => b.trips - a.trips).slice(0, 30).map((f) => ({ ...f, buy: r2(f.buy) })) },
        purchaseByVendor: Object.values(vendors).sort((a, b) => b.buy - a.buy).map((v) => ({
          id: v.id, name: v.name, kind: v.kind, trips: v.trips, buy: r2(v.buy), share: pct(v.buy, buyExt), avg: v.trips ? r2(v.buy / v.trips) : 0,
          payment: Object.entries(v.pay).sort((a, b) => b[1] - a[1])[0]?.[0] || '', branch: Object.entries(v.branch).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
        })),
      };
    });
    res.json(PV.maskMoney(req.user, out));
  } catch (e) {
    console.error('[vendors] daily:', e);
    res.status(500).json({ message: 'تعذّر حساب التحليل اليومي' });
  }
};

// ── The register ────────────────────────────────────────────────────────────

/** A carrier's score (0–100) from how it works for us: volume, regular months, recency, a signed contract, a complete file. */
function scoreOf(v, maxTrips) {
  const vol = maxTrips ? Math.min(1, Math.log1p(v.trips || 0) / Math.log1p(maxTrips)) : 0;
  const regular = Math.min(1, (v.activeMonths || 0) / Math.max(1, (v.curMonth || 0) + 1));
  const days = v.last ? (Date.now() - new Date(v.last).getTime()) / 86400000 : 999;
  const recent = days <= 7 ? 1 : days <= 30 ? 0.7 : days <= 90 ? 0.35 : 0;
  const contract = v.signed ? 1 : /متابعة|ارسال|إرسال/.test(v.contractStatus || '') ? 0.4 : 0;
  const file = v.completeness != null ? v.completeness / 100 : 0;
  const s = Math.round(100 * (0.35 * vol + 0.2 * regular + 0.2 * recent + 0.15 * contract + 0.1 * file));
  return { score: s, grade: s >= 80 ? 'A' : s >= 60 ? 'B' : s >= 40 ? 'C' : 'D' };
}

const FILE_FIELDS = ['phone', 'representative', 'headOffice', 'destinations', 'vehicleTypes', 'fleetSize', 'contractDate', 'taxClass', 'financeCode', 'commercialRegister'];
const FILE_LABELS = { phone: 'الجوال', representative: 'ممثل المورد', headOffice: 'المقر', destinations: 'الوجهات', vehicleTypes: 'نوع السيارات', fleetSize: 'عدد السيارات', contractDate: 'تاريخ التعاقد', taxClass: 'التصنيف الضريبي', financeCode: 'كود المالية', commercialRegister: 'السجل التجاري' };
const missingFile = (v) => FILE_FIELDS.filter((f) => v[f] == null || String(v[f]).trim() === '' || v[f] === 0);

/** GET /vendors — the register joined with this year's activity. Name-only carriers (seen in shipments, never registered) are listed too. */
exports.listVendors = async (req, res) => {
  try {
    const Y = await VA.yearly(yearOf(req.query));
    const regs = await ShipmentOrderSupplier.find({ mergedInto: null, isActive: { $ne: false } })
      .select('name type inMaster masterNo followOwner contractStatus vendorSigned ourSigned taxClass phone representative headOffice destinations vehicleTypes fleetSize contractDate financeCode commercialRegister rating leadPriority isNewVendor energizeRep paymentTermDays lastFollowUpAt aliases')
      .lean();
    const act = new Map(Y.vendors.filter((v) => v.vendorId).map((v) => [v.vendorId, v]));
    const maxTrips = Math.max(1, ...Y.vendors.map((v) => v.trips));
    const rows = [];
    for (const r of regs) {
      const a = act.get(String(r._id));
      // Thousands of register rows are one-off platform carriers; list a register row when it is on the master, worked this year, or was edited by the team.
      if (!r.inMaster && !a && !r.followOwner && !r.contractStatus) continue;
      const kind = /تنشيط/.test(r.name) ? 'fleet' : r.type === 'freelancer' ? 'freelancer' : r.inMaster ? 'master' : 'outside';
      if (kind === 'fleet') continue;
      const miss = missingFile(r);
      const v = {
        id: String(r._id), name: r.name, kind, type: r.type, inMaster: !!r.inMaster, masterNo: r.masterNo, followOwner: r.followOwner, contractStatus: r.contractStatus,
        signed: signedOf(r), taxClass: r.taxClass, phone: r.phone, representative: r.representative, headOffice: r.headOffice, destinations: r.destinations,
        vehicleTypes: r.vehicleTypes, fleetSize: r.fleetSize, rating: r.rating, leadPriority: r.leadPriority, isNewVendor: r.isNewVendor, energizeRep: r.energizeRep,
        trips: a?.trips || 0, buy: r2(a?.buy || 0), mon: a?.mon || new Array(12).fill(0), month: a ? a.mon[Y.curMonth] || 0 : 0, trend: a?.trend || 'never',
        activeLast3: !!a?.activeLast3, activeThisMonth: !!a?.activeThisMonth, activeMonths: a?.activeMonths || 0,
        first: isoDay(a?.first), last: isoDay(a?.last), names: a?.names?.length || 0, aliases: (r.aliases || []).length,
        avg: a?.trips ? r2(a.buy / a.trips) : 0, completeness: Math.round(((FILE_FIELDS.length - miss.length) / FILE_FIELDS.length) * 100), lastFollowUpAt: r.lastFollowUpAt,
      };
      Object.assign(v, scoreOf({ ...v, curMonth: Y.curMonth }, maxTrips));
      rows.push(v);
    }
    for (const a of Y.vendors) {
      if (a.vendorId || a.kind === 'fleet') continue;
      const v = {
        id: null, nameKey: fold(a.name), name: a.name, kind: a.kind, inMaster: false, followOwner: '', contractStatus: '', signed: false,
        trips: a.trips, buy: r2(a.buy), mon: a.mon, month: a.mon[Y.curMonth] || 0, trend: a.trend, activeLast3: a.activeLast3, activeThisMonth: a.activeThisMonth,
        activeMonths: a.activeMonths, first: isoDay(a.first), last: isoDay(a.last), names: a.names.length, avg: a.trips ? r2(a.buy / a.trips) : 0, completeness: 0, unregistered: true,
      };
      Object.assign(v, scoreOf({ ...v, curMonth: Y.curMonth }, maxTrips));
      rows.push(v);
    }
    rows.sort((a, b) => b.trips - a.trips || (a.name < b.name ? -1 : 1));
    const owners = [...new Set(rows.map((r) => r.followOwner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    res.json(PV.maskMoney(req.user, { year: Y.year, curMonth: Y.curMonth + 1, vendors: rows, owners }));
  } catch (e) {
    console.error('[vendors] list:', e);
    res.status(500).json({ message: 'تعذّر تحميل الموردين' });
  }
};

/** The activity side of a carrier card, from its shipments in the year (by reference or any of its names). */
async function activityOf({ id, name, year }) {
  const y = Number(year) || Number(todayKey().slice(0, 4));
  const R = await VA.resolver();
  const v = id ? R.byId.get(String(id)) : null;
  const keys = new Set(v ? [fold(v.name), ...(v.aliasKeys || [])] : [fold(name)]);
  // Candidate names: every distinct supplier name of the year whose fold is one of the carrier's keys.
  const names = (await ShipmentOrder.distinct('supplierName', { pickupTime: { $gte: startOfDay(`${y}-01-01`), $lte: endOfDay(`${y}-12-31`) } }))
    .filter((n) => keys.has(fold(n)));
  const or = [];
  if (id) or.push({ supplier: new mongoose.Types.ObjectId(String(id)) });
  if (names.length) or.push({ supplierName: { $in: names } });
  if (!or.length) return { names: [], rows: [] };
  const rows = await ShipmentOrder.find({ $or: or, pickupTime: { $gte: startOfDay(`${y}-01-01`), $lte: endOfDay(`${y}-12-31`) } })
    .select('pickupTime branch customerName fromCity toCity status cancelReason buyPrice supplierName vehiclePlate driverName agentName waybillNumber paymentSubtype truckType')
    .sort({ pickupTime: -1 }).lean();
  return { names, rows };
}

function cardFrom(rows, approved) {
  const live = rows.filter((o) => o.status !== 'cancelled');
  const mon = new Array(12).fill(0); const monBuy = new Array(12).fill(0);
  const group = (key) => {
    const m = {};
    for (const o of live) { const k = String(o[key] || '—').trim() || '—'; const x = m[k] || (m[k] = { name: k, trips: 0, buy: 0 }); x.trips += 1; x.buy += Number(o.buyPrice) || 0; }
    return Object.values(m).sort((a, b) => b.trips - a.trips).map((x) => ({ ...x, buy: r2(x.buy), avg: x.trips ? r2(x.buy / x.trips) : 0, share: pct(x.trips, live.length) }));
  };
  for (const o of live) { const m = new Date(o.pickupTime).getUTCMonth(); mon[m] += 1; monBuy[m] += Number(o.buyPrice) || 0; }
  const routes = {};
  for (const o of live) {
    const k = `${(o.fromCity || '').trim()} → ${(o.toCity || '').trim()}`;
    const r = routes[k] || (routes[k] = { route: k, from: o.fromCity, to: o.toCity, trips: 0, prices: [], last: null, lastPrice: null });
    r.trips += 1;
    if (Number(o.buyPrice) > 0) r.prices.push(Number(o.buyPrice));
    if (!r.last || o.pickupTime > r.last) { r.last = o.pickupTime; r.lastPrice = Number(o.buyPrice) || null; }
  }
  const apprOf = (from, to) => approved.find((a) => a.fromKey === fold(from) && a.toKey === fold(to));
  const buy = live.reduce((s, o) => s + (Number(o.buyPrice) || 0), 0);
  return {
    trips: live.length, cancelled: rows.length - live.length, buy: r2(buy), avg: live.length ? r2(buy / live.length) : 0,
    first: isoDay(live[live.length - 1]?.pickupTime), last: isoDay(live[0]?.pickupTime),
    mon, monBuy: monBuy.map(r2),
    branches: group('branch'), customers: group('customerName').slice(0, 30), opsReps: group('agentName'), drivers: group('driverName').slice(0, 40), plates: group('vehiclePlate').slice(0, 40),
    routes: Object.values(routes).sort((a, b) => b.trips - a.trips).map((r) => {
      const ap = apprOf(r.from, r.to);
      const avg = r.prices.length ? r2(r.prices.reduce((a, b) => a + b, 0) / r.prices.length) : null;
      return { route: r.route, trips: r.trips, min: r.prices.length ? Math.min(...r.prices) : null, max: r.prices.length ? Math.max(...r.prices) : null, avg, last: isoDay(r.last), lastPrice: r.lastPrice,
        approved: ap ? { A: ap.priceA, B: ap.priceB, C: ap.priceC } : null, aboveA: !!(ap && ap.priceA && r.lastPrice && r.lastPrice > ap.priceA) };
    }),
    lastTrips: rows.slice(0, 25).map((o) => ({ waybillNumber: o.waybillNumber, day: isoDay(o.pickupTime), branch: o.branch, route: `${o.fromCity || ''} → ${o.toCity || ''}`, customer: o.customerName, price: o.buyPrice, status: o.status, rep: o.agentName, name: o.supplierName, plate: o.vehiclePlate, driver: o.driverName })),
  };
}

/** GET /vendors/:id — the carrier card: file, follow-ups, trucks and drivers, and how it works for us this year. */
exports.getVendor = async (req, res) => {
  try {
    const v = await ShipmentOrderSupplier.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ message: 'المورد غير موجود' });
    const [act, follow, vehicles, drivers, approved, Y] = await Promise.all([
      activityOf({ id: v._id, year: req.query.year }),
      VendorFollowUp.find({ supplier: v._id }).sort({ at: -1 }).limit(200).lean(),
      ShipmentOrderVehicle.find({ supplier: v._id, isActive: { $ne: false } }).select('plate name truckType brand color modelYear operationCardExpiry defaultDriverName defaultDriverPhone').lean(),
      ShipmentOrderDriver.find({ supplier: v._id, isActive: { $ne: false } }).select('name phone nationality residenceNumber driverCardExpiry vehicle').lean(),
      VendorApprovedPrice.find({ isActive: { $ne: false } }).lean(),
      VA.yearly(yearOf(req.query)),
    ]);
    const card = cardFrom(act.rows, approved);
    const a = Y.vendors.find((x) => x.vendorId === String(v._id));
    const miss = missingFile(v);
    const maxTrips = Math.max(1, ...Y.vendors.map((x) => x.trips));
    const completeness = Math.round(((FILE_FIELDS.length - miss.length) / FILE_FIELDS.length) * 100);
    const score = scoreOf({ trips: card.trips, activeMonths: card.mon.filter((x) => x > 0).length, curMonth: Y.curMonth, last: card.last, signed: signedOf(v), contractStatus: v.contractStatus, completeness }, maxTrips);
    res.json(PV.maskMoney(req.user, {
      vendor: { ...v, signed: signedOf(v), kind: /تنشيط/.test(v.name) ? 'fleet' : v.type === 'freelancer' ? 'freelancer' : v.inMaster ? 'master' : 'outside' },
      names: act.names, missing: miss.map((f) => ({ key: f, label: FILE_LABELS[f] })), completeness,
      trend: a?.trend || (card.trips ? 'steady' : 'never'), ...score,
      activity: card, followUps: follow, vehicles, drivers, year: Y.year, curMonth: Y.curMonth + 1,
    }));
  } catch (e) {
    console.error('[vendors] card:', e);
    res.status(500).json({ message: 'تعذّر تحميل بطاقة المورد' });
  }
};

/** GET /vendors/by-name?name= — the card of a carrier seen only by name in shipments. */
exports.getByName = async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ message: 'الاسم مطلوب' });
    const R = await VA.resolver();
    const hit = R.byKey.get(fold(name));
    if (hit) return res.json({ redirect: String(hit._id) });
    const [act, approved] = await Promise.all([activityOf({ name, year: req.query.year }), VendorApprovedPrice.find({ isActive: { $ne: false } }).lean()]);
    res.json(PV.maskMoney(req.user, { vendor: { name, unregistered: true }, names: act.names, activity: cardFrom(act.rows, approved), followUps: [], vehicles: [], drivers: [] }));
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل البطاقة' }); }
};

const VENDOR_EDITABLE = ['name', 'type', 'phone', 'email', 'notes', 'commercialRegister', 'taxCard', 'nationalAddress', 'bankName', 'iban',
  'ownerName', 'ownerPhone', 'managerName', 'managerPhone', 'accountantName', 'accountantPhone', 'paymentTerms',
  'inMaster', 'masterNo', 'isNewVendor', 'followOwner', 'followUser', 'energizeRep', 'taxClass', 'representative', 'destinations', 'headOffice',
  'vehicleTypes', 'fleetSize', 'hasPapers', 'vendorSigned', 'ourSigned', 'contractDate', 'contractStatus', 'paymentTermDays',
  'financeCode', 'financeClass', 'previousName', 'leadPriority', 'aliases', 'rating', 'ratingNote', 'isActive'];

const cleanVendor = (body) => {
  const out = {};
  for (const k of VENDOR_EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  for (const k of ['masterNo', 'fleetSize', 'paymentTermDays', 'rating']) if (k in out) out[k] = out[k] === '' || out[k] == null ? null : Number(out[k]);
  if ('aliases' in out) out.aliases = [...new Set((Array.isArray(out.aliases) ? out.aliases : String(out.aliases || '').split('\n')).map((s) => String(s).trim()).filter(Boolean))];
  if ('type' in out && !['company', 'freelancer'].includes(out.type)) delete out.type;
  if ('followUser' in out && out.followUser && !mongoose.isValidObjectId(String(out.followUser))) out.followUser = null;
  return out;
};

exports.createVendor = async (req, res) => {
  try {
    const data = cleanVendor(req.body || {});
    if (!String(data.name || '').trim()) return res.status(400).json({ message: 'اسمُ المورد مطلوب', fields: ['name'] });
    const R = await VA.resolver();
    const dup = R.byKey.get(fold(data.name));
    if (dup) return res.status(409).json({ code: 'EXISTS', message: `المورّد مسجَّلٌ باسم «${dup.name}»`, id: String(dup._id) });
    const doc = new ShipmentOrderSupplier({ ...data, createdBy: req.user._id });
    await doc.save();
    await logAudit({ user: req.user, action: 'create', entity: 'ShipmentOrderSupplier', entityId: doc._id, changes: { name: doc.name, inMaster: doc.inMaster }, ipAddress: req.ip });
    announce({ id: String(doc._id) });
    res.status(201).json({ vendor: doc });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر إضافة المورد'); }
};

exports.updateVendor = async (req, res) => {
  try {
    const doc = await ShipmentOrderSupplier.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'المورد غير موجود' });
    const data = cleanVendor(req.body || {});
    // An alias claimed by another carrier would split its shipments between two rows.
    if (data.aliases?.length || data.name) {
      const R = await VA.resolver();
      for (const n of [data.name, ...(data.aliases || [])].filter(Boolean)) {
        const owner = R.byKey.get(fold(n));
        // A master carrier may take a name from a non-master row (same carrier, older spelling); never from another master carrier.
        if (owner && String(owner._id) !== String(doc._id) && (owner.inMaster || !doc.inMaster)) return res.status(409).json({ code: 'ALIAS_TAKEN', message: `الاسم «${n}» مسجَّلٌ لمورّدٍ آخر: «${owner.name}» — ادمجهما بدلًا من ذلك` });
      }
    }
    const before = {};
    for (const k of Object.keys(data)) before[k] = doc[k];
    Object.assign(doc, data);
    await doc.save();
    await logAudit({ user: req.user, action: 'update', entity: 'ShipmentOrderSupplier', entityId: doc._id, changes: { before, after: data }, ipAddress: req.ip });
    announce({ id: String(doc._id) });
    res.json({ vendor: doc });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حفظ المورد'); }
};

// ── Follow-ups ──────────────────────────────────────────────────────────────

exports.listFollowUps = async (req, res) => {
  try {
    const q = {};
    if (req.params.id) q.supplier = req.params.id;
    if (req.query.from || req.query.to) q.at = { ...(req.query.from ? { $gte: startOfDay(req.query.from) } : {}), ...(req.query.to ? { $lte: endOfDay(req.query.to) } : {}) };
    if (req.query.due === '1') q.nextAt = { $ne: null, $lte: endOfDay(todayKey()) };
    const rows = await VendorFollowUp.find(q).sort({ at: -1 }).limit(500).populate('supplier', 'name followOwner contractStatus').lean();
    res.json({ followUps: rows });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل المتابعات' }); }
};

exports.addFollowUp = async (req, res) => {
  try {
    const v = await ShipmentOrderSupplier.findById(req.params.id);
    if (!v) return res.status(404).json({ message: 'المورد غير موجود' });
    const b = req.body || {};
    if (!String(b.outcome || b.note || '').trim()) return res.status(400).json({ message: 'اكتب ما تمّ في المتابعة', fields: ['outcome'] });
    const f = await VendorFollowUp.create({
      supplier: v._id, at: b.at ? new Date(b.at) : new Date(), channel: b.channel || 'call',
      outcome: String(b.outcome || '').trim(), note: String(b.note || '').trim(), contractStatus: String(b.contractStatus || '').trim(),
      nextAt: b.nextAt ? new Date(b.nextAt) : null, by: req.user._id, byName: fullName(req.user),
    });
    v.lastFollowUpAt = f.at;
    if (f.contractStatus) v.contractStatus = f.contractStatus;
    await v.save();
    await logAudit({ user: req.user, action: 'follow_up', entity: 'ShipmentOrderSupplier', entityId: v._id, changes: { outcome: f.outcome, contractStatus: f.contractStatus }, ipAddress: req.ip });
    announce({ id: String(v._id) });
    res.status(201).json({ followUp: f });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حفظ المتابعة'); }
};

exports.deleteFollowUp = async (req, res) => {
  try {
    const f = await VendorFollowUp.findById(req.params.fid);
    if (!f) return res.status(404).json({ message: 'المتابعة غير موجودة' });
    const lead = PV.isVendorLead(req.user) || require('../config/constants').isTopRole(req.user.role);
    if (!lead && String(f.by) !== String(req.user._id)) return res.status(403).json({ message: 'يحذف المتابعةَ كاتبُها أو قائدُ الفريق' });
    await f.deleteOne();
    announce({ id: String(f.supplier) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'تعذّر الحذف' }); }
};

// ── Approved prices ─────────────────────────────────────────────────────────

exports.listPrices = async (req, res) => {
  try { res.json({ prices: await VendorApprovedPrice.find({}).sort({ fromCity: 1, toCity: 1 }).lean() }); }
  catch (e) { res.status(500).json({ message: 'تعذّر تحميل قائمة الأسعار' }); }
};
const PRICE_FIELDS = ['fromCity', 'toCity', 'truckType', 'priceA', 'priceB', 'priceC', 'notes', 'isActive'];
exports.savePrice = async (req, res) => {
  try {
    const data = {};
    for (const k of PRICE_FIELDS) if (req.body[k] !== undefined) data[k] = req.body[k];
    for (const k of ['priceA', 'priceB', 'priceC']) if (k in data) data[k] = data[k] === '' || data[k] == null ? null : Number(data[k]);
    const doc = req.params.pid ? await VendorApprovedPrice.findById(req.params.pid) : new VendorApprovedPrice();
    if (!doc) return res.status(404).json({ message: 'السعر غير موجود' });
    Object.assign(doc, data, { updatedByName: fullName(req.user) });
    if (!doc.fromCity || !doc.toCity) return res.status(400).json({ message: 'اكتب المسار (من وإلى)' });
    await doc.save();
    await logAudit({ user: req.user, action: req.params.pid ? 'update' : 'create', entity: 'VendorApprovedPrice', entityId: doc._id, changes: data, ipAddress: req.ip });
    announce({});
    res.json({ price: doc });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'هذا المسار مسجَّلٌ في القائمة بالفعل' });
    return sendMongooseError(res, e, 'تعذّر حفظ السعر');
  }
};
exports.deletePrice = async (req, res) => {
  try {
    const d = await VendorApprovedPrice.findById(req.params.pid);
    if (!d) return res.status(404).json({ message: 'السعر غير موجود' });
    await d.deleteOne();
    announce({});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'تعذّر الحذف' }); }
};

// ── Route search ────────────────────────────────────────────────────────────

/** GET /route-search?from&to — who carried this route, at what price against the approved list, and who could take a return trip. */
exports.routeSearch = async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!from && !to) return res.status(400).json({ message: 'اكتب مكان التحميل أو الوجهة' });
    const y = Number(req.query.year) || Number(todayKey().slice(0, 4));
    const { arabicSearchRegex } = require('../utils/arabicSearch');
    const match = { pickupTime: { $gte: startOfDay(`${y}-01-01`), $lte: endOfDay(`${y}-12-31`) }, status: { $ne: 'cancelled' } };
    if (from) match.fromCity = arabicSearchRegex(from);
    if (to) match.toCity = arabicSearchRegex(to);
    const R = await VA.resolver();
    const [rows, approved, back, masters] = await Promise.all([
      ShipmentOrder.find(match).select('pickupTime fromCity toCity buyPrice supplier supplierName vehiclePlate agentName').sort({ pickupTime: -1 }).limit(5000).lean(),
      VendorApprovedPrice.find({ isActive: { $ne: false } }).lean(),
      // A carrier that recently delivered to the loading place may take the load back.
      from ? ShipmentOrder.find({ toCity: arabicSearchRegex(from), status: { $ne: 'cancelled' }, pickupTime: { $gte: new Date(Date.now() - 45 * 86400000) } })
        .select('pickupTime fromCity supplier supplierName vehiclePlate').sort({ pickupTime: -1 }).limit(1500).lean() : [],
      ShipmentOrderSupplier.find({ inMaster: true, mergedInto: null, $or: [
        ...(from ? [{ headOffice: arabicSearchRegex(from) }, { destinations: arabicSearchRegex(from) }] : []),
        ...(to ? [{ headOffice: arabicSearchRegex(to) }, { destinations: arabicSearchRegex(to) }] : []),
        { destinations: /جميع/ },
      ] }).select('name followOwner contractStatus vendorSigned ourSigned headOffice vehicleTypes fleetSize phone destinations').lean(),
    ]);
    const vendors = {};
    const routes = {};
    for (const o of rows) {
      const c = VA.classify(R, o.supplier, o.supplierName, o.vehiclePlate);
      routes[`${o.fromCity} → ${o.toCity}`] = (routes[`${o.fromCity} → ${o.toCity}`] || 0) + 1;
      if (c.kind === 'fleet' || c.kind === 'none') continue;
      const k = c.vendor ? String(c.vendor._id) : `n:${fold(c.name)}`;
      const v = vendors[k] || (vendors[k] = { id: c.vendor ? String(c.vendor._id) : null, name: c.name, kind: c.kind, owner: c.vendor?.followOwner || '', contract: c.vendor?.contractStatus || '', phone: c.vendor?.phone || '', trips: 0, prices: [], last: null, lastPrice: null, routes: new Set() });
      v.trips += 1;
      const p = Number(o.buyPrice) || 0;
      if (p) v.prices.push(p);
      if (!v.last || o.pickupTime > v.last) { v.last = o.pickupTime; v.lastPrice = p || null; }
      v.routes.add(`${o.fromCity} → ${o.toCity}`);
    }
    const ap = approved.filter((a) => (!from || arabicSearchRegex(from).test(a.fromCity)) && (!to || arabicSearchRegex(to).test(a.toCity)));
    const ceiling = ap.length ? Math.min(...ap.map((a) => a.priceA || Infinity)) : null;
    const all = rows.map((o) => Number(o.buyPrice) || 0).filter(Boolean);
    const backMap = {};
    for (const o of back) {
      const c = VA.classify(R, o.supplier, o.supplierName, o.vehiclePlate);
      if (c.kind === 'fleet' || c.kind === 'none') continue;
      const k = c.vendor ? String(c.vendor._id) : `n:${fold(c.name)}`;
      const b = backMap[k] || (backMap[k] = { id: c.vendor ? String(c.vendor._id) : null, name: c.name, kind: c.kind, trips: 0, last: null, from: o.fromCity });
      b.trips += 1;
      if (!b.last || o.pickupTime > b.last) { b.last = o.pickupTime; b.from = o.fromCity; }
    }
    res.json(PV.maskMoney(req.user, {
      from, to, year: y, trips: rows.length,
      routes: Object.entries(routes).sort((a, b) => b[1] - a[1]).map(([route, n]) => ({ route, n })),
      price: all.length ? { min: Math.min(...all), max: Math.max(...all), avg: r2(all.reduce((a, b) => a + b, 0) / all.length) } : null,
      approved: ap.map((a) => ({ fromCity: a.fromCity, toCity: a.toCity, A: a.priceA, B: a.priceB, C: a.priceC })),
      vendors: Object.values(vendors).sort((a, b) => b.trips - a.trips).map((v) => ({
        ...v, routes: [...v.routes], last: isoDay(v.last), avg: v.prices.length ? r2(v.prices.reduce((a, b) => a + b, 0) / v.prices.length) : null,
        min: v.prices.length ? Math.min(...v.prices) : null, max: v.prices.length ? Math.max(...v.prices) : null, prices: undefined,
        aboveA: !!(ceiling && v.lastPrice && v.lastPrice > ceiling),
      })),
      returnTrip: Object.values(backMap).sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 40).map((b) => ({ ...b, last: isoDay(b.last) })),
      masterNearby: masters.map((m) => ({ id: String(m._id), name: m.name, owner: m.followOwner, contract: m.contractStatus, signed: signedOf(m), headOffice: m.headOffice, vehicleTypes: m.vehicleTypes, fleetSize: m.fleetSize, phone: m.phone, destinations: m.destinations })),
    }));
  } catch (e) {
    console.error('[vendors] route search:', e);
    res.status(500).json({ message: 'تعذّر البحث بالمسار' });
  }
};

// ── Alerts ──────────────────────────────────────────────────────────────────

/** GET /alerts?days=30&individuals=0 — what needs the team's action, each with a shared state (new / in progress / done). */
exports.alerts = async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
    const withInd = req.query.individuals === '1';
    const since = new Date(Date.now() - days * 86400000);
    const [Y, R, states, approved, masters] = await Promise.all([
      VA.yearly(yearOf(req.query)), VA.resolver(), VendorSetting.findById('alertStates').lean(),
      VendorApprovedPrice.find({ isActive: { $ne: false } }).lean(),
      ShipmentOrderSupplier.find({ inMaster: true, mergedInto: null }).lean(),
    ]);
    const st = states?.value || {};
    const state = (k) => st[k.replace(/\./g, '_')]?.state || 'new';
    const recent = await ShipmentOrder.find({ pickupTime: { $gte: since }, status: { $ne: 'cancelled' } })
      .select('pickupTime fromCity toCity buyPrice supplier supplierName vehiclePlate agentName waybillNumber').lean();
    const inWin = {};
    for (const o of recent) {
      const c = VA.classify(R, o.supplier, o.supplierName, o.vehiclePlate);
      if (c.kind === 'fleet' || c.kind === 'none') continue;
      if (!withInd && c.kind === 'freelancer') continue;
      const k = c.vendor ? String(c.vendor._id) : `n:${fold(c.name)}`;
      const v = inWin[k] || (inWin[k] = { key: k, id: c.vendor ? String(c.vendor._id) : null, name: c.name, kind: c.kind, vendor: c.vendor, trips: 0, last: null, reps: {}, above: [] });
      v.trips += 1;
      if (!v.last || o.pickupTime > v.last) v.last = o.pickupTime;
      if (o.agentName) v.reps[o.agentName] = (v.reps[o.agentName] || 0) + 1;
      const ap = approved.find((a) => a.fromKey === fold(o.fromCity) && a.toKey === fold(o.toCity));
      if (ap && ap.priceA && Number(o.buyPrice) > ap.priceA) v.above.push({ waybillNumber: o.waybillNumber, route: `${o.fromCity} → ${o.toCity}`, price: o.buyPrice, A: ap.priceA });
    }
    const vs = Object.values(inWin);
    const topRep = (v) => Object.entries(v.reps).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const mk = (type, key, extra) => ({ type, key: `${type}:${key}`, state: state(`${type}:${key}`), ...extra });
    const groups = [
      { type: 'notInMaster', ar: 'موردون نشطون غير مسجّلين بالقائمة المعتمدة', action: 'الإضافة للماستر والإسناد لأحد أعضاء الفريق',
        items: vs.filter((v) => v.kind === 'outside' || (withInd && v.kind === 'freelancer')).sort((a, b) => b.trips - a.trips)
          .map((v) => mk('notInMaster', v.key, { id: v.id, name: v.name, kind: v.kind, trips: v.trips, last: isoDay(v.last), detail: topRep(v) })) },
      { type: 'unsigned', ar: 'موردون نشطون دون عقدٍ موقّع', action: 'استكمال توقيع العقد',
        items: vs.filter((v) => v.kind === 'master' && !signedOf(v.vendor)).sort((a, b) => b.trips - a.trips)
          .map((v) => mk('unsigned', v.key, { id: v.id, name: v.name, kind: v.kind, trips: v.trips, last: isoDay(v.last), detail: v.vendor?.contractStatus || '—', owner: v.vendor?.followOwner || '' })) },
      { type: 'stopped', ar: 'موردو ماستر متوقفون', action: 'المتابعة وإعادة التنشيط',
        items: Y.vendors.filter((v) => v.kind === 'master' && v.trend === 'stopped').sort((a, b) => b.trips - a.trips)
          .map((v) => mk('stopped', v.vendorId, { id: v.vendorId, name: v.name, kind: v.kind, trips: v.trips, last: isoDay(v.last), detail: `${v.trips} رحلة منذ بداية العام`, owner: R.byId.get(v.vendorId)?.followOwner || '' })) },
      { type: 'missingData', ar: 'بياناتٌ ناقصة في ملف المورد', action: 'استكمال البيانات',
        items: masters.map((m) => ({ m, miss: missingFile(m) })).filter((x) => x.miss.length >= 3).sort((a, b) => b.miss.length - a.miss.length)
          .map(({ m, miss }) => mk('missingData', String(m._id), { id: String(m._id), name: m.name, kind: 'master', trips: null, last: null, detail: miss.map((f) => FILE_LABELS[f]).join('، '), count: miss.length, owner: m.followOwner })) },
      { type: 'aboveApproved', ar: 'أسعارٌ أعلى من الفئة A المعتمدة', action: 'مراجعة السعر',
        items: vs.filter((v) => v.above.length).sort((a, b) => b.above.length - a.above.length)
          .map((v) => mk('aboveApproved', v.key, { id: v.id, name: v.name, kind: v.kind, trips: v.above.length, last: isoDay(v.last), detail: v.above.slice(0, 3).map((x) => `${x.route}: ${x.price} مقابل ${x.A}`).join(' · '), rows: v.above.slice(0, 20) })) },
      { type: 'multiName', ar: 'مورّدٌ مسجّلٌ بأكثر من اسمٍ على النظام', action: 'توحيد الاسم على النظام',
        items: Y.vendors.filter((v) => v.kind !== 'fleet' && v.names.length > 1).sort((a, b) => b.names.length - a.names.length)
          .map((v) => mk('multiName', v.id, { id: v.vendorId, name: v.name, kind: v.kind, trips: v.trips, last: isoDay(v.last), detail: v.names.filter((n) => n !== v.name).join(' · '), count: v.names.length })) },
    ];
    const hideDone = req.query.hideDone !== '0';
    for (const g of groups) {
      g.total = g.items.length;
      g.open = g.items.filter((i) => i.state !== 'done').length;
      if (hideDone) g.items = g.items.filter((i) => i.state !== 'done');
    }
    res.json(PV.maskMoney(req.user, { days, groups }));
  } catch (e) {
    console.error('[vendors] alerts:', e);
    res.status(500).json({ message: 'تعذّر حساب التنبيهات' });
  }
};

exports.setAlertState = async (req, res) => {
  try {
    const key = String(req.body?.key || '');
    const s = String(req.body?.state || '');
    if (!key || !['new', 'in_progress', 'done'].includes(s)) return res.status(400).json({ message: 'حالةٌ غير صالحة' });
    await VendorSetting.updateOne({ _id: 'alertStates' }, { $set: { [`value.${key.replace(/\./g, '_')}`]: { state: s, by: fullName(req.user), at: new Date() } } }, { upsert: true });
    announce({ alert: key });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'تعذّر الحفظ' }); }
};

// ── Settings ────────────────────────────────────────────────────────────────

exports.getSettings = async (req, res) => {
  try { res.json({ targets: await targets(), team: await teamOptions() }); }
  catch (e) { res.status(500).json({ message: 'تعذّر تحميل الإعدادات' }); }
};
exports.saveSettings = async (req, res) => {
  try {
    const b = req.body?.targets || {};
    const byBranch = {};
    for (const [k, v] of Object.entries(b.byBranch || {})) if (Number(v) > 0) byBranch[k] = Number(v);
    await VendorSetting.updateOne({ _id: 'targets' }, { $set: { value: { daily: Number(b.daily) || 0, monthly: Number(b.monthly) || 0, byBranch }, updatedByName: fullName(req.user) } }, { upsert: true });
    announce({ settings: true });
    res.json({ targets: await targets() });
  } catch (e) { res.status(500).json({ message: 'تعذّر حفظ الإعدادات' }); }
};

/** The vendors team, for the follow-up owner pickers: accounts in the section and the names already used on the register. */
async function teamOptions() {
  const users = await require('../models/User').find({ role: { $in: PV.VENDOR_ROLES }, isActive: { $ne: false } }).select('firstName lastName role').lean();
  const names = await ShipmentOrderSupplier.distinct('followOwner', { followOwner: { $nin: ['', null] } });
  return { users: users.map((u) => ({ id: String(u._id), name: fullName(u), role: u.role })), owners: names.sort((a, b) => a.localeCompare(b, 'ar')) };
}

/** GET /compare?ids= — up to three carriers side by side. */
exports.compare = async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').filter((x) => mongoose.isValidObjectId(x)).slice(0, 3);
    const approved = await VendorApprovedPrice.find({ isActive: { $ne: false } }).lean();
    const out = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const v = await ShipmentOrderSupplier.findById(id).select('name followOwner contractStatus vendorSigned ourSigned inMaster type').lean();
      if (!v) continue;
      // eslint-disable-next-line no-await-in-loop
      const act = await activityOf({ id, year: req.query.year });
      const c = cardFrom(act.rows, approved);
      out.push({ id, name: v.name, owner: v.followOwner, contract: v.contractStatus, signed: signedOf(v), trips: c.trips, buy: c.buy, avg: c.avg,
        topBranch: c.branches[0]?.name || '', topRep: c.opsReps[0]?.name || '', topCustomer: c.customers[0]?.name || '', topRoute: c.routes[0]?.route || '', mon: c.mon, last: c.last });
    }
    res.json(PV.maskMoney(req.user, { vendors: out }));
  } catch (e) { res.status(500).json({ message: 'تعذّرت المقارنة' }); }
};

/** GET /filter-options — the carrier filters' values with counts: follow-up owner and contract status. */
exports.filterOptions = async (req, res) => {
  try {
    const [owners, contracts] = await Promise.all([
      ShipmentOrderSupplier.aggregate([{ $match: { inMaster: true, mergedInto: null } }, { $group: { _id: { $ifNull: ['$followOwner', ''] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      ShipmentOrderSupplier.aggregate([{ $match: { inMaster: true, mergedInto: null } }, { $group: { _id: { $ifNull: ['$contractStatus', ''] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    ]);
    const shape = (rows) => rows.map((x) => ({ value: String(x._id || '').trim() || '__none', count: x.n }));
    res.json({ owners: shape(owners), contracts: shape(contracts) });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل قيم الفلاتر' }); }
};

module.exports.EVENT = EVENT;
module.exports.blameOf = blameOf;
