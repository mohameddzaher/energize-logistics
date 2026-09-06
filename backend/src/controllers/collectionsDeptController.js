/**
 * قسمُ التحصيل — العملاءُ الذين نحصّل منهم، والموردون الذين نسدّد لهم.
 *
 * ── من أين تأتي الأرقام ────────────────────────────────────────────────────
 * لا من جدولٍ ثانٍ يُملأ باليد. عملُ القسم اليوميّ هو كشوفُ سير عمل التشغيل
 * نفسُها: قيمةُ البيع مستحقٌّ على العميل، وقيمةُ الشراء مستحقٌّ للمورّد، و«تاريخ
 * التحصيل» و«تاريخ السداد» هما ما يقول أيُّهما أُغلق. فالسجلُّ هنا هو الطرف،
 * والأرقامُ تُجمَع من الكشوف — لا تُنسَخ إليها.
 *
 * ونسخُها كان سيعني رقمين لشيءٍ واحد: يُعدَّل الكشفُ فيبقى ملفُّ العميل يقول
 * القديم، ولا يُعرف أيُّهما الصحيح.
 *
 * ── ولماذا التجميعُ في القاعدة ─────────────────────────────────────────────
 * أربعةٌ وثلاثون ألفَ كشفٍ لا تُنقَل إلى العقدة لتُجمَّع فيها: العنقودُ مقيَّدُ
 * النطاق، والنقلُ هو الثمنُ لا الحساب. تُجمَّع في القاعدة فتعود ٢٧٧ صفًّا
 * للعملاء و٢١٢٩ للموردين، ويُطوى الرسمُ العربيّ فوقها في العقدة — وهي مئاتٌ
 * لا آلاف.
 */
const mongoose = require('mongoose');
const CollectionsParty = require('../models/CollectionsParty');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const CollectionsFollowUp = require('../models/CollectionsFollowUp');
const { FleetShipment } = require('../models/FleetModels');
const ShipmentOrder = require('../models/ShipmentOrder');
const { fold } = require('../models/CollectionsParty');
const { dayRange } = require('../utils/companyDay');
const { flexSpaceRegex, numberSearchRegex } = require('../utils/plateKey');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

const CACHE_PREFIX = 'collections-dept:';
const STATS_TTL = 60 * 1000;

// الحقلُ الذي يحمل اسمَ الطرف في الكشف. العميلُ هو «اسم المستخدم» على المنصّة،
// والموردُ هو **مالكُ السيارة** — لا اسمُ السائق: السائقُ يُستأجر والمالكُ
// يُحاسَب، ونحن ندفع لمن يملك الشاحنة.
const FIELD_OF = { customer: 'username', supplier: 'carOwner' };

// اتّجاهُ المال: العميلُ يدفع لنا قيمةَ البيع، والموردُ نأخذ منه بقيمة الشراء.
const VALUE_OF = { customer: 'sellingValue', supplier: 'purchaseValue' };

// وما يقول إنّ الصفَّ أُغلق: العميلُ يُغلق بتاريخ التحصيل، والموردُ بتاريخ
// السداد. وخلطُهما يجعل فاتورةً حُصِّلت تبدو مسدَّدةً لمورّدٍ لم يقبض شيئًا.
const CLOSED_BY = { customer: 'collectionDate', supplier: 'paymentDate' };

// الكشفُ الملغى لم يُنفَّذ ولم يصل عنه مالٌ ولا يُدفع عنه شيء — فعدُّه في
// المستحقّ يقيّد دَينًا لا وجودَ له. ويُستثنى من الطرفين معًا.
const NOT_CANCELLED = {
  executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] },
};

const EDITABLE = [
  'name', 'phone', 'email', 'contactPerson', 'contactPhone', 'accountantName',
  'accountantPhone', 'commercialRegister', 'taxNumber', 'iban', 'bankName',
  'address', 'city', 'partyType', 'paymentType', 'paymentTerms', 'creditLimit', 'status',
  'assignedTo', 'lastContactAt', 'nextFollowUpAt', 'notes', 'isActive',
  // ── حقولُ دفتر التحصيل ──────────────────────────────────────────────────
  // تُقرأ في سجلّ الأعمار وفي التنبيهات، فلا بدّ أن تُصحَّح من ملفّ العميل:
  // رفعُ الحدّ الائتمانيّ ونقلُ الحساب إلى موظّفٍ آخر عملٌ يوميّ، وما يُقرأ
  // ولا يُصحَّح يبقى خطأً إلى الأبد.
  'code', 'collectionOfficer', 'officer', 'hoLocation', 'grade', 'salesManagers',
  'department', 'region', 'creditDays', 'aliases',
];
const pick = (body) => {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  return out;
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * ── مَن يقتصر على «ما لنا» ──────────────────────────────────────────────────
 *
 * قسمُ التحصيل يُحصِّل؛ وما ندفعه للموردين والصافيُ بينهما شأنُ الإدارة والمالية.
 *
 * وأُخفيت أوّلًا في الشاشة وحدَها — فبقي الخادمُ يرسل «المستحقّ علينا» وأكبرَ
 * الموردين وتقادمَهم وعمودَ الفرع، تُقرأ في أدوات المتصفّح وتخرج في أيّ تصدير.
 * والحجبُ في مكانٍ واحدٍ حجبٌ في نصف الطريق، ويُقرأ أسوأَ من غيابه: مَن رآه
 * مخفيًّا حسبه محجوبًا. فالقاعدةُ هنا، والشاشةُ تتبعها.
 *
 * وهي بالدور لا بالقسم: الإدارةُ والماليةُ ومديرُ العمليات يفتحون القسمَ نفسَه
 * ويرَون الوجهين.
 */
const RECEIVABLES_ONLY_ROLES = ['collections_manager', 'collections_staff'];
const receivablesOnly = (user) => RECEIVABLES_ONLY_ROLES.includes(user?.role);
const isKind = (k) => k === 'customer' || k === 'supplier';

/**
 * أرقامُ كلّ طرفٍ من الكشوف، مفهرسةً بالاسم المطويّ.
 *
 * تُحسب مرّةً لكلّ جهةٍ وتُحفَظ دقيقةً: تفتحها الصفحةُ والملفُّ واللوحةُ في
 * الدقيقة نفسها، فحسابٌ واحدٌ يخدم الثلاثة.
 */
async function statsByKind(kind) {
  return cache.wrap(`${CACHE_PREFIX}stats:${kind}`, STATS_TTL, async () => {
    const field = FIELD_OF[kind];
    const value = VALUE_OF[kind];
    const closed = CLOSED_BY[kind];

    const rows = await OperationsWorkflow.aggregate([
      { $match: { [field]: { $nin: [null, ''] }, ...NOT_CANCELLED } },
      {
        $group: {
          _id: `$${field}`,
          reports: { $sum: 1 },
          total: { $sum: { $ifNull: [`$${value}`, 0] } },
          // المُغلَق: ما له تاريخٌ في عمود الإغلاق. والفارغُ ليس صفرًا هنا —
          // «لم يُحصَّل بعد» حالةٌ لا مبلغ.
          settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
          settledCount: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, 1, 0] } },
          invoiced: { $sum: { $cond: [{ $ifNull: ['$invoiceNumber', false] }, 1, 0] } },
          lastReportAt: { $max: '$reportDate' },
          lastSettledAt: { $max: `$${closed}` },
        },
      },
    ]).allowDiskUse(true);

    // الطيُّ بعد التجميع لا قبلَه: الطيُّ داخل القاعدة سلسلةُ `$replaceAll`
    // تُكتب في كلّ نقطة، والصفوفُ العائدةُ مئاتٌ فطيُّها هنا أرخصُ وأوضح.
    const byKey = new Map();
    for (const row of rows) {
      const key = fold(row._id);
      if (!key) continue;
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, {
          key,
          names: [{ name: row._id, reports: row.reports }],
          reports: row.reports,
          total: row.total,
          settled: row.settled,
          settledCount: row.settledCount,
          invoiced: row.invoiced,
          lastReportAt: row.lastReportAt || null,
          lastSettledAt: row.lastSettledAt || null,
        });
        continue;
      }
      cur.reports += row.reports;
      cur.total += row.total;
      cur.settled += row.settled;
      cur.settledCount += row.settledCount;
      cur.invoiced += row.invoiced;
      cur.names.push({ name: row._id, reports: row.reports });
      if (row.lastReportAt && (!cur.lastReportAt || row.lastReportAt > cur.lastReportAt)) cur.lastReportAt = row.lastReportAt;
      if (row.lastSettledAt && (!cur.lastSettledAt || row.lastSettledAt > cur.lastSettledAt)) cur.lastSettledAt = row.lastSettledAt;
    }

    for (const v of byKey.values()) {
      v.total = r2(v.total);
      v.settled = r2(v.settled);
      v.outstanding = r2(v.total - v.settled);
      v.openReports = v.reports - v.settledCount;
      // الاسمُ المعروض أكثرُ الكتابتين ورودًا لا أوّلُها صدفةً.
      v.names.sort((a, b) => b.reports - a.reports);
      v.displayName = v.names[0].name;
    }
    return byKey;
  });
}

const emptyStats = () => ({
  reports: 0, total: 0, settled: 0, outstanding: 0,
  settledCount: 0, openReports: 0, invoiced: 0,
  lastReportAt: null, lastSettledAt: null, names: [],
});

const withStats = (party, stats) => {
  const s = stats.get(party.nameKey || fold(party.name)) || emptyStats();
  return {
    ...party,
    reports: s.reports, total: s.total, settled: s.settled, outstanding: s.outstanding,
    openReports: s.openReports, invoiced: s.invoiced,
    lastReportAt: s.lastReportAt, lastSettledAt: s.lastSettledAt,
    nameVariants: (s.names || []).length > 1 ? s.names.map((n) => n.name) : [],
  };
};

// ═══════════════════════════════════════════════════════════════════════════
//  الأطراف
// ═══════════════════════════════════════════════════════════════════════════

