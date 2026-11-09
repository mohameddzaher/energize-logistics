/**
 * Shipment analytics: one computation behind the section's analytics page (web and phone).
 * It replaced two pages that each answered half the question with different numbers. Every figure here is computed in
 * the database from the shipments themselves, under the same filters, so a number on the page always equals the rows
 * the shipments list returns for the same filters. Money follows the reader's side (config/priceView).
 */
const mongoose = require('mongoose');
const ShipmentOrder = require('../models/ShipmentOrder');
const ShipmentOrderSupplier = require('../models/ShipmentOrderSupplier');
const ShipmentRequest = require('../models/ShipmentRequest');
const PV = require('../config/priceView');
const cache = require('../utils/ttlCache');
const { startOfDay, endOfDay, todayKey } = require('../utils/companyDay');
const { textIn } = require('../utils/colFilter');
const { westernDigits } = require('../utils/arabicSearch');

const TZ = 'Asia/Riyadh';
const CANCELLED = 'cancelled';
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (a, b) => (b ? r2((a / b) * 100) : 0);

/** One spelling key per name: alef forms, ta marbuta, ya, the Persian letters the platform used, diacritics, spaces. */
const fold = (v) => westernDigits(String(v || ''))
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/چ/g, 'ج').replace(/گ/g, 'ك').replace(/ڤ/g, 'ف').replace(/پ/g, 'ب')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[\s ]+/g, ' ').trim().toLowerCase();

/** An anchored pattern matching every stored spelling of a name, for filtering by a folded name. */
const foldedExact = (v) => {
  const body = fold(v)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[اأإآٱ]/g, '[اأإآٱ]')
    .replace(/[هة]/g, '[هة]')
    .replace(/[يى]/g, '[يى]')
    .replace(/ج/g, '[جچ]').replace(/ك/g, '[كگ]').replace(/ف/g, '[فڤ]').replace(/ب/g, '[بپ]')
    .split(' ').join('[\\s\u00a0]+');
  // The no-break space is the character itself: MongoDB's regex engine rejects the \u escape.
  return new RegExp(`^[\\s\u00a0]*${body}[\\s\u00a0]*$`, 'i');
};

/** Every filterable dimension: its query key, the stored field, and whether names fold. */
const DIMS = {
  customer: { field: 'customerName', fold: true, ar: 'العميل' },
  supplier: { field: 'supplierName', fold: true, ar: 'المورّد' },
  fromCity: { field: 'fromCity', fold: true, ar: 'من' },
  toCity: { field: 'toCity', fold: true, ar: 'إلى' },
  branch: { field: 'branch', ar: 'الفرع' },
  truckType: { field: 'truckType', ar: 'نوع الشاحنة' },
  truckLength: { field: 'truckLength', ar: 'طول الشاحنة' },
  cargoType: { field: 'cargoType', ar: 'نوع الحمولة' },
  payment: { field: 'paymentSubtype', ar: 'نوع الدفع' },
  salesRep: { field: 'salesRepName', fold: true, ar: 'مندوب المبيعات' },
  sourcingRep: { field: 'sourcingRepName', fold: true, ar: 'مسؤول التوريد' },
  agent: { field: 'agentName', fold: true, ar: 'مُنشئ الشحنة' },
  status: { field: 'status', ar: 'الحالة' },
  cancelReason: { field: 'cancelReason', ar: 'سبب الإلغاء' },
  source: { field: 'source', ar: 'المصدر' },
};

const listOf = (v) => {
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x)).filter((x) => x !== '');
};

