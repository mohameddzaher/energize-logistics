/**
 * Operations private: the operations manifests themselves, with selling value and the profit under it.
 * One price, not two. This page used to keep the real price in its own collection (`PrivateSellingPrice`) because the manifest's selling value came from the platform equal to the purchase and could not carry our margin. Later the workflow's selling value became hand-written and pushed to the platform with the owner's approval, leaving two places for one number: fixing it here left workflow and collections stale, and vice versa.
 * The single reference is now the manifest's `sellingValue` column: this page reads it like the workflow and writes it by the same path (`workflowController.setSellingValue`: column permission, lock, platform first, cache and broadcast). `PrivateSellingPrice` is no longer written; its content is reconciled once by scripts/reconcilePrivateSellingPrices.js.
 * The customer route price is a suggestion, not a value. An unpriced manifest used to display the route price from the customer file, so the table showed a number the manifest did not. It is now shown beside the value (`routePrice`) to be approved with one click, and an approved one is written to the manifest like any edit.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const { routeKey, applyRoute, priceFor } = require('../utils/customerRoutes');
const cache = require('../utils/ttlCache');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Columns read in the table: the operations workflow's own columns, so a manifest looks the same here and there. Money columns (invoice, collection) are hidden from those who lack them by the same rule as there (`stripMoneyFor`). */
const LIST_FIELDS = [
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'ownerType', 'executionStatus', 'applicationStatus',
  'paymentMethod', 'username', 'userPhone', 'taxIndicator',
  'purchaseValue', 'sellingValue', 'sellingValueSource', 'driverName', 'driverPhone', 'truckType', 'truckSize',
  'loadType', 'reference', 'representativeName', 'operationsReview',
  'paymentDate', 'paymentDateByName', 'payingBranch', 'paymentAmount', 'paymentType', 'paymentSubtype',
  'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
  'stage', 'externalSource', 'lockedBy', 'lockedAt', 'createdAt',
];
const LIST_PROJECT = Object.fromEntries(LIST_FIELDS.map((f) => [f, 1]));

/**
 * Route price index: key 'customer|route' to price.
 * Cached for a minute rather than built per call: building it reads every customer with their routes (170 KB), and any write on a customer clears it (ShipmentOrderCustomer hooks), so a price is never read from before its correction.
 */
async function routePriceIndex() {
  return cache.wrap('opsprivate:routes', 60000, async () => {
    const { fold } = require('../models/CollectionsParty');
    const customers = await ShipmentOrderCustomer.find({ isActive: { $ne: false } })
      .select('name routes.fromCity routes.toCity routes.price routes.tiers').lean();
    const map = new Map();
    // A tiered route is suggested at its highest tier. A manifest is one vehicle and nothing says how many vehicles the customer ordered, so its tier is unknown; the highest route price is suggested (owner decision).
    map.tiers = new Set();
    for (const c of customers) {
      for (const r of c.routes || []) {
        const k = `${fold(c.name)}|${routeKey(r.fromCity, r.toCity)}`;
        const top = Math.max(0, ...(r.tiers || []).map((t) => Number(t.price) || 0));
        if (top > 0) { map.set(k, top); map.tiers.add(k); continue; }
        if (r.price == null) continue;
        map.set(k, Number(r.price));
      }
    }
    return map;
  });
}

/** Suggested customer route price: `{ value, source: 'tier'|'route' }` or `null`. */
function unitPrice(index, username, from, to) {
  const { fold } = require('../models/CollectionsParty');
  const k = `${fold(username || '')}|${routeKey(from, to)}`;
  const p = index.get(k);
  if (p == null) return null;
  return { value: Number(p), source: index.tiers && index.tiers.has(k) ? 'tier' : 'route' };
}

const r2 = (x) => Math.round(x * 100) / 100;

/** Value source as read: hand-entered (`manual`), the collections book (`collections_book`), or the platform (`platform`, which is also the old empty value). */
const sourceOf = (w) => {
  const s = String(w.sellingValueSource || '');
  return s === 'manual' || s === 'collections_book' ? s : 'platform';
};

