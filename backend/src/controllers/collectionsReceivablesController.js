/**
 * المديونيّة — لوحةُ قسم التحصيل كشجرةٍ تُطابق نفسَها.
 *
 * ── لماذا لوحةٌ ثانية ───────────────────────────────────────────────────────
 * اللوحةُ الأولى (`collectionsDeptController.dashboard`) مبنيّةٌ على كشوف
 * التشغيل: ما حُصّل من الكشوف وما بقي. وهي صحيحةٌ وتجيب عن سؤالٍ آخر. وسؤالُ
 * مدير التحصيل الأوّل هو: **كم علينا، ومن أيِّه في موعده ومن أيِّه خرج عن
 * موعده** — وجوابُه في دفتر الفواتير لا في الكشوف (٩٤٪ من فواتير الدفتر لا
 * كشوفَ لها عندنا؛ راجع رأسَ models/CollectionInvoice).
 *
 * ── والشجرةُ تُطابق نفسَها، وإلّا فلا تُقرأ ─────────────────────────────────
 *     الإجماليُّ = ضريبيٌّ + نقديّ
 *     الضريبيُّ  = في موعده + متأخّر + بلا مدّةِ سداد
 *     المتأخّرُ  = ١–٣٠ + ٣١–٦٠ + أكثرُ من ٦٠
 *     وما تأخّر فوق ٦٠ = يُتفاوَض + قضايا + لم يُصنَّف
 * كلُّ عقدةٍ عددٌ وقيمة، وكلُّ عقدةٍ تُفتَح فتُرى صفوفُها — **من الاشتقاق
 * نفسِه** الذي حسبها (`derive()` أدناه)، فلا يُقرأ رقمٌ ويُفتَح جدولٌ بغيره.
 *
 * ── ومن أيِّ يومٍ يُعَدّ التأخير ────────────────────────────────────────────
 * مدّةُ السداد تبدأ من **تاريخ التسليم** لا من تاريخ إصدار الفاتورة — راجع
 * two-delivery-dates: `deliveryDate` في الدفتر هو تسليمُ الفاتورة للعميل.
 * فالاستحقاقُ = التسليم + مدّةُ العميل (`CollectionsParty.creditDays`).
 * وفاتورةٌ لم تُسلَّم بعدُ: يُعَدّ من إصدارها ويُقال ذلك في الصفّ.
 * وعميلٌ بلا مدّةٍ محفوظة (١٢٦ حسابًا من ٣٨٦) لا يُخترَع له ثلاثون يومًا:
 * يُجمَع في «بلا مدّة سداد» — عقدةٌ ظاهرةٌ تُسدّ، لا رقمٌ مذوّبٌ في غيره.
 */
const mongoose = require('mongoose');
const CollectionInvoice = require('../models/CollectionInvoice');
const CollectionsParty = require('../models/CollectionsParty');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

const DAY = 86400000;
const TTL = 30 * 1000;

/** الفاتورةُ قائمةٌ ما لم تُحصَّل ولم تكن رقمًا محجوزًا. */
const OUTSTANDING = CollectionInvoice.OPEN;

/**
 * المراحلُ المشتركة: تُضَمّ مدّةُ العميل، ثمّ يُشتقّ الاستحقاقُ والتأخير
 * والشريحةُ وحالةُ الخلاف. يقرؤها حسابُ البطاقات **وجدولُ الصفوف** معًا.
 */
const derive = () => [
  {
    $lookup: {
      from: 'collectionsparties',
      localField: 'party',
      foreignField: '_id',
      as: '_p',
      pipeline: [{ $project: { creditDays: 1, collectionOfficer: 1, issue: 1, name: 1, code: 1 } }],
    },
  },
  { $addFields: { _party: { $first: '$_p' } } },
  {
    $addFields: {
      creditDays: { $ifNull: ['$_party.creditDays', 0] },
      officer: { $ifNull: ['$_party.collectionOfficer', ''] },
      issueState: { $ifNull: ['$_party.issue.state', 'none'] },
      // أساسُ العدّ: التسليمُ إن وُجد، وإلّا الإصدار — ويُقال أيُّهما.
      basis: { $cond: [{ $ne: ['$deliveryDate', null] }, 'delivery', 'invoice'] },
      basisDate: { $ifNull: ['$deliveryDate', '$invoiceDate'] },
    },
  },
  {
    $addFields: {
      dueDate: {
        $cond: [
          { $or: [{ $eq: ['$basisDate', null] }, { $lte: ['$creditDays', 0] }] }, null,
          { $dateAdd: { startDate: '$basisDate', unit: 'day', amount: '$creditDays' } },
        ],
      },
    },
  },
  {
    $addFields: {
      daysLate: {
        $cond: [{ $eq: ['$dueDate', null] }, null,
          { $dateDiff: { startDate: '$dueDate', endDate: '$$NOW', unit: 'day' } }],
      },
    },
  },
  {
    $addFields: {
      // «بلا مدّة» عقدةٌ ثالثةٌ لا تُخفى: لا موعدَ لها فلا تُقال «في موعدها».
      dueState: {
        $switch: {
          branches: [
            { case: { $eq: ['$dueDate', null] }, then: 'noterm' },
            { case: { $lte: ['$daysLate', 0] }, then: 'within' },
          ],
          default: 'late',
        },
      },
      lateBand: {
        $switch: {
          branches: [
            { case: { $eq: ['$dueDate', null] }, then: 'none' },
            { case: { $lte: ['$daysLate', 0] }, then: 'none' },
            { case: { $lte: ['$daysLate', 30] }, then: 'd1_30' },
            { case: { $lte: ['$daysLate', 60] }, then: 'd31_60' },
          ],
          default: 'd60_plus',
        },
      },
    },
  },
  { $project: { _p: 0, _party: 0 } },
];

