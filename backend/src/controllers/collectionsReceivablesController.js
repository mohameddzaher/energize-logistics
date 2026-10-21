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
 *
 * ── وأنواعُ الدفع الأربعة: مستحقٌّ وغيرُ مستحقّ ──────────────────────────────
 * صاحبُ الشركة (٢٠٢٦/١٠/٢١): «الفواتير الضريبية — بالاستحقاق» تُستبدَل بأربع
 * بطاقات، واحدةٍ لكلّ نوعٍ جديد («آجل - فاتورة»، «آجل - كاش»، «نقدي - 3PL»،
 * «نقدي - HT»)، كلٌّ منها نصفان:
 *
 *   مستحقّ      = تجاوز موعدَه (`late`) **أو بلا مدّةِ سدادٍ محفوظة** (`noterm`):
 *                 لا شيءَ يؤجّله، فهو مطلوبٌ الآن.
 *   غيرُ مستحقّ = لم يحِن موعدُه (`within`).
 *
 * و«ضريبي»/«كاش» بلا نوعٍ جديد لا تدخل البطاقاتِ الأربع (قولُ صاحب الشركة).
 * ومن أين يُقرأ كلُّ نوع — راجع `subtypeCards` أدناه.
 */
const mongoose = require('mongoose');
const CollectionInvoice = require('../models/CollectionInvoice');
const CollectionsParty = require('../models/CollectionsParty');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { SUBTYPE_KEYS, subtypeFamily } = require('../utils/paymentType');

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

// ═══════════════════════════════════════════════════════════════════════════
//  الأنواعُ الأربعة — مستحقٌّ وغيرُ مستحقّ
// ═══════════════════════════════════════════════════════════════════════════

const TAX_SUBS = SUBTYPE_KEYS.filter((k) => subtypeFamily(k) === 'tax');
const CASH_SUBS = SUBTYPE_KEYS.filter((k) => subtypeFamily(k) === 'cash');
const CANCELLED_EXEC = ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'];
/** «مستحق» = تجاوز موعدَه أو لا موعدَ له؛ «غير مستحق» = في موعده. */
const isDue = (dueState) => dueState !== 'within';

/**
 * نوعُ فاتورة الدفتر — يُشتقّ من كشوفها ساعةَ السؤال، ولا يُنسَخ إلى الدفتر.
 *
 * الفاتورةُ وحدةُ التحصيل وقد تضمّ كشوفًا عدّة، والنوعُ صفةُ الكشف. فإن اختلفت
 * كشوفُ فاتورةٍ واحدة عُدّت تحت نوعِ **أكثرِها** — والتعادلُ يذهب إلى النوع
 * الجديد على «ضريبي» بلا نوع (يدٌ اختارته على بعضها قصدًا، والفارغُ قديمٌ لم
 * يُراجَع). والفاتورةُ التي لا كشوفَ لها عندنا (أكثرُ الدفتر) بلا نوع.
 *
 * @returns {Map<string, string>} رقمُ الفاتورة ← النوع ('' = ضريبي بلا نوع)
 */
