/**
 * Customer registry: one table for everything known about a customer, and a file per customer.
 * It replaced customer cards, which could not answer the first questions asked: how many sheets, what value, on which routes, when the last shipment. It is now an Excel-like register with a column per figure, a filter per column, and a file opening each customer's trips, analysis and route prices.
 * Joins use the folded name, not the literal one: customer names in operations sheets carry unusual whitespace (NBSP, double spaces) from the platform, so a literal match returns zero among thousands of sheets. All joins use the folded key (fold in CollectionsParty); see customer-name-hidden-differences.
 */
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrder = require('../models/ShipmentOrder');
const { fold } = require('../models/CollectionsParty');
const { routeKey } = require('../utils/customerRoutes');
const cache = require('../utils/ttlCache');
const { canSeeSelling } = require('./workflowController');

const TTL = 60 * 1000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const { dayRange, todayKey } = require('../utils/companyDay');
const { textIn, mergeOptions } = require('../utils/colFilter');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Trip columns with an Excel-style filter in the customer file (text columns of the trips table). */
const TRIP_FILTER_COLS = [
  'reportNumber', 'fromLocation', 'toLocation', 'branch', 'carOwner', 'carNumber', 'driverName',
  'applicationStatus', 'executionStatus', 'paymentMethod',
];
const TRIP_SEARCH_FIELDS = ['reportNumber', 'fromLocation', 'toLocation', 'branch', 'carOwner', 'carNumber', 'driverName'];
const MAX_TRIP_OPTIONS = 300;