/** فلترُ اللوحة — نفسُه في البطاقات وفي الصفوف. */
const baseMatch = (q) => {
  const f = { ...OUTSTANDING };
  if (q.kind === 'tax' || q.kind === 'cash') f.kind = q.kind;
  if (q.officerParties) f.party = q.officerParties.exclude ? { $nin: q.officerParties.exclude } : { $in: q.officerParties };
  if (q.customer) f.partyName = flexSpaceRegex(String(q.customer));
  if (q.from || q.to) {
    f.invoiceDate = {};
    if (q.from) f.invoiceDate.$gte = new Date(q.from);
    if (q.to) f.invoiceDate.$lte = new Date(`${q.to}T23:59:59.999Z`);
  }
  return f;
};

/** الأطرافُ التي يحملها موظّفُ تحصيلٍ بعينه — يُقرأ مرّةً لا لكلّ فاتورة. */
//
// ── و«بلا مسؤول» سؤالٌ لا غيابُ سؤال ──────────────────────────────────────
// بطاقةُ «—» في اللوحة كانت ترسل اسمًا فارغًا، والفارغُ يُقرأ «بلا فلتر» —
// فتفتح البطاقةُ التي عليها ٥٩٣ ألفًا المديونيّةَ كلَّها بعشرين مليونًا.
// فـ`none` تعني الحساباتِ التي لا موظّفَ لها، ومعها الفواتيرُ غيرُ المربوطة.
const partiesOfOfficer = async (officer) => {
  if (!officer) return null;
  if (officer === 'none') {
    const rows = await CollectionsParty.find({ collectionOfficer: { $nin: [null, ''] } }).select('_id').lean();
    return { exclude: rows.map((r) => r._id) };
  }
  const rows = await CollectionsParty.find({ collectionOfficer: officer }).select('_id').lean();
  return rows.map((r) => r._id);
};

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const node = (rows, pick) => {
  const hit = rows.filter(pick);
  return { count: hit.length, value: Math.round(sum(hit.map((r) => r.total || 0)) * 100) / 100 };
};

/**
 * GET /api/collections-dept/receivables/overview
 * ?kind=&officer=&customer=&from=&to=
 */