exports.listParties = async (req, res) => {
  try {
    const kind = String(req.query.kind || 'customer');
    if (!isKind(kind)) return res.status(400).json({ message: 'kind must be customer or supplier' });

    const filter = { kind };
    if (req.query.active === 'true') filter.isActive = true;
    if (req.query.active === 'false') filter.isActive = false;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.city) filter.city = req.query.city;
    if (req.query.partyType) filter.partyType = req.query.partyType;
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;

    // البحثُ يطوي المسافاتِ وفروقَ الرسم كما في بقيّة النظام: مَن نسخ الاسم من
    // مكانٍ آخر بمسافتين أو بهمزةٍ أخرى يجد صفَّه.
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = flexSpaceRegex(q);
      filter.$or = [
        { name: rx }, { nameKey: rx }, { phone: rx }, { email: rx },
        { contactPerson: rx }, { contactPhone: rx },
        { commercialRegister: rx }, { taxNumber: rx }, { iban: rx }, { city: rx },
      ];
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const [parties, total, stats] = await Promise.all([
      CollectionsParty.find(filter)
        .populate('assignedTo', 'firstName lastName')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CollectionsParty.countDocuments(filter),
      statsByKind(kind),
    ]);

    res.json({
      parties: parties.map((p) => withStats(p, stats)),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الأطراف', error: e.message });
  }
};

/** ملفُّ الطرف: بياناتُه وأرقامُه وكشوفُه وحركتُه بالشهر. */
exports.getPartyProfile = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const party = await CollectionsParty.findById(req.params.id)
      .populate('assignedTo', 'firstName lastName')
      .lean();
    if (!party) return res.status(404).json({ message: 'الطرف غير موجود' });

    const kind = party.kind;
    const field = FIELD_OF[kind];
    const value = VALUE_OF[kind];
    const closed = CLOSED_BY[kind];
    const stats = await statsByKind(kind);
    const s = stats.get(party.nameKey || fold(party.name)) || emptyStats();

    // كلُّ صيغةٍ كُتب بها اسمُه في الكشوف تخصّه: المطابقةُ بالاسم المطويّ،
    // والكشوفُ تُقرأ بالصيغ كلِّها لا بواحدة.
    const names = (s.names || []).map((n) => n.name);
    const rowFilter = names.length
      ? { [field]: { $in: names }, ...NOT_CANCELLED }
      : { [field]: party.name, ...NOT_CANCELLED };

    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);

    const [reports, reportsTotal, monthly] = await Promise.all([
      OperationsWorkflow.find(rowFilter)
        .select(`reportNumber reportDate fromLocation toLocation branch carNumber username carOwner ${value} ${closed} invoiceNumber invoiceDate totalInvoice payingBranch documentNumber executionStatus`)
        .sort({ reportDate: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      OperationsWorkflow.countDocuments(rowFilter),
      OperationsWorkflow.aggregate([
        { $match: { ...rowFilter, reportDate: { $ne: null } } },
        {
          $group: {
            // الشهرُ بتوقيت الشركة لا بغرينتش: كشفُ ما بعد التاسعة مساءً في
            // آخر يومٍ من الشهر يقع في الشهر التالي لو حُسب بغرينتش.
            _id: { $dateToString: { date: '$reportDate', format: '%Y-%m', timezone: 'Asia/Riyadh' } },
            reports: { $sum: 1 },
            total: { $sum: { $ifNull: [`$${value}`, 0] } },
            settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 36 },
      ]),
    ]);

    // ── وشغلُه معنا ليس كشوفَ التشغيل وحدَها ──────────────────────────────
    // العميلُ يُنقَل له بشاحناتنا (إدارة الأسطول) وبشاحناتِ موردٍ (طلبات
    // الشحنات) كما يُنقَل له على منصّة التشغيل. وملفٌّ يعرض واحدةً منها يقول
    // «تعاملنا معه كذا مرّة» وهو رقمٌ ناقص.
    //
    // والمطابقةُ بكلّ صيغةٍ كُتب بها اسمُه، لا بصيغةٍ واحدة.
    const nameRx = names.length
      ? names.map((n) => flexSpaceRegex(n))
      : [flexSpaceRegex(party.name)];
    const nameMatch = { $or: nameRx.map((rx) => ({ customerName: rx })) };
    const supplierMatch = { $or: nameRx.map((rx) => ({ supplierName: rx })) };

    const [fleetLoads, orders] = await Promise.all([
      kind === 'customer'
        ? FleetShipment.find(nameMatch)
          .select('waybillNumber shipmentDate fromCity toCity status price customerName vehiclePlate driverName')
          .sort({ shipmentDate: -1 }).limit(50).lean()
        : [],
      ShipmentOrder.find(kind === 'customer' ? nameMatch : supplierMatch)
        .select('orderNumber orderDate fromCity toCity status sellPrice buyPrice customerName supplierName truckType')
        .sort({ orderDate: -1 }).limit(50).lean(),
    ]);

    res.json({
      party: withStats(party, stats),
      // شغلُه معنا من كلّ باب: أسطولُنا، وطلباتُ الشحنات، وكشوفُ التشغيل.
      work: {
        fleetLoads,
        orders,
        counts: { reports: reportsTotal, fleetLoads: fleetLoads.length, orders: orders.length },
      },
      reports,
      reportsTotal,
      page,
      limit,
      pages: Math.max(1, Math.ceil(reportsTotal / limit)),
      monthly: monthly.map((m) => ({
        month: m._id,
        reports: m.reports,
        total: r2(m.total),
        settled: r2(m.settled),
        outstanding: r2(m.total - m.settled),
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الملف', error: e.message });
  }
};

exports.createParty = async (req, res) => {
  try {
    const kind = String(req.body.kind || '');
    if (!isKind(kind)) return res.status(400).json({ message: 'kind must be customer or supplier' });
    const body = stripEmpty(pick(req.body), CollectionsParty.schema);
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: الاسم', fields: { name: 'مطلوب' } });
    }
    // الاسمُ المكرَّرُ يُقال باسمه: «موجود بالفعل» بلا اسمٍ يترك المستخدم يبحث.
    // الاسمُ وحدَه لم يعد الهويّة — الشركةُ الواحدة قد تحمل حسابين (نقديًّا
    // وضريبيًّا) بكودين. فيُمنع التكرارُ حيث لا كودَ يفرّق، ويُسمَح به حين
    // يُكتب كودٌ صريحٌ يختلف.
    const wantedCode = String(req.body.code || '').trim();
    const dup = await CollectionsParty.findOne({
      kind, nameKey: fold(body.name), ...(wantedCode ? { code: { $ne: wantedCode } } : {}),
    }).select('_id name code').lean();
    if (dup && !wantedCode) {
      return res.status(409).json({
        message: `«${dup.name}» مسجَّل بالفعل — الاسمان يُقرآن واحدًا بعد طيّ فروق الرسم`,
        existingId: dup._id,
      });
    }
    // ── والكودُ يُولَّد على سياقة الدفتر ────────────────────────────────────
    // لكلّ حسابٍ كودٌ يُعرَف به في المحاسبة وفي كلّ مراسلة: النقديُّ `C####`
    // والضريبيُّ `1104####`. تركُه لمن يُدخل يعني صيغًا شتّى وأكوادًا مكرَّرة،
    // فيُقرأ التاليَ في سلسلة نوعِه ويُكتب من نفسِه. ومَن كتب كودًا بيده يُترك
    // له — الاستيرادُ والتصحيحُ يحتاجانه.
    let code = String(body.code || '').trim();
    if (!code && kind === 'customer') {
      const { nextPartyCode } = require('../utils/partyCode');
      code = await nextPartyCode(body.paymentType === 'cash' ? 'cash' : 'tax');
    }
    const party = await CollectionsParty.create({ ...body, ...(code ? { code } : {}), kind, source: 'manual', createdBy: req.user._id });
    await logAudit({
      user: req.user._id, action: 'create_collections_party', entity: 'CollectionsParty',
      entityId: party._id, changes: { after: { kind, name: party.name } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:party', { id: party._id, kind }); } catch (_) {}
    res.status(201).json({ party: withStats(party.toObject(), await statsByKind(kind)) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر إنشاء الطرف'); }
};

exports.updateParty = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const existing = await CollectionsParty.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'الطرف غير موجود' });

    const body = stripEmpty(pick(req.body), CollectionsParty.schema);
    if (body.name && fold(body.name) !== existing.nameKey) {
      const dup = await CollectionsParty.findOne({
        kind: existing.kind, nameKey: fold(body.name), _id: { $ne: existing._id },
      }).select('_id name').lean();
      if (dup) return res.status(409).json({ message: `«${dup.name}» مسجَّل بالفعل`, existingId: dup._id });
    }

    const before = { name: existing.name, status: existing.status, isActive: existing.isActive };
    const party = await CollectionsParty.findByIdAndUpdate(existing._id, { $set: body }, { new: true, runValidators: true })
      .populate('assignedTo', 'firstName lastName')
      .lean();
    await logAudit({
      user: req.user._id, action: 'update_collections_party', entity: 'CollectionsParty',
      entityId: party._id, changes: { before, after: body }, ipAddress: req.ip,
    });
    try { emitToAll('collections:party', { id: party._id, kind: party.kind }); } catch (_) {}
    // ── ودفترُ التحصيل يُبطَل معه ──────────────────────────────────────────
    // سجلُّ الأعمار والتنبيهاتُ تُخزَّن دقيقةً. ورفعُ الحدّ الائتمانيّ من ملفّ
    // العميل هو الفعلُ الذي يُطفئ تنبيهَه — فلو بقيت الذاكرةُ لظلّ التنبيهُ
    // معلَّقًا بعد أن عولج، وهو أسوأُ من ألّا يظهر أصلًا.
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    res.json({ party: withStats(party, await statsByKind(party.kind)) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ الطرف'); }
};

/**
 * الحذفُ يُعطِّل مَن له تاريخ.
 *
 * حذفُ طرفٍ له كشوفٌ يقطعُ كشوفَه عن ملفّه: تبقى الصفوفُ تحمل اسمَه ولا يبقى
 * ما يجمعها، فيختفي دَينٌ قائمٌ من كلّ تقرير. والتعطيلُ يُخفيه من القوائم
 * ويُبقي تاريخَه مقروءًا.
 */
exports.deleteParty = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const party = await CollectionsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'الطرف غير موجود' });

    const stats = await statsByKind(party.kind);
    const s = stats.get(party.nameKey || fold(party.name));
    if (s && s.reports > 0) {
      party.isActive = false;
      await party.save();
      await logAudit({
        user: req.user._id, action: 'deactivate_collections_party', entity: 'CollectionsParty',
        entityId: party._id, changes: { after: { name: party.name, reports: s.reports } }, ipAddress: req.ip,
      });
      try { emitToAll('collections:party', { id: party._id, kind: party.kind }); } catch (_) {}
      return res.json({
        deactivated: true,
        message: `«${party.name}» له ${s.reports} كشفًا — عُطِّل بدل حذفه حتى لا ينقطع تاريخُه`,
      });
    }

    await party.deleteOne();
    await logAudit({
      user: req.user._id, action: 'delete_collections_party', entity: 'CollectionsParty',
      entityId: party._id, changes: { before: { name: party.name } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:party', { id: party._id, kind: party.kind }); } catch (_) {}
    res.json({ deleted: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الطرف'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  المتابعات — مكالمةٌ أو وعدٌ بالسداد، مقيَّدةٌ على طرف
// ═══════════════════════════════════════════════════════════════════════════
//
// كانت صفحةً تحت «العملاء والمالية» تُقيَّد على عميلٍ من ورك فلو لم يعد يجري.
// وكلُّ ما يخصّ التحصيل موضعُه قسمُ التحصيل — وإلّا سُجّلت المتابعةُ في قسمٍ لا
// يملكها، على طرفٍ لا يعرفه أحد.

const FU_EDITABLE = [
  'report', 'type', 'status', 'notes', 'amountCollected',
  'promiseDate', 'promiseAmount', 'promiseFulfilled', 'nextFollowUpAt',
];
const pickFu = (body) => {
  const out = {};
  for (const k of FU_EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  return out;
};

const FU_POPULATE = (q) => q
  .populate('collector', 'firstName lastName')
  .populate('party', 'name kind')
  .populate('report', 'reportNumber reportDate');

exports.listFollowUps = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const items = await FU_POPULATE(CollectionsFollowUp.find({ party: req.params.id }))
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json({ followUps: items });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل المتابعات', error: e.message });
  }
};

/**
 * المتابعاتُ المستحقّة — ما حان موعدُه ولم يُقفَل.
 *
 * الوعدُ بلا موعدٍ يُسأل عنه ليس متابعة بل ملاحظة. وهذه النقطةُ هي ما يجعل
 * «قال يسدّد الخميس» بندًا يعود يوم الخميس، لا سطرًا يُنسى.
 */
exports.dueFollowUps = async (req, res) => {
  try {
    const now = new Date();
    const filter = { closedAt: null, nextFollowUpAt: { $ne: null, $lte: now } };
    if (req.query.mine === 'true') filter.collector = req.user._id;
    const items = await FU_POPULATE(CollectionsFollowUp.find(filter))
      .sort({ nextFollowUpAt: 1 }).limit(200).lean();
    res.json({ followUps: items, total: items.length });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل المستحقّ', error: e.message });
  }
};

exports.createFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const party = await CollectionsParty.findById(req.params.id).select('_id name kind').lean();
    if (!party) return res.status(404).json({ message: 'الطرف غير موجود' });

    const body = stripEmpty(pickFu(req.body), CollectionsFollowUp.schema);
    if (!body.notes || !String(body.notes).trim()) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: الملاحظات', fields: { notes: 'مطلوب' } });
    }
    if (!body.type) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: نوع المتابعة', fields: { type: 'مطلوب' } });
    }

    const fu = await CollectionsFollowUp.create({ ...body, party: party._id, collector: req.user._id });

    // آخرُ تواصلٍ على الطرف نفسِه: يُقرأ في القائمة بلا فتح ملفّه. والمتابعةُ
    // القادمة تُنقَل إليه كذلك، فلا يُبحَث عنها في سجلٍّ آخر.
    const patch = { lastContactAt: new Date() };
    if (body.nextFollowUpAt) patch.nextFollowUpAt = body.nextFollowUpAt;
    await CollectionsParty.findByIdAndUpdate(party._id, { $set: patch });

    await logAudit({
      user: req.user._id, action: 'log_collections_follow_up', entity: 'CollectionsFollowUp',
      entityId: fu._id, changes: { after: { party: party.name, type: body.type } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:follow-up', { party: party._id }); } catch (_) {}
    res.status(201).json({ followUp: await FU_POPULATE(CollectionsFollowUp.findById(fu._id)).lean() });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تسجيل المتابعة'); }
};

exports.updateFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.fuId)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const body = stripEmpty(pickFu(req.body), CollectionsFollowUp.schema);
    // الإقفالُ فعلٌ يُسجَّل بصاحبه ووقتِه، لا حقلٌ يُكتب.
    if (req.body.close === true) { body.closedAt = new Date(); body.closedBy = req.user._id; }
    if (req.body.close === false) { body.closedAt = null; body.closedBy = null; }

    const fu = await CollectionsFollowUp.findByIdAndUpdate(req.params.fuId, { $set: body }, { new: true, runValidators: true });
    if (!fu) return res.status(404).json({ message: 'المتابعة غير موجودة' });
    await logAudit({
      user: req.user._id, action: 'update_collections_follow_up', entity: 'CollectionsFollowUp',
      entityId: fu._id, changes: { after: body }, ipAddress: req.ip,
    });
    try { emitToAll('collections:follow-up', { party: fu.party }); } catch (_) {}
    res.json({ followUp: await FU_POPULATE(CollectionsFollowUp.findById(fu._id)).lean() });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ المتابعة'); }
};

exports.deleteFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.fuId)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const fu = await CollectionsFollowUp.findById(req.params.fuId);
    if (!fu) return res.status(404).json({ message: 'المتابعة غير موجودة' });
    await fu.deleteOne();
    await logAudit({
      user: req.user._id, action: 'delete_collections_follow_up', entity: 'CollectionsFollowUp',
      entityId: fu._id, changes: { before: { notes: fu.notes } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:follow-up', { party: fu.party }); } catch (_) {}
    res.json({ deleted: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف المتابعة'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  اللوحة
// ═══════════════════════════════════════════════════════════════════════════

/**
 * لوحةُ التحصيل: ما لنا وما علينا، ومَن أكبرُ المتأخّرين، وأين تتراكم.
 *
 * المدى اختياريّ: بلا مدًى تُقرأ الصورةُ كلُّها — وهي ما يُسأل عنه أوّلًا
 * («كم لنا عند الناس؟») لا شهرٌ بعينه.
 */
exports.dashboard = async (req, res) => {
  try {
    const { from, to } = req.query;
    // حدُّ اليوم بتوقيت الشركة — لا بغرينتش: بغرينتش تُفقَد أوّلُ ثلاثِ ساعاتٍ
    // من يوم البداية وتُكسَب ثلاثٌ من اليوم التالي لآخر يوم.
    const range = from || to ? dayRange(from, to) : null;
    // ── وفلاترُ اللوحة هي فلاترُ الصفحات ──────────────────────────────────
    // كانت اللوحةُ تقبل مدًى فحسب، والأسئلةُ التي تُطرح عليها أكثر: عميلٌ
    // بعينه، ومورّدٌ بعينه، وفرعٌ، وشريحةُ عمر. ولوحةٌ لا تُفلتر تُقرأ مرّةً
    // ثمّ يُنزل منها إلى الصفحات لتُقرأ ثانيةً.
    const extra = {};
    if (req.query.customer) extra.username = flexSpaceRegex(String(req.query.customer));
    if (req.query.supplier) extra.carOwner = flexSpaceRegex(String(req.query.supplier));
    if (req.query.branch) extra.branch = String(req.query.branch);
    const dateMatch = { ...extra, ...(range ? { reportDate: range } : {}) };

    // شريحةُ العمر تُقاس على تاريخ الكشف — وهي شرائحُ لا تتداخل، فمجموعُها
    // يساوي الكلَّ ولا يُعدّ الكشفُ مرّتين.
    const ageBand = AGE_BANDS[req.query.age] ? req.query.age : null;
    if (ageBand) {
      const c = ageCondition('reportDate', ageBand).reportDate;
      dateMatch.reportDate = { ...(dateMatch.reportDate || {}), ...c };
    }
    // ── والمدى يُدمَج، لا يُنسَخ فوقه ─────────────────────────────────────
    // «تاريخُ الكشف موجود» و«تاريخُ الكشف داخل المدى» شرطان على الحقل نفسِه،
    // وكتابةُ أحدهما بعد الآخر في كائنٍ واحدٍ تُلغيه — فيسقط المدى صامتًا
    // وتُقرأ اللوحةُ المفلترةُ على البيانات كلِّها.
    const datedMatch = {
      ...extra,
      reportDate: { $ne: null, ...(dateMatch.reportDate || {}) },
    };
    // المفتاحُ يحمل الفلاترَ كلَّها والدور: نتيجةٌ حُسبت لمن يرى الوجهين لا
    // تُخدَم لمن يرى وجهًا واحدًا، ولا نتيجةُ عميلٍ لعميلٍ آخر.
    const key = `${CACHE_PREFIX}dash:${receivablesOnly(req.user) ? 'r' : 'a'}:${JSON.stringify(req.query || {})}`;

    const data = await cache.wrap(key, STATS_TTL, async () => {
      const side = async (kind) => {
        const field = FIELD_OF[kind];
        const value = VALUE_OF[kind];
        const closed = CLOSED_BY[kind];
        const match = { [field]: { $nin: [null, ''] }, ...NOT_CANCELLED, ...dateMatch };

        const [totals] = await OperationsWorkflow.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              reports: { $sum: 1 },
              total: { $sum: { $ifNull: [`$${value}`, 0] } },
              settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              settledCount: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, 1, 0] } },
            },
          },
        ]);

        const top = await OperationsWorkflow.aggregate([
          { $match: { ...match, [closed]: null } },
          {
            $group: {
              _id: `$${field}`,
              reports: { $sum: 1 },
              outstanding: { $sum: { $ifNull: [`$${value}`, 0] } },
              oldest: { $min: '$reportDate' },
            },
          },
          { $sort: { outstanding: -1 } },
          // سقفٌ أوسعُ قبل الطيّ: الصفُّ المقصوصُ قد يكون نصفَ صفٍّ آخر.
          { $limit: 200 },
        ]);

        // الطيُّ نفسُه المستعمَل في السجلّ — وإلّا ظهر المورّدُ الواحدُ صفّين.
        const merged = new Map();
        for (const row of top) {
          const k = fold(row._id);
          if (!k) continue;
          const cur = merged.get(k);
          if (!cur) { merged.set(k, { name: row._id, reports: row.reports, outstanding: row.outstanding, oldest: row.oldest, _top: row.reports }); continue; }
          cur.reports += row.reports;
          cur.outstanding += row.outstanding;
          if (row.oldest && (!cur.oldest || row.oldest < cur.oldest)) cur.oldest = row.oldest;
          if (row.reports > cur._top) { cur.name = row._id; cur._top = row.reports; }
        }

        const t = totals || { reports: 0, total: 0, settled: 0, settledCount: 0 };
        return {
          reports: t.reports,
          total: r2(t.total),
          settled: r2(t.settled),
          outstanding: r2(t.total - t.settled),
          settledCount: t.settledCount,
          openReports: t.reports - t.settledCount,
          top: [...merged.values()]
            .sort((a, b) => b.outstanding - a.outstanding)
            .slice(0, 15)
            .map((x) => ({ name: x.name, reports: x.reports, outstanding: r2(x.outstanding), oldest: x.oldest || null })),
        };
      };

      const monthly = async (kind) => {
        const value = VALUE_OF[kind];
        const closed = CLOSED_BY[kind];
        const rows = await OperationsWorkflow.aggregate([
          { $match: { ...NOT_CANCELLED, ...datedMatch } },
          {
            $group: {
              _id: { $dateToString: { date: '$reportDate', format: '%Y-%m', timezone: 'Asia/Riyadh' } },
              total: { $sum: { $ifNull: [`$${value}`, 0] } },
              settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ]);
        return rows.map((m) => ({ month: m._id, total: r2(m.total), settled: r2(m.settled), outstanding: r2(m.total - m.settled) }));
      };

      // ── تقادمُ المستحقّ ─────────────────────────────────────────────────
      // الرقمُ الواحد «مستحقٌّ ١.٢ مليون» لا يقول شيئًا عن خطره: مليونٌ عمرُه
      // أسبوعٌ عملٌ جارٍ، ومليونٌ عمرُه سنةٌ مالٌ يكاد يضيع.
      const aging = async (kind) => {
        const value = VALUE_OF[kind];
        const closed = CLOSED_BY[kind];
        const [row] = await OperationsWorkflow.aggregate([
          { $match: { ...NOT_CANCELLED, ...datedMatch, [closed]: null } },
          { $addFields: { ageDays: { $divide: [{ $subtract: ['$$NOW', '$reportDate'] }, 86400000] } } },
          {
            $group: {
              _id: null,
              d0_30: { $sum: { $cond: [{ $lte: ['$ageDays', 30] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              d31_60: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 30] }, { $lte: ['$ageDays', 60] }] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              d61_90: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 60] }, { $lte: ['$ageDays', 90] }] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              d90p: { $sum: { $cond: [{ $gt: ['$ageDays', 90] }, { $ifNull: [`$${value}`, 0] }, 0] } },
            },
          },
        ]);
        const a = row || { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
        return [
          { bucket: '0-30', amount: r2(a.d0_30) },
          { bucket: '31-60', amount: r2(a.d31_60) },
          { bucket: '61-90', amount: r2(a.d61_90) },
          { bucket: '90+', amount: r2(a.d90p) },
        ];
      };

      const byBranch = await OperationsWorkflow.aggregate([
        { $match: { ...NOT_CANCELLED, ...dateMatch, branch: { $nin: [null, ''] } } },
        {
          $group: {
            _id: '$branch',
            reports: { $sum: 1 },
            receivable: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, 0, { $ifNull: ['$sellingValue', 0] }] } },
            payable: { $sum: { $cond: [{ $ifNull: ['$paymentDate', false] }, 0, { $ifNull: ['$purchaseValue', 0] }] } },
          },
        },
        { $sort: { receivable: -1 } },
      ]);

      const [customers, suppliers, custMonthly, custAging, suppAging, partyCounts] = await Promise.all([
        side('customer'), side('supplier'), monthly('customer'),
        aging('customer'), aging('supplier'),
        CollectionsParty.aggregate([{ $group: { _id: { kind: '$kind', active: '$isActive' }, n: { $sum: 1 } } }]),
      ]);

      const counts = { customer: { active: 0, inactive: 0 }, supplier: { active: 0, inactive: 0 } };
      for (const c of partyCounts) {
        const bucket = counts[c._id.kind];
        if (bucket) bucket[c._id.active === false ? 'inactive' : 'active'] += c.n;
      }

      return {
        customers, suppliers,
        monthly: custMonthly,
        aging: { customer: custAging, supplier: suppAging },
        byBranch: byBranch.map((b) => ({ branch: b._id, reports: b.reports, receivable: r2(b.receivable), payable: r2(b.payable) })),
        counts,
      };
    });

    // ما لا يُعرض لا يُرسَل. والكاشُ مشتركٌ بين الأدوار، فالحجبُ يجري على
    // النسخة العائدة لا على المخزَّنة.
    if (receivablesOnly(req.user)) {
      const { suppliers: _s, ...rest } = data;
      return res.json({
        ...rest,
        aging: { customer: data.aging.customer },
        byBranch: data.byBranch.map(({ payable, ...b }) => b),
        counts: { customer: data.counts.customer, supplier: data.counts.supplier },
      });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل اللوحة', error: e.message });
  }
};

/** قيمُ فلاتر اللوحة — من الكشوف نفسِها. */
exports.dashboardFilterOptions = async (req, res) => {
  try {
    const only = receivablesOnly(req.user);
    const [customers, suppliers, branches] = await Promise.all([
      OperationsWorkflow.distinct('username', { ...NOT_CANCELLED, username: { $nin: [null, ''] } }),
      // ولا تُعرَض أسماءُ الموردين لمن لا يرى ما عليهم: فلترٌ لا نتيجةَ له.
      only ? Promise.resolve([]) : OperationsWorkflow.distinct('carOwner', { ...NOT_CANCELLED, carOwner: { $nin: [null, ''] } }),
      OperationsWorkflow.distinct('branch', { ...NOT_CANCELLED, branch: { $nin: [null, ''] } }),
    ]);
    res.json({
      customers: customers.sort().slice(0, 1000),
      suppliers: suppliers.sort().slice(0, 1000),
      branches: branches.sort(),
      receivablesOnly: only,
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر', error: e.message });
  }
};

/** قيمُ الفلاتر — مبنيّةٌ من البيانات نفسِها لا مكتوبةً بالإيد. */
exports.filterOptions = async (req, res) => {
  try {
    const kind = String(req.query.kind || 'customer');
    if (!isKind(kind)) return res.status(400).json({ message: 'kind must be customer or supplier' });
    const [status, city, partyType] = await Promise.all([
      CollectionsParty.distinct('status', { kind, status: { $nin: [null, ''] } }),
      CollectionsParty.distinct('city', { kind, city: { $nin: [null, ''] } }),
      CollectionsParty.distinct('partyType', { kind, partyType: { $nin: [null, ''] } }),
    ]);
    res.json({ status: status.sort(), city: city.sort(), partyType: partyType.sort() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر', error: e.message });
  }
};

// تُنادى من السكربتات بعد الاستيراد فلا تبقى الشاشة على أرقامٍ قديمة دقيقةً.
exports.invalidate = () => cache.clear(CACHE_PREFIX);
exports._internals = { statsByKind, FIELD_OF, VALUE_OF, CLOSED_BY, NOT_CANCELLED };

// ═══════════════════════════════════════════════════════════════════════════
//  الفواتير — من هنا يعمل قسمُ التحصيل
// ═══════════════════════════════════════════════════════════════════════════
//
// ── لماذا صفحتان لا صفحةُ كشوف ─────────────────────────────────────────────
// التحصيلُ لا يُحصِّل كشوفًا؛ يُحصِّل فواتير. والكشفُ الذي لم يُفوتَر بعد لا
// شأنَ له بالقسم أصلًا — إلّا أن يكون نقديًّا، فالنقديُّ يُحصَّل في يومه بلا
// فاتورة، ويُعرَف برقم كشفه.
//
//   · فواتيرُ الكاش    — كشوفٌ نوعُ دفعها نقديّ، اكتمل لها سدادٌ وفرعٌ ومبلغ.
//                       العنصرُ فيها الكشف، والقيمةُ يكتبها المحصِّل بيده.
//   · فواتيرُ الضريبي  — مجموعةٌ برقم الفاتورة لا بالكشف: الفاتورةُ الواحدة قد
//                       تضمّ كشوفًا عدّة، والقسمُ يتعامل بها لا بها منفردة.
//
// ── وأعمارُ الفواتير شرائحُ لا تتداخل ──────────────────────────────────────
// «فوق ١٥ يومًا» تعني من خمسةَ عشرَ إلى ثلاثين، لا كلَّ ما تجاوز الخمسةَ عشر.
// الشرائحُ المتداخلة تجعل الفاتورةَ الواحدة تُعدّ في أربعة أرقام، فلا يُعرف
// كم فاتورةً في كلّ عمرٍ حقًّا.
/**
 * ── ورقمٌ يعني «لا فاتورة» ليس رقمَ فاتورة ─────────────────────────────────
 *
 * في البيانات ألفٌ وتسعُمئةٍ وثلاثةٌ وتسعون كشفًا مكتوبٌ في خانة فاتورتها
 * «no inv» — وهي عبارةٌ تقول إنّ الكشفَ لم يُفوتَر بعد. فلو عُدَّت رقمَ فاتورةٍ
 * لظهرت في صدر الصفحة «فاتورةٌ» فيها ألفان من الكشوف وقيمةٌ مجمَّعة، وهي لا
 * وجودَ لها — والفواتيرُ الحقيقيّةُ أرقامٌ من أربع خاناتٍ تحمل الواحدةُ نحوَ
 * ثمانيةَ عشرَ كشفًا.
 *
 * غيابُ القيمة ليس قيمة. فما يعني «لا فاتورة» يُقرأ كما لو كانت الخانةُ فارغة.
 */
const NO_INVOICE_TOKENS = [
  'no inv', 'no invoice', 'noinv', 'no-inv', 'none', 'n/a', 'na', '-', '—', '0',
  'بدون', 'بدون فاتورة', 'لا يوجد', 'لا توجد', 'غير مفوتر', 'غير مفوترة',
];
/**
 * شرطُ «رقمُ فاتورةٍ حقيقيّ».
 *
 * والمطابقةُ لا تبالي بحالة الحرف: كُتبت في البيانات «no inv» و«no Inv»، وعدُّ
 * الصيغ يدًا يُسقط ما لم يُتخيَّل منها — وقد أسقط الثانيةَ فعلًا حتى ظهرت في
 * الصفحة. فتُطابَق بتعبيرٍ واحدٍ يقبل الحالتين والفراغَ الزائد.
 */
const NO_INVOICE_RX = new RegExp(
  `^\\s*(?:${NO_INVOICE_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`,
  'i',
);
const REAL_INVOICE = { invoiceNumber: { $nin: [null, ''], $not: NO_INVOICE_RX } };

const AGE_BANDS = {
  '0_15': [0, 15],
  '15_30': [15, 30],
  '30_45': [30, 45],
  '45_60': [45, 60],
  '60_plus': [60, null],
};

/** شرطُ العمر على حقلِ تاريخٍ ما — بالأيّام منذُه حتى اليوم. */
function ageCondition(field, band) {
  const b = AGE_BANDS[band];
  if (!b) return {};
  const [from, to] = b;
  const now = Date.now();
  const cond = {};
  // الأقدمُ عمرًا هو الأصغرُ تاريخًا: «مضى عليه أكثرُ من ١٥» = تاريخُه أقدمُ
  // من (اليوم − ١٥).
  //
  // والشريحةُ الأحدث بلا حدٍّ أعلى: في البيانات كشوفٌ بتواريخَ مستقبليّة، وحدٌّ
  // «أقدمُ من اليوم» كان يُسقطها من الشرائح كلِّها — فينقص المجموعُ عن الكلّ
  // واحدًا لا يُعرف أين ذهب.
  if (from) cond.$lte = new Date(now - from * 86400000);
  if (to != null) cond.$gt = new Date(now - to * 86400000);
  return { [field]: cond };
}

/** فلاترُ الصفحتين المشتركة: عميلٌ وفرعٌ ومدًى وحالةُ التحصيل وشريحةُ العمر. */
/**
 * أسماءُ عملاءِ صفحةٍ ← معرّفاتُ ملفّاتهم، باستعلامٍ واحد.
 *
 * الصفُّ يحمل اسمًا، وملفُّ العميل يُفتَح بمعرّفه. فلو تُرجم الاسمُ في الواجهة
 * لكان لكلّ ضغطةٍ طلبٌ ثانٍ ولانتظر المستخدمُ مرّتين. ويُترجَم هنا لمئة صفٍّ
 * دفعةً واحدة، بالاسم المطويّ فتلتقي صيغُ الاسم كلُّها على ملفٍّ واحد.
 */
async function partyIdsByName(names, kind = 'customer') {
  const keys = [...new Set((names || []).filter(Boolean).map((n) => fold(n)))];
  if (!keys.length) return new Map();
  const rows = await CollectionsParty.find({ kind, nameKey: { $in: keys } }).select('_id nameKey').lean();
  return new Map(rows.map((r) => [r.nameKey, String(r._id)]));
}

/** شروطُ دفتر الفواتير من استعلام الصفحة — يقرؤها الجدولُ وقائمةُ قيم الأعمدة. */
function ledgerInvoiceMatch(query) {
  const f = {};
  if (query.customer) f.partyName = flexSpaceRegex(String(query.customer));
  if (query.q) {
    const { exact, loose } = numberSearchRegex(String(query.q));
    const rx = exact || loose;
    f.$or = [{ invoiceNumber: rx }, { partyName: exact ? rx : loose }, { partyCode: rx }];
  }
  if (query.collected === 'yes') f.$and = [...(f.$and || []), { $or: [{ collectionDate: { $ne: null } }, { status: /collected/i }] }];
  else if (query.collected === 'no') f.$and = [...(f.$and || []), { collectionDate: null, status: { $not: /collected/i } }];
  if (query.from || query.to) {
    f.invoiceDate = {};
    if (query.from) f.invoiceDate.$gte = new Date(query.from);
    if (query.to) f.invoiceDate.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.age) {
    const c = ageCondition('invoiceDate', String(query.age));
    if (c.invoiceDate) f.invoiceDate = { ...(f.invoiceDate || {}), ...c.invoiceDate };
  }
  return f;
}

/**
 * فلاترُ الأعمدة على طريقة إكسل — لصفحتَي الفواتير.
 *
 * ── ولماذا في الخادم لا في المتصفّح ────────────────────────────────────────
 * الجدولُ مُصفَّحٌ في الخادم: مئةُ صفٍّ في الصفحة من تسعة آلاف. فبناءُ قائمة
 * القيم من الصفوف المحمَّلة يعرض قيمَ الصفحة الحاليّة وحدَها، والفلترةُ بها
 * تفلتر مئةً وتترك الباقي. فالقيمُ تُحسب في القاعدة والفلترُ يُطبَّق فيها.
 *
 * وتصل القيمُ مكرَّرةً (`cf_x=a&cf_x=b`) لا مفصولةً بفاصلة، لأنّ القيم نفسَها
 * قد تحوي فاصلةً — واسمُ عميلٍ فيه فاصلةٌ يصير عميلين.
 */
// ما يجوز الفلترةُ به في كلّ صفحة، ومن أيّ مجموعة يُقرأ.
const COL_FIELDS = {
  // الكاش: صفُّه كشفُ تشغيل.
  cash: {
    reportNumber: 'text', username: 'text', branch: 'text', payingBranch: 'text',
    fromLocation: 'text', toLocation: 'text', collectionDetail: 'text',
    paymentDate: 'date', collectionDate: 'date', deliveryDate: 'date',
  },
  // الضريبيّ: صفُّه فاتورةُ دفتر.
  tax: {
    invoiceNumber: 'text', partyName: 'text', partyCode: 'text', status: 'text',
    invoiceDate: 'date', deliveryDate: 'date', collectionDate: 'date',
  },
};
const RIYADH = 'Asia/Riyadh';

/** «YYYY-MM-DD» بتوقيت الرياض ← مدى اليوم كلِّه بالـ UTC. */
function riyadhDayRange(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  // الرياض +03:00 ثابتةً بلا توقيتٍ صيفيّ.
  const start = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000+03:00`);
  return { $gte: start, $lt: new Date(start.getTime() + 86400000) };
}

/** يقرأ `cf_<field>` من الاستعلام ويبني منها شرطَ مونجو. */
function columnFilters(query, kind) {
  const allowed = COL_FIELDS[kind] || {};
  const and = [];
  for (const [key, raw] of Object.entries(query || {})) {
    if (!key.startsWith('cf_')) continue;
    const field = key.slice(3);
    const type = allowed[field];
    if (!type) continue; // عمودٌ غيرُ مسموح: يُتجاهَل ولا يُوسَّع الفلتر
    const values = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v));
    if (!values.length) continue;

    if (type === 'date') {
      // «(فارغ)» تُرسَل نصًّا فارغًا وتعني «لا تاريخ».
      const or = [];
      for (const v of values) {
        if (!v) { or.push({ [field]: null }, { [field]: { $exists: false } }); continue; }
        const r = riyadhDayRange(v);
        if (r) or.push({ [field]: r });
      }
      if (or.length) and.push({ $or: or });
    } else {
      const or = [];
      const plain = values.filter(Boolean);
      if (values.some((v) => !v)) or.push({ [field]: null }, { [field]: '' }, { [field]: { $exists: false } });
      if (plain.length) or.push({ [field]: { $in: plain } });
      if (or.length) and.push({ $or: or });
    }
  }
  return and;
}

/**
 * قيمُ عمودٍ واحدٍ مع عدد صفوف كلِّ قيمة — محسوبةً على المجموعة المطابقة كلِّها.
 *
 * تُحسب تحت الفلاتر القائمة عدا فلترِ العمود نفسِه: فتحُ قائمة «العميل» بعد
 * اختيار عميلٍ منها يجب أن يعرض العملاءَ كلَّهم لا المختارَ وحدَه، وإلّا لم
 * يستطع أحدٌ إضافةَ عميلٍ ثانٍ إلى اختياره.
 */
exports.invoiceColumnOptions = async (req, res) => {
  try {
    const kind = req.params.kind === 'cash' ? 'cash' : 'tax';
    const field = String(req.query.field || '');
    const type = (COL_FIELDS[kind] || {})[field];
    if (!type) return res.status(400).json({ message: 'عمود غير معروف' });

    const q = String(req.query.q || '').trim();
    const LIMIT = 200;

    // الفلاتر القائمةُ دون فلترِ هذا العمود.
    const others = { ...req.query };
    delete others[`cf_${field}`];

    let match;
    let Model;
    if (kind === 'cash') {
      const { AUTO_RULE_FROM } = require('../utils/paymentType');
      match = { ...invoiceFilters(others, { ageField: 'paymentDate' }), paymentType: 'cash' };
      match.$and = [
        ...(match.$and || []),
        { $or: [{ reportDate: { $lt: AUTO_RULE_FROM } }, { accountingReview: { $nin: ['', null] } }] },
        ...columnFilters(others, kind),
      ];
      Model = OperationsWorkflow;
    } else {
      const CollectionInvoice = require('../models/CollectionInvoice');
      match = ledgerInvoiceMatch(others);
      match.$and = [...(match.$and || []), ...columnFilters(others, kind)];
      Model = CollectionInvoice;
    }
    if (!match.$and.length) delete match.$and;

    const groupId = type === 'date'
      ? { $cond: [{ $ifNull: [`$${field}`, false] },
        { $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone: RIYADH } }, ''] }
      : { $ifNull: [`$${field}`, ''] };

    const pipeline = [{ $match: match }, { $group: { _id: groupId, count: { $sum: 1 } } }];
    if (q) {
      // البحثُ داخل القائمة يجري على القيمة بعد التجميع، فيشمل التواريخَ
      // المصوغةَ كما تُعرض.
      pipeline.push({ $match: { _id: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } });
    }
    pipeline.push({ $sort: type === 'date' ? { _id: -1 } : { count: -1, _id: 1 } });
    pipeline.push({ $limit: LIMIT + 1 });

    const rows = await Model.aggregate(pipeline).allowDiskUse(true);
    const truncated = rows.length > LIMIT;
    res.json({
      values: rows.slice(0, LIMIT).map((r) => ({ value: String(r._id ?? ''), count: r.count })),
      truncated,
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل قيم العمود', error: e.message });
  }
};

function invoiceFilters(query, { ageField }) {
  const f = { ...NOT_CANCELLED };
  if (query.customer) f.username = flexSpaceRegex(String(query.customer));
  if (query.branch) f.payingBranch = String(query.branch);
  if (query.q) {
    // ── الرقمُ الكامل يُطلَب كاملًا ──────────────────────────────────────────
    // البحثُ عن «٩٧١٩» كان يُخرج ستّةَ صفوفٍ في فاتورتين: الفاتورةَ نفسَها،
    // وكشفًا رقمُه ٩٧١٩، وسندًا رقمُه ٩٧١٩ تحت فاتورةٍ أخرى — فتبدو الفاتورةُ
    // مكرَّرةً وهي واحدة. فإن طابق الرقمُ حقلًا كاملًا فهو المقصود؛ والتضمينُ
    // يبقى لمن كتب جزءًا. راجع numberSearchRegex.
    const { exact, loose } = numberSearchRegex(String(query.q));
    const rx = exact || loose;
    f.$or = [{ reportNumber: rx }, { invoiceNumber: rx }, { username: exact ? rx : loose }, { documentNumber: rx }];
  }

  // ── حالةُ التحصيل ───────────────────────────────────────────────────────
  // الصفحةُ تعرض المحصَّلَ وغيرَه معًا، والسؤالُ يُطرح على الوجهين: «ما الذي
  // بقي؟» و«كم حصّلنا؟». فالاختيارُ صريحٌ فوق الجدول لا مخبوءٌ في فلتر.
  // والدفترُ قد يقول «محصَّل» بلا تاريخ — فالفلترُ يسأل عن الاثنين معًا.
  if (query.collected === 'yes') f.$and = [...(f.$and || []), { $or: [{ collectionDate: { $ne: null } }, { cashCollectionStatus: 'collected' }] }];
  else if (query.collected === 'no') f.$and = [...(f.$and || []), { collectionDate: null, cashCollectionStatus: { $ne: 'collected' } }];

  // تفصيلُ التحصيل — «أرِني ما يحصّله الفرعُ وحدَه».
  if (query.detail) f.collectionDetail = String(query.detail);

  const range = query.from || query.to ? dayRange(query.from, query.to) : null;
  if (range) f[ageField] = range;
  if (query.age && AGE_BANDS[query.age]) {
    const c = ageCondition(ageField, query.age)[ageField];
    f[ageField] = { ...(f[ageField] || {}), ...c };
  }
  if (!f[ageField]) f[ageField] = { $ne: null };
  return f;
}

/**
 * فواتيرُ الكاش — كشوفٌ نقديّة اكتمل سدادُها للمورّد.
 *
 * تصل هنا لحظةَ ما يختار موظّفُ التشغيل «كاش» ويكتب تاريخَ السداد وفرعَه
 * ومبلغَه: ذلك معناه أنّ الشحنة نُفّذت ودُفع للمورّد، فالمالُ عند العميل الآن
 * ويُطلَب في يومه.
 *
 * ولا يُعرَض «مبلغ السداد» هنا: ذاك ما دُفع للمورّد، وما يُحصَّل من العميل رقمٌ
 * آخر يكتبه المحصِّل بيده حين يقبضه.
 */
exports.cashInvoices = async (req, res) => {
  try {
    // ── والكشفُ النقديُّ يُحصَّل سواءٌ عرفنا ما دفعناه فيه أم لا ────────────
    //
    // كان الشرطُ يقتضي فرعًا مسدِّدًا ومبلغَ سدادٍ أكبرَ من صفر. و«مبلغ السداد»
    // ما دفعناه نحن للمورّد — لا ما على العميل. فاشتراطُه في صفحةِ تحصيلٍ يعني
    // أنّ الكشفَ لا يُطالَب به حتى نكون قد سجّلنا شراءَه.
    //
    // والأثر: ألفٌ وثمانمئةٍ وأربعةٌ وثلاثون كشفًا نقديًّا في دفتر التحصيل،
    // تعرض الصفحةُ منها **خمسة**. أي أنّ المحصِّل يفتح شاشتَه فلا يرى ما
    // يُحصّله.
    //
    // فالشرطُ هو النوعُ وحدَه: كلُّ كشفٍ نقديٍّ قابلٌ للتحصيل، والمحصَّلُ منه
    // يُعرَف بتاريخ تحصيله لا بغيابه من القائمة.
    // ── ولا تصل الشاشةَ إلّا بعد مراجعة التشغيل ──────────────────────────────
    // كان الشرطُ تاريخَ سدادٍ ونوعًا نقديًّا. وصار معهما **مراجعةُ التشغيل**:
    // الكشفُ لا يُطالَب به العميلُ قبل أن يراجعه التشغيلُ ويقرّ أنّه تامّ.
    //
    // ويسري على الكشوف الجديدة وحدَها (راجع AUTO_RULE_FROM): عمودُ المراجعة
    // فارغٌ في تسعةٍ وعشرين ألفَ كشفٍ سابق، فاشتراطُه عليها يُفرغ الشاشةَ من
    // كلّ ما يعمل عليه القسمُ اليوم.
    const { AUTO_RULE_FROM } = require('../utils/paymentType');
    const filter = {
      ...invoiceFilters(req.query, { ageField: 'paymentDate' }),
      paymentType: 'cash',
    };
    filter.$and = [...(filter.$and || []), {
      $or: [
        { reportDate: { $lt: AUTO_RULE_FROM } },
        { accountingReview: { $nin: ['', null] } },
      ],
    }, ...columnFilters(req.query, 'cash')];

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const [rows, total, totals] = await Promise.all([
      OperationsWorkflow.find(filter)
        .select('reportNumber reportDate username payingBranch paymentDate collectedAmount collectionDate cashCollectionStatus collectionDetail deliveryDate branch fromLocation toLocation sellingValue')
        .sort({ paymentDate: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      OperationsWorkflow.countDocuments(filter),
      OperationsWorkflow.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            collected: { $sum: { $ifNull: ['$collectedAmount', 0] } },
            value: { $sum: { $ifNull: ['$sellingValue', 0] } },
            // ── والمحصَّلُ بلا تاريخٍ محصَّل ────────────────────────────────
            // دفترُ الكاش يقول عن تسعةٍ وتسعين كشفًا «Collected» ولا تاريخَ
            // لها فيه. فعدُّها غيرَ محصَّلةٍ لأنّ خانةَ التاريخ فارغةٌ يجعل
            // الشاشةَ تطالب بمالٍ وصل.
            collectedCount: {
              $sum: {
                $cond: [
                  { $or: [{ $ifNull: ['$collectionDate', false] }, { $eq: ['$cashCollectionStatus', 'collected'] }] },
                  1, 0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const now = Date.now();
    const t = totals[0] || { collected: 0, collectedCount: 0 };
    const partyIds = await partyIdsByName(rows.map((w) => w.username));
    res.json({
      invoices: rows.map((w) => ({
        _id: w._id,
        reportNumber: w.reportNumber,
        customer: w.username || '',
        partyId: partyIds.get(fold(w.username || '')) || '',
        branch: w.branch || '',
        payingBranch: w.payingBranch || '',
        paymentDate: w.paymentDate,
        route: [w.fromLocation, w.toLocation].filter(Boolean).join(' — '),
        // ── وما يُطالَب به يُعرَض بجانب ما قُبض ────────────────────────────
        // كانت الصفحةُ تعرض «مبلغ التحصيل» وحدَه، وهو صفرٌ في ألفٍ وثلاثمئةٍ
        // وسبعةٍ وثلاثين كشفًا لم يُكتب مبلغُها بعد. فيفتح المحصِّلُ شاشتَه
        // فيرى أصفارًا ولا يعرف بكم يُطالِب.
        value: r2(w.sellingValue),
        collectedAmount: r2(w.collectedAmount),
        collectionDate: w.collectionDate || null,
        // «محصَّل» في الدفتر وإن لم يُعرف يومُه — تقرؤها الشاشة فتقول ذلك
        // صراحةً بدل «لم يُحصَّل».
        collectedNoDate: !w.collectionDate && w.cashCollectionStatus === 'collected',
        // ── والنقديُّ يُسلَّم للعميل كالضريبيّ ──────────────────────────────
        // الفاتورةُ النقديّة تُحمَل إلى العميل ويُوقَّع عليها كغيرها، ومن يومئذٍ
        // يُطالَب. فكان زرُّ التسليم في صفحة الضريبيّ وحدَها، فيبقى نصفُ العمل
        // بلا تاريخٍ في النظام.
        deliveryDate: w.deliveryDate || null,
        collectionDetail: w.collectionDetail || '',
        ageDays: w.paymentDate ? Math.floor((now - new Date(w.paymentDate).getTime()) / 86400000) : null,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      totals: { value: r2(t.value), collected: r2(t.collected), collectedCount: t.collectedCount, pendingCount: total - t.collectedCount },
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل فواتير الكاش', error: e.message });
  }
};

/**
 * فواتيرُ الضريبي — مجموعةٌ برقم الفاتورة.
 *
 * الفاتورةُ الواحدة قد تضمّ أكثرَ من كشف، وذلك معتاد. فالصفُّ هنا فاتورةٌ لا
 * كشف، ومعه عددُ كشوفه — ومن أراد تفصيلَها فتحها.
 */
/**
 * الفواتيرُ الضريبيّة — من دفتر الفواتير، لا من الكشوف.
 *
 * ── لماذا انقلب المصدر ────────────────────────────────────────────────────
 * كانت هذه الصفحة تُجمِّع كشوفَ التشغيل على رقم الفاتورة. والفاتورةُ لا تُولَد
 * من كشف: في دفتر التحصيل ثمانيةُ آلافٍ وتسعُمئةٍ وثمانٍ وسبعون فاتورة، ولا
 * يحمل رقمَها في كشوفنا إلّا خمسُمئةٍ وثمانٍ وخمسون — ستّةٌ في المئة. فكان
 * أربعةٌ وتسعون في المئة من فواتير الشركة لا تظهر في صفحة اسمُها «الفواتير
 * الضريبيّة»: يُبحَث عن الفاتورة ١١٨٠٠ فلا تُوجد، وهي في النظام وقيمتُها
 * ٤٧١٥ ومسلَّمةٌ لصاحبها.
 *
 * فالمصدرُ الآن هو الدفتر — وهو ما يقوله نموذجُ CollectionInvoice نفسُه:
 * الفاتورةُ مستندٌ قائمٌ بنفسه، والكشفُ يُنسَب إليها حين يوجد لا العكس.
 * وتُلحَق بها كشوفُها متى وُجدت، فيبقى «كم كشفًا تحتها» و«أحُصّلت كلُّها».
 */
exports.taxInvoices = async (req, res) => {
  try {
    const CollectionInvoice = require('../models/CollectionInvoice');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    // ── والدفترُ كلُّه فواتير ────────────────────────────────────────────────
    // كان يُستبعَد ما `kind` فيه «cash»، و`kind` صفةٌ استنتجناها من شكل كود
    // الحساب (C…) لا شيءٌ في الورقة. فسقطت ثلاثُ فواتيرَ حقيقيّةٍ من ورقة
    // «Daily Invoice Report» — لشركة تنشيط، مسلَّمةٌ وقيمتُها سبعةُ آلافٍ
    // وسبعُمئة — من صفحة الفواتير، ولم تظهر في صفحة الكاش لأنّ تلك تقرأ
    // الكشوف لا الفواتير. فلا تظهر في شاشةٍ أصلًا.
    //
    // وكلُّ صفٍّ في تلك الورقة فاتورة، فتُعرَض كلُّها.
    const f = ledgerInvoiceMatch(req.query);
    // فلاترُ الأعمدة تُضاف فوق ما سبق — راجع columnFilters.
    const cf = columnFilters(req.query, 'tax');
    if (cf.length) f.$and = [...(f.$and || []), ...cf];

    const [rows, total, totalsAgg] = await Promise.all([
      CollectionInvoice.find(f).sort({ invoiceDate: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      CollectionInvoice.countDocuments(f),
      CollectionInvoice.aggregate([
        { $match: f },
        { $group: {
          _id: null,
          value: { $sum: '$total' },
          invoices: { $sum: 1 },
          fullyCollected: { $sum: { $cond: [{ $or: [{ $ifNull: ['$collectionDate', false] }, { $regexMatch: { input: { $ifNull: ['$status', ''] }, regex: /collected/i } }] }, 1, 0] } },
        } },
      ]),
    ]);

    // كشوفُ هذه الصفحة وحدَها — لا الدفترِ كلِّه: استعلامٌ صغيرٌ على مئةِ رقم.
    const nums = rows.map((r) => r.invoiceNumber).filter(Boolean);
    const repAgg = nums.length ? await OperationsWorkflow.aggregate([
      { $match: { invoiceNumber: { $in: nums }, ...NOT_CANCELLED } },
      { $group: {
        _id: '$invoiceNumber',
        reports: { $sum: 1 },
        collectedReports: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, 1, 0] } },
        branch: { $first: '$branch' },
        payingBranch: { $first: '$payingBranch' },
      } },
    ]) : [];
    const byNo = new Map(repAgg.map((r) => [r._id, r]));

    const t = totalsAgg[0] || { value: 0, invoices: 0, fullyCollected: 0 };
    const now = Date.now();
    const partyIds = await partyIdsByName(rows.map((r) => r.partyName));

    res.json({
      invoices: rows.map((i) => {
        const rep = byNo.get(i.invoiceNumber);
        // ── والمحصَّلُ يُقرأ من الدفتر أوّلًا ────────────────────────────────
        // الدفترُ يقول «محصَّلة» ولو لم يكن لها كشفٌ عندنا؛ وكشوفُنا تُكمِّل
        // الصورةَ ولا تنقضها.
        const collected = !!i.collectionDate || /collected/i.test(i.status || '');
        return {
          invoiceNumber: i.invoiceNumber,
          customer: i.partyName || '',
          partyId: partyIds.get(fold(i.partyName || '')) || '',
          partyCode: i.partyCode || '',
          value: r2(i.total),
          // الصافي والضريبة يُشتقّان من الإجمالي حين لا يذكرهما الدفتر.
          net: r2(i.total / 1.15),
          vat: r2(i.total - i.total / 1.15),
          invoiceDate: i.invoiceDate,
          deliveryDate: i.deliveryDate,
          branch: rep?.branch || '',
          payingBranch: rep?.payingBranch || '',
          reports: rep?.reports || 0,
          collectedReports: rep?.collectedReports || 0,
          fullyCollected: collected,
          collectionDate: i.collectionDate || null,
          status: i.status || '',
          ageDays: i.invoiceDate ? Math.floor((now - new Date(i.invoiceDate).getTime()) / 86400000) : null,
        };
      }),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      totals: { value: r2(t.value), invoices: t.invoices, fullyCollected: t.fullyCollected, pending: t.invoices - t.fullyCollected },
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفواتير الضريبية', error: e.message });
  }
};

/**
 * تفصيلُ فاتورة: الفاتورةُ أوّلًا، وكشوفُها إن وُجدت.
 *
 * ── وكانت الصفحةُ تُقلب فتبيضّ ────────────────────────────────────────────
 * كانت هذه الدالّةُ تبحث في كشوف التشغيل عن الرقم، فإن لم تجد قالت «لا كشوف
 * بهذا الرقم» وردّت 404. وقائمةُ الفواتير التي جاء منها الضغطُ تُقرأ من
 * الدفتر لا من الكشوف — والدفترُ يقول عن نفسه إنّ ستّةً في المئة فقط من
 * فواتيره لها كشوفٌ عندنا. فأربعةٌ وتسعون في المئة من الضغطاتِ كانت تنتهي
 * إلى صفحةٍ بيضاء.
 *
 * والترتيبُ الصحيح هو ترتيبُ النموذج نفسِه: الفاتورةُ مستندٌ قائمٌ بذاته،
 * والكشفُ يُنسَب إليها حين يوجد. فتُقرأ الفاتورةُ من الدفتر، وتُلحَق بها
 * كشوفُها إن كانت، وتُعرض بلا كشوفٍ إن لم تكن — وذلك حالُها الطبيعيّ لا خطأ.
 *
 * ولا يُردُّ 404 إلّا حين لا يكون للرقم أثرٌ في الدفتر ولا في الكشوف.
 */
exports.taxInvoiceDetail = async (req, res) => {
  try {
    const number = String(req.params.invoiceNumber || '').trim();
    if (!number) return res.status(400).json({ message: 'رقم الفاتورة مطلوب' });

    const CollectionInvoice = require('../models/CollectionInvoice');
    const [ledger, rows] = await Promise.all([
      CollectionInvoice.findOne({ invoiceNumber: number }).lean(),
      OperationsWorkflow.find({ invoiceNumber: number, ...NOT_CANCELLED })
        .select('reportNumber reportDate username branch payingBranch fromLocation toLocation carNumber carOwner sellingValue netInvoice tax totalInvoice invoiceDate deliveryDate sendingDate documentNumber collectedAmount collectionDate accountingReview paymentType')
        .sort({ reportDate: 1 }).lean(),
    ]);

    if (!ledger && !rows.length) return res.status(404).json({ message: 'لا فاتورة بهذا الرقم' });

    // ── واسمُ العميل يصير بابًا ──────────────────────────────────────────
    // الفاتورةُ تحمل اسمًا، وملفُّ العميل يُفتَح بمعرّفه. فيُترجَم الاسمُ هنا
    // مرّةً بالاسم المطويّ — لا في الواجهة بطلبٍ ثانٍ لكلِّ ضغطة.
    const customerName = ledger?.partyName || rows[0]?.username || '';
    const partyDoc = customerName
      ? await CollectionsParty.findOne({ kind: 'customer', nameKey: fold(customerName) }).select('_id').lean()
      : null;

    const sum = (k) => r2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
    // ── والمالُ يُقرأ من الدفتر متى نطق ──────────────────────────────────
    // الدفترُ هو ما يعمل عليه المحاسب. فإن ذكر الإجماليَّ فهو الإجماليّ،
    // ويُشتقُّ منه الصافي والضريبة. وإن سكت — فاتورةٌ وُلدت من كشفٍ عندنا —
    // جُمعت من كشوفها.
    const fromLedger = ledger && Number(ledger.total) > 0;
    const value = fromLedger ? r2(ledger.total) : sum('totalInvoice');
    const net = fromLedger ? r2(ledger.total / 1.15) : sum('netInvoice');
    const vat = fromLedger ? r2(ledger.total - ledger.total / 1.15) : sum('tax');

    res.json({
      invoiceNumber: number,
      kind: ledger?.kind || (rows[0]?.paymentType === 'cash' ? 'cash' : 'tax'),
      customer: customerName,
      partyId: partyDoc?._id ? String(partyDoc._id) : '',
      partyCode: ledger?.partyCode || '',
      invoiceDate: ledger?.invoiceDate || rows.find((r) => r.invoiceDate)?.invoiceDate || null,
      deliveryDate: ledger?.deliveryDate || rows.find((r) => r.deliveryDate)?.deliveryDate || null,
      collectionDate: ledger?.collectionDate || null,
      status: ledger?.status || '',
      comments: ledger?.comments || '',
      // من أين جاءت الفاتورة: من دفتر الشركة أم وُلدت من كشفٍ عندنا.
      inLedger: !!ledger,
      reports: rows,
      totals: {
        reports: rows.length,
        net,
        vat,
        value,
        collectedReports: rows.filter((r) => r.collectionDate).length,
      },
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفاتورة', error: e.message });
  }
};

/**
 * تسجيلُ التحصيل.
 *
 * ── ويُكتب على الكشوف نفسِها ───────────────────────────────────────────────
 * لا في جدولٍ ثانٍ للتحصيل. الكشفُ هو المستند، وتاريخُ تحصيله عمودٌ فيه —
 * فيراه قسمُ التشغيل في اللحظة نفسِها بلا مزامنة.
 *
 * والفاتورةُ التي تضمّ كشوفًا يُكتب تاريخُها على كشوفها كلِّها: تحصيلُ الفاتورة
 * تحصيلٌ لما فيها، وتركُ بعضِها مفتوحًا يجعلها تظهر «نصفَ محصَّلة» إلى الأبد.
 */
// ── الدفتران يتحرّكان معًا ───────────────────────────────────────────────────
//
// الفاتورةُ مكتوبةٌ في مكانين: على كشوف التشغيل التي تحتها، وفي دفتر التحصيل
// (`CollectionInvoice`) الذي فيه تسعةُ آلافِ فاتورةٍ ترجع إلى ٢٠٢٢ — أكثرُها
// بلا كشفٍ عندنا أصلًا. وهما ليسا نسخةً من نسخة، بل وجهان لشيءٍ واحد.
//
// وكان كلٌّ يتحرّك وحدَه: الدفترُ يقول إنّ الفاتورة ٩٧١٩ سُلّمت في ١ مارس
// وحُصّلت، وكشفُها في التشغيل خاليان. فمن فتح الكشف رأى فاتورةً لم تُسلَّم بعد.
//
// فكلُّ تسجيلٍ هنا يكتب في الوجهين معًا.
const syncInvoiceLedger = async (invoiceNumber, { deliveryDate, collectionDate }) => {
  const no = String(invoiceNumber || '').trim();
  if (!no || NO_INVOICE_RX.test(no)) return null;
  const CollectionInvoice = require('../models/CollectionInvoice');
  const $set = {};
  if (deliveryDate !== undefined) $set.deliveryDate = deliveryDate;
  if (collectionDate !== undefined) $set.collectionDate = collectionDate;
  // الحالةُ تتبع التواريخ لا تُكتب على حدة: «محصَّلة» أقوى من «مسلَّمة».
  const inv = await CollectionInvoice.findOne({ invoiceNumber: no });
  if (!inv) return null;
  const collected = collectionDate !== undefined ? collectionDate : inv.collectionDate;
  const delivered = deliveryDate !== undefined ? deliveryDate : inv.deliveryDate;
  $set.status = collected ? 'Collected' : (delivered ? 'Delivered' : (inv.status || ''));
  await CollectionInvoice.updateOne({ _id: inv._id }, { $set });
  return inv._id;
};

/**
 * تسجيلُ تسليم الفاتورة إلى العميل — POST /invoices/deliver
 *
 * فريقُ التحصيل يأخذ الفواتير ويذهب بها إلى العملاء، ومن يوم استلام العميل
 * تبدأ مهلتُه المتّفق عليها: مَن مهلتُه خمسةٌ وأربعون يومًا تُعَدُّ من ذلك
 * اليوم لا من يوم إصدار الفاتورة ولا من يوم وصولها الفرع.
 *
 * وهو غيرُ `branchDeliveryDate` — تسليمِ الكشف إلى الفرع، وهو عملُ التشغيل
 * ويأتي من شيت المتابعة. كانا حقلًا واحدًا فكانت المهلةُ تُحسب من تاريخٍ
 * أسبقَ من التسليم الحقيقيّ. راجع models/OperationsWorkflow.
 */
exports.recordDelivery = async (req, res) => {
  try {
    const { deliveryDate } = req.body;
    if (!deliveryDate) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: تاريخ التسليم للعميل', fields: { deliveryDate: 'مطلوب' } });
    }
    const invoiceNumber = String(req.body.invoiceNumber || '').trim();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!invoiceNumber && !ids.length) return res.status(400).json({ message: 'حدِّد فاتورةً أو كشوفًا' });

    const filter = invoiceNumber ? { invoiceNumber, ...NOT_CANCELLED } : { _id: { $in: ids } };
    const when = new Date(deliveryDate);
    const r = await OperationsWorkflow.updateMany(filter, { $set: { deliveryDate: when, lastModifiedBy: req.user._id } });
    await syncInvoiceLedger(invoiceNumber, { deliveryDate: when });

    cache.clear('wf:');
    cache.clear(CACHE_PREFIX);
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    await logAudit({
      user: req.user._id, action: 'record_delivery', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null, entityKey: invoiceNumber || undefined,
      changes: { after: { deliveryDate, count: r.modifiedCount } }, ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, delivery: true }); } catch (_) {}

    res.json({
      updated: r.modifiedCount || 0,
      message: invoiceNumber
        ? `سُجِّل تسليمُ الفاتورة ${invoiceNumber} للعميل على ${r.modifiedCount} كشفًا`
        : `سُجِّل التسليم للعميل على ${r.modifiedCount} كشفًا`,
    });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تسجيل التسليم'); }
};

/**
 * تفصيلُ التحصيل — PUT /invoices/detail
 *
 * من أين وصل المال: قبضه الفرعُ، أو قُبض نقدًا، أو أخذه المحصِّلُ من العميل.
 * والقيمُ من `collections_detail` في إعدادات القسم — لا تُتحقَّق هنا مقابل
 * قائمةٍ ثابتة، لأنّ القائمةَ تُعدَّل وهذا مقصودُها.
 *
 * ويُكتب بلا تاريخٍ ولا مبلغ: هو صفةُ الكشف لا حدثٌ فيه، فيُوضَع قبل التحصيل
 * وبعده سواء.
 */
exports.setCollectionDetail = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!ids.length) return res.status(400).json({ message: 'حدِّد كشفًا واحدًا على الأقل' });
    const detail = String(req.body.detail || '').trim();

    const r = await OperationsWorkflow.updateMany(
      { _id: { $in: ids } },
      { $set: { collectionDetail: detail, lastModifiedBy: req.user._id } },
    );

    cache.clear('wf:');
    cache.clear(CACHE_PREFIX);
    await logAudit({
      user: req.user._id, action: 'set_collection_detail', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null,
      changes: { after: { collectionDetail: detail, count: r.modifiedCount } }, ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, detail: true }); } catch (_) {}

    res.json({ updated: r.modifiedCount || 0, message: detail ? 'حُفظ تفصيلُ التحصيل' : 'أُزيل تفصيلُ التحصيل' });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ تفصيل التحصيل'); }
};

/**
 * كشفٌ نقديٌّ واحد — PUT /invoices/cash/:id
 *
 * ── ولماذا يوجد ──────────────────────────────────────────────────────────
 * التطبيقُ يحفظ صفَّ أيِّ قائمةٍ بـ PUT على `<endpoint>/<id>` — هكذا صُمّم
 * `ResourceConfig`. وصفحةُ الكاش لم يكن لها هذا الطريق، فكان المحصِّلُ يكتب
 * المبلغَ في الهاتف ويضغط «حفظ» فتذهب الكتابةُ إلى طريقٍ لا وجودَ له.
 *
 * والحقولُ الثلاثةُ هي عملُ المحصِّل كلُّه على الكشف: ما قبضه، ومتى، ومتى وصلت
 * الفاتورةُ العميل، ومن أين وصل المال. وما لم يُرسَل لا يُمسّ — فالتطبيقُ قد
 * يرسل حقلًا واحدًا.
 */
exports.updateCashInvoice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّفٌ غير صالح' });
    const wf = await OperationsWorkflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ message: 'الكشف غير موجود' });

    const $set = { lastModifiedBy: req.user._id };
    const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
    if (has('collectedAmount')) $set.collectedAmount = Number(req.body.collectedAmount) || 0;
    if (has('collectionDate')) $set.collectionDate = req.body.collectionDate ? new Date(req.body.collectionDate) : null;
    if (has('deliveryDate')) $set.deliveryDate = req.body.deliveryDate ? new Date(req.body.deliveryDate) : null;
    if (has('collectionDetail')) $set.collectionDetail = String(req.body.collectionDetail || '').trim();

    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set });
    // والفاتورةُ في الدفتر تُحدَّث معه — الوجهان لا يتحرّك أحدُهما وحدَه.
    if (wf.invoiceNumber && ($set.deliveryDate !== undefined || $set.collectionDate !== undefined)) {
      await syncInvoiceLedger(wf.invoiceNumber, {
        ...($set.deliveryDate !== undefined ? { deliveryDate: $set.deliveryDate } : {}),
        ...($set.collectionDate !== undefined ? { collectionDate: $set.collectionDate } : {}),
      });
    }

    cache.clear('wf:');
    cache.clear(CACHE_PREFIX);
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    await logAudit({
      user: req.user._id, action: 'update', entity: 'OperationsWorkflow', entityId: wf._id,
      entityKey: wf.reportNumber, changes: { after: req.body }, ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { id: String(wf._id) }); } catch (_) {}

    res.json({ message: 'حُفظ' });
  } catch (e) { sendMongooseError(res, e, 'تعذّر الحفظ'); }
};

exports.recordCollection = async (req, res) => {
  try {
    const { collectionDate, collectedAmount } = req.body;
    if (!collectionDate) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: تاريخ التحصيل', fields: { collectionDate: 'مطلوب' } });
    }

    const invoiceNumber = String(req.body.invoiceNumber || '').trim();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!invoiceNumber && !ids.length) {
      return res.status(400).json({ message: 'حدِّد فاتورةً أو كشوفًا' });
    }

    const filter = invoiceNumber
      ? { invoiceNumber, ...NOT_CANCELLED }
      : { _id: { $in: ids } };

    const $set = { collectionDate: new Date(collectionDate), lastModifiedBy: req.user._id };
    // المبلغُ للكاش: الفاتورةُ الضريبيّة قيمتُها مكتوبةٌ فيها، والنقديُّ يقبضه
    // المحصِّل فيكتب ما قبض.
    if (collectedAmount !== undefined && collectedAmount !== '') $set.collectedAmount = Number(collectedAmount) || 0;

    const r = await OperationsWorkflow.updateMany(filter, { $set });
    // والدفترُ الآخر معه — راجع syncInvoiceLedger.
    await syncInvoiceLedger(invoiceNumber, { collectionDate: $set.collectionDate });
    cache.clear('wf:');
    cache.clear(CACHE_PREFIX);
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}

    await logAudit({
      user: req.user._id, action: 'record_collection', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null,
      entityKey: invoiceNumber || undefined,
      changes: { after: { collectionDate, collectedAmount, count: r.modifiedCount } },
      ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, collection: true }); } catch (_) {}

    res.json({
      updated: r.modifiedCount || 0,
      message: invoiceNumber
        ? `سُجِّل التحصيل على ${r.modifiedCount} كشفًا تحت الفاتورة ${invoiceNumber}`
        : `سُجِّل التحصيل على ${r.modifiedCount} كشفًا`,
    });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تسجيل التحصيل'); }
};

/** قيمُ فلاتر صفحتَي الفواتير — مبنيّةٌ من البيانات نفسِها. */
exports.invoiceFilterOptions = async (req, res) => {
  try {
    const kind = req.query.kind === 'cash' ? 'cash' : 'tax';
    const base = kind === 'cash'
      ? { paymentType: 'cash', ...NOT_CANCELLED }
      : { ...REAL_INVOICE, paymentType: 'tax', ...NOT_CANCELLED };
    // ── وقائمةُ العملاء تتبع مصدرَ الصفحة ────────────────────────────────────
    // الضريبيّةُ صارت تُقرأ من دفتر الفواتير، وفيه ثمانيةُ آلافٍ من الفواتير
    // لأصحابٍ لا كشفَ لهم عندنا. فقائمةٌ مبنيّةٌ على أسماء الكشوف تعرض ستّةً في
    // المئة من عملاء الصفحة، فيبحث المستخدمُ عن عميلٍ يراه في الجدول ولا يجده
    // في الفلتر.
    const CollectionInvoice = require('../models/CollectionInvoice');
    const [customers, branches] = await Promise.all([
      kind === 'cash'
        ? OperationsWorkflow.distinct('username', { ...base, username: { $nin: [null, ''] } })
        : CollectionInvoice.distinct('partyName', { partyName: { $nin: [null, ''] } }),
      OperationsWorkflow.distinct('payingBranch', { ...base, payingBranch: { $nin: [null, ''] } }),
    ]);
    res.json({ customers: customers.sort().slice(0, 2000), branches: branches.sort() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر', error: e.message });
  }
};

exports.AGE_BANDS = AGE_BANDS;
exports.NO_INVOICE_TOKENS = NO_INVOICE_TOKENS;
