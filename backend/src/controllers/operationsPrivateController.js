/**
 * «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها، بقيمة البيع وما تحتها من ربح.
 *
 * ── كان للسعر نسختان، وصارت واحدة ──────────────────────────────────────────
 * كانت هذه الصفحةُ تحفظ «السعرَ الحقيقيّ» في جدولٍ وحدَها (`PrivateSellingPrice`)
 * لأنّ قيمةَ البيع في الكشف كانت تأتي من المنصّة مساويةً للشراء ولا يجوز أن
 * يُكتب فيها هامشُنا. ثمّ صارت قيمةُ البيع في سير العمل تُكتب بيدٍ وتُدفَع إلى
 * المنصّة بإذن صاحب الشركة، فصار للرقم الواحد موضعان: يُصحَّح هنا فيبقى سيرُ
 * العمل والتحصيلُ على القديم، ويُصحَّح هناك فتبقى هذه الصفحةُ على القديم.
 *
 * فصار المرجعُ **عمودَ `sellingValue` في الكشف وحدَه** (صاحبُ الشركة،
 * ٢٠٢٦/١٠/٢١): هذه الصفحةُ تقرؤه كما يقرؤه سيرُ العمل، وتكتبه بالطريق نفسِه
 * (`workflowController.setSellingValue` — صلاحيّةُ العمود، والقفل، والمنصّةُ
 * أوّلًا، والذاكرةُ والبثّ). ولا يُكتب في `PrivateSellingPrice` بعد اليوم؛ ما
 * فيه يُطابَق مرّةً بسكربت (scripts/reconcilePrivateSellingPrices.js).
 *
 * ── وسعرُ مسار العميل اقتراحٌ لا قيمة ───────────────────────────────────────
 * كان الكشفُ بلا سعرٍ محفوظٍ يُعرَض هنا بسعر مساره من ملفّ العميل، فيقول
 * الجدولُ رقمًا لا يقوله الكشفُ نفسُه. فصار يُعرَض بجانب القيمة (`routePrice`)
 * ليُعتمَد بضغطة — وما يُعتمَد يُكتب في الكشف كأيّ تعديل.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const { routeKey, applyRoute, priceFor } = require('../utils/customerRoutes');
const cache = require('../utils/ttlCache');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * الأعمدةُ التي تُقرأ في الجدول — أعمدةُ سير عمل التشغيل نفسُها، ليُرى الكشفُ
 * هنا كما يُرى هناك. وأعمدةُ المال (الفاتورة والتحصيل) تُحجب عمّن لا يملكها
 * بالقاعدة نفسِها التي تحجبها هناك (`stripMoneyFor`).
 */
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
 * فهرسُ أسعار المسارات: مفتاحُ «عميل|مسار» ← السعر.
 *
 * ── ويُحفَظ دقيقةً ولا يُبنى لكلّ نداء ─────────────────────────────────────
 * بناؤه قراءةُ العملاء كلِّهم بمساراتهم (١٧٠ كيلوبايت). وأيُّ كتابةٍ على عميلٍ
 * تمسحه (خطّافاتُ ShipmentOrderCustomer)، فلا يُقرأ سعرٌ سبق تصحيحَه.
 */
