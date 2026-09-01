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
const { fold } = require('../models/CollectionsParty');
const { dayRange } = require('../utils/companyDay');
const { flexSpaceRegex } = require('../utils/plateKey');
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
  'address', 'city', 'partyType', 'paymentTerms', 'creditLimit', 'status',
  'assignedTo', 'lastContactAt', 'nextFollowUpAt', 'notes', 'isActive',
];
const pick = (body) => {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  return out;
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
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

    res.json({
      party: withStats(party, stats),
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
    const dup = await CollectionsParty.findOne({ kind, nameKey: fold(body.name) }).select('_id name').lean();
    if (dup) {
      return res.status(409).json({
        message: `«${dup.name}» مسجَّل بالفعل — الاسمان يُقرآن واحدًا بعد طيّ فروق الرسم`,
        existingId: dup._id,
      });
    }
    const party = await CollectionsParty.create({ ...body, kind, source: 'manual', createdBy: req.user._id });
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
    const dateMatch = range ? { reportDate: range } : {};
    // ── والمدى يُدمَج، لا يُنسَخ فوقه ─────────────────────────────────────
    // «تاريخُ الكشف موجود» و«تاريخُ الكشف داخل المدى» شرطان على الحقل نفسِه،
    // وكتابةُ أحدهما بعد الآخر في كائنٍ واحدٍ تُلغيه — فيسقط المدى صامتًا
    // وتُقرأ اللوحةُ المفلترةُ على البيانات كلِّها.
    const datedMatch = { reportDate: range ? { $ne: null, ...range } : { $ne: null } };
    const key = `${CACHE_PREFIX}dash:${from || ''}:${to || ''}`;

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

    res.json(data);
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل اللوحة', error: e.message });
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
