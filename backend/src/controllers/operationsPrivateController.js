/**
 * «التشغيل — خاصّ»: كشوفُ التشغيل نفسُها، بسعر بيعنا الحقيقيّ.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * سعرُ البيع في سير عمل التشغيل يأتي من منصّةٍ ليست لنا، وهو مساوٍ لسعر
 * الشراء دائمًا — فريقُ العمليّات هناك لا يعرف هامشَنا ولا يجوز أن يعرفه.
 * فالصفحةُ التي يقرأ فيها المديرُ «البيع» كانت تقرأ شراءً مكتوبًا مرّتين،
 * وتصحيحُه في مكانه يعني شيئين ممنوعين: تمحوه المزامنةُ في أوّل مرور، وقد
 * يُدفَع إلى المنصّة فيُقرأ هناك.
 *
 * فهذه الصفحةُ **ليست نسخةً ثانية**: تقرأ الكشوفَ من موضعها حرفًا بحرف، ولا
 * تملك منها إلّا عمودًا واحدًا — سعرَ البيع — محفوظًا عندنا في
 * `PrivateSellingPrice`. فكلُّ ما يحدث في التشغيل (كشفٌ جديد، تعديلُ عميلٍ،
 * إلغاءُ حمولة) يظهر هنا في اللحظة بلا مزامنةٍ ولا انتظار، ولا يظهر ما يُكتب
 * هنا في أيّ مكانٍ آخر.
 *
 * ── ومن أين يأتي السعرُ حين لا يُكتب بيد ────────────────────────────────────
 * من ملفّ العميل: آخرُ سعرٍ عُمل به على هذا المسار (utils/customerRoutes).
 * فالكشفُ الجديد يولد بسعره الصحيح بلا أن يفتحه أحد، والموظّفُ يصحّح ما شذّ —
 * وتصحيحُه يصير هو الأحدثَ في ملفّ العميل، فيرثه ما بعده.
 */
const mongoose = require('mongoose');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const PrivateSellingPrice = require('../models/PrivateSellingPrice');
const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
const { routeKey, applyRoute, priceFor } = require('../utils/customerRoutes');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');

const S = (v) => String(v ?? '').trim();
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
  'purchaseValue', 'sellingValue', 'driverName', 'driverPhone', 'truckType', 'truckSize',
  'loadType', 'reference', 'representativeName', 'operationsReview',
  'paymentDate', 'paymentDateByName', 'payingBranch', 'paymentAmount', 'paymentType',
  'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
  'stage', 'externalSource', 'createdAt',
];
const LIST_PROJECT = Object.fromEntries(LIST_FIELDS.map((f) => [f, 1]));

/**
 * فهرسُ أسعار المسارات: مفتاحُ «عميل|مسار» ← السعر.
 *
 * ── ويُحفَظ دقيقةً ولا يُبنى لكلّ نداء ─────────────────────────────────────
 * بناؤه قراءةُ العملاء كلِّهم بمساراتهم (١٧٠ كيلوبايت) — أثقلُ ما في الصفحة،
 * وكان يُدفَع مع كلّ صفحةٍ وكلّ مجموعٍ وكلّ خبرٍ حيّ. وأيُّ كتابةٍ على عميلٍ
 * تمسحه (خطّافاتُ ShipmentOrderCustomer)، فلا يُقرأ سعرٌ سبق تصحيحَه.
 */
async function routePriceIndex() {
  const cache = require('../utils/ttlCache');
  return cache.wrap('opsprivate:routes', 60000, async () => {
    const { fold } = require('../models/CollectionsParty');
    const customers = await ShipmentOrderCustomer.find({ isActive: { $ne: false } })
      .select('name routes.fromCity routes.toCity routes.price').lean();
    const map = new Map();
    for (const c of customers) {
      for (const r of c.routes || []) {
        if (r.price == null) continue;
        map.set(`${fold(c.name)}|${routeKey(r.fromCity, r.toCity)}`, Number(r.price));
      }
    }
    return map;
  });
}

/** سعرُ المسار لعميلٍ ومدينتين — أو `undefined` إن لم يكن له سعر. */
function routePrice(index, username, from, to) {
  const { fold } = require('../models/CollectionsParty');
  return index.get(`${fold(username || '')}|${routeKey(from, to)}`);
}