exports.overview = async (req, res) => {
  try {
    const key = `cdr:ov:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const officerParties = await partiesOfOfficer(req.query.officer);
    const match = baseMatch({ ...req.query, officerParties });

    // ── تُقرأ الصفوفُ مرّةً وتُبنى الشجرةُ منها ──────────────────────────
    // المديونيّةُ القائمةُ نحوُ ألفٍ وخمسِ مئة فاتورة — حملُها إلى العقدة
    // أرخصُ من ثمانيَ عشرةَ تجميعةً على القاعدة، ويضمن أنّ كلَّ عقدةٍ في
    // الشجرة محسوبةٌ من **نفس** الصفوف التي تفتحها البطاقة.
    const rows = await CollectionInvoice.aggregate([
      { $match: match },
      ...derive(),
      {
        $project: {
          invoiceNumber: 1, kind: 1, total: 1, partyName: 1, partyCode: 1, party: 1,
          invoiceDate: 1, deliveryDate: 1, status: 1,
          creditDays: 1, officer: 1, issueState: 1, basis: 1, dueDate: 1, daysLate: 1,
          dueState: 1, lateBand: 1,
        },
      },
    ]).allowDiskUse(true);

    const tax = (r) => r.kind === 'tax';
    const cash = (r) => r.kind === 'cash';
    const tree = {
      all: node(rows, () => true),
      byKind: {
        tax: node(rows, tax),
        cash: node(rows, cash),
      },
      // التفصيلُ على الضريبيّ: هو الذي له مدّةُ سدادٍ ومواعيد. والنقديُّ يُحصَّل
      // عند التسليم، فتفصيلُه بالمواعيد لا معنى له — ويبقى رقمُه في الشجرة.
      tax: {
        within: node(rows, (r) => tax(r) && r.dueState === 'within'),
        late: node(rows, (r) => tax(r) && r.dueState === 'late'),
        noterm: node(rows, (r) => tax(r) && r.dueState === 'noterm'),
        bands: {
          d1_30: node(rows, (r) => tax(r) && r.lateBand === 'd1_30'),
          d31_60: node(rows, (r) => tax(r) && r.lateBand === 'd31_60'),
          d60_plus: node(rows, (r) => tax(r) && r.lateBand === 'd60_plus'),
        },
        // وما كسر الستّين: أهو خلافٌ في اليد أم خرج إلى القضاء؟
        over60: {
          negotiating: node(rows, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'negotiating'),
          legal: node(rows, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'legal'),
          unclassified: node(rows, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'none'),
        },
      },
      cash: {
        within: node(rows, (r) => cash(r) && r.dueState === 'within'),
        late: node(rows, (r) => cash(r) && r.dueState === 'late'),
        noterm: node(rows, (r) => cash(r) && r.dueState === 'noterm'),
      },
    };

    // ── والتحقّقُ يُرسَل مع الأرقام ──────────────────────────────────────
    // «المفروض الأرقام كلها تكون صح ومتساويه» — فيُحسب الفرقُ هنا ويُعرَض في
    // الشاشة إن وُجد، بدل أن يُكتشَف بجمعٍ باليد.
    const checks = [
      { of: 'الإجمالي = ضريبي + نقدي', diff: tree.all.value - (tree.byKind.tax.value + tree.byKind.cash.value), n: tree.all.count - (tree.byKind.tax.count + tree.byKind.cash.count) },
      { of: 'الضريبي = في موعده + متأخر + بلا مدّة', diff: tree.byKind.tax.value - (tree.tax.within.value + tree.tax.late.value + tree.tax.noterm.value), n: tree.byKind.tax.count - (tree.tax.within.count + tree.tax.late.count + tree.tax.noterm.count) },
      { of: 'المتأخر = ١–٣٠ + ٣١–٦٠ + فوق ٦٠', diff: tree.tax.late.value - (tree.tax.bands.d1_30.value + tree.tax.bands.d31_60.value + tree.tax.bands.d60_plus.value), n: tree.tax.late.count - (tree.tax.bands.d1_30.count + tree.tax.bands.d31_60.count + tree.tax.bands.d60_plus.count) },
      { of: 'فوق ٦٠ = تفاوض + قضايا + غير مصنّف', diff: tree.tax.bands.d60_plus.value - (tree.tax.over60.negotiating.value + tree.tax.over60.legal.value + tree.tax.over60.unclassified.value), n: tree.tax.bands.d60_plus.count - (tree.tax.over60.negotiating.count + tree.tax.over60.legal.count + tree.tax.over60.unclassified.count) },
    ].map((c) => ({ ...c, diff: Math.round(c.diff * 100) / 100, ok: Math.abs(c.diff) < 0.5 && c.n === 0 }));

    // أثقلُ العملاء في كلّ شريحةٍ تهمّ — ومن يُفتَح يُفتَح بحسابه.
    const byParty = new Map();
    for (const r of rows) {
      const k = String(r.party || r.partyName || '—');
      if (!byParty.has(k)) {
        byParty.set(k, {
          party: r.party || null, name: r.partyName || '—', code: r.partyCode || '',
          officer: r.officer || '', issueState: r.issueState || 'none',
          count: 0, value: 0, late: 0, lateValue: 0, over60: 0, over60Value: 0, oldest: null,
        });
      }
      const g = byParty.get(k);
      g.count += 1; g.value += r.total || 0;
      if (r.dueState === 'late') { g.late += 1; g.lateValue += r.total || 0; }
      if (r.lateBand === 'd60_plus') { g.over60 += 1; g.over60Value += r.total || 0; }
      if (r.daysLate != null && (g.oldest == null || r.daysLate > g.oldest)) g.oldest = r.daysLate;
    }
    const parties = [...byParty.values()]
      .map((g) => ({ ...g, value: Math.round(g.value * 100) / 100, lateValue: Math.round(g.lateValue * 100) / 100, over60Value: Math.round(g.over60Value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);

    // وبالموظّف — لكلٍّ ما عليه، فيُقرأ العملُ موزَّعًا لا مجموعًا.
    const byOfficer = new Map();
    for (const r of rows) {
      const k = r.officer || '—';
      if (!byOfficer.has(k)) byOfficer.set(k, { officer: k, count: 0, value: 0, late: 0, lateValue: 0, over60: 0, over60Value: 0 });
      const g = byOfficer.get(k);
      g.count += 1; g.value += r.total || 0;
      if (r.dueState === 'late') { g.late += 1; g.lateValue += r.total || 0; }
      if (r.lateBand === 'd60_plus') { g.over60 += 1; g.over60Value += r.total || 0; }
    }

    const body = {
      tree,
      checks,
      parties: parties.slice(0, 300),
      officers: [...byOfficer.values()].map((g) => ({
        ...g, value: Math.round(g.value * 100) / 100,
        lateValue: Math.round(g.lateValue * 100) / 100, over60Value: Math.round(g.over60Value * 100) / 100,
      })).sort((a, b) => b.value - a.value),
      generatedAt: new Date(),
    };
    cache.set(key, body, TTL);
    res.json(body);
  } catch (e) {
    console.error('receivables overview', e);
    res.status(500).json({ message: 'تعذّر حساب المديونية' });
  }
};

/**
 * GET /api/collections-dept/receivables/rows
 * نفسُ الاشتقاق، مُفلترًا بعقدةٍ من الشجرة:
 *   ?kind=tax&dueState=late&lateBand=d60_plus&issue=legal&party=<id>&officer=&page=&limit=
 */
exports.rows = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const officerParties = await partiesOfOfficer(req.query.officer);
    const match = baseMatch({ ...req.query, officerParties });
    if (req.query.party && mongoose.isValidObjectId(String(req.query.party))) {
      match.party = new mongoose.Types.ObjectId(String(req.query.party));
    }
    const post = {};
    if (['within', 'late', 'noterm'].includes(req.query.dueState)) post.dueState = req.query.dueState;
    if (['d1_30', 'd31_60', 'd60_plus'].includes(req.query.lateBand)) post.lateBand = req.query.lateBand;
    if (['none', 'negotiating', 'legal'].includes(req.query.issue)) post.issueState = req.query.issue;

    const pipeline = [
      { $match: match },
      ...derive(),
      ...(Object.keys(post).length ? [{ $match: post }] : []),
      { $sort: { daysLate: -1, total: -1 } },
      {
        $facet: {
          rows: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                invoiceNumber: 1, kind: 1, total: 1, partyName: 1, partyCode: 1, party: 1,
                invoiceDate: 1, deliveryDate: 1, status: 1, creditDays: 1, officer: 1,
                issueState: 1, basis: 1, dueDate: 1, daysLate: 1, dueState: 1, lateBand: 1,
              },
            },
          ],
          totals: [{ $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$total', 0] } } } }],
        },
      },
    ];
    const [out] = await CollectionInvoice.aggregate(pipeline).allowDiskUse(true);
    const t = out?.totals?.[0] || { count: 0, value: 0 };
    res.json({
      rows: out?.rows || [],
      total: t.count,
      value: Math.round((t.value || 0) * 100) / 100,
      page,
      limit,
    });
  } catch (e) {
    console.error('receivables rows', e);
    res.status(500).json({ message: 'تعذّر تحميل الصفوف' });
  }
};

/**
 * PUT /api/collections-dept/parties/:id/issue — { state, note }
 * حالةُ الخلاف قرارٌ يُكتب باسم من كتبه: «يُتفاوَض» أو «قضايا» أو «لا خلاف».
 */
exports.setIssue = async (req, res) => {
  try {
    const state = String(req.body?.state || '').trim();
    if (!['none', 'negotiating', 'legal'].includes(state)) {
      return res.status(400).json({ message: 'حالةٌ غير معروفة' });
    }
    const note = String(req.body?.note || '').trim();
    // ── ولا يُقال «قضايا» بلا بيان ────────────────────────────────────────
    // رقمٌ في خانة القضايا يتحرّك بناءً عليه عملُ القسم كلِّه، ومن يقرؤه بعد
    // شهرٍ يسأل «أيُّ قضيّة؟». فالسببُ مكتوبٌ مع القرار.
    if (state !== 'none' && !note) {
      return res.status(400).json({ message: 'اكتب بيانَ الحالة (رقمُ القضيّة أو ما اتُّفق عليه)' });
    }
    const party = await CollectionsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'الحساب غير موجود' });
    const before = party.issue?.state || 'none';
    party.issue = {
      state,
      note,
      since: state === 'none' ? null : (before === state && party.issue?.since ? party.issue.since : new Date()),
      updatedBy: req.user?._id,
      updatedByName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim(),
    };
    await party.save();
    cache.clear('cdr:');
    await logAudit({
      user: req.user?._id, action: 'update', entity: 'CollectionsParty', entityId: party._id,
      changes: { before: { issue: before }, after: { issue: state, note } }, ipAddress: req.ip,
    }).catch(() => {});
    try { emitToAll('collections:changed', { party: String(party._id) }); } catch (e) { /* زيادة */ }
    res.json({ party: { _id: party._id, name: party.name, issue: party.issue } });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

exports._derive = derive;