/** Row as displayed: the manifest's own value, its profit, and the customer route suggestion. */
function shapeRow(w, index) {
  const sell = num(w.sellingValue);
  const buy = num(w.purchaseValue);
  // A manifest with no price has no profit or loss. Zero in the selling field means not priced yet, not sold at zero; subtracting it from purchase would show a full loss on every row without a price.
  const profit = sell > 0 ? r2(sell - buy) : null;
  const route = index ? unitPrice(index, w.username, w.fromLocation, w.toLocation) : null;
  const source = sourceOf(w);
  return {
    ...w,
    sellingValue: sell,
    // (The name stays for old mobile builds; it is the same value, there is no second price.)
    platformSellingValue: sell,
    priceSource: source,
    priceSaved: source !== 'platform',
    routePrice: route ? route.value : null,
    routePriceSource: route ? route.source : '',
    profit,
    margin: profit != null && sell > 0 ? r2((profit / sell) * 100) : null,
  };
}

/** The filter is the operations workflow's filter, verbatim: search, range, column filters (`cf_<column>`) and missing vouchers all come from `buildWorkflowFilter`. Money columns cannot be filtered by those who cannot see them. */
function baseFilter(req) {
  const { buildWorkflowFilter, canSeeMoney } = require('./workflowController');
  const money = canSeeMoney(req.user && req.user.role);
  return { filter: buildWorkflowFilter(req.query, undefined, money), money };
}

/** Priced / unpriced: the only filter the workflow page does not have. */
const pricedParam = (q) => {
  const v = String((q && q.priced) || '').trim();
  return v === 'yes' || v === 'no' ? v : '';
};

/** Priced: a positive selling value on the manifest. Anything else: zero or empty. */
const PRICED = { sellingValue: { $gt: 0 } };
const withPriced = (filter, priced) => {
  if (!priced) return filter;
  const cond = priced === 'yes' ? PRICED : { $nor: [PRICED] };
  return { $and: [filter, cond] };
};

/** Card totals, computed in the database over the priced/unpriced split. */
async function priceGroups(filter) {
  const groups = await OperationsWorkflow.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $gt: [{ $ifNull: ['$sellingValue', 0] }, 0] },
        n: { $sum: 1 },
        b: { $sum: { $ifNull: ['$purchaseValue', 0] } },
        s: { $sum: { $ifNull: ['$sellingValue', 0] } },
      },
    },
  ]).allowDiskUse(true);
  return groups.map((g) => ({ priced: !!g._id, n: g.n, b: num(g.b), sell: g._id ? num(g.s) : 0 }));
}

/** Sums the groups into the card numbers. */
function summarize(groups) {
  let sell = 0; let buyPriced = 0; let buyAll = 0; let priced = 0; let unpriced = 0; let total = 0;
  for (const g of groups) {
    total += g.n; buyAll += g.b;
    if (g.priced) { sell += g.sell; buyPriced += g.b; priced += g.n; } else unpriced += g.n;
  }
  return {
    total,
    priced,
    unpriced,
    sumSelling: r2(sell),
    sumPurchase: r2(buyPriced),
    sumPurchaseAll: r2(buyAll),
    sumPurchaseUnpriced: r2(buyAll - buyPriced),
    // The value is single now; the name stays for its readers.
    sumPlatformSelling: r2(sell),
    profit: r2(sell - buyPriced),
    margin: sell ? r2(((sell - buyPriced) / sell) * 100) : 0,
  };
}

/** Matching rows (with the priced filter if requested) in table order. `skip/limit` for the page; no limit for export (with a sane cap). */
async function matchingRows(filter, priced, { skip = 0, limit = 0 } = {}) {
  const f = withPriced(filter, priced);
  let q = OperationsWorkflow.find(f).select(LIST_PROJECT).sort({ createdAt: -1 });
  if (skip) q = q.skip(skip);
  if (limit) q = q.limit(limit);
  const [rows, total] = await Promise.all([
    q.lean(),
    limit ? OperationsWorkflow.countDocuments(f) : Promise.resolve(null),
  ]);
  return { rows, total: total == null ? rows.length : total };
}

