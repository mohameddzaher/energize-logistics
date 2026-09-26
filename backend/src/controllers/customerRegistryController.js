/**
 * سجلُّ العملاء — جدولٌ واحدٌ لكلّ ما يُعرَف عن العميل، وملفٌّ لكلّ عميل.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كان العملاءُ بطاقاتٍ: الاسمُ والهاتفُ وزرّا تعديلٍ وحذف. ولا يُقرأ منها ما
 * يُسأل عنه أوّلًا — «كم كشفًا لهذا العميل؟ وبكم؟ وعلى أيّ المسارات؟ ومتى
 * آخرُ شحنةٍ له؟» — فيُفتح الجدولُ في مكانٍ آخر ويُجمَع بالعين.
 *
 * فصار سجلًّا يُقرأ كإكسل: عمودٌ لكلّ رقم، وفلترٌ على كلّ عمود، وملفٌّ يُفتح
 * على العميل فيه رحلاتُه وتحليلُه وأسعارُ مساراته.
 *
 * ── والوصلُ بالاسم المطويّ لا الحرفيّ ───────────────────────────────────────
 * اسمُ العميل في كشوف التشغيل يحمل فراغاتٍ غيرَ عاديّة (NBSP ومسافاتٍ مزدوجة)
 * جاءت من المنصّة. فالمطابقةُ الحرفيّةُ تعيد صفرًا والكشوفُ أربعةُ آلاف:
 * `countDocuments({ username: name })` = ٠ بينما الاسمُ نفسُه في القائمة.
 * فالوصلُ كلُّه بالمفتاح المطويّ (`fold` في CollectionsParty) — راجع
 * customer-name-hidden-differences.
 */
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrder = require('../models/ShipmentOrder');
const { fold } = require('../models/CollectionsParty');
const { routeKey } = require('../utils/customerRoutes');
const cache = require('../utils/ttlCache');
const { canSeeMoney } = require('./workflowController');

const TTL = 60 * 1000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** مجاميعُ كشوف التشغيل لكلّ عميلٍ مطويِّ الاسم — قراءةٌ واحدةٌ للجميع. */
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
 * الطلباتُ المُنشأة **عندنا** لكلّ عميل.
 *
 * ولا تُعَدُّ المنسوخةُ من المنصّة: ٣٦٬٢٨٤ من ٣٦٬٢٨٥ صفًّا في هذا السجلّ مرآةٌ
 * لكشوف التشغيل نفسِها (`source: 'platform'`)، فعَدُّها يكرّر عمودَ الكشوف
 * برقمٍ مطابقٍ ويوهم أنّهما عملان.
 */