const monthBounds = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`];
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/**
 * Period of the customer file from `preset` (this_month | last_month), `month=YYYY-MM` or `from`/`to` (YYYY-MM-DD).
 * Whole Riyadh days, inclusive on both ends; "this month" is resolved here from the company calendar so web and phone cannot disagree.
 */
function tripPeriod(q = {}) {
  let from = '';
  let to = '';
  const tm = todayKey().slice(0, 7);
  if (q.preset === 'this_month') [from, to] = monthBounds(tm);
  else if (q.preset === 'last_month') [from, to] = monthBounds(shiftMonth(tm, -1));
  else if (YM.test(String(q.month || ''))) [from, to] = monthBounds(String(q.month));
  else {
    from = YMD.test(String(q.from || '')) ? String(q.from) : '';
    to = YMD.test(String(q.to || '')) ? String(q.to) : '';
  }
  if (!from && !to) return null;
  return { from, to, range: dayRange(from, to) };
}

/** Search and column-filter conditions on the trips; `skipField` leaves out a column's own filter when listing its values. */
function tripConditions(q = {}, skipField = '') {
  const conds = [];
  const s = String(q.q || '').trim();
  if (s) {
    const rx = { $regex: escRx(s), $options: 'i' };
    conds.push({ $or: TRIP_SEARCH_FIELDS.map((f) => ({ [f]: rx })) });
  }
  for (const f of TRIP_FILTER_COLS) {
    if (f === skipField) continue;
    const raw = q[`cf_${f}`];
    if (raw === undefined) continue;
    const c = textIn(f, (Array.isArray(raw) ? raw : [raw]).map((v) => String(v ?? '')));
    if (c) conds.push(c);
  }
  return conds;
}

/** One match for every figure derived from the sheets, so cards, chart, routes and the trips list agree. */
function tripMatch(base, period, conds) {
  const all = [base];
  if (period?.range) all.push({ reportDate: period.range });
  all.push(...conds);
  return all.length === 1 ? base : { $and: all };
}

/** Every spelling of the customer's name in the sheets (folded join). */
async function sheetNamesOf(c) {
  const key = fold(c.name);
  return (await OperationsWorkflow.distinct('username', { username: { $nin: [null, ''] } }))
    .filter((n) => fold(n) === key);
}

/** Stable cache-key part built from the filter params only. */
function filterKey(q = {}) {
  const out = {};
  for (const k of ['preset', 'month', 'from', 'to', 'q']) if (q[k]) out[k] = String(q[k]);
  for (const f of TRIP_FILTER_COLS) {
    const raw = q[`cf_${f}`];
    if (raw !== undefined) out[f] = (Array.isArray(raw) ? raw : [raw]).map(String).sort();
  }
  return JSON.stringify(out);
}

/** Operations sheet totals per folded customer name, in one read for all. */
async function sheetTotals() {
  const rows = await OperationsWorkflow.aggregate([
    { $match: { username: { $nin: [null, ''] } } },
    {
      $group: {
        _id: '$username',
        sheets: { $sum: 1 },
        purchase: { $sum: { $ifNull: ['$purchaseValue', 0] } },
        last: { $max: '$reportDate' },
        first: { $min: '$reportDate' },
      },
    },
  ]).allowDiskUse(true);
  const by = new Map();
  for (const r of rows) {
    const k = fold(r._id);
    if (!k) continue;
    const cur = by.get(k) || { sheets: 0, purchase: 0, last: null, first: null };
    cur.sheets += r.sheets;
    cur.purchase += r.purchase;
    if (r.last && (!cur.last || r.last > cur.last)) cur.last = r.last;
    if (r.first && (!cur.first || r.first < cur.first)) cur.first = r.first;
    by.set(k, cur);
  }
  return by;
}

/**
 * Orders created here per customer.
 * Platform copies are not counted: nearly all rows in this register mirror operations sheets (source: 'platform'), so counting them would repeat the sheets column with an identical number and suggest two different pieces of work.
 */
async function orderTotals() {
  const rows = await ShipmentOrder.aggregate([
    { $match: { source: { $ne: 'platform' }, graduationNumber: null } },
    { $group: { _id: '$customerName', orders: { $sum: 1 }, last: { $max: '$createdAt' } } },
  ]).allowDiskUse(true);
  const by = new Map();
  for (const r of rows) {
    const k = fold(r._id);
    if (!k) continue;
    const cur = by.get(k) || { orders: 0, last: null };
    cur.orders += r.orders;
    if (r.last && (!cur.last || r.last > cur.last)) cur.last = r.last;
    by.set(k, cur);
  }
  return by;
}

/**
 * A customer row as read in the table.
 * No empty values are sent: writing every field made the payload about 311 KB for roughly 670 customers, over a third of it names of fields with no value (paymentMethod empty, minPrice null, lastSheetAt null). Every reader (table, export, sort, phone screen) treats absent as empty via `?? ''` or `v == null`.
 * Empty and missing are dropped, but zero and false stay: zero sheets is a number read in the column, and the no-work card is built on sheets === 0.
 */
const put = (out, k, v) => { if (v !== '' && v !== null && v !== undefined) out[k] = v; };

function shapeRow(c, sheets, orders) {
  const routes = c.routes || [];
  const priced = routes.filter((r) => r.price != null && r.price > 0);
  const cities = new Set();
  for (const r of routes) { if (r.fromCity) cities.add(r.fromCity); if (r.toCity) cities.add(r.toCity); }
  const prices = priced.map((r) => Number(r.price));
  const s = sheets || {};
  const o = orders || {};
  const lastRoute = routes.reduce((a, b) => ((a?.at || 0) > (b?.at || 0) ? a : b), null);
  const out = {
    _id: String(c._id),
    customerCode: c.customerCode || '',
    name: c.name,
    isActive: c.isActive !== false,
    routesCount: routes.length,
    pricedRoutes: priced.length,
    unpricedRoutes: routes.length - priced.length,
    citiesCount: cities.size,
    sheets: s.sheets || 0,
    purchaseTotal: r2(s.purchase || 0),
    orders: o.orders || 0,
  };
  put(out, 'phone', c.phone);
  put(out, 'email', c.email);
  put(out, 'minPrice', prices.length ? Math.min(...prices) : null);
  put(out, 'maxPrice', prices.length ? Math.max(...prices) : null);
  put(out, 'avgPrice', prices.length ? r2(prices.reduce((x, y) => x + y, 0) / prices.length) : null);
  put(out, 'lastPriceAt', lastRoute?.at || null);
  put(out, 'firstSheetAt', s.first || null);
  put(out, 'lastSheetAt', s.last || null);
  // notes and lastOrderAt are not sent: no table or export column for them (REGISTRY_COLS in lib/customerRegistry.ts). Notes are read and written in the customer file, /api/customer-registry/:id, not in the register.
  // Approved preferences are read in the table too: whoever fills a shipment wants to know the customer has an agreed truck type and payment method.
  put(out, 'truckType', c.defaults?.truckType);
  put(out, 'cargoType', c.defaults?.cargoType);
  put(out, 'paymentMethod', c.defaults?.paymentMethod);
  put(out, 'branch', c.defaults?.branch);
  return out;
}

// GET /api/customer-registry: the whole table with its figures (filtering and sorting happen on the screen).
exports.list = async (req, res) => {
  try {
    const body = await cache.wrapStale('so:registry:customers:full', TTL, 15 * 60 * 1000, async () => {
      const [customers, sheets, orders] = await Promise.all([
        ShipmentOrderCustomer.find({ isActive: { $ne: false } }).select('customerCode name phone email routes defaults isActive').lean(),
        sheetTotals(),
        orderTotals(),
      ]);
      const rows = customers
        .map((c) => shapeRow(c, sheets.get(fold(c.name)), orders.get(fold(c.name))))
        .sort((a, b) => b.sheets - a.sheets || a.name.localeCompare(b.name));
      const sum = (f) => r2(rows.reduce((a, r) => a + (r[f] || 0), 0));
      return {
        customers: rows,
        summary: {
          total: rows.length,
          active: rows.filter((r) => r.isActive).length,
          withRoutes: rows.filter((r) => r.routesCount > 0).length,
          withoutRoutes: rows.filter((r) => r.routesCount === 0).length,
          unpricedRoutes: rows.reduce((a, r) => a + r.unpricedRoutes, 0),
          working: rows.filter((r) => r.sheets > 0).length,
          idle: rows.filter((r) => r.sheets === 0).length,
          sheets: sum('sheets'),
          purchaseTotal: sum('purchaseTotal'),
        },
      };
    });
    // The customer's rating over the last 90 days of shipments (volume, revenue, regularity, cancellations, recency): the same score as the analytics page.
    let ratings = {};
    try {
      ratings = await cache.wrapStale('so:analytics:customer-rating:90', 60 * 1000, 15 * 60 * 1000, async () => {
        const ins = require('./shipmentInsightsController');
        const { todayKey } = require('../utils/companyDay');
        const to = todayKey();
        const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 89);
        const out = await ins.compute({ from: d.toISOString().slice(0, 10), to });
        return Object.fromEntries(out.customers.map((c) => [ins.fold(c.name), { grade: c.grade, score: c.score, trend: c.trend, live: c.live, cancelRate: c.cancelRate, last: c.last }]));
      });
    } catch (e) { console.error('customer registry rating:', e.message); }
    const ratingOf = (name) => ratings[require('./shipmentInsightsController').fold(name)] || null;
    const withRating = (list) => list.map((r) => {
      const g = ratingOf(r.name);
      return { ...r, rating: g, ratingScore: g ? g.score : null };
    });
    // Purchase totals follow the selling-price list (the pricing view of a customer), and never reach sales, who see no cost.
    if (!canSeeSelling(req.user.role) || require('../config/priceView').isSalesRole(req.user)) {
      return res.json({
        customers: withRating(body.customers.map(({ purchaseTotal, ...r }) => r)),
        summary: { ...body.summary, purchaseTotal: undefined },
      });
    }
    res.json({ ...body, customers: withRating(body.customers) });
  } catch (e) {
    console.error('customer registry list:', e);
    res.status(500).json({ message: 'تعذّر تحميل سجل العملاء' });
  }
};

/**
 * GET /api/customer-registry/:id: the customer file: analysis, routes and trips.
 * Trips come from operations sheets (the real work history) and from our own orders, joined by folded name. Only one page of them is returned, since a customer may have thousands of sheets.
 */
exports.profile = async (req, res) => {
  try {
    const c = await ShipmentOrderCustomer.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ message: 'العميل غير موجود' });
    // Purchase figures on the customer file: the selling-price list, never sales (who see no cost).
    const money = canSeeSelling(req.user.role) && !require('../config/priceView').isSalesRole(req.user);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    // Period, search and column filters drive every sheet-derived figure (cards, chart, routes run, trips); agreed prices are not dated and stay whole.
    const period = tripPeriod(req.query);
    const conds = tripConditions(req.query);

    const body = await cache.wrapStale(
      `so:registry:profile:${c._id}:${money ? 'm' : 'n'}:${page}:${limit}:${filterKey(req.query)}`, TTL, 10 * 60 * 1000,
      async () => {
        // Every name in the sheets folds to this customer's key; there may be more than one spelling.
        const names = await sheetNamesOf(c);
        const base = names.length ? { username: { $in: names } } : { _id: null };
        const match = tripMatch(base, period, conds);
        const orderMatch = { source: { $ne: 'platform' }, customerName: { $in: names.length ? names : [c.name] } };
        if (period?.range) orderMatch.createdAt = period.range;

        const [agg, monthly, byRoute, sheetsPage, total, orders] = await Promise.all([
          OperationsWorkflow.aggregate([
            { $match: match },
            {
              $group: {
                _id: null,
                sheets: { $sum: 1 },
                purchase: { $sum: { $ifNull: ['$purchaseValue', 0] } },
                first: { $min: '$reportDate' },
                last: { $max: '$reportDate' },
                branches: { $addToSet: '$branch' },
              },
            },
          ]),
          OperationsWorkflow.aggregate([
            { $match: { $and: [match, { reportDate: { $ne: null } }] } },
            {
              $group: {
                _id: { $dateToString: { date: '$reportDate', format: '%Y-%m', timezone: 'Asia/Riyadh' } },
                sheets: { $sum: 1 },
                purchase: { $sum: { $ifNull: ['$purchaseValue', 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ]),
          OperationsWorkflow.aggregate([
            { $match: match },
            {
              $group: {
                _id: { from: '$fromLocation', to: '$toLocation' },
                sheets: { $sum: 1 },
                purchase: { $sum: { $ifNull: ['$purchaseValue', 0] } },
                last: { $max: '$reportDate' },
              },
            },
            { $sort: { sheets: -1 } },
            { $limit: 100 },
          ]),
          OperationsWorkflow.find(match)
            .select('reportNumber reportDate fromLocation toLocation branch carOwner carNumber driverName applicationStatus executionStatus purchaseValue paymentMethod stage')
            .sort({ reportDate: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
          OperationsWorkflow.countDocuments(match),
          ShipmentOrder.find(orderMatch)
            .select('orderNumber createdAt fromCity toCity status supplierName vehiclePlate price')
            .sort({ createdAt: -1 }).limit(50).lean(),
        ]);

        const a = agg[0] || { sheets: 0, purchase: 0, first: null, last: null, branches: [] };
        // Each route's price as in the customer file, joined by the same folded route.
        const priceOf = new Map();
        for (const r of c.routes || []) {
          if (r.price == null) continue;
          const k = routeKey(r.fromCity, r.toCity);
          const prev = priceOf.get(k);
          if (!prev || (r.at || 0) > (prev.at || 0)) priceOf.set(k, { price: r.price, at: r.at, source: r.source });
        }
        // Price tiers by vehicle count, on the same route, whether or not it is priced with a single price.
        const tiersOf = new Map();
        for (const r of c.routes || []) {
          if ((r.tiers || []).length) tiersOf.set(routeKey(r.fromCity, r.toCity), { tiers: r.tiers, at: r.tiersAt || null, by: r.tiersBy || '' });
        }
        const routes = byRoute.map((r) => {
          const p = priceOf.get(routeKey(r._id.from, r._id.to));
          return {
            from: r._id.from || '', to: r._id.to || '', sheets: r.sheets,
            purchase: money ? r2(r.purchase) : undefined,
            lastAt: r.last || null,
            price: p ? p.price : null, priceAt: p?.at || null, priceSource: p?.source || '',
            tiers: tiersOf.get(routeKey(r._id.from, r._id.to))?.tiers || [],
            tiersAt: tiersOf.get(routeKey(r._id.from, r._id.to))?.at || null,
            tiersBy: tiersOf.get(routeKey(r._id.from, r._id.to))?.by || '',
          };
        });

        return {
          customer: {
            _id: String(c._id), customerCode: c.customerCode || '', name: c.name, phone: c.phone || '', email: c.email || '',
            notes: c.notes || '', isActive: c.isActive !== false,
            defaults: c.defaults || {},
            routes: (c.routes || []).map((r) => ({
              _id: String(r._id || ''), fromCity: r.fromCity || '', toCity: r.toCity || '',
              price: r.price ?? null, at: r.at || null, source: r.source || '', hits: r.hits || 1,
              tiers: r.tiers || [],
            })),
          },
          analysis: {
            sheets: a.sheets,
            purchaseTotal: money ? r2(a.purchase) : undefined,
            avgPerSheet: money && a.sheets ? r2(a.purchase / a.sheets) : undefined,
            firstAt: a.first, lastAt: a.last,
            branches: (a.branches || []).filter(Boolean),
            routesCount: (c.routes || []).length,
            pricedRoutes: (c.routes || []).filter((r) => r.price > 0).length,
            orders: orders.length,
            monthly: monthly.map((m) => ({ month: m._id, sheets: m.sheets, purchase: money ? r2(m.purchase) : undefined })),
          },
          routes,
          // A reader without the purchase side gets the sheets without it too, not only the totals.
          sheets: { rows: money ? sheetsPage : sheetsPage.map(({ purchaseValue, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / limit)) },
          orders,
          period: period ? { from: period.from, to: period.to } : null,
          filtered: !!(period || conds.length),
        };
      },
    );
    // Whoever may edit the tiers is computed per requester, outside the shared cached response. The agreed price is treated like the tiers: for the same two roles.
    res.json({ ...body, canEditTiers: exports.canEditTiers(req.user.role), canEditPrices: exports.canEditTiers(req.user.role) });
  } catch (e) {
    console.error('customer registry profile:', e);
    res.status(500).json({ message: 'تعذّر تحميل ملف العميل' });
  }
};

/**
 * GET /api/customer-registry/:id/trip-filters?field=<column>: one trips column's values with row counts, for its Excel-style filter.
 * Counted on the server under the period, search and every other column filter (not its own): the trips table is paginated, so the loaded page holds only a slice of the values.
 */
exports.tripFilterOptions = async (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!TRIP_FILTER_COLS.includes(field)) return res.status(400).json({ message: 'Unknown filter column' });
    const c = await ShipmentOrderCustomer.findById(req.params.id).select('name').lean();
    if (!c) return res.status(404).json({ message: 'العميل غير موجود' });
    const body = await cache.wrapStale(
      `so:registry:tripopts:${c._id}:${field}:${String(req.query.q2 || '')}:${filterKey(req.query)}`, TTL, 10 * 60 * 1000,
      async () => {
        const names = await sheetNamesOf(c);
        const base = names.length ? { username: { $in: names } } : { _id: null };
        const match = tripMatch(base, tripPeriod(req.query), tripConditions(req.query, field));
        const rows = await OperationsWorkflow.aggregate([
          { $match: match },
          { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        ]).allowDiskUse(true);
        const s = String(req.query.q2 || '').trim().toLowerCase();
        let values = mergeOptions(rows.map((r) => ({ value: r._id, count: r.count })))
          .filter((o) => !s || o.value.toLowerCase().includes(s))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
        const truncated = values.length > MAX_TRIP_OPTIONS;
        if (truncated) values = values.slice(0, MAX_TRIP_OPTIONS);
        return { filters: [{ key: field, values, truncated }] };
      },
    );
    res.json(body);
  } catch (e) {
    console.error('customer registry trip filters:', e);
    res.status(500).json({ message: 'تعذّر تحميل قيم الفلتر' });
  }
};

/**
 * PUT /api/customer-registry/:id/route-tiers  { fromCity, toCity, tiers }
 * Route price tiers by vehicle count. Only the operations manager or the system admin write them; anyone else opening the customer file can read but not edit.
 * The guard is here, not in the route list: authorize passes through section grants (edit on the section opens every endpoint), so a role list in the routes file does not stop someone granted the section. Exactly two roles are required whatever else is granted, so the role is checked here.
 */
const { PRICE_EDITORS: TIER_EDITORS } = require('../utils/customerRoutes');
exports.canEditTiers = (role) => TIER_EDITORS.includes(role);

exports.setRouteTiers = async (req, res) => {
  try {
    if (!TIER_EDITORS.includes(req.user && req.user.role)) {
      return res.status(403).json({ message: 'شرائحُ الأسعار يعدّلها مديرُ العمليّات أو مديرُ النظام', code: 'TIERS_EDITOR_ONLY' });
    }
    const { cleanTiers } = require('../utils/customerRoutes');
    const from = String(req.body.fromCity || '').trim();
    const to = String(req.body.toCity || '').trim();
    if (!from || !to) return res.status(400).json({ message: 'المسارُ ناقص: من وإلى' });
    const tiers = cleanTiers(req.body.tiers);

    const customer = await ShipmentOrderCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'العميل غير موجود' });
    const k = routeKey(from, to);
    let route = (customer.routes || []).find((r) => routeKey(r.fromCity, r.toCity) === k);
    const before = route ? (route.tiers || []).map((t) => ({ minTrucks: t.minTrucks, maxTrucks: t.maxTrucks, price: t.price })) : [];
    if (!route) {
      // A route the customer works on that is not yet in their price list: it enters now with its tiers.
      customer.routes.push({ fromCity: from, toCity: to, price: null, at: null, source: '', hits: 0 });
      route = customer.routes[customer.routes.length - 1];
    }
    route.tiers = tiers;
    route.tiersAt = new Date();
    route.tiersBy = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ').trim();
    await customer.save();

    cache.clear('opsprivate:');
    await require('../utils/auditLogger')({
      user: req.user, action: 'update_route_price_tiers', entity: 'ShipmentOrderCustomer', entityId: customer._id,
      changes: { before: { route: `${from} ← ${to}`, tiers: before }, after: { route: `${from} ← ${to}`, tiers } },
      ipAddress: req.ip,
    });
    try {
      const { emitToAll } = require('../websocket/socketManager');
      emitToAll('shipmentOrders:customers', {});
      emitToAll('workflow:updated', { bulk: true, prices: true });
    } catch (_) { /* extra */ }
    res.json({ fromCity: from, toCity: to, tiers, tiersAt: route.tiersAt, tiersBy: route.tiersBy });
  } catch (e) {
    res.status(e.status === 400 ? 400 : 500).json({ message: e.status === 400 ? e.message : 'تعذّر حفظ الشرائح' });
  }
};