async function subtypeOfInvoices(numbers) {
  const list = [...new Set((numbers || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  const agg = await OperationsWorkflow.aggregate([
    { $match: { invoiceNumber: { $in: list }, paymentType: { $ne: 'cash' }, executionStatus: { $nin: CANCELLED_EXEC } } },
    { $group: { _id: { inv: '$invoiceNumber', sub: { $ifNull: ['$paymentSubtype', ''] } }, n: { $sum: 1 } } },
  ]);
  const best = new Map();
  for (const r of agg) {
    const inv = String(r._id.inv || '').trim();
    const sub = String(r._id.sub || '');
    const cur = best.get(inv);
    if (!cur || r.n > cur.n || (r.n === cur.n && sub && (!cur.sub || sub < cur.sub))) best.set(inv, { sub, n: r.n });
  }
  for (const [inv, b] of best) out.set(inv, b.sub);
  return out;
}

/**
 * كشوفُ الكاش القائمة بأنواعها الثلاثة — من سير العمل لا من الدفتر.
 *
 * الكاشُ صفُّه كشفُ تشغيل، فيُقرأ من الكشوف: **شرطُ صفحة فواتير الكاش نفسُه**
 * (`cashScreenFilter`) وما لم يُحصَّل منه. والقيمةُ قيمةُ البيع (ما تعرضه تلك
 * الصفحة)، والمدّةُ تُعَدّ من **التسليم للعميل** إن كُتب، وإلّا من تاريخ السداد
 * — والاشتقاقُ نفسُه الذي يكتبه `derive()` للدفتر (موعد، تأخير، حالة).
 */
async function cashSubtypeRows(q, officerParties, subs = CASH_SUBS) {
  const { cashScreenFilter } = require('./collectionsDeptController');
  const filter = cashScreenFilter({
    collected: 'no',
    ...(q.customer ? { customer: q.customer } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  });
  filter.paymentSubtype = { $in: subs };
  const docs = await OperationsWorkflow.find(filter)
    .select('reportNumber username paymentDate deliveryDate sellingValue paymentSubtype').lean();
  const keys = [...new Set(docs.map((w) => CollectionsParty.fold(w.username || '')).filter(Boolean))];
  const parties = keys.length
    ? await CollectionsParty.find({ kind: 'customer', nameKey: { $in: keys } })
      .select('_id name code nameKey creditDays collectionOfficer issue').lean()
    : [];
  const byKey = new Map(parties.map((p) => [p.nameKey, p]));
  const today = Math.floor(Date.now() / DAY);
  const out = [];
  for (const w of docs) {
    const p = byKey.get(CollectionsParty.fold(w.username || '')) || null;
    if (officerParties) {
      const id = p ? String(p._id) : '';
      if (officerParties.exclude) { if (id && officerParties.exclude.some((x) => String(x) === id)) continue; }
      else if (!id || !officerParties.some((x) => String(x) === id)) continue;
    }
    const creditDays = Number(p?.creditDays) || 0;
    const basisDate = w.deliveryDate || w.paymentDate || null;
    const dueDate = basisDate && creditDays > 0 ? new Date(new Date(basisDate).getTime() + creditDays * DAY) : null;
    // `$dateDiff` بالأيّام يعدّ حدودَ الأيّام (UTC) — فيُحسب هنا كذلك.
    const daysLate = dueDate ? today - Math.floor(dueDate.getTime() / DAY) : null;
    const dueState = dueDate == null ? 'noterm' : (daysLate <= 0 ? 'within' : 'late');
    out.push({
      _id: w._id,
      invoiceNumber: String(w.reportNumber || ''),
      reportNumber: String(w.reportNumber || ''),
      kind: 'cash',
      source: 'workflow',
      subtype: w.paymentSubtype,
      total: Math.round((Number(w.sellingValue) || 0) * 100) / 100,
      partyName: w.username || '',
      partyCode: p?.code || '',
      party: p?._id || null,
      invoiceDate: w.paymentDate || null,
      deliveryDate: w.deliveryDate || null,
      status: '',
      creditDays,
      officer: p?.collectionOfficer || '',
      issueState: p?.issue?.state || 'none',
      basis: w.deliveryDate ? 'delivery' : 'payment',
      dueDate,
      daysLate,
      dueState,
      lateBand: 'none',
    });
  }
  return out;
}

/**
 * البطاقاتُ الأربع من صفوفها: «آجل - فاتورة» من فواتير الدفتر الضريبيّة
 * (نوعُها من كشوفها — `subtypeOfInvoices`)، والثلاثةُ النقديّة من الكشوف.
 */
async function subtypeRowsFor(q, officerParties, ledgerTaxRows) {
  const nos = ledgerTaxRows.map((r) => r.invoiceNumber);
  const [subOf, cashRows] = await Promise.all([subtypeOfInvoices(nos), cashSubtypeRows(q, officerParties)]);
  const taxRows = ledgerTaxRows
    .map((r) => ({ ...r, subtype: subOf.get(String(r.invoiceNumber || '').trim()) || '' }))
    .filter((r) => TAX_SUBS.includes(r.subtype));
  return [...taxRows, ...cashRows];
}

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

    // ── والأنواعُ الأربعة: مستحقٌّ وغيرُ مستحقّ ─────────────────────────────
    // `baseMatch` قد يحصر الدفترَ في الكاش (`kind=cash`) فلا ضريبيَّ في الصفوف —
    // وبطاقةُ «آجل - فاتورة» تتبعه، كما تتبعه الثلاثةُ النقديّة إن حُصر في الضريبيّ.
    const subRows = await subtypeRowsFor(
      req.query, officerParties, req.query.kind === 'cash' ? [] : rows.filter(tax),
    ).then((list) => (req.query.kind === 'tax' ? list.filter((r) => r.kind === 'tax') : list));
    tree.subtypes = Object.fromEntries(SUBTYPE_KEYS.map((k) => {
      const mine = subRows.filter((r) => r.subtype === k);
      return [k, {
        total: node(mine, () => true),
        due: node(mine, (r) => isDue(r.dueState)),
        notDue: node(mine, (r) => !isDue(r.dueState)),
      }];
    }));

    // ── والتحقّقُ يُرسَل مع الأرقام ──────────────────────────────────────
    // «المفروض الأرقام كلها تكون صح ومتساويه» — فيُحسب الفرقُ هنا ويُعرَض في
    // الشاشة إن وُجد، بدل أن يُكتشَف بجمعٍ باليد.
    const checks = [
      { of: 'الإجمالي = ضريبي + نقدي', diff: tree.all.value - (tree.byKind.tax.value + tree.byKind.cash.value), n: tree.all.count - (tree.byKind.tax.count + tree.byKind.cash.count) },
      // (كان هنا «الضريبي = في موعده + متأخر + بلا مدّة» — قسمُه استُبدل بالأنواع الأربعة.)
      { of: 'المتأخر = ١–٣٠ + ٣١–٦٠ + فوق ٦٠', diff: tree.tax.late.value - (tree.tax.bands.d1_30.value + tree.tax.bands.d31_60.value + tree.tax.bands.d60_plus.value), n: tree.tax.late.count - (tree.tax.bands.d1_30.count + tree.tax.bands.d31_60.count + tree.tax.bands.d60_plus.count) },
      { of: 'فوق ٦٠ = تفاوض + قضايا + غير مصنّف', diff: tree.tax.bands.d60_plus.value - (tree.tax.over60.negotiating.value + tree.tax.over60.legal.value + tree.tax.over60.unclassified.value), n: tree.tax.bands.d60_plus.count - (tree.tax.over60.negotiating.count + tree.tax.over60.legal.count + tree.tax.over60.unclassified.count) },
      // وكلُّ بطاقةٍ من الأربع: نصفاها = جملتُها.
      ...SUBTYPE_KEYS.map((k) => {
        const c = tree.subtypes[k];
        return {
          of: `«${require('../utils/paymentType').PAYMENT_KIND_AR[k]}» = مستحق + غير مستحق`,
          diff: c.total.value - (c.due.value + c.notDue.value),
          n: c.total.count - (c.due.count + c.notDue.count),
        };
      }),
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
    // ── بطاقةٌ من الأنواع الأربعة: `?subtype=<النوع>&due=due|notdue` ──────────
    const subtype = SUBTYPE_KEYS.includes(String(req.query.subtype || '')) ? String(req.query.subtype) : '';
    const dueFilter = ['due', 'notdue'].includes(req.query.due) ? req.query.due : '';
    const keepDue = (r) => !dueFilter || (dueFilter === 'due' ? isDue(r.dueState) : !isDue(r.dueState));
    if (subtype && subtypeFamily(subtype) === 'cash') {
      // الكشوفُ النقديّة: الصفوفُ نفسُها التي عدّتها البطاقة (cashSubtypeRows).
      let list = (await cashSubtypeRows(req.query, officerParties, [subtype])).filter(keepDue);
      if (req.query.party && mongoose.isValidObjectId(String(req.query.party))) {
        list = list.filter((r) => r.party && String(r.party) === String(req.query.party));
      }
      list.sort((a, b) => (b.daysLate ?? -Infinity) - (a.daysLate ?? -Infinity) || b.total - a.total);
      const value = list.reduce((a, r) => a + (r.total || 0), 0);
      return res.json({
        rows: list.slice((page - 1) * limit, page * limit),
        total: list.length,
        value: Math.round(value * 100) / 100,
        page,
        limit,
      });
    }
    const match = baseMatch({ ...req.query, officerParties });
    if (req.query.party && mongoose.isValidObjectId(String(req.query.party))) {
      match.party = new mongoose.Types.ObjectId(String(req.query.party));
    }
    const post = {};
    if (['within', 'late', 'noterm'].includes(req.query.dueState)) post.dueState = req.query.dueState;
    if (['d1_30', 'd31_60', 'd60_plus'].includes(req.query.lateBand)) post.lateBand = req.query.lateBand;
    if (['none', 'negotiating', 'legal'].includes(req.query.issue)) post.issueState = req.query.issue;
    if (subtype) {
      // «آجل - فاتورة»: فواتيرُ الدفتر الضريبيّة التي نوعُ كشوفها هو — يُشتقّ هنا
      // كما اشتُقّ للبطاقة (subtypeOfInvoices)، قبل الترقيم.
      match.kind = 'tax';
      const nos = await CollectionInvoice.distinct('invoiceNumber', match);
      const subOf = await subtypeOfInvoices(nos);
      match.invoiceNumber = { $in: nos.filter((n) => subOf.get(String(n || '').trim()) === subtype) };
      if (dueFilter) post.dueState = dueFilter === 'due' ? { $in: ['late', 'noterm'] } : 'within';
    }

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
exports._subtypeOfInvoices = subtypeOfInvoices;
exports._cashSubtypeRows = cashSubtypeRows;