async function orderTotals() {
  const rows = await ShipmentOrder.aggregate([
    { $match: { source: { $ne: 'platform' } } },
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
 * صفُّ العميل كما يُقرأ في الجدول.
 *
 * ── ولا يُرسَل فراغ ─────────────────────────────────────────────────────────
 * كان الصفُّ يُكتب بكلّ حقوله دائمًا، فبلغت الحمولةُ ٣١١ كيلوبايت لستّمئةٍ
 * وإحدى وسبعين عميلًا — وأكثرُ من ثلثها أسماءُ حقولٍ لا قيمةَ فيها:
 * `"paymentMethod":""` في ٦٦٩ صفًّا، و`"minPrice":null` في ٥٤٣، و`"lastSheetAt":null`
 * في ٤٤٩. وكلُّ قارئٍ لها — الجدولُ والتصديرُ والفرزُ وشاشةُ الهاتف — يقرؤها
 * بـ`?? ''` أو `v == null`، فالغائبُ عنده هو الفارغُ نفسُه.
 *
 * فيُحذَف الفارغُ والمعدوم، ويبقى **الصفرُ** و`false`: «٠ كشفًا» رقمٌ يُقرأ في
 * العمود، وبطاقةُ «بلا عمل» تُبنى على `sheets === 0` — فحذفُه يُفرغ الشريحة.
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
  // `notes` و`lastOrderAt` لا يُرسَلان: لا عمودَ لهما في الجدول ولا في التصدير
  // (`REGISTRY_COLS` في lib/customerRegistry.ts). والملاحظاتُ تُقرأ وتُكتب في
  // ملفّ العميل — `/api/customer-registry/:id` — لا في السجلّ.
  // التفضيلاتُ المعتمدة تُقرأ في الجدول أيضًا: من يملأ شحنةً يريد أن يعرف
  // أنّ لهذا العميل نوعَ شاحنةٍ وطريقةَ دفعٍ متّفقًا عليهما.
  put(out, 'truckType', c.defaults?.truckType);
  put(out, 'cargoType', c.defaults?.cargoType);
  put(out, 'paymentMethod', c.defaults?.paymentMethod);
  put(out, 'branch', c.defaults?.branch);
  return out;
}

// GET /api/customer-registry — الجدول كلُّه بأرقامه (الفلترةُ والفرزُ في الشاشة).
exports.list = async (req, res) => {
  try {
    const body = await cache.wrapStale('so:registry:customers:full', TTL, 15 * 60 * 1000, async () => {
      const [customers, sheets, orders] = await Promise.all([
        ShipmentOrderCustomer.find({}).select('name phone email routes defaults isActive').lean(),
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
    // الشراءُ مالٌ: يُحجَب عمّن لا يراه في سير العمل — بالقاعدة نفسِها.
    if (!canSeeMoney(req.user.role)) {
      return res.json({
        customers: body.customers.map(({ purchaseTotal, ...r }) => r),
        summary: { ...body.summary, purchaseTotal: undefined },
      });
    }
    res.json(body);
  } catch (e) {
    console.error('customer registry list:', e);
    res.status(500).json({ message: 'تعذّر تحميل سجل العملاء' });
  }
};

/**
 * GET /api/customer-registry/:id — ملفُّ العميل: تحليلُه ومساراتُه ورحلاتُه.
 *
 * والرحلاتُ من كشوف التشغيل (تاريخُ العمل الحقيقيّ) ومن طلباتنا معًا، موصولةً
 * بالاسم المطويّ. ويُعاد منها صفحةٌ واحدةٌ لا الكلّ: عميلٌ له أربعةُ آلاف كشف.
 */
exports.profile = async (req, res) => {
  try {
    const c = await ShipmentOrderCustomer.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ message: 'العميل غير موجود' });
    const key = fold(c.name);
    const money = canSeeMoney(req.user.role);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const body = await cache.wrapStale(
      `so:registry:profile:${c._id}:${money ? 'm' : 'n'}:${page}:${limit}`, TTL, 10 * 60 * 1000,
      async () => {
        // كلُّ اسمٍ في الكشوف يطوي إلى مفتاح هذا العميل — قد يكون أكثرَ من كتابة.
        const names = (await OperationsWorkflow.distinct('username', { username: { $nin: [null, ''] } }))
          .filter((n) => fold(n) === key);
        const match = names.length ? { username: { $in: names } } : { _id: null };

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
            { $match: { ...match, reportDate: { $ne: null } } },
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
          ShipmentOrder.find({ source: { $ne: 'platform' }, customerName: { $in: names.length ? names : [c.name] } })
            .select('orderNumber createdAt fromCity toCity status supplierName vehiclePlate price')
            .sort({ createdAt: -1 }).limit(50).lean(),
        ]);

        const a = agg[0] || { sheets: 0, purchase: 0, first: null, last: null, branches: [] };
        // سعرُ كلّ مسارٍ كما في ملفّ العميل — يُوصَل بالمسار المطويّ نفسِه.
        const priceOf = new Map();
        for (const r of c.routes || []) {
          if (r.price == null) continue;
          const k = routeKey(r.fromCity, r.toCity);
          const prev = priceOf.get(k);
          if (!prev || (r.at || 0) > (prev.at || 0)) priceOf.set(k, { price: r.price, at: r.at, source: r.source });
        }
        const routes = byRoute.map((r) => {
          const p = priceOf.get(routeKey(r._id.from, r._id.to));
          return {
            from: r._id.from || '', to: r._id.to || '', sheets: r.sheets,
            purchase: money ? r2(r.purchase) : undefined,
            lastAt: r.last || null,
            price: p ? p.price : null, priceAt: p?.at || null, priceSource: p?.source || '',
          };
        });

        return {
          customer: {
            _id: String(c._id), name: c.name, phone: c.phone || '', email: c.email || '',
            notes: c.notes || '', isActive: c.isActive !== false,
            defaults: c.defaults || {},
            routes: (c.routes || []).map((r) => ({
              _id: String(r._id || ''), fromCity: r.fromCity || '', toCity: r.toCity || '',
              price: r.price ?? null, at: r.at || null, source: r.source || '', hits: r.hits || 1,
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
          sheets: { rows: sheetsPage, total, page, pages: Math.max(1, Math.ceil(total / limit)) },
          orders,
        };
      },
    );
    res.json(body);
  } catch (e) {
    console.error('customer registry profile:', e);
    res.status(500).json({ message: 'تعذّر تحميل ملف العميل' });
  }
};
