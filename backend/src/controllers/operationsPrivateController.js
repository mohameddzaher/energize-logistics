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
const logAudit = require('../utils/auditLogger');

const S = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** الأعمدةُ التي تُقرأ في الجدول — لا يُنقَل ما لا يُعرَض. */
const LIST_FIELDS = [
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'username', 'userPhone', 'applicationStatus',
  'paymentMethod', 'purchaseValue', 'sellingValue', 'driverName', 'truckType',
  'truckSize', 'loadType', 'reference', 'representativeName', 'stage',
  'externalSource', 'createdAt',
].join(' ');

/** فهرسُ أسعار المسارات: مفتاحُ «عميل|مسار» ← السعر. يُبنى مرّةً لكلّ نداء. */
async function routePriceIndex() {
  const { fold } = require('../models/CollectionsParty');
  const customers = await ShipmentOrderCustomer.find({ isActive: { $ne: false } })
    .select('name routes').lean();
  const map = new Map();
  for (const c of customers) {
    for (const r of c.routes || []) {
      if (r.price == null) continue;
      map.set(`${fold(c.name)}|${routeKey(r.fromCity, r.toCity)}`, Number(r.price));
    }
  }
  return map;
}

/** سعرُ الكشف كما يُعرَض: المحفوظُ عندنا، وإلّا سعرُ مسار العميل، وإلّا صفر. */
function resolvePrice(w, saved, index) {
  const { fold } = require('../models/CollectionsParty');
  if (saved) return { value: num(saved.sellingValue), source: saved.source || 'manual', saved: true };
  const p = index.get(`${fold(w.username || '')}|${routeKey(w.fromLocation, w.toLocation)}`);
  if (p != null) return { value: p, source: 'route', saved: false };
  return { value: 0, source: '', saved: false };
}

// GET /api/operations-private
exports.list = async (req, res) => {
  try {
    const { buildWorkflowFilter } = require('./workflowController');
    const filter = buildWorkflowFilter(req.query, undefined, true);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const [rows, total] = await Promise.all([
      OperationsWorkflow.find(filter).select(LIST_FIELDS)
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .lean(),
      OperationsWorkflow.countDocuments(filter),
    ]);

    const ids = rows.map((r) => r._id);
    const [saved, index] = await Promise.all([
      PrivateSellingPrice.find({ workflow: { $in: ids } }).lean(),
      routePriceIndex(),
    ]);
    const byId = new Map(saved.map((s) => [String(s.workflow), s]));

    const workflows = rows.map((w) => {
      const p = resolvePrice(w, byId.get(String(w._id)), index);
      return {
        ...w,
        // ── والعمودُ يُسمّى باسمه ────────────────────────────────────────
        // `sellingValue` هنا سعرُنا نحن، و`platformSellingValue` ما تقوله
        // المنصّة — يُعرَضان معًا فيُرى الفرقُ ولا يُخلَط بينهما.
        platformSellingValue: num(w.sellingValue),
        sellingValue: p.value,
        priceSource: p.source,
        priceSaved: p.saved,
        // ── وكشفٌ بلا سعرٍ لا ربحَ له ولا خسارة ────────────────────────────
        // الصفرُ في خانة البيع ليس بيعًا بصفر: هو «لم يُسعَّر بعد». وطرحُه من
        // الشراء يعطي خسارةً كاملةً في كلّ صفٍّ لم يصله سعرُه — ومجموعُها
        // يُقرأ في اللوحة كارثةً لم تقع.
        profit: p.value > 0 ? Math.round((p.value - num(w.purchaseValue)) * 100) / 100 : null,
      };
    });

    res.json({
      workflows, total, page, pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    console.error('operations-private list:', e);
    res.status(500).json({ message: 'تعذّر تحميل التقرير' });
  }
};

// GET /api/operations-private/stats — مجاميعُ الفلتر كلِّه لا الصفحةِ المعروضة.
exports.stats = async (req, res) => {
  try {
    const { buildWorkflowFilter } = require('./workflowController');
    const filter = buildWorkflowFilter(req.query, undefined, true);
    const rows = await OperationsWorkflow.find(filter)
      .select('username fromLocation toLocation purchaseValue').lean();
    const ids = rows.map((r) => r._id);
    const [saved, index] = await Promise.all([
      PrivateSellingPrice.find({ workflow: { $in: ids } }).select('workflow sellingValue source').lean(),
      routePriceIndex(),
    ]);
    const byId = new Map(saved.map((s) => [String(s.workflow), s]));

    // ── والربحُ يُحسب على ما سُعِّر وحدَه ─────────────────────────────────
    // الكشفُ الذي لم يصله سعرُ بيعه بعد ليس صفقةً بلا إيراد: هو صفقةٌ لم
    // يُكتب إيرادُها. فجمعُ شرائه مع بيعٍ صفرٍ يصنع «خسارةً» بعشرين مليونًا
    // لا وجودَ لها. فتُفصَل: ربحٌ على المسعَّر، وشراءُ غيرِ المسعَّر يُقال
    // وحدَه ليُعرَف حجمُ ما ينقص.
    let sell = 0; let buyPriced = 0; let buyAll = 0; let priced = 0; let unpriced = 0;
    for (const w of rows) {
      const p = resolvePrice(w, byId.get(String(w._id)), index);
      const b = num(w.purchaseValue);
      buyAll += b;
      if (p.value > 0) { sell += p.value; buyPriced += b; priced += 1; } else unpriced += 1;
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    res.json({
      total: rows.length,
      priced,
      unpriced,
      sumSelling: r2(sell),
      sumPurchase: r2(buyPriced),
      sumPurchaseAll: r2(buyAll),
      sumPurchaseUnpriced: r2(buyAll - buyPriced),
      profit: r2(sell - buyPriced),
      margin: sell ? r2(((sell - buyPriced) / sell) * 100) : 0,
    });
  } catch (e) {
    console.error('operations-private stats:', e);
    res.status(500).json({ message: 'تعذّر حساب المجاميع' });
  }
};

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