// GET /api/operations-private
exports.list = async (req, res) => {
  try {
    const { filter, money } = baseFilter(req);
    const priced = pricedParam(req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const [index, { rows, total }] = await Promise.all([
      routePriceIndex(),
      matchingRows(filter, priced, { skip: (page - 1) * limit, limit }),
    ]);
    const { stripMoneyFor } = require('./workflowController');
    const workflows = stripMoneyFor(req.user.role, rows.map((w) => shapeRow(w, index)));

    res.json({
      workflows, total, page, pages: Math.max(1, Math.ceil(total / limit)), money,
    });
  } catch (e) {
    console.error('operations-private list:', e);
    res.status(500).json({ message: 'تعذّر تحميل التقرير' });
  }
};

// GET /api/operations-private/stats - totals of the whole filter, not the displayed page.
// Profit is computed on priced manifests only. A manifest whose selling price has not arrived is a deal whose revenue is not written yet, not one without revenue; adding its purchase to a zero sale fabricates a loss. So profit is on priced rows, and the purchase of unpriced ones is reported separately to show the missing size.
exports.stats = async (req, res) => {
  try {
    const { filter } = baseFilter(req);
    const priced = pricedParam(req.query);
    // Totals are cached like dashboards. Aggregating 36,000 manifests by (customer, from, to) takes about a second and is requested on every open and every live event from the operations sync. The last result is served at once and recomputed in the background after 30s; a price correction clears it immediately (updatePrice), so a pre-correction number is never read.
    const key = `opsprivate:stats:${req.user.role}:${JSON.stringify(req.query || {})}`;
    const body = await cache.wrapStale(key, 30000, 10 * 60 * 1000, async () => {
      let groups = await priceGroups(filter);
      if (priced) groups = groups.filter((g) => g.priced === (priced === 'yes'));
      const out = summarize(groups);

      // Order status distribution, for filtering. The screen showed money only, with no way to see what is on the road now except opening the column list. These are the same cards as in the operations workflow, computed the same way: on the whole filter, not the displayed page.
      // It runs on `filter` before the priced/unpriced split, since that split applies to groups, not manifests; mixing it into the status counts would give a number that does not match what clicking it opens.
      const OperationsWorkflow = require('../models/OperationsWorkflow');
      const rows = await OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: '$applicationStatus', n: { $sum: 1 } } },
      ]);
      out.byStatus = {};
      out.statusTotal = 0;
      for (const r of rows) {
        if (!r._id) continue;
        out.byStatus[r._id] = r.n;
        out.statusTotal += r.n;
      }
      return out;
    });
    res.json(body);
  } catch (e) {
    console.error('operations-private stats:', e);
    res.status(500).json({ message: 'تعذّر حساب المجاميع' });
  }
};

/**
 * GET /api/operations-private/export
 * Everything matching the filter (or the whole table with `scope=all`) with our resolved prices, as an Excel file built on the server like the workflow export; tens of thousands of rows should not cross the browser raw. `format=json` returns the same rows (for mobile and verification), capped at `EXPORT_CAP`.
 */
const EXPORT_CAP = 60000;
/** The same build for a background export request (controllers/exportJobsController), so the file is identical whether downloaded now or notified later. */
exports.buildExportFile = async (query = {}, user = {}) => {
  const { shaped, money } = await exportRowsFor(query, user);
  const buf = await buildPrivateWorkbook(shaped, money);
  return { buf, rows: shaped.length, name: `operations-private-${new Date().toISOString().slice(0, 10)}.xlsx` };
};

/** Rows shaped for export, read by both the direct response and the background request. */
async function exportRowsFor(query, user) {
  const all = String(query.scope || '') === 'all';
  const q = all ? {} : query;
  const { buildWorkflowFilter, canSeeMoney } = require('./workflowController');
  const money = canSeeMoney(user.role);
  const filter = buildWorkflowFilter(q, undefined, money);
  const priced = all ? '' : pricedParam(query);
  const [index, { rows, total }] = await Promise.all([
    routePriceIndex(),
    matchingRows(filter, priced, { limit: EXPORT_CAP }),
  ]);
  const capped = rows;
  const shaped = require('./workflowController').stripMoneyFor(user.role, capped.map((w) => shapeRow(w, index)));
  return { shaped, total, capped, money };
}