/** سعرُ الكشف كما يُعرَض: المحفوظُ عندنا، وإلّا سعرُ مسار العميل، وإلّا صفر. */
function resolvePrice(w, saved, index) {
  if (saved) return { value: num(saved.sellingValue), source: saved.source || 'manual', saved: true };
  const p = routePrice(index, w.username, w.fromLocation, w.toLocation);
  if (p != null) return { value: num(p), source: 'route', saved: false };
  return { value: 0, source: '', saved: false };
}

const r2 = (x) => Math.round(x * 100) / 100;

/** الصفُّ كما يُعرَض: سعرُنا في `sellingValue`، وسعرُ المنصّة باسمه. */
function shapeRow(w, saved, index) {
  const p = resolvePrice(w, saved, index);
  const buy = num(w.purchaseValue);
  // ── وكشفٌ بلا سعرٍ لا ربحَ له ولا خسارة ──────────────────────────────────
  // الصفرُ في خانة البيع ليس بيعًا بصفر: هو «لم يُسعَّر بعد». وطرحُه من
  // الشراء يعطي خسارةً كاملةً في كلّ صفٍّ لم يصله سعرُه.
  const profit = p.value > 0 ? r2(p.value - buy) : null;
  const { _p, ...rest } = w;
  return {
    ...rest,
    // ── والعمودُ يُسمّى باسمه ──────────────────────────────────────────────
    // `sellingValue` هنا سعرُنا نحن، و`platformSellingValue` ما تقوله المنصّة.
    platformSellingValue: num(w.sellingValue),
    sellingValue: p.value,
    priceSource: p.source,
    priceSaved: p.saved,
    profit,
    margin: profit != null && p.value > 0 ? r2((profit / p.value) * 100) : null,
  };
}

/**
 * ── الفلترُ هو فلترُ سير عمل التشغيل حرفًا بحرف ─────────────────────────────
 * البحثُ والمدى (من/إلى، ونهايةُ «إلى» آخرُ لحظةٍ من يومها بتوقيت الشركة)
 * وفلاترُ الأعمدة (`cf_<العمود>`) و«فواتير لم تصل» — كلُّها من
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

/** يُلحق بكلّ كشفٍ سعرَه المحفوظ (إن وُجد) في `_p`. */
const lookupStages = () => [
  {
    $lookup: {
      from: PrivateSellingPrice.collection.name,
      localField: '_id',
      foreignField: 'workflow',
      as: '_p',
    },
  },
  { $addFields: { _p: { $arrayElemAt: ['$_p', 0] } } },
];

/**
 * ── المجاميعُ تُحسب في القاعدة لا بنقل الصفوف ────────────────────────────────
 * كان الحسابُ ينقل كلَّ صفٍّ مطابقٍ إلى الخادم ليجمعه: ستّةٌ وثلاثون ألفَ صفٍّ
 * على عنقودٍ بطيء النقل = دقيقةٌ وأكثر للبطاقات وحدَها. والسعرُ لا يحتاج الصفَّ:
 *   • المحفوظُ يُقرأ بـ`$lookup` ويُجمع في القاعدة،
 *   • وسعرُ المسار يتوقّف على (العميل، من، إلى) وحدَها — فتُجمع الصفوفُ بلا
 *     سعرٍ محفوظ على هذا الثلاثيّ، ويُسعَّر كلُّ ثلاثيٍّ مرّةً في الخادم.
 * فيعبر الشبكةَ بضعةُ آلافِ مجموعةٍ صغيرة لا عشراتُ آلافِ صفّ.
 */
async function priceGroups(filter, index) {
  const groups = await OperationsWorkflow.aggregate([
    { $match: filter },
    ...lookupStages(),
    {
      $project: {
        u: '$username', f: '$fromLocation', t: '$toLocation',
        b: { $ifNull: ['$purchaseValue', 0] },
        ps: { $ifNull: ['$sellingValue', 0] },
        has: { $cond: [{ $ifNull: ['$_p', false] }, true, false] },
        s: { $ifNull: ['$_p.sellingValue', 0] },
      },
    },
    {
      $group: {
        _id: {
          has: '$has',
          pos: { $gt: ['$s', 0] },
          u: { $cond: ['$has', null, '$u'] },
          f: { $cond: ['$has', null, '$f'] },
          t: { $cond: ['$has', null, '$t'] },
        },
        n: { $sum: 1 }, b: { $sum: '$b' }, s: { $sum: '$s' }, ps: { $sum: '$ps' },
      },
    },
  ]).allowDiskUse(true);

  return groups.map((g) => {
    if (g._id.has) {
      return { n: g.n, b: num(g.b), ps: num(g.ps), sell: g._id.pos ? num(g.s) : 0, priced: !!g._id.pos, has: true };
    }
    const p = num(routePrice(index, g._id.u, g._id.f, g._id.t));
    return {
      n: g.n, b: num(g.b), ps: num(g.ps), sell: p > 0 ? p * g.n : 0, priced: p > 0, has: false,
      key: { u: g._id.u, f: g._id.f, t: g._id.t },
    };
  });
}