/** The date span asked for, and the previous span of the same length. */
function spanOf(q) {
  const today = todayKey();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? String(q.from) : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? String(q.to) : today;
  const d = (ymd, n) => { const x = new Date(`${ymd}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const days = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1);
  const prevTo = d(from, -1);
  const prevFrom = d(prevTo, -(days - 1));
  return { from, to, days, prevFrom, prevTo };
}

/** The match for the filters, without the dates (the caller adds the span it wants). */
async function filterMatch(q) {
  const and = [];
  for (const [key, dim] of Object.entries(DIMS)) {
    const vals = listOf(q[`f_${key}`]);
    if (!vals.length) continue;
    const blank = vals.includes('__blank__');
    const real = vals.filter((v) => v !== '__blank__');
    if (dim.fold) {
      const or = real.map((v) => ({ [dim.field]: foldedExact(v) }));
      if (blank) or.push({ [dim.field]: { $in: ['', null] } });
      if (or.length) and.push({ $or: or });
    } else {
      const c = textIn(dim.field, [...real, ...(blank ? [''] : [])]);
      if (c) and.push(c);
    }
  }
  // A route is a pair, filtered as one value "from → to".
  const routes = listOf(q.f_route);
  if (routes.length) {
    and.push({ $or: routes.map((rt) => {
      const [a, b] = rt.split('→').map((s) => s.trim());
      return { fromCity: foldedExact(a || ''), toCity: foldedExact(b || '') };
    }) });
  }
  // Supplier kind: a company or a freelance driver, read from the supplier register.
  const kinds = listOf(q.f_supplierType);
  if (kinds.length) {
    const ids = await ShipmentOrderSupplier.find({ type: { $in: kinds.filter((k) => k !== 'none') } }).select('_id').lean();
    const or = [{ supplier: { $in: ids.map((x) => x._id) } }];
    if (kinds.includes('none')) or.push({ supplier: null });
    and.push({ $or: or });
  }
  if (q.f_request === 'yes') and.push({ shipmentRequest: { $ne: null } });
  if (q.f_request === 'no') and.push({ shipmentRequest: null });
  if (q.q && String(q.q).trim()) {
    const { arabicSearchRegex } = require('../utils/arabicSearch');
    const r = arabicSearchRegex(q.q);
    const or = [{ customerName: r }, { supplierName: r }, { fromCity: r }, { toCity: r }, { driverName: r },
      { vehiclePlate: r }, { salesRepName: r }, { agentName: r }, { branch: r }, { truckType: r }, { cancelReason: r }];
    const n = Number(westernDigits(String(q.q).trim()));
    if (Number.isFinite(n)) or.push({ waybillNumber: n });
    and.push({ $or: or });
  }
  return and;
}

const dateKey = (q) => (q.dateBy === 'created' ? 'createdAt' : 'pickupTime');

/** Money rules in one place: executed = not cancelled; margin only where both prices exist, so a missing price never reads as profit. */
const LIVE = { $ne: [{ $ifNull: ['$status', ''] }, CANCELLED] };
const SELL = { $ifNull: ['$sellPrice', 0] };
const BUY = { $ifNull: ['$buyPrice', 0] };
const PRICED = { $and: [LIVE, { $gt: [SELL, 0] }, { $gt: [BUY, 0] }] };
const acc = () => ({
  orders: { $sum: 1 },
  live: { $sum: { $cond: [LIVE, 1, 0] } },
  sell: { $sum: { $cond: [LIVE, SELL, 0] } },
  buy: { $sum: { $cond: [LIVE, BUY, 0] } },
  priced: { $sum: { $cond: [PRICED, 1, 0] } },
  pSell: { $sum: { $cond: [PRICED, SELL, 0] } },
  pBuy: { $sum: { $cond: [PRICED, BUY, 0] } },
  noSell: { $sum: { $cond: [{ $and: [LIVE, { $not: [{ $gt: [SELL, 0] }] }] }, 1, 0] } },
  noBuy: { $sum: { $cond: [{ $and: [LIVE, { $not: [{ $gt: [BUY, 0] }] }] }, 1, 0] } },
});

/** The figures of one group, all derived the same way. */
const figures = (g) => {
  const cancelled = g.orders - g.live;
  const margin = g.pSell - g.pBuy;
  const sellWith = g.live - g.noSell;
  const buyWith = g.live - g.noBuy;
  return {
    orders: g.orders, live: g.live, cancelled, cancelRate: pct(cancelled, g.orders),
    sell: r2(g.sell), buy: r2(g.buy),
    avgSell: sellWith ? r2(g.sell / sellWith) : 0,
    avgBuy: buyWith ? r2(g.buy / buyWith) : 0,
    margin: r2(margin), marginPct: g.pSell ? pct(margin, g.pSell) : null,
    avgMargin: g.priced ? r2(margin / g.priced) : 0,
    priced: g.priced, noSell: g.noSell, noBuy: g.noBuy,
  };
};

/** Groups whose names fold to one are one row, shown under their most used spelling. */
function mergeFolded(rows, total) {
  const by = new Map();
  for (const r of rows) {
    const k = fold(r._id) || '';
    const cur = by.get(k);
    if (!cur) { by.set(k, { ...r, _names: [[r._id, r.orders]] }); continue; }
    for (const f of ['orders', 'live', 'sell', 'buy', 'priced', 'pSell', 'pBuy', 'noSell', 'noBuy']) cur[f] += r[f] || 0;
    if (r.first && (!cur.first || r.first < cur.first)) cur.first = r.first;
    if (r.last && (!cur.last || r.last > cur.last)) cur.last = r.last;
    if (r.months) cur.months = [...new Set([...(cur.months || []), ...r.months])];
    if (r.routes) cur.routes = [...new Set([...(cur.routes || []), ...r.routes])];
    if (r.recent != null) { cur.recent = (cur.recent || 0) + r.recent; cur.before = (cur.before || 0) + (r.before || 0); }
    cur._names.push([r._id, r.orders]);
  }
  return [...by.values()].map((g) => {
    const name = g._names.sort((a, b) => b[1] - a[1])[0][0];
    const out = { key: String(name ?? ''), name: String(name ?? '').trim() || '—', ...figures(g), share: pct(g.live, total) };
    if (g._names.length > 1) out.spellings = g._names.length;
    if (g.first) out.first = g.first;
    if (g.last) out.last = g.last;
    if (g.months) out.activeMonths = g.months.length;
    if (g.routes) out.routes = g.routes.length;
    if (g.recent != null) { out.recent = g.recent; out.before = g.before || 0; }
    return out;
  }).sort((a, b) => b.live - a.live || b.orders - a.orders);
}

/**
 * Customer rating, 0–100, from what every reader may see: volume, revenue, regular work, reliability (cancellations) and recency.
 * Margin is deliberately not in it, so sales (who never see cost) and management read the same score.
 */
function rateCustomers(rows, spanDays) {
  if (!rows.length) return rows;
  const rank = (arr, v) => (arr.length <= 1 ? 1 : arr.filter((x) => x < v).length / (arr.length - 1));
  const lives = rows.map((r) => r.live);
  const sells = rows.map((r) => r.sell || 0);
  const spanMonths = Math.max(1, Math.round(spanDays / 30));
  const now = Date.now();
  return rows.map((r) => {
    const volume = rank(lives, r.live);
    const revenue = rank(sells, r.sell || 0);
    const regular = Math.min(1, (r.activeMonths || 1) / spanMonths);
    const reliable = 1 - Math.min(1, (r.cancelRate || 0) / 50);
    const days = r.last ? (now - new Date(r.last).getTime()) / 86400000 : 999;
    const recent = days <= 7 ? 1 : days <= 30 ? 0.75 : days <= 60 ? 0.45 : days <= 120 ? 0.2 : 0;
    const score = Math.round(100 * (0.3 * volume + 0.2 * revenue + 0.15 * regular + 0.2 * reliable + 0.15 * recent));
    const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D';
    let trend = 'steady';
    if (r.recent != null) {
      if (!r.before && r.recent) trend = 'new';
      else if (r.before && !r.recent) trend = 'stopped';
      else if (r.before && r.recent >= r.before * 1.2) trend = 'up';
      else if (r.before && r.recent <= r.before * 0.8) trend = 'down';
    }
    return { ...r, score, grade, trend, daysSinceLast: Math.round(days) };
  }).sort((a, b) => b.score - a.score || b.live - a.live);
}

async function compute(q) {
  const span = spanOf(q);
  const dk = dateKey(q);
  const rest = await filterMatch(q);
  const inSpan = (from, to) => ({ [dk]: { $gte: startOfDay(from), $lte: endOfDay(to) } });
  const match = { $and: [inSpan(span.from, span.to), ...rest] };
  const prevMatch = { $and: [inSpan(span.prevFrom, span.prevTo), ...rest] };
  // The last 30 days of the span against the 30 before, for each customer's direction.
  const endD = endOfDay(span.to);
  const cut = new Date(endD.getTime() - 30 * 86400000);
  const cutPrev = new Date(cut.getTime() - 30 * 86400000);
  const byMonth = span.days > 62;
  const bucket = { $dateToString: { format: byMonth ? '%Y-%m' : '%Y-%m-%d', date: `$${dk}`, timezone: TZ } };
  const dimGroup = (field, extra = {}) => [{ $group: { _id: { $ifNull: [`$${field}`, ''] }, ...acc(), ...extra } }];

  const [f] = await ShipmentOrder.aggregate([
    { $match: match },
    { $facet: {
      totals: [{ $group: { _id: null, ...acc(),
        customers: { $addToSet: '$customerName' }, suppliers: { $addToSet: '$supplierName' },
        routes: { $addToSet: { $concat: [{ $ifNull: ['$fromCity', ''] }, '→', { $ifNull: ['$toCity', ''] }] } },
        advances: { $sum: { $cond: [LIVE, { $ifNull: ['$advanceAmount', 0] }, 0] } },
        fromRequests: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$shipmentRequest', null] }, null] }, 1, 0] } },
        noSalesRep: { $sum: { $cond: [{ $and: [LIVE, { $in: [{ $ifNull: ['$salesRepName', ''] }, ['']] }] }, 1, 0] } },
      } }],
      trend: [{ $group: { _id: bucket, ...acc() } }, { $sort: { _id: 1 } }],
      byStatus: [{ $group: { _id: { $ifNull: ['$status', ''] }, n: { $sum: 1 } } }],
      customer: dimGroup('customerName', {
        first: { $min: `$${dk}` }, last: { $max: `$${dk}` },
        months: { $addToSet: { $dateToString: { format: '%Y-%m', date: `$${dk}`, timezone: TZ } } },
        routes: { $addToSet: { $concat: [{ $ifNull: ['$fromCity', ''] }, '→', { $ifNull: ['$toCity', ''] }] } },
        recent: { $sum: { $cond: [{ $and: [LIVE, { $gt: [`$${dk}`, cut] }] }, 1, 0] } },
        before: { $sum: { $cond: [{ $and: [LIVE, { $gt: [`$${dk}`, cutPrev] }, { $lte: [`$${dk}`, cut] }] }, 1, 0] } },
      }),
      supplier: dimGroup('supplierName', { first: { $min: `$${dk}` }, last: { $max: `$${dk}` } }),
      route: [{ $group: { _id: { $concat: [{ $ifNull: ['$fromCity', ''] }, ' → ', { $ifNull: ['$toCity', ''] }] }, ...acc(),
        minBuy: { $min: { $cond: [{ $and: [LIVE, { $gt: [BUY, 0] }] }, BUY, null] } },
        maxBuy: { $max: { $cond: [{ $and: [LIVE, { $gt: [BUY, 0] }] }, BUY, null] } },
        minSell: { $min: { $cond: [{ $and: [LIVE, { $gt: [SELL, 0] }] }, SELL, null] } },
        maxSell: { $max: { $cond: [{ $and: [LIVE, { $gt: [SELL, 0] }] }, SELL, null] } },
      } }],
      fromCity: dimGroup('fromCity'),
      toCity: dimGroup('toCity'),
      branch: dimGroup('branch'),
      truckType: dimGroup('truckType'),
      truckLength: dimGroup('truckLength'),
      cargoType: dimGroup('cargoType'),
      payment: dimGroup('paymentSubtype'),
      salesRep: dimGroup('salesRepName'),
      sourcingRep: dimGroup('sourcingRepName'),
      agent: dimGroup('agentName'),
      bySupplierId: [{ $group: { _id: '$supplier', ...acc() } }],
      cancelReasons: [{ $match: { status: CANCELLED } }, { $group: { _id: { $ifNull: ['$cancelReason', ''] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      cancelByBranch: [{ $match: { status: CANCELLED } }, { $group: { _id: { b: { $ifNull: ['$branch', ''] }, r: { $ifNull: ['$cancelReason', ''] } }, n: { $sum: 1 } } }],
      weekday: [{ $group: { _id: { $dayOfWeek: { date: `$${dk}`, timezone: TZ } }, ...acc() } }, { $sort: { _id: 1 } }],
      duration: [
        { $match: { $expr: { $and: [LIVE, { $gt: ['$arrivalTime', '$pickupTime'] }] }, arrivalTime: { $ne: null }, pickupTime: { $ne: null } } },
        { $project: { h: { $divide: [{ $subtract: ['$arrivalTime', '$pickupTime'] }, 3600000] } } },
        { $match: { h: { $lt: 720 } } },
        { $bucket: { groupBy: '$h', boundaries: [0, 24, 48, 96, 168, 720], default: 'other', output: { n: { $sum: 1 }, h: { $sum: '$h' } } } },
      ],
      marginBands: [
        { $match: { $expr: PRICED } },
        { $project: { p: { $multiply: [{ $divide: [{ $subtract: [SELL, BUY] }, SELL] }, 100] } } },
        { $bucket: { groupBy: '$p', boundaries: [-1e12, 0, 5, 10, 15, 20, 30, 1e12], default: 'other', output: { n: { $sum: 1 } } } },
      ],
      losing: [
        { $match: { $expr: PRICED } },
        { $addFields: { margin: { $subtract: [SELL, BUY] } } },
        { $match: { margin: { $lt: 0 } } },
        { $sort: { margin: 1 } }, { $limit: 50 },
        { $project: { waybillNumber: 1, customerName: 1, supplierName: 1, fromCity: 1, toCity: 1, status: 1, sellPrice: 1, buyPrice: 1, margin: 1, pickupTime: 1 } },
      ],
      losingCount: [{ $match: { $expr: { $and: [PRICED, { $lt: [SELL, BUY] }] } } }, { $count: 'n' }],
    } },
  ]).allowDiskUse(true);

  const [prevAgg] = await ShipmentOrder.aggregate([{ $match: prevMatch }, { $group: { _id: null, ...acc(),
    customers: { $addToSet: '$customerName' } } }]);

  const T = (f.totals && f.totals[0]) || { orders: 0, live: 0, sell: 0, buy: 0, priced: 0, pSell: 0, pBuy: 0, noSell: 0, noBuy: 0, customers: [], suppliers: [], routes: [] };
  const P = prevAgg || { orders: 0, live: 0, sell: 0, buy: 0, priced: 0, pSell: 0, pBuy: 0, noSell: 0, noBuy: 0, customers: [] };
  const distinct = (arr) => new Set((arr || []).map(fold).filter(Boolean)).size;
  const tot = figures(T);
  const prev = figures(P);

  // Supplier kind from the register: company, freelance driver, or none recorded.
  const supIds = (f.bySupplierId || []).map((x) => x._id).filter(Boolean);
  const kinds = new Map((await ShipmentOrderSupplier.find({ _id: { $in: supIds } }).select('type').lean()).map((s) => [String(s._id), s.type || 'company']));
  const kindAcc = {};
  for (const g of f.bySupplierId || []) {
    const k = g._id ? (kinds.get(String(g._id)) || 'company') : 'none';
    const cur = kindAcc[k] || (kindAcc[k] = { _id: k, orders: 0, live: 0, sell: 0, buy: 0, priced: 0, pSell: 0, pBuy: 0, noSell: 0, noBuy: 0 });
    for (const x of ['orders', 'live', 'sell', 'buy', 'priced', 'pSell', 'pBuy', 'noSell', 'noBuy']) cur[x] += g[x] || 0;
  }

  const plain = (rows) => (rows || []).map((g) => ({ key: String(g._id ?? ''), name: String(g._id ?? '').trim() || '—', ...figures(g), share: pct(g.live, T.live) }))
    .sort((a, b) => b.live - a.live || b.orders - a.orders);
  const cancelledTotal = T.orders - T.live;
  const durRows = (f.duration || []).filter((b) => b._id !== 'other');
  const durN = durRows.reduce((a, b) => a + b.n, 0);
  const durLabel = { 0: '0-24', 24: '24-48', 48: '48-96', 96: '96-168', 168: '168+' };
  const bandLabel = { '-1000000000000': '<0', 0: '0-5', 5: '5-10', 10: '10-15', 15: '15-20', 20: '20-30', 30: '30+' };

  const customers = rateCustomers(mergeFolded(f.customer || [], T.live), span.days);
  const routes = plain(f.route).map((r, i) => {
    const g = f.route.find((x) => String(x._id ?? '') === r.key) || {};
    return { ...r, minBuy: g.minBuy, maxBuy: g.maxBuy, minSell: g.minSell, maxSell: g.maxSell, rank: i + 1 };
  });

  return {
    span: { ...span, dateBy: dk === 'createdAt' ? 'created' : 'pickup', unit: byMonth ? 'month' : 'day' },
    totals: {
      ...tot,
      customers: distinct(T.customers), suppliers: distinct(T.suppliers), routes: (T.routes || []).length,
      advances: r2(T.advances), fromRequests: T.fromRequests || 0, noSalesRep: T.noSalesRep || 0,
      losing: f.losingCount?.[0]?.n || 0,
    },
    previous: { ...prev, customers: distinct(P.customers) },
    trend: (f.trend || []).map((g) => ({ key: g._id, ...figures(g) })),
    byStatus: Object.fromEntries((f.byStatus || []).map((x) => [x._id, x.n])),
    customers,
    suppliers: mergeFolded(f.supplier || [], T.live),
    routes,
    fromCities: mergeFolded(f.fromCity || [], T.live),
    toCities: mergeFolded(f.toCity || [], T.live),
    branches: plain(f.branch),
    truckTypes: plain(f.truckType),
    truckLengths: plain(f.truckLength),
    cargoTypes: plain(f.cargoType),
    payments: plain(f.payment),
    salesReps: mergeFolded(f.salesRep || [], T.live),
    sourcingReps: mergeFolded(f.sourcingRep || [], T.live),
    agents: mergeFolded(f.agent || [], T.live),
    supplierKinds: Object.values(kindAcc).map((g) => ({ key: g._id, name: g._id, ...figures(g), share: pct(g.live, T.live) })).sort((a, b) => b.live - a.live),
    cancelReasons: (f.cancelReasons || []).map((x) => ({ reason: x._id || '', count: x.n, pct: pct(x.n, cancelledTotal) })),
    cancelByBranch: (f.cancelByBranch || []).map((x) => ({ branch: x._id.b || '', reason: x._id.r || '', n: x.n })),
    weekday: (f.weekday || []).map((g) => ({ day: g._id, ...figures(g) })),
    duration: { trips: durN, avgHours: durN ? r2(durRows.reduce((a, b) => a + b.h, 0) / durN) : null, buckets: durRows.map((b) => ({ key: durLabel[b._id] || String(b._id), n: b.n })) },
    marginBands: (f.marginBands || []).filter((b) => b._id !== 'other').map((b) => ({ key: bandLabel[b._id] || String(b._id), n: b.n })),
    losing: (f.losing || []).map((o) => ({ ...o, margin: r2(o.margin) })),
    requests: await requestFunnel(q, span),
  };
}

/** Funnel rows with their fulfilment rate (of what was decided: placed ÷ trucks minus still open and withdrawn) and top reasons. */
const dimRows = (rows) => (rows || []).map((x) => {
  const decided = x.trucks - x.open - x.cancelled;
  const reasons = {};
  for (const rr of x.reasons || []) if (rr) reasons[rr] = (reasons[rr] || 0) + 1;
  return {
    name: String(x._id || '').trim() || '—', requests: x.requests, trucks: x.trucks, placed: x.placed, rejected: x.rejected, open: x.open, cancelled: x.cancelled,
    fulfilment: pct(x.placed, decided), reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
  };
});

/** Requests from sales in the span: asked, placed, rejected, open, and why rejected. Filtered by the fields a request carries. */
/** One request funnel per value of a field: asked, placed, rejected, open trucks and the fulfilment rate. */
const dimFunnel = (key) => [
  { $group: { _id: { $ifNull: [key, ''] }, requests: { $sum: 1 }, trucks: { $sum: '$trucks' }, placed: { $sum: { $size: '$placed' } },
    rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, { $subtract: ['$trucks', { $size: '$placed' }] }, 0] } },
    open: { $sum: { $cond: [{ $in: ['$status', ['pending', 'in_progress']] }, { $subtract: ['$trucks', { $size: '$placed' }] }, 0] } },
    cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, '$trucks', 0] } },
    reasons: { $push: '$rejectReason' } } },
  { $sort: { trucks: -1 } }, { $limit: 300 },
];

async function requestFunnel(q, span) {
  const and = [{ createdAt: { $gte: startOfDay(span.from), $lte: endOfDay(span.to) } }];
  const map = { customer: 'customerName', fromCity: 'fromCity', toCity: 'toCity', branch: 'branch', truckType: 'truckType', salesRep: 'salesRepName' };
  for (const [k, field] of Object.entries(map)) {
    const vals = listOf(q[`f_${k}`]).filter((v) => v !== '__blank__');
    if (vals.length) and.push({ $or: vals.map((v) => ({ [field]: foldedExact(v) })) });
  }
  const [r] = await ShipmentRequest.aggregate([
    { $match: { $and: and } },
    { $facet: {
      totals: [{ $group: { _id: null, requests: { $sum: 1 }, trucks: { $sum: '$trucks' }, placed: { $sum: { $size: '$placed' } },
        rejectedTrucks: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, { $subtract: ['$trucks', { $size: '$placed' }] }, 0] } },
        openTrucks: { $sum: { $cond: [{ $in: ['$status', ['pending', 'in_progress']] }, { $subtract: ['$trucks', { $size: '$placed' }] }, 0] } },
        cancelledTrucks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, '$trucks', 0] } },
        resubmits: { $sum: '$resubmits' },
        hours: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $ne: ['$closedAt', null] }] }, { $divide: [{ $subtract: ['$closedAt', '$createdAt'] }, 3600000] }, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
      } }],
      byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
      reasons: [{ $match: { rejectReason: { $nin: ['', null] } } }, { $group: { _id: '$rejectReason', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      bySales: [{ $group: { _id: { $ifNull: ['$createdByName', ''] }, requests: { $sum: 1 }, trucks: { $sum: '$trucks' }, placed: { $sum: { $size: '$placed' } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } } } }, { $sort: { trucks: -1 } }],
      byHandler: [{ $unwind: '$placed' }, { $group: { _id: { $ifNull: ['$placed.byName', ''] }, placed: { $sum: 1 } } }, { $sort: { placed: -1 } }],
      // The same funnel cut by what a request carries, so the gap can be read by customer, route, branch and truck.
      byCustomer: dimFunnel('$customerName'),
      byRoute: dimFunnel({ $concat: [{ $ifNull: ['$fromCity', ''] }, ' → ', { $ifNull: ['$toCity', ''] }] }),
      byBranch: dimFunnel('$branch'),
      byTruckType: dimFunnel('$truckType'),
      bySalesRep: dimFunnel('$salesRepName'),
      // Why each sales member's requests fell short.
      reasonBySales: [{ $match: { rejectReason: { $nin: ['', null] } } }, { $group: { _id: { s: { $ifNull: ['$createdByName', ''] }, r: '$rejectReason' }, n: { $sum: 1 }, trucks: { $sum: { $subtract: ['$trucks', { $size: '$placed' }] } } } }, { $sort: { n: -1 } }],
      reasonTrucks: [{ $match: { rejectReason: { $nin: ['', null] } } }, { $group: { _id: '$rejectReason', trucks: { $sum: { $subtract: ['$trucks', { $size: '$placed' }] } } } }],
      trend: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, requests: { $sum: 1 }, trucks: { $sum: '$trucks' }, placed: { $sum: { $size: '$placed' } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, { $subtract: ['$trucks', { $size: '$placed' }] }, 0] } } } }, { $sort: { _id: 1 } }],
      // How long open requests have been waiting, and how fast trucks get placed.
      openAge: [{ $match: { status: { $in: ['pending', 'in_progress'] } } }, { $project: { h: { $divide: [{ $subtract: ['$$NOW', '$createdAt'] }, 3600000] }, open: { $subtract: ['$trucks', { $size: '$placed' }] } } },
        { $bucket: { groupBy: '$h', boundaries: [0, 2, 6, 24, 72, 1e9], default: 'other', output: { requests: { $sum: 1 }, trucks: { $sum: '$open' } } } }],
      firstPlace: [{ $match: { 'placed.0': { $exists: true } } }, { $project: { h: { $divide: [{ $subtract: [{ $min: '$placed.at' }, '$createdAt'] }, 3600000] } } },
        { $group: { _id: null, n: { $sum: 1 }, h: { $sum: '$h' } } }],
      resubmitted: [{ $match: { resubmits: { $gt: 0 } } }, { $group: { _id: null, requests: { $sum: 1 }, placedAfter: { $sum: { $cond: [{ $gt: [{ $size: '$placed' }, 0] }, 1, 0] } } } }],
    } },
  ]);
  const t = r?.totals?.[0] || { requests: 0, trucks: 0, placed: 0, rejectedTrucks: 0, openTrucks: 0, cancelledTrucks: 0, resubmits: 0, hours: 0, completed: 0 };
  return {
    ...t,
    fulfilment: pct(t.placed, t.trucks - t.openTrucks - t.cancelledTrucks),
    avgHoursToComplete: t.completed ? r2(t.hours / t.completed) : null,
    byStatus: Object.fromEntries((r?.byStatus || []).map((x) => [x._id, x.n])),
    reasons: (r?.reasons || []).map((x) => ({ reason: x._id, count: x.n })),
    bySales: (r?.bySales || []).map((x) => ({ name: x._id || '—', ...x, _id: undefined, fulfilment: pct(x.placed, x.trucks) })),
    byHandler: (r?.byHandler || []).map((x) => ({ name: x._id || '—', placed: x.placed })),
    byCustomer: dimRows(r?.byCustomer), byRoute: dimRows(r?.byRoute), byBranch: dimRows(r?.byBranch),
    byTruckType: dimRows(r?.byTruckType), bySalesRep: dimRows(r?.bySalesRep),
    reasonBySales: (r?.reasonBySales || []).map((x) => ({ sales: x._id.s || '—', reason: x._id.r, requests: x.n, trucks: x.trucks })),
    reasonTrucks: Object.fromEntries((r?.reasonTrucks || []).map((x) => [x._id, x.trucks])),
    trend: (r?.trend || []).map((x) => ({ day: x._id, requests: x.requests, trucks: x.trucks, placed: x.placed, rejected: x.rejected })),
    openAge: (r?.openAge || []).filter((b) => b._id !== 'other').map((b) => ({ key: ({ 0: '<2h', 2: '2-6h', 6: '6-24h', 24: '1-3d', 72: '3d+' })[b._id] || String(b._id), requests: b.requests, trucks: b.trucks })),
    avgHoursToFirstPlace: r?.firstPlace?.[0]?.n ? r2(r.firstPlace[0].h / r.firstPlace[0].n) : null,
    resubmitted: r?.resubmitted?.[0] || { requests: 0, placedAfter: 0 },
  };
}

/** GET /api/shipment-orders/insights */
exports.insights = async (req, res) => {
  try {
    const key = `so:analytics:insights:${JSON.stringify(req.query || {})}`;
    const out = await cache.wrapStale(key, 45 * 1000, 10 * 60 * 1000, () => compute(req.query || {}));
    res.json({ ...PV.maskMoney(req.user, out), priceView: PV.priceView(req.user) });
  } catch (e) {
    console.error('[shipment insights]', e);
    res.status(500).json({ message: 'تعذّر حساب التحليلات' });
  }
};

/** GET /api/shipment-orders/insights/options: every filter's values with counts over the asked span. */
exports.options = async (req, res) => {
  try {
    const span = spanOf(req.query || {});
    const dk = dateKey(req.query || {});
    const key = `so:analytics:opts:${dk}:${span.from}:${span.to}`;
    const out = await cache.wrapStale(key, 2 * 60 * 1000, 15 * 60 * 1000, async () => {
      const facet = {};
      for (const [k, d] of Object.entries(DIMS)) facet[k] = [{ $group: { _id: { $ifNull: [`$${d.field}`, ''] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1500 }];
      facet.route = [{ $group: { _id: { $concat: [{ $ifNull: ['$fromCity', ''] }, ' → ', { $ifNull: ['$toCity', ''] }] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1500 }];
      const [f] = await ShipmentOrder.aggregate([{ $match: { [dk]: { $gte: startOfDay(span.from), $lte: endOfDay(span.to) } } }, { $facet: facet }]);
      const result = {};
      for (const [k, rows] of Object.entries(f || {})) {
        const d = DIMS[k];
        if (d && d.fold) {
          const by = new Map();
          for (const x of rows) {
            const fk = fold(x._id);
            const cur = by.get(fk) || { value: x._id, count: 0, top: 0 };
            cur.count += x.n;
            if (x.n > cur.top) { cur.top = x.n; cur.value = x._id; }
            by.set(fk, cur);
          }
          result[k] = [...by.values()].map(({ value, count }) => ({ value: String(value ?? '').trim() ? value : '__blank__', count }))
            .sort((a, b) => b.count - a.count);
        } else {
          result[k] = rows.map((x) => ({ value: String(x._id ?? '').trim() ? x._id : '__blank__', count: x.n }));
        }
      }
      return result;
    });
    // A hidden side's lists say nothing about money, so they are returned whole.
    res.json({ options: out, labels: Object.fromEntries(Object.entries(DIMS).map(([k, d]) => [k, d.ar])) });
  } catch (e) {
    console.error('[shipment insights options]', e);
    res.status(500).json({ message: 'تعذّر تحميل قيم الفلاتر' });
  }
};

module.exports.compute = compute;
module.exports.filterMatch = filterMatch;
module.exports.fold = fold;
module.exports.foldedExact = foldedExact;