exports.exportRows = async (req, res) => {
  try {
    const { shaped, total, capped, money } = await exportRowsFor(req.query, req.user);

    if (String(req.query.format || '') === 'json') {
      return res.json({ rows: shaped, total, truncated: total > capped.length, money });
    }

    const buf = await buildPrivateWorkbook(shaped, money);
    const name = `operations-private-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${name}`);
    res.setHeader('Content-Length', String(buf.length));
    if (total > capped.length) res.setHeader('X-Export-Truncated', String(total));
    return res.send(buf);
  } catch (e) {
    console.error('operations-private export:', e);
    return res.status(500).json({ message: 'تعذّر التصدير' });
  }
};

/** The workbook itself with its columns and translations, from one place. */
async function buildPrivateWorkbook(shaped, money) {
  {
    const { SHIPMENT_STATUS_AR } = require('../config/constants');
    const PAYMENT_AR = { cash: 'كاش', late: 'آجل' };
    const STAGE_AR = {
      draft: 'مسودة', submitted_to_ops: 'مرسل للتشغيل', ops_completed: 'تم التشغيل',
      submitted_to_collections: 'مرسل للتحصيل', completed: 'مكتمل',
    };
    const SOURCE_AR = { manual: 'يدويّ', collections_book: 'دفتر التحصيل', platform: 'المنصّة' };
    const d = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh' }) : '');
    const st = (v) => SHIPMENT_STATUS_AR[v] || v || '';
    const yes = (v) => (v ? 'تمّت' : '');
    const COLUMNS = [
      ['رقم الطلب', (w) => w.reportNumber || ''],
      ['تاريخ الطلب', (w) => d(w.reportDate)],
      ['من', (w) => w.fromLocation || ''],
      ['إلى', (w) => w.toLocation || ''],
      ['الفرع', (w) => w.branch || ''],
      ['مالك السيارة', (w) => w.carOwner || ''],
      ['رقم السيارة', (w) => w.carNumber || ''],
      ['نوع الملكية', (w) => w.ownerType || ''],
      ['حالة التنفيذ', (w) => st(w.executionStatus)],
      ['حالة الطلب', (w) => st(w.applicationStatus)],
      ['طريقة الدفع', (w) => PAYMENT_AR[w.paymentMethod] || w.paymentMethod || ''],
      ['العميل', (w) => w.username || ''],
      ['هاتف العميل', (w) => w.userPhone || ''],
      ['قيمة الشراء', (w) => num(w.purchaseValue)],
      ['قيمة البيع', (w) => (w.sellingValue > 0 ? w.sellingValue : '')],
      ['سعر مسار العميل (اقتراح)', (w) => (w.routePrice != null ? w.routePrice : '')],
      ['الربح', (w) => (w.profit == null ? '' : w.profit)],
      ['الهامش %', (w) => (w.margin == null ? '' : w.margin)],
      ['مصدر السعر', (w) => SOURCE_AR[w.priceSource] || ''],
      ['السائق', (w) => w.driverName || ''],
      ['نوع الشاحنة', (w) => w.truckType || ''],
      ['حجم الشاحنة', (w) => w.truckSize || ''],
      ['المندوب', (w) => w.representativeName || ''],
      ['مراجعة العمليات', (w) => yes(w.operationsReview)],
      ['تاريخ السداد', (w) => d(w.paymentDate)],
      ['مسؤول البيانات', (w) => w.paymentDateByName || ''],
      ['فرع السداد', (w) => w.payingBranch || ''],
      ['مبلغ السداد', (w) => num(w.paymentAmount)],
      ['نوع الدفع', (w) => require('../utils/paymentType').paymentKindLabel(w)],
      ['وجهة أمر النقل النهائية', (w) => w.finalReportDestination || ''],
      ['رقم المستند', (w) => w.documentNumber || ''],
      ['تاريخ الإرسال', (w) => d(w.sendingDate)],
      ['تاريخ التسليم للفرع', (w) => d(w.branchDeliveryDate)],
      ['تاريخ التسليم للعميل', (w) => d(w.deliveryDate)],
      ['مراجعة المحاسبة', (w) => yes(w.accountingReview), 'money'],
      ['رقم الفاتورة', (w) => w.invoiceNumber || '', 'money'],
      ['صافي الفاتورة', (w) => num(w.netInvoice), 'money'],
      ['الضريبة', (w) => num(w.tax), 'money'],
      ['إجمالي الفاتورة', (w) => num(w.totalInvoice), 'money'],
      ['تاريخ الفاتورة', (w) => d(w.invoiceDate), 'money'],
      ['المبلغ المحصّل', (w) => num(w.collectedAmount), 'money'],
      ['تاريخ التحصيل', (w) => d(w.collectionDate), 'money'],
      ['المرحلة', (w) => STAGE_AR[w.stage] || w.stage || '', 'money'],
    ];
    const cols = money ? COLUMNS : COLUMNS.filter(([, , tag]) => tag !== 'money');
    const aoa = [cols.map(([h]) => h), ...shaped.map((w) => cols.map(([, get]) => get(w)))];
    // Workbook writing runs in a worker thread; otherwise this export would freeze every other request on this worker for thirty seconds. See utils/xlsxBuilder.
    const buf = await require('../utils/xlsxBuilder').buildXlsx(aoa, {
      sheetName: 'التشغيل خاص',
      cols: cols.map(([h]) => ({ wch: Math.max(h.length + 4, 14) })),
    });
    return buf;
  }
}