/**
 * شرطُ «مسعَّر / غير مسعَّر» على مستوى الصفّ — بعد `$lookup`.
 * المسعَّر: له سعرٌ محفوظٌ موجب، أو لا محفوظَ له ومسارُه مسعَّر في ملفّ العميل.
 * والثلاثيّاتُ المسعَّرة تأتي من `priceGroups` نفسِها، فلا يفترق الجدولُ عن
 * البطاقات في تعريف «المسعَّر».
 */
function pricedMatch(priced, groups) {
  const combos = groups.filter((g) => !g.has && g.priced)
    .map((g) => ({ username: g.key.u, fromLocation: g.key.f, toLocation: g.key.t }));
  const noSaved = { _p: { $exists: false } };
  if (priced === 'yes') {
    return {
      $or: [
        { '_p.sellingValue': { $gt: 0 } },
        ...(combos.length ? [{ $and: [noSaved, { $or: combos }] }] : []),
      ],
    };
  }
  return {
    $or: [
      { $and: [{ _p: { $exists: true } }, { $nor: [{ '_p.sellingValue': { $gt: 0 } }] }] },
      combos.length ? { $and: [noSaved, { $nor: combos }] } : noSaved,
    ],
  };
}

/** يجمع المجموعات إلى أرقام البطاقات. */
function summarize(groups) {
  let sell = 0; let buyPriced = 0; let buyAll = 0; let priced = 0; let unpriced = 0; let total = 0; let platform = 0;
  for (const g of groups) {
    total += g.n; buyAll += g.b; platform += g.ps;
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
    sumPlatformSelling: r2(platform),
    profit: r2(sell - buyPriced),
    margin: sell ? r2(((sell - buyPriced) / sell) * 100) : 0,
  };
}

/**
 * الصفوفُ المطابقة (بفلتر «مسعَّر» إن طُلب) مرتّبةً كالجدول، مع سعرها المحفوظ.
 * `skip/limit` للصفحة؛ وبلا حدٍّ للتصدير (بسقفٍ عاقل).
 */
async function matchingRows(filter, priced, index, { skip = 0, limit = 0 } = {}) {
  if (!priced) {
    // بلا فلتر «مسعَّر»: الصفحةُ تُقصّ أوّلًا ثمّ يُلحق سعرُها — لا `$lookup`
    // على الجدول كلِّه من أجل خمسين صفًّا.
    const pipe = [{ $match: filter }, { $sort: { createdAt: -1 } }];
    if (skip) pipe.push({ $skip: skip });
    if (limit) pipe.push({ $limit: limit });
    pipe.push({ $project: LIST_PROJECT }, ...lookupStages());
    const [rows, total] = await Promise.all([
      OperationsWorkflow.aggregate(pipe).allowDiskUse(true),
      limit ? OperationsWorkflow.countDocuments(filter) : Promise.resolve(null),
    ]);
    return { rows, total: total == null ? rows.length : total };
  }
  const groups = await priceGroups(filter, index);
  const pipe = [
    { $match: filter },
    ...lookupStages(),
    { $match: pricedMatch(priced, groups) },
    { $sort: { createdAt: -1 } },
  ];
  const page = [];
  if (skip) page.push({ $skip: skip });
  if (limit) page.push({ $limit: limit });
  page.push({ $project: { ...LIST_PROJECT, _p: 1 } });
  const [out] = await OperationsWorkflow.aggregate([
    ...pipe,
    { $facet: { rows: page, total: [{ $count: 'n' }] } },
  ]).allowDiskUse(true);
  return { rows: (out && out.rows) || [], total: (out && out.total[0] && out.total[0].n) || 0 };
}