async function routePriceIndex() {
  return cache.wrap('opsprivate:routes', 60000, async () => {
    const { fold } = require('../models/CollectionsParty');
    const customers = await ShipmentOrderCustomer.find({ isActive: { $ne: false } })
      .select('name routes.fromCity routes.toCity routes.price routes.tiers').lean();
    const map = new Map();
    // ── ومسارُ الشرائح يُقترَح بأعلى شريحةٍ فيه ─────────────────────────────
    // الكشفُ سيارةٌ واحدة ولا شيءَ فيه يقول كم سيارةً طلب العميل — فلا تُعرَف
    // شريحتُه. فيُقترَح **أعلى** سعرٍ للمسار (قرارُ صاحب الشركة).
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

/** سعرُ مسار العميل المقترَح: `{ value, source: 'tier'|'route' }` أو `null`. */
function unitPrice(index, username, from, to) {
  const { fold } = require('../models/CollectionsParty');
  const k = `${fold(username || '')}|${routeKey(from, to)}`;
  const p = index.get(k);
  if (p == null) return null;
  return { value: Number(p), source: index.tiers && index.tiers.has(k) ? 'tier' : 'route' };
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * مصدرُ القيمة كما يُقرأ: من كتبها بيده (`manual`)، أو دفترُ التحصيل
 * (`collections_book`)، أو المنصّةُ (`platform` — وهو الفارغُ القديم أيضًا).
 */
const sourceOf = (w) => {
  const s = String(w.sellingValueSource || '');
  return s === 'manual' || s === 'collections_book' ? s : 'platform';
};

/** الصفُّ كما يُعرَض: قيمةُ الكشف نفسُها، وربحُها، واقتراحُ مسار العميل. */
function shapeRow(w, index) {
  const sell = num(w.sellingValue);
  const buy = num(w.purchaseValue);
  // ── وكشفٌ بلا سعرٍ لا ربحَ له ولا خسارة ──────────────────────────────────
  // الصفرُ في خانة البيع ليس بيعًا بصفر: هو «لم يُسعَّر بعد». وطرحُه من
  // الشراء يعطي خسارةً كاملةً في كلّ صفٍّ لم يصله سعرُه.
  const profit = sell > 0 ? r2(sell - buy) : null;
  const route = index ? unitPrice(index, w.username, w.fromLocation, w.toLocation) : null;
  const source = sourceOf(w);
  return {
    ...w,
    sellingValue: sell,
    // (يبقى الاسمُ لنسخ الجوّال القديمة — وهو القيمةُ نفسُها: لا سعرَ ثانٍ.)
    platformSellingValue: sell,
    priceSource: source,
    priceSaved: source !== 'platform',
    routePrice: route ? route.value : null,
    routePriceSource: route ? route.source : '',
    profit,
    margin: profit != null && sell > 0 ? r2((profit / sell) * 100) : null,
  };
}

/**
 * ── الفلترُ هو فلترُ سير عمل التشغيل حرفًا بحرف ─────────────────────────────
 * البحثُ والمدى وفلاترُ الأعمدة (`cf_<العمود>`) و«سندات لم تصل» — كلُّها من
 * `buildWorkflowFilter`. وأعمدةُ المال لا يُفلتَر بها مَن لا يراها.
 */
function baseFilter(req) {
  const { buildWorkflowFilter, canSeeMoney } = require('./workflowController');
  const money = canSeeMoney(req.user && req.user.role);
  return { filter: buildWorkflowFilter(req.query, undefined, money), money };
}

/** «مسعَّر / غير مسعَّر» — الفلترُ الوحيدُ الذي لا تعرفه صفحةُ سير العمل. */
const pricedParam = (q) => {
  const v = String((q && q.priced) || '').trim();
  return v === 'yes' || v === 'no' ? v : '';
};

/** المسعَّر: قيمةُ بيعٍ موجبةٌ في الكشف. وغيرُه: صفرٌ أو فراغ. */
const PRICED = { sellingValue: { $gt: 0 } };
const withPriced = (filter, priced) => {
  if (!priced) return filter;
  const cond = priced === 'yes' ? PRICED : { $nor: [PRICED] };
  return { $and: [filter, cond] };
};

/** مجاميعُ البطاقات — في القاعدة، على قسمَي «مسعَّر/غير مسعَّر». */
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

/** يجمع المجموعات إلى أرقام البطاقات. */
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
    // القيمةُ واحدةٌ الآن — يبقى الاسمُ لمن يقرؤه.
    sumPlatformSelling: r2(sell),
    profit: r2(sell - buyPriced),
    margin: sell ? r2(((sell - buyPriced) / sell) * 100) : 0,
  };
}

/**
 * الصفوفُ المطابقة (بفلتر «مسعَّر» إن طُلب) مرتّبةً كالجدول.
 * `skip/limit` للصفحة؛ وبلا حدٍّ للتصدير (بسقفٍ عاقل).
 */
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

// GET /api/operations-private/stats — مجاميعُ الفلتر كلِّه لا الصفحةِ المعروضة.
//
// ── والربحُ يُحسب على ما سُعِّر وحدَه ─────────────────────────────────────
// الكشفُ الذي لم يصله سعرُ بيعه بعد ليس صفقةً بلا إيراد: هو صفقةٌ لم يُكتب
// إيرادُها. فجمعُ شرائه مع بيعٍ صفرٍ يصنع «خسارةً» لا وجودَ لها. فتُفصَل:
// ربحٌ على المسعَّر، وشراءُ غيرِ المسعَّر يُقال وحدَه ليُعرَف حجمُ ما ينقص.
exports.stats = async (req, res) => {
  try {
    const { filter } = baseFilter(req);
    const priced = pricedParam(req.query);
    // ── والمجاميعُ تُحفَظ كما تُحفَظ اللوحات ────────────────────────────────
    // تجميعُ ستٍّ وثلاثين ألفَ كشفٍ على ثلاثيّ (عميل، من، إلى) يأخذ قرابةَ
    // الثانية، وتُطلَب مع كلّ فتحةٍ وكلّ خبرٍ حيٍّ من مزامنة التشغيل. فيُقدَّم
    // آخرُ حسابٍ فورًا ويُعاد في الخلف بعد نصف دقيقة، وتصحيحُ سعرٍ يمسحه في
    // حينه (updatePrice) فلا يُقرأ رقمٌ سبق تصحيحَه.
    const key = `opsprivate:stats:${req.user.role}:${JSON.stringify(req.query || {})}`;
    const body = await cache.wrapStale(key, 30000, 10 * 60 * 1000, async () => {
      let groups = await priceGroups(filter);
      if (priced) groups = groups.filter((g) => g.priced === (priced === 'yes'));
      const out = summarize(groups);

      // ── وتوزيعُ حالات الطلب، ليُفلتَر منه ──────────────────────────────────
      // الشاشةُ كانت تعرض المالَ وحدَه، ولا سبيلَ لرؤية «ما هو في الطريق الآن»
      // إلّا بفتح قائمة العمود. وهي البطاقاتُ نفسُها في «سير عمل التشغيل»،
      // فتُحسَب هنا كما تُحسَب هناك: على الفلتر كلِّه لا على الصفحة المعروضة.
      //
      // ويُحسَب على `filter` قبل قسمة «مسعَّر/غير مسعَّر»: تلك قسمةٌ تقع على
      // المجموعات لا على الكشوف، فخلطُها بعدّ الحالات يعطي رقمًا لا يطابق ما
      // يفتحه الضغطُ عليه — وهو العطبُ الذي يُقرأ كذبًا في البطاقة.
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
 * GET /api/operations-private/export — كلُّ ما طابق الفلتر (أو الجدولُ كلُّه بـ
 * `scope=all`) بأسعارنا المحلولة، ملفَّ إكسل يُبنى في الخادم كما يُبنى تصديرُ
 * سير العمل: عشراتُ آلاف الصفوف لا تعبر المتصفّحَ خامًا.
 * و`format=json` يردّ الصفوفَ نفسَها (للجوّال وللتحقّق)، بسقف `EXPORT_CAP`.
 */
const EXPORT_CAP = 60000;
/**
 * البناءُ نفسُه لطلبِ تصديرٍ في الخلفيّة (controllers/exportJobsController) —
 * فالملفُّ واحدٌ سواءٌ نُزِّل في الحال أو جاء إشعارُه بعد حين.
 */
exports.buildExportFile = async (query = {}, user = {}) => {
  const { shaped, money } = await exportRowsFor(query, user);
  const buf = await buildPrivateWorkbook(shaped, money);
  return { buf, rows: shaped.length, name: `operations-private-${new Date().toISOString().slice(0, 10)}.xlsx` };
};

/** الصفوفُ المشكَّلةُ للتصدير — يقرؤها الردُّ المباشر وطلبُ الخلفيّة معًا. */
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

/** المصنَّفُ نفسُه بأعمدته وترجماته — من موضعٍ واحدٍ لا اثنين. */
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
      ['وجهة الكشف النهائية', (w) => w.finalReportDestination || ''],
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
    // كتابةُ المصنَّف في خيطٍ عامل — وإلّا جمَّد هذا التصديرُ كلَّ طلبٍ آخرَ
    // على هذا العامل ثلاثين ثانية. راجع utils/xlsxBuilder.
    const buf = await require('../utils/xlsxBuilder').buildXlsx(aoa, {
      sheetName: 'التشغيل خاص',
      cols: cols.map(([h]) => ({ wch: Math.max(h.length + 4, 14) })),
    });
    return buf;
  }
}

/**
 * PUT /api/operations-private/:id — قيمةُ البيع وحدَها، في الكشف نفسِه.
 *
 * بالطريق الذي يكتب به سيرُ العمل حرفًا (`setSellingValue`): صلاحيّةُ العمود
 * (مَن ليس في SELLING_ROLES يُردّ ٤٠٣ هنا كما هناك)، والقفلُ، والمنصّةُ أوّلًا
 * (رفضُها = لا حفظ)، ومصدرُ `manual` فلا تكتب المزامنةُ فوقها، والذاكرةُ تُمسح
 * قبل البثّ. فما يُكتب هنا يراه سيرُ العمل والتحصيلُ والمنصّةُ في الحال.
 *
 * ويُعلَّم ملفُّ العميل كما كان: هذا آخرُ سعرٍ عُمل به على هذا المسار.
 */
exports.updatePrice = async (req, res) => {
  try {
    const { setSellingValue } = require('./workflowController');
    const note = String(req.body.note ?? '').trim().slice(0, 300);
    const out = await setSellingValue(req.params.id, req.body.sellingValue, req.user, { ip: req.ip, note });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    const w = out.body.workflow;
    const value = Number(w.sellingValue) || 0;

    // ── والتصحيحُ يُعلِّم ملفَّ العميل ────────────────────────────────────
    // مَن صحّح سعرَ كشفٍ إنّما يقول «هذا سعرُنا على هذا المسار اليوم» — وهو
    // نفسُه الرقمُ الذي تقترحه هذه الصفحةُ وشاشةُ إنشاء الشحنة لما بعده.
    // ولا يُعلِّمه إلّا من له أن يكتب سعرَ وجهة.
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

/**
 * التحليلُ — بطاقاتُ لوحة مدير التشغيل ورسومُها، على نفس البيانات.
 * الحسابُ في `opsAnalyticsController` كي يكون واحدًا لهذه الصفحة وللوحة طلبات
 * الشحنات — ولا يختلف رقمٌ بين شاشتين.
 */
exports.analytics = require('./opsAnalyticsController').analytics;
exports.analyticsFilters = require('./opsAnalyticsController').filters;

exports.priceFor = priceFor;
exports.applyRoute = applyRoute;