/**
 * PUT /api/operations-private/:id - the selling value only, on the manifest itself.
 * It uses the workflow's write path exactly (`setSellingValue`): column permission (anyone outside SELLING_ROLES gets 403 here as there), lock, platform first (its rejection means no save), source `manual` so the sync does not overwrite it, and the cache cleared before the broadcast. What is written here is seen at once by the workflow, collections and the platform.
 * The customer file is also marked: this is the latest price used on this route.
 */
exports.updatePrice = async (req, res) => {
  try {
    const { setSellingValue } = require('./workflowController');
    const note = String(req.body.note ?? '').trim().slice(0, 300);
    const out = await setSellingValue(req.params.id, req.body.sellingValue, req.user, { ip: req.ip, note });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    const w = out.body.workflow;
    const value = Number(w.sellingValue) || 0;

    // A correction marks the customer file. Fixing a manifest's price says this is our price on this route today, the same number this page and shipment creation suggest afterwards. Only someone allowed to write a destination price marks it.
    let learned = null;
    if (!out.body.unchanged && value > 0) {
      try {
        const { learnRouteByName, canEditPrices } = require('../utils/customerRoutes');
        if (canEditPrices(req.user.role)) {
          learned = await learnRouteByName(w.username, {
            fromCity: w.fromLocation,
            toCity: w.toLocation,
            price: value,
            at: w.reportDate || new Date(),
            source: 'private',
          });
        }
      } catch (e) { console.error('[private] learn route:', e.message); }
    }

    res.json({
      price: { workflow: w._id, reportNumber: w.reportNumber, sellingValue: value, source: 'manual' },
      workflow: w,
      learned,
      sellingPlatform: !!out.body.sellingPlatform,
      profit: value > 0 ? Math.round((value - num(w.purchaseValue)) * 100) / 100 : null,
    });
  } catch (e) {
    console.error('operations-private update:', e);
    res.status(500).json({ message: 'تعذّر حفظ السعر' });
  }
};

/** Analytics: the operations manager dashboard cards and charts over the same data. The computation lives in `opsAnalyticsController` so this page and the shipment-orders dashboard share one result and a number never differs between screens. */
exports.analytics = require('./opsAnalyticsController').analytics;
exports.analyticsFilters = require('./opsAnalyticsController').filters;

exports.priceFor = priceFor;
exports.applyRoute = applyRoute;