// GET /api/operations-private
exports.list = async (req, res) => {
  try {
    const { filter, money } = baseFilter(req);
    const priced = pricedParam(req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    // بلا فلتر «مسعَّر» لا تحتاج الصفحةُ الفهرسَ قبل قراءتها — فيُقرآن معًا.
    const [index, { rows, total }] = priced
      ? await routePriceIndex().then(async (ix) => [ix, await matchingRows(filter, priced, ix, { skip: (page - 1) * limit, limit })])
      : await Promise.all([routePriceIndex(), matchingRows(filter, priced, null, { skip: (page - 1) * limit, limit })]);
    const { stripMoneyFor } = require('./workflowController');
    const workflows = stripMoneyFor(req.user.role, rows.map((w) => shapeRow(w, w._p, index)));

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
      const index = await routePriceIndex();
      let groups = await priceGroups(filter, index);
      if (priced) groups = groups.filter((g) => g.priced === (priced === 'yes'));
      return summarize(groups);
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
  const index = await routePriceIndex();
  const { rows, total } = await matchingRows(filter, priced, index, { limit: 0 });
  const capped = rows.slice(0, EXPORT_CAP);
  const shaped = require('./workflowController').stripMoneyFor(user.role, capped.map((w) => shapeRow(w, w._p, index)));
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
    const SOURCE_AR = { sheet: 'تقرير الفروع', route: 'ملفّ العميل', manual: 'يدويّ', private: 'يدويّ' };
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
      ['سعر البيع (المنصّة)', (w) => num(w.platformSellingValue)],
      ['سعر البيع (الحقيقي)', (w) => (w.sellingValue > 0 ? w.sellingValue : '')],
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
      ['نوع الدفع', (w) => (w.paymentType === 'cash' ? 'كاش' : w.paymentType === 'tax' ? 'ضريبي' : '')],
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
 * PUT /api/operations-private/:id — سعرُ البيع وحدَه.
 *
 * ولا يُكتب في الكشف: الكشفُ مرآةُ المنصّة، وما يُكتب فيه قد يعود إليها.
 * ويُعلَّم ملفُّ العميل: هذا آخرُ سعرٍ عُمل به على هذا المسار.
 */
exports.updatePrice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const w = await OperationsWorkflow.findById(req.params.id)
      .select('reportNumber username fromLocation toLocation purchaseValue reportDate').lean();
    if (!w) return res.status(404).json({ message: 'الكشف غير موجود' });

    const value = Number(req.body.sellingValue);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'سعرٌ غير صالح' });
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';

    const doc = await PrivateSellingPrice.findOneAndUpdate(
      { workflow: w._id },
      {
        $set: {
          reportNumber: S(w.reportNumber),
          sellingValue: value,
          source: 'manual',
          note: S(req.body.note).slice(0, 300),
          updatedBy: req.user._id,
          updatedByName: who,
        },
      },
      { new: true, upsert: true },
    ).lean();

    // ── والتصحيحُ يُعلِّم ملفَّ العميل ────────────────────────────────────
    // مَن صحّح سعرَ كشفٍ إنّما يقول «هذا سعرُنا على هذا المسار اليوم». فيرثه
    // كلُّ كشفٍ بعده بلا أن يُكتب مرّةً ثانية — وهو نفسُه الرقمُ الذي تقترحه
    // شاشةُ إنشاء الشحنة.
    let learned = null;
    try {
      const { learnRouteByName } = require('../utils/customerRoutes');
      learned = await learnRouteByName(w.username, {
        fromCity: w.fromLocation,
        toCity: w.toLocation,
        price: value,
        at: w.reportDate || new Date(),
        source: 'private',
      });
    } catch (e) { console.error('[private] learn route:', e.message); }

    try { cache.clear('opsprivate:stats'); } catch (_) { /* */ }
    try { emitToAll('operationsPrivate:updated', { _id: String(w._id), sellingValue: value }); } catch (_) { /* */ }
    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'PrivateSellingPrice',
      entityId: w._id,
      changes: { after: { sellingValue: value, reportNumber: w.reportNumber } },
      ipAddress: req.ip,
    });

    res.json({
      price: doc,
      learned,
      profit: Math.round((value - num(w.purchaseValue)) * 100) / 100,
    });
  } catch (e) {
    console.error('operations-private update:', e);
    res.status(500).json({ message: 'تعذّر حفظ السعر' });
  }
};

/** يُستعمَل في الاستيراد وفي الاختبار — يكتب سعرًا بمصدره بلا طلبِ HTTP. */
exports.setPrice = async function setPrice(workflowId, reportNumber, value, source) {
  return PrivateSellingPrice.findOneAndUpdate(
    { workflow: workflowId },
    { $set: { reportNumber: S(reportNumber), sellingValue: Number(value) || 0, source } },
    { new: true, upsert: true },
  );
};

exports.priceFor = priceFor;
exports.applyRoute = applyRoute;
