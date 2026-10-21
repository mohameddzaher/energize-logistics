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
 *     الإجماليُّ = ١–١٥ + ١٦–٣٠ + ٣١–٦٠ + ٦١–٩٠ + أكثرُ من ٩٠ (+ بلا تاريخ)
 *     كلُّ شريحةِ عمر = طبيعي + متوسّط + مرتفع
 *     كلُّ نوعٍ من الأنواع الأربعة = مستحقّ + غيرُ مستحقّ
 * كلُّ عقدةٍ عددٌ وقيمة، وكلُّ عقدةٍ تُفتَح فتُرى صفوفُها — **من الصفوف نفسِها**
 * التي حسبتها (`loadBase()` ثمّ `passes()` أدناه)، فلا يُقرأ رقمٌ ويُفتَح جدولٌ
 * بغيره.
 *
 * ── ومن أيِّ يومٍ يُعَدّ العمرُ والتأخير ─────────────────────────────────────
 * مدّةُ السداد تبدأ من **تاريخ التسليم** لا من تاريخ إصدار الفاتورة — راجع
 * two-delivery-dates: `deliveryDate` في الدفتر هو تسليمُ الفاتورة للعميل.
 * وفاتورةٌ لم تُسلَّم بعدُ: يُعَدّ من إصدارها ويُقال ذلك في الصفّ. وكشفُ الكاش
 * يُعَدّ من التسليم للعميل، وإلّا من تاريخ السداد.
 *
 *   العمرُ       = الأيّامُ منذ ذلك اليوم.
 *   الاستحقاقُ   = ذلك اليوم + مدّةُ العميل (`CollectionsParty.creditDays`).
 *
 * ── والخطورةُ: طبيعي / متوسّط / مرتفع ───────────────────────────────────────
 * قاعدةُ صاحب الشركة (٢٠٢٦/١٠/٢١): لكلّ عميلٍ مدّةٌ «يسدّد خلال N يومًا».
 *
 *   طبيعي   العمرُ ≤ N
 *   متوسّط  N < العمر ≤ N + ٣٠
 *   مرتفع   العمرُ > N + ٣٠
 *
 * (مثالُه: مدّةُ ٣٠ ⇒ طبيعيٌّ حتى ٣٠، ومتوسّطٌ من ٣١ إلى ٦٠، ومرتفعٌ بعد ٦٠.)
 * وعميلٌ بلا مدّةٍ محفوظة (أكثرُ العملاء) تُقاس خطورتُه على **مدّةٍ افتراضيّة
 * ٣٠ يومًا** (`DEFAULT_TERM_DAYS`) — قرارُ صاحب الشركة — وتُعرَض اللوحةُ كم
 * فاتورةً وكم عميلًا يُقاس كذلك، ومنها تُفتَح قائمتُهم لتُكتب مُددُهم.
 *
 * والمدّةُ الافتراضيّةُ للخطورة وحدَها: «مستحقّ / غير مستحقّ» على حاله — ما لا
 * مدّةَ له مستحقٌّ الآن (`noterm`)، لا شيءَ يؤجّله.
 *
 * ── وشرائحُ العمر: خمسٌ بلا تداخل ───────────────────────────────────────────
 *   ١–١٥ (ومعها عمرُ صفرٍ — سُلِّم اليوم)، ١٦–٣٠، ٣١–٦٠، ٦١–٩٠، أكثرُ من ٩٠.
 * وما لا تاريخَ له أصلًا لا عمرَ له، فله خانتُه «بلا تاريخ» — تُجمَع الشرائحُ
 * معها فتساوي الإجماليَّ تمامًا.
 *
 * ── وأنواعُ الدفع الأربعة: مستحقٌّ وغيرُ مستحقّ ──────────────────────────────
 * صاحبُ الشركة (٢٠٢٦/١٠/٢١): أربعُ بطاقات، واحدةٌ لكلّ نوعٍ جديد («آجل -
 * فاتورة»، «آجل - كاش»، «نقدي - 3PL»، «نقدي - HT»)، كلٌّ منها نصفان:
 *
 *   مستحقّ      = تجاوز موعدَه (`late`) **أو بلا مدّةِ سدادٍ محفوظة** (`noterm`).
 *   غيرُ مستحقّ = لم يحِن موعدُه (`within`).
 *
 * و«ضريبي»/«كاش» بلا نوعٍ جديد لا تدخل البطاقاتِ الأربع (قولُ صاحب الشركة).
 * «آجل - فاتورة» من فواتير الدفتر (نوعُها من كشوفها)، والثلاثةُ النقديّة من
 * الكشوف (`cashSubtypeRows`).
 *
 * ── والفلاتر: كلُّ رقمٍ في اللوحة تحتها ──────────────────────────────────────
 * مسؤولُ التحصيل (الفعليّ — راجع utils/collectionsOfficer)، والعميل، ونوعُ الدفع
 * (الستّة)، والاستحقاق، والقضايا. تُطبَّق على الصفوف قبل أيّ عدّ، فتتبعها
 * البطاقاتُ كلُّها وتحملها كلُّ قائمةٍ تُفتَح.
 */
const mongoose = require('mongoose');
const CollectionInvoice = require('../models/CollectionInvoice');
const CollectionsParty = require('../models/CollectionsParty');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { SUBTYPE_KEYS, subtypeFamily, PAYMENT_KIND_AR } = require('../utils/paymentType');
const { collectionsManager, effectiveOfficer, isDefaultOfficer } = require('../utils/collectionsOfficer');

const DAY = 86400000;
const TTL = 30 * 1000;

/** مدّةُ السداد التي تُقاس عليها خطورةُ عميلٍ لا مدّةَ له — قرارُ صاحب الشركة. */
const DEFAULT_TERM_DAYS = 30;
/** عرضُ خانة «متوسّط» بعد المدّة: (N، N+30]. */
const RISK_SPAN_DAYS = 30;
/** شرائحُ العمر — الحدُّ الأعلى شامل، والأولى تضمّ الصفرَ وما دونه. */
const AGE_BANDS = [
  { key: 'd1_15', max: 15, ar: '١ – ١٥ يومًا', en: '1–15 days' },
  { key: 'd16_30', max: 30, ar: '١٦ – ٣٠ يومًا', en: '16–30 days' },
  { key: 'd31_60', max: 60, ar: '٣١ – ٦٠ يومًا', en: '31–60 days' },
  { key: 'd61_90', max: 90, ar: '٦١ – ٩٠ يومًا', en: '61–90 days' },
  { key: 'd91_plus', max: null, ar: 'أكثر من ٩٠ يومًا', en: 'Over 90 days' },
];
const BAND_KEYS = [...AGE_BANDS.map((b) => b.key), 'nodate'];
const RISKS = ['normal', 'medium', 'hard'];
const PAY_KINDS = ['tax', 'cash', ...SUBTYPE_KEYS];
const DUE_STATES = ['within', 'late', 'noterm'];
const ISSUES = ['none', 'negotiating', 'legal'];

const ageBandOf = (age) => {
  if (age == null || Number.isNaN(age)) return 'nodate';
  return AGE_BANDS.find((b) => b.max == null || age <= b.max).key;
};
const termOf = (creditDays) => (Number(creditDays) > 0 ? Number(creditDays) : DEFAULT_TERM_DAYS);
const riskOf = (age, creditDays) => {
  if (age == null || Number.isNaN(age)) return 'nodate';
  const n = termOf(creditDays);
  if (age <= n) return 'normal';
  if (age <= n + RISK_SPAN_DAYS) return 'medium';
  return 'hard';
};

/** الفاتورةُ قائمةٌ ما لم تُحصَّل ولم تكن رقمًا محجوزًا. */
const OUTSTANDING = CollectionInvoice.OPEN;

/**
 * المراحلُ المشتركة: تُضَمّ مدّةُ العميل، ثمّ يُشتقّ الاستحقاقُ والتأخير
 * والعمرُ وحالةُ الخلاف — لكلّ فاتورةٍ في الدفتر.
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
      // بيانُ الحالة ومنذ متى — تقرؤهما صفحةُ «القضايا» وجدولُ المديونيّة.
      issueNote: { $ifNull: ['$_party.issue.note', ''] },
      issueSince: { $ifNull: ['$_party.issue.since', null] },
      // أساسُ العدّ: التسليمُ إن وُجد، وإلّا الإصدار — ويُقال أيُّهما.
      basis: { $cond: [{ $ne: ['$deliveryDate', null] }, 'delivery', 'invoice'] },
      basisDate: { $ifNull: ['$deliveryDate', '$invoiceDate'] },
    },
  },
  {
    $addFields: {
      age: {
        $cond: [{ $eq: ['$basisDate', null] }, null,
          { $dateDiff: { startDate: '$basisDate', endDate: '$$NOW', unit: 'day' } }],
      },
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
      // «بلا مدّة» حالةٌ ثالثةٌ لا تُخفى: لا موعدَ لها فلا تُقال «في موعدها».
      dueState: {
        $switch: {
          branches: [
            { case: { $eq: ['$dueDate', null] }, then: 'noterm' },
            { case: { $lte: ['$daysLate', 0] }, then: 'within' },
          ],
          default: 'late',
        },
      },
      // (شرائحُ التأخير القديمة — تبقى في الجواب لنسخ التطبيق القائمة.)
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

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
/**
 * ما بقي على الصفّ — وهو ما تعدّه اللوحةُ مديونيّة.
 *
 * الفاتورةُ الجزئيّة قائمةٌ حتى تكتمل، لكنّ المطالَبَ به باقيها لا قيمتُها: عميلٌ
 * سدّد ستّين من مئةٍ عليه أربعون. فكلُّ مجموعِ قيمةٍ هنا يجمع هذا لا `total`.
 */
const owed = (r) => (Number(r.total) || 0) - (Number(r.collected) || 0);

// ═══════════════════════════════════════════════════════════════════════════
//  الأنواعُ الأربعة — من أين يُقرأ نوعُ كلّ صفّ
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
 * ونوعُ شحنةٍ نقديّةٍ في الدفتر — من كشفها في سير العمل إن حمل نوعًا نقديًّا.
 * رقمُ الشحنة في دفتر النقديّ هو رقمُ الكشف نفسُه. وما لا كشفَ نقديَّ له بنوعٍ
 * جديد يبقى «كاش».
 */
async function cashSubtypeOfReports(numbers) {
  const list = [...new Set((numbers || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  const docs = await OperationsWorkflow.find({
    reportNumber: { $in: list }, paymentType: 'cash', paymentSubtype: { $in: CASH_SUBS },
    executionStatus: { $nin: CANCELLED_EXEC },
  }).select('reportNumber paymentSubtype').lean();
  for (const d of docs) out.set(String(d.reportNumber || '').trim(), d.paymentSubtype);
  return out;
}

/**
 * كشوفُ الكاش القائمة بأنواعها الثلاثة — من سير العمل لا من الدفتر.
 *
 * الكاشُ صفُّه كشفُ تشغيل، فيُقرأ من الكشوف: **شرطُ صفحة فواتير الكاش نفسُه**
 * (`cashScreenFilter`) وما لم يُحصَّل منه. والقيمةُ قيمةُ البيع (ما تعرضه تلك
 * الصفحة)، والمدّةُ تُعَدّ من **التسليم للعميل** إن كُتب، وإلّا من تاريخ السداد
 * — والاشتقاقُ نفسُه الذي يكتبه `derive()` للدفتر (عمر، موعد، تأخير، حالة).
 */
async function cashSubtypeRows(q = {}, subs = CASH_SUBS) {
  const { cashScreenFilter } = require('./collectionsDeptController');
  // `open`: ما لم يكتمل — والجزئيُّ منه قائمٌ بباقيه (راجع owed).
  const filter = cashScreenFilter({
    collected: 'open',
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  });
  filter.paymentSubtype = { $in: subs };
  const docs = await OperationsWorkflow.find(filter)
    .select('reportNumber username paymentDate deliveryDate sellingValue collectedAmount paymentSubtype').lean();
  const keys = [...new Set(docs.map((w) => CollectionsParty.fold(w.username || '')).filter(Boolean))];
  const parties = keys.length
    ? await CollectionsParty.find({ kind: 'customer', nameKey: { $in: keys } })
      .select('_id name code nameKey creditDays collectionOfficer issue').lean()
    : [];
  const byKey = new Map(parties.map((p) => [p.nameKey, p]));
  const today = Math.floor(Date.now() / DAY);
  return docs.map((w) => {
    const p = byKey.get(CollectionsParty.fold(w.username || '')) || null;
    const creditDays = Number(p?.creditDays) || 0;
    const basisDate = w.deliveryDate || w.paymentDate || null;
    const dueDate = basisDate && creditDays > 0 ? new Date(new Date(basisDate).getTime() + creditDays * DAY) : null;
    // `$dateDiff` بالأيّام يعدّ حدودَ الأيّام (UTC) — فيُحسب هنا كذلك.
    const daysLate = dueDate ? today - Math.floor(dueDate.getTime() / DAY) : null;
    const age = basisDate ? today - Math.floor(new Date(basisDate).getTime() / DAY) : null;
    return {
      _id: w._id,
      invoiceNumber: String(w.reportNumber || ''),
      reportNumber: String(w.reportNumber || ''),
      kind: 'cash',
      source: 'workflow',
      payKind: w.paymentSubtype,
      total: r2(w.sellingValue),
      partyName: w.username || '',
      partyCode: p?.code || '',
      party: p?._id || null,
      invoiceDate: w.paymentDate || null,
      deliveryDate: w.deliveryDate || null,
      status: '',
      creditDays,
      officer: p?.collectionOfficer || '',
      issueState: p?.issue?.state || 'none',
      issueNote: p?.issue?.note || '',
      issueSince: p?.issue?.since || null,
      // كشفٌ لم يكتمل قد يحمل دفعةً جزئيّة — تُطرَح من القيمة في كلّ مجموع (owed).
      collected: r2(w.collectedAmount),
      basis: w.deliveryDate ? 'delivery' : 'payment',
      dueDate,
      daysLate,
      age,
      dueState: dueDate == null ? 'noterm' : (daysLate <= 0 ? 'within' : 'late'),
      lateBand: 'none',
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  الصفوفُ مرّةً واحدة — ثمّ يُعَدّ منها كلُّ شيء
// ═══════════════════════════════════════════════════════════════════════════

/**
 * كلُّ ما تعدّه اللوحة، بلا فلاتر (إلّا مدى التاريخ):
 *   ledger — فواتيرُ الدفتر القائمة بنوعَيه (الإجماليُّ وشرائحُ العمر منها)؛
 *   cashWf — كشوفُ الكاش بأنواعها الثلاثة (بطاقاتُها).
 *
 * ── ولماذا مرّةً واحدة ────────────────────────────────────────────────────
 * القائمُ ألفٌ ونصفُ ألفِ فاتورة؛ حملُها إلى العقدة مرّةً وتصفيتُها هناك أرخصُ
 * من تجميعةٍ على القاعدة لكلّ بطاقةٍ ولكلّ فلتر — ويضمن أنّ البطاقةَ وجدولَها
 * من الصفوف نفسِها. وتُحفَظ ثلاثين ثانيةً بمفتاحٍ لا يحمل إلّا المدى، فتغييرُ
 * الفلاتر لا يعيد القراءة؛ وكلُّ كتابةٍ في القسم تمسح `cdr:` فتعبر العاملَين.
 */
async function loadBase(q = {}) {
  const from = String(q.from || ''); const to = String(q.to || '');
  return cache.wrap(`cdr:base:${from}|${to}`, TTL, async () => {
    const match = { ...OUTSTANDING };
    if (from || to) {
      match.invoiceDate = {};
      if (from) match.invoiceDate.$gte = new Date(from);
      if (to) match.invoiceDate.$lte = new Date(`${to}T23:59:59.999Z`);
    }
    const [ledger, cashWf] = await Promise.all([
      CollectionInvoice.aggregate([
        { $match: match },
        ...derive(),
        {
          $project: {
            invoiceNumber: 1, kind: 1, total: 1, collectedAmount: 1, partyName: 1, partyCode: 1, party: 1,
            invoiceDate: 1, deliveryDate: 1, status: 1,
            creditDays: 1, officer: 1, issueState: 1, issueNote: 1, issueSince: 1, basis: 1, dueDate: 1, daysLate: 1,
            age: 1, dueState: 1, lateBand: 1,
          },
        },
      ]).allowDiskUse(true),
      cashSubtypeRows({ from, to }),
    ]);

    const taxNos = ledger.filter((r) => r.kind === 'tax').map((r) => String(r.invoiceNumber || '').trim());
    const cashNos = ledger.filter((r) => r.kind === 'cash').map((r) => String(r.invoiceNumber || '').trim());
    const { countsFor } = require('./collectionsAttachmentsController');
    const [subOfTax, subOfCash, attTax, attCash, wfOfCash] = await Promise.all([
      subtypeOfInvoices(taxNos),
      cashSubtypeOfReports(cashNos),
      countsFor('tax', taxNos),
      countsFor('cash', cashWf.map((r) => String(r._id))),
      // شحنةُ الدفتر النقديّة رقمُها رقمُ كشفها — ومنه يُفتَح الكشفُ من الجدول.
      cashNos.length
        ? OperationsWorkflow.find({ reportNumber: { $in: [...new Set(cashNos.filter(Boolean))] } }).select('_id reportNumber').lean()
        : [],
    ]);
    const wfIdOf = new Map(wfOfCash.map((w) => [String(w.reportNumber || '').trim(), String(w._id)]));
    // معاملةُ التخليص لكلّ صفّ: الضريبيّةُ بكشوف فاتورتها، والنقديُّ بكشفه.
    const customsLinks = require('../services/customsOpsLink');
    const linked = await customsLinks.linkedIndex();

    for (const r of ledger) {
      const no = String(r.invoiceNumber || '').trim();
      if (r.kind === 'tax') {
        const sub = subOfTax.get(no) || '';
        r.payKind = TAX_SUBS.includes(sub) ? sub : 'tax';
        r.attachments = attTax.get(no) || 0;
      } else {
        r.payKind = subOfCash.get(no) || 'cash';
        r.attachments = null;
        r.workflowId = wfIdOf.get(no) || null;
      }
      r.customs = r.kind === 'tax'
        ? customsLinks.customsOfInvoice(linked, no)
        : [customsLinks.customsOfReport(linked, no)].filter(Boolean);
      r.total = r.total || 0;
      // القائمةُ هنا لم تكتمل — وقد يكون فيها مقبوضٌ جزئيّ يُطرَح من قيمتها.
      r.collected = r2(r.collectedAmount || 0);
      r.ageBand = ageBandOf(r.age);
      r.risk = riskOf(r.age, r.creditDays);
    }
    // الشحنةُ النقديّةُ التي في الدفتر تُعَدّ هناك — فلا تُعَدّ مرّتين في عدّادات الفلاتر.
    const ledgerCash = new Set(cashNos);
    for (const r of cashWf) {
      r.attachments = attCash.get(String(r._id)) || 0;
      r.ageBand = ageBandOf(r.age);
      r.risk = riskOf(r.age, r.creditDays);
      r.inLedger = ledgerCash.has(String(r.reportNumber || '').trim());
      r.customs = [customsLinks.customsOfReport(linked, r.reportNumber)].filter(Boolean);
    }
    return { ledger, cashWf };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  الفلاتر — تُطبَّق على الصفوف قبل أيّ عدّ
// ═══════════════════════════════════════════════════════════════════════════

const listOf = (v) => [].concat(v == null ? [] : v)
  .flatMap((x) => String(x).split(','))
  .map((s) => s.trim())
  .filter(Boolean);

/** مفتاحُ العميل: حسابُه إن رُبط، وإلّا اسمُه مطويًّا. */
const partyKey = (r) => (r.party ? String(r.party) : `n:${CollectionsParty.fold(r.partyName || '')}`);

/**
 * فلاترُ اللوحة من الرابط:
 *   officer=<اسم>,<اسم>   مسؤولُ التحصيل الفعليّ (و`none` القديمة = المدير)
 *   parties=<مفتاح>,…      العميل (معرّفُ الحساب، أو `n:<الاسم مطويًّا>`)
 *   pay=tax,cash,<نوع>…    نوعُ الدفع — القيمُ الستّ
 *   dueState=within,late,noterm   الاستحقاق
 *   issue=none,negotiating,legal  القضايا
 * ومعها القديمان: `party=<معرّف>` (يُضمّ إلى العملاء) و`customer=<اسم>` (بحثٌ بالاسم).
 */
function parseFilters(q = {}, mgr) {
  const officer = new Set(listOf(q.officer).map((v) => (v === 'none' ? (mgr?.name || '') : v).toLowerCase()).filter(Boolean));
  const parties = new Set(listOf(q.parties));
  if (q.party && mongoose.isValidObjectId(String(q.party))) parties.add(String(q.party));
  return {
    officer,
    parties,
    pay: new Set(listOf(q.pay).filter((v) => PAY_KINDS.includes(v))),
    dueState: new Set(listOf(q.dueState).filter((v) => DUE_STATES.includes(v))),
    issue: new Set(listOf(q.issue).filter((v) => ISSUES.includes(v))),
    customerRx: q.customer ? flexSpaceRegex(String(q.customer)) : null,
  };
}

/** يقيس كلَّ بُعدٍ وحدَه — ومنه عدّاداتُ الفلاتر (كلٌّ تحت الأبعاد الأخرى). */
const DIMS = {
  officer: (r, f, mgr) => f.officer.has(effectiveOfficer(r.officer, mgr).toLowerCase()),
  parties: (r, f) => f.parties.has(partyKey(r)),
  pay: (r, f) => f.pay.has(r.payKind),
  dueState: (r, f) => f.dueState.has(r.dueState),
  issue: (r, f) => f.issue.has(r.issueState || 'none'),
};

function passes(r, f, mgr, except = '') {
  for (const [k, test] of Object.entries(DIMS)) {
    if (k === except || !f[k].size) continue;
    if (!test(r, f, mgr)) return false;
  }
  if (f.customerRx && !f.customerRx.test(r.partyName || '')) return false;
  return true;
}

/**
 * عقدةٌ: القيمةُ، والعدد (فواتير ضريبيّة + كشوف تخريج نقديّة — يُعرَضان منفصلين
 * لأنّهما وحدتان لا تُجمعان في الكلام)، وعددُ العملاء.
 */
function node(rows, pick = () => true) {
  let count = 0; let value = 0; let tax = 0; let cash = 0;
  const customers = new Set();
  for (const r of rows) {
    if (!pick(r)) continue;
    count += 1; value += owed(r);
    if (r.kind === 'tax') tax += 1; else cash += 1;
    customers.add(partyKey(r));
  }
  return { count, value: r2(value), customers: customers.size, tax, cash };
}

const check = (of, whole, parts) => {
  const diff = r2(whole.value - parts.reduce((a, p) => a + p.value, 0));
  const n = whole.count - parts.reduce((a, p) => a + p.count, 0);
  return { of, diff, n, ok: Math.abs(diff) < 0.5 && n === 0 };
};

/**
 * GET /api/collections-dept/receivables/overview
 * ?from=&to=&officer=&parties=&pay=&dueState=&issue=   (راجع parseFilters)
 */
exports.overview = async (req, res) => {
  try {
    const q = req.query || {};
    const mgr = await collectionsManager();
    const key = `cdr:ov:${mgr?.name || ''}:${JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]]))}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const base = await loadBase(q);
    const f = parseFilters(q, mgr);
    const L = base.ledger.filter((r) => passes(r, f, mgr));
    const W = base.cashWf.filter((r) => passes(r, f, mgr));
    const tax = (r) => r.kind === 'tax';
    const cash = (r) => r.kind === 'cash';

    const tree = {
      all: node(L),
      byKind: { tax: node(L, tax), cash: node(L, cash) },
      // ── شرائحُ العمر، وفي كلٍّ أجزاؤها الثلاثة ─────────────────────────
      ages: Object.fromEntries(BAND_KEYS.map((b) => {
        const inBand = L.filter((r) => r.ageBand === b);
        return [b, {
          total: node(inBand),
          ...(b === 'nodate' ? {} : Object.fromEntries(RISKS.map((k) => [k, node(inBand, (r) => r.risk === k)]))),
        }];
      })),
      risk: Object.fromEntries(RISKS.map((k) => [k, node(L, (r) => r.risk === k)])),
      // ── وما يقرؤه التطبيقُ القائم (نسخٌ وُزِّعت قبل اللوحة الجديدة) ─────
      tax: {
        within: node(L, (r) => tax(r) && r.dueState === 'within'),
        late: node(L, (r) => tax(r) && r.dueState === 'late'),
        noterm: node(L, (r) => tax(r) && r.dueState === 'noterm'),
        bands: {
          d1_30: node(L, (r) => tax(r) && r.lateBand === 'd1_30'),
          d31_60: node(L, (r) => tax(r) && r.lateBand === 'd31_60'),
          d60_plus: node(L, (r) => tax(r) && r.lateBand === 'd60_plus'),
        },
        // صفحةُ اللوحة القديمة تقرؤه بلا حارس — وتبقى مفتوحةً في ألسنةٍ لم
        // تُحدَّث بعد النشر، فغيابُه يُسقطها («reading 'negotiating'»).
        over60: {
          negotiating: node(L, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'negotiating'),
          legal: node(L, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'legal'),
          unclassified: node(L, (r) => tax(r) && r.lateBand === 'd60_plus' && (r.issueState || 'none') === 'none'),
        },
      },
      cash: {
        within: node(L, (r) => cash(r) && r.dueState === 'within'),
        late: node(L, (r) => cash(r) && r.dueState === 'late'),
        noterm: node(L, (r) => cash(r) && r.dueState === 'noterm'),
      },
    };

    // ── والأنواعُ الأربعة: مستحقٌّ وغيرُ مستحقّ ─────────────────────────────
    tree.subtypes = Object.fromEntries(SUBTYPE_KEYS.map((k) => {
      const mine = (subtypeFamily(k) === 'tax' ? L : W).filter((r) => r.payKind === k);
      return [k, {
        total: node(mine),
        due: node(mine, (r) => isDue(r.dueState)),
        notDue: node(mine, (r) => !isDue(r.dueState)),
      }];
    }));

    // ── «آجل - فاتورة» بلا مرفق ─────────────────────────────────────────
    // الفاتورةُ التي لا صورةَ لها في النظام تُطالَب بلا دليل. ومعها «ضريبي» بلا
    // نوعٍ جديد (أكثرُ الدفتر اليوم) سطرًا ثانيًا، كي لا يُقرأ صفرُ البطاقة
    // «لا شيءَ ناقص» وكلُّ القديم بلا مرفق.
    const attachments = {
      of: node(L, (r) => r.payKind === 'deferred_invoice'),
      missing: node(L, (r) => r.payKind === 'deferred_invoice' && !r.attachments),
      plainTaxMissing: node(L, (r) => r.payKind === 'tax' && !r.attachments),
    };

    // ── ومن يُقاس على المدّة الافتراضيّة ─────────────────────────────────
    const onDefault = L.filter((r) => !(Number(r.creditDays) > 0));
    const dParties = new Map();
    for (const r of onDefault) {
      const k = partyKey(r);
      if (!dParties.has(k)) {
        dParties.set(k, {
          key: k, party: r.party || null, name: r.partyName || '—', code: r.partyCode || '',
          officer: effectiveOfficer(r.officer, mgr), officerIsDefault: isDefaultOfficer(r.officer),
          count: 0, value: 0, tax: 0, cash: 0,
        });
      }
      const g = dParties.get(k);
      g.count += 1; g.value += owed(r); if (r.kind === 'tax') g.tax += 1; else g.cash += 1;
    }
    const defaultTerm = {
      days: DEFAULT_TERM_DAYS,
      ...node(onDefault),
      parties: [...dParties.values()].map((g) => ({ ...g, value: r2(g.value) })).sort((a, b) => b.value - a.value),
    };

    // ── والتحقّقُ يُرسَل مع الأرقام ──────────────────────────────────────
    // «المفروض الأرقام كلها تكون صح ومتساويه» — فيُحسب الفرقُ هنا ويُعرَض في
    // الشاشة إن وُجد، بدل أن يُكتشَف بجمعٍ باليد.
    const ages = tree.ages;
    const checks = [
      check('الإجمالي = ضريبي + نقدي', tree.all, [tree.byKind.tax, tree.byKind.cash]),
      check('الإجمالي = شرائح العمر الخمس + بلا تاريخ', tree.all, BAND_KEYS.map((b) => ages[b].total)),
      ...AGE_BANDS.map((b) => check(`«${b.ar}» = طبيعي + متوسط + مرتفع`, ages[b.key].total, RISKS.map((k) => ages[b.key][k]))),
      check('الإجمالي = طبيعي + متوسط + مرتفع + بلا تاريخ', tree.all, [...RISKS.map((k) => tree.risk[k]), ages.nodate.total]),
      ...SUBTYPE_KEYS.map((k) => {
        const c = tree.subtypes[k];
        return check(`«${PAYMENT_KIND_AR[k]}» = مستحق + غير مستحق`, c.total, [c.due, c.notDue]);
      }),
    ];

    // أثقلُ العملاء — ومن يُفتَح يُفتَح بحسابه.
    const byParty = new Map();
    for (const r of L) {
      const k = partyKey(r);
      if (!byParty.has(k)) {
        byParty.set(k, {
          party: r.party || null, key: k, name: r.partyName || '—', code: r.partyCode || '',
          officer: effectiveOfficer(r.officer, mgr), officerIsDefault: isDefaultOfficer(r.officer),
          issueState: r.issueState || 'none',
          count: 0, value: 0, late: 0, lateValue: 0, hard: 0, hardValue: 0, oldest: null,
        });
      }
      const g = byParty.get(k);
      g.count += 1; g.value += owed(r);
      if (r.dueState === 'late') { g.late += 1; g.lateValue += owed(r); }
      if (r.risk === 'hard') { g.hard += 1; g.hardValue += owed(r); }
      if (r.age != null && (g.oldest == null || r.age > g.oldest)) g.oldest = r.age;
    }
    const parties = [...byParty.values()]
      .map((g) => ({ ...g, value: r2(g.value), lateValue: r2(g.lateValue), hardValue: r2(g.hardValue) }))
      .sort((a, b) => b.value - a.value);

    // وبالمسؤول الفعليّ — لا صفَّ «بلا مسؤول»: ما لم يُسنَد فعلى المدير.
    const byOfficer = new Map();
    for (const r of L) {
      const k = effectiveOfficer(r.officer, mgr) || '—';
      if (!byOfficer.has(k)) {
        byOfficer.set(k, {
          officer: k, isManager: !!mgr && k === mgr.name, defaulted: 0,
          count: 0, value: 0, late: 0, lateValue: 0, hard: 0, hardValue: 0,
        });
      }
      const g = byOfficer.get(k);
      g.count += 1; g.value += owed(r);
      if (isDefaultOfficer(r.officer)) g.defaulted += 1;
      if (r.dueState === 'late') { g.late += 1; g.lateValue += owed(r); }
      if (r.risk === 'hard') { g.hard += 1; g.hardValue += owed(r); }
    }

    // ── عدّاداتُ الفلاتر: كلُّ قائمةٍ تحت الفلاتر الأخرى ───────────────────
    // على ما تعدّه اللوحةُ كلُّه: الدفترُ، وكشوفُ الكاش بأنواعها التي ليست فيه.
    const U = [...base.ledger, ...base.cashWf.filter((r) => !r.inLedger)];
    const facet = (dim, keyOf, labelOf) => {
      const m = new Map();
      for (const r of U) {
        if (!passes(r, f, mgr, dim)) continue;
        const k = keyOf(r);
        if (!m.has(k)) m.set(k, { value: k, label: labelOf(r, k), count: 0, amount: 0 });
        const e = m.get(k); e.count += 1; e.amount += owed(r);
      }
      return m;
    };
    const fixed = (m, keys) => keys.map((k) => ({ value: k, count: m.get(k)?.count || 0, amount: r2(m.get(k)?.amount) }));
    const off = facet('officer', (r) => effectiveOfficer(r.officer, mgr) || '—', (r, k) => k);
    if (mgr?.name && !off.has(mgr.name)) off.set(mgr.name, { value: mgr.name, label: mgr.name, count: 0, amount: 0 });
    const cust = facet('parties', partyKey, (r) => r.partyName || '—');
    const custCode = new Map(U.map((r) => [partyKey(r), r.partyCode || '']));
    const facets = {
      officer: [...off.values()].map((e) => ({ ...e, amount: r2(e.amount), isManager: !!mgr && e.value === mgr.name }))
        .sort((a, b) => b.amount - a.amount),
      parties: [...cust.values()].map((e) => ({ ...e, amount: r2(e.amount), code: custCode.get(e.value) || '' }))
        .sort((a, b) => b.amount - a.amount),
      pay: fixed(facet('pay', (r) => r.payKind, () => ''), PAY_KINDS),
      dueState: fixed(facet('dueState', (r) => r.dueState, () => ''), DUE_STATES),
      issue: fixed(facet('issue', (r) => r.issueState || 'none', () => ''), ISSUES),
    };

    const body = {
      tree,
      checks,
      attachments,
      defaultTerm,
      facets,
      manager: mgr ? { name: mgr.name, email: mgr.email } : null,
      rules: { defaultTermDays: DEFAULT_TERM_DAYS, riskSpanDays: RISK_SPAN_DAYS, bands: AGE_BANDS },
      parties: parties.slice(0, 300),
      officers: [...byOfficer.values()].map((g) => ({
        ...g, value: r2(g.value), lateValue: r2(g.lateValue), hardValue: r2(g.hardValue),
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

// ═══════════════════════════════════════════════════════════════════════════
//  صفوفُ البطاقة — صفحةُ «تفاصيل المديونيّة» وقضاياها
// ═══════════════════════════════════════════════════════════════════════════

const RIYADH = 'Asia/Riyadh';
/** يومُ الرياض «YYYY-MM-DD» — به تُفلتَر أعمدةُ التاريخ كما تُقرأ في الشاشة. */
const ymd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-CA', { timeZone: RIYADH });
};
const ROWS_CAP = 20000;

/**
 * العقدةُ من الرابط — ما يضيّق الصفوفَ فوق فلاتر اللوحة:
 *   kind=tax|cash                      نصفا الإجمالي
 *   subtype=<نوع>&due=due|notdue       نصفُ بطاقةِ نوع
 *   band=<شريحة>&risk=normal|medium|hard   خانةٌ من «عمر التأخير»
 *   attach=missing|missing_tax         «آجل - فاتورة» (أو «ضريبي») بلا مرفق
 *   term=default                       ما يُقاس على المدّة الافتراضيّة
 *   lateBand=d1_30|d31_60|d60_plus     (الشرائحُ القديمة — للروابط المحفوظة)
 */
function nodeOf(q = {}) {
  const subtype = SUBTYPE_KEYS.includes(String(q.subtype || '')) ? String(q.subtype) : '';
  return {
    subtype,
    // بطاقةُ نوعٍ نقديّ: صفوفُها كشوفُ الكاش (cashSubtypeRows)؛ وما عداها الدفتر.
    workflow: !!subtype && subtypeFamily(subtype) === 'cash',
    due: ['due', 'notdue'].includes(q.due) ? q.due : '',
    band: BAND_KEYS.includes(String(q.band || '')) ? String(q.band) : '',
    risk: RISKS.includes(String(q.risk || '')) ? String(q.risk) : '',
    kind: ['tax', 'cash'].includes(q.kind) ? q.kind : '',
    lateBand: ['d1_30', 'd31_60', 'd60_plus'].includes(q.lateBand) ? q.lateBand : '',
    attach: ['missing', 'missing_tax'].includes(q.attach) ? q.attach : '',
    term: q.term === 'default' ? 'default' : '',
  };
}
const inNode = (r, n) => (!n.kind || r.kind === n.kind)
  && (!n.subtype || r.payKind === n.subtype)
  && (!n.due || (n.due === 'due' ? isDue(r.dueState) : !isDue(r.dueState)))
  && (!n.band || r.ageBand === n.band)
  && (!n.risk || r.risk === n.risk)
  && (!n.lateBand || r.lateBand === n.lateBand)
  && (n.attach !== 'missing' || (r.payKind === 'deferred_invoice' && !r.attachments))
  && (n.attach !== 'missing_tax' || (r.payKind === 'tax' && !r.attachments))
  && (n.term !== 'default' || !(Number(r.creditDays) > 0));

/**
 * أعمدةُ الجدول نصًّا — بها يُفلتَر القمعُ (`cf_<عمود>=قيمة`، مكرَّرةً لا
 * مفصولةً بفاصلة: قد تحمل القيمةُ فاصلة) ومنها تُبنى قوائمُه. والنصُّ هو ما
 * يُقرأ في الخانة، فما يُختار هو ما يُرى.
 */
const COLS = {
  number: (r) => String(r.invoiceNumber || ''),
  customer: (r) => r.partyName || '',
  code: (r) => r.partyCode || '',
  officer: (r, mgr) => effectiveOfficer(r.officer, mgr) || '',
  payKind: (r) => r.payKind || '',
  invoiceDate: (r) => ymd(r.invoiceDate),
  deliveryDate: (r) => ymd(r.deliveryDate),
  term: (r) => String(termOf(r.creditDays)),
  termSource: (r) => (Number(r.creditDays) > 0 ? 'customer' : 'default'),
  dueDate: (r) => ymd(r.dueDate),
  ageBand: (r) => r.ageBand || '',
  risk: (r) => r.risk || '',
  dueState: (r) => r.dueState || '',
  issue: (r) => r.issueState || 'none',
  attach: (r) => (r.attachments == null ? '' : (r.attachments > 0 ? 'yes' : 'no')),
};
const colFiltersOf = (q = {}) => {
  const out = {};
  for (const k of Object.keys(COLS)) {
    const v = [].concat(q[`cf_${k}`] == null ? [] : q[`cf_${k}`]).map(String);
    if (v.length) out[k] = new Set(v);
  }
  return out;
};

const RISK_ORDER = { normal: 1, medium: 2, hard: 3, nodate: 0 };
const time = (d) => (d ? new Date(d).getTime() || 0 : null);
/** الفرزُ — كلُّ عمودٍ بقيمته لا بنصّه: التاريخُ بزمنه والمبلغُ برقمه. */
const SORTS = {
  number: (r) => String(r.invoiceNumber || ''),
  customer: (r) => r.partyName || '',
  officer: (r) => r._officer || '',
  payKind: (r) => r.payKind || '',
  invoiceDate: (r) => time(r.invoiceDate),
  deliveryDate: (r) => time(r.deliveryDate),
  term: (r) => termOf(r.creditDays),
  dueDate: (r) => time(r.dueDate),
  age: (r) => r.age,
  daysLate: (r) => r.daysLate,
  total: (r) => r.total || 0,
  collected: (r) => r.collected || 0,
  remaining: (r) => (r.total || 0) - (r.collected || 0),
  risk: (r) => RISK_ORDER[r.risk] ?? 0,
  issue: (r) => r.issueState || 'none',
};

/**
 * صفوفُ العقدة تحت كلِّ فلتر — اللوحةُ، والعقدةُ، والبحثُ، وقموعُ الأعمدة.
 * `exceptCol`: عمودٌ تُبنى قائمتُه فلا يُفلتَر بنفسه (كما يفعل إكسل).
 */
function selectRows(base, q, mgr, exceptCol = '') {
  const f = parseFilters(q, mgr);
  const n = nodeOf(q);
  const cf = colFiltersOf(q);
  const needle = String(q.q || '').trim().toLowerCase();
  const src = n.workflow ? base.cashWf : base.ledger;
  return src.filter((r) => {
    if (!passes(r, f, mgr) || !inNode(r, n)) return false;
    if (needle && ![r.invoiceNumber, r.partyName, r.partyCode].some((v) => String(v || '').toLowerCase().includes(needle))) return false;
    for (const [k, set] of Object.entries(cf)) {
      if (k === exceptCol) continue;
      if (!set.has(COLS[k](r, mgr))) return false;
    }
    return true;
  });
}

const sumOf = (list, pick) => r2(list.reduce((a, r) => a + (pick(r) || 0), 0));

/**
 * GET /api/collections-dept/receivables/rows
 * الصفوفُ نفسُها التي عُدّت، بالفلاتر نفسِها (parseFilters)، ثمّ بالعقدة
 * (nodeOf)، ثمّ بحثٌ `q` وقموعُ الأعمدة `cf_<عمود>`؛
 * &sort=<عمود>&dir=asc|desc&page=&limit=   (`limit=all` للتصدير — حتى ٢٠ ألفًا)
 *
 * والمجاميعُ على النتيجة كلِّها لا على الصفحة المعروضة.
 */
exports.rows = async (req, res) => {
  try {
    const q = req.query || {};
    const page = Math.max(1, Number(q.page) || 1);
    const limit = q.limit === 'all' ? ROWS_CAP : Math.min(500, Math.max(1, Number(q.limit) || 100));
    const mgr = await collectionsManager();
    const base = await loadBase(q);
    const list = selectRows(base, q, mgr);

    // الفرزُ الافتراضيُّ: الأقدمُ أوّلًا ثمّ الأكبر — ما يُطالَب به اليوم.
    const sortKey = SORTS[q.sort] ? q.sort : '';
    if (sortKey) {
      const dir = q.dir === 'asc' ? 1 : -1;
      const get = SORTS[sortKey];
      if (sortKey === 'officer') list.forEach((r) => { r._officer = effectiveOfficer(r.officer, mgr); });
      list.sort((a, b) => {
        const x = get(a); const y = get(b);
        // الفارغُ آخرًا في الاتّجاهين — لا يتصدّر الجدولَ صفٌّ بلا تاريخ.
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'string') return x.localeCompare(y, 'ar') * dir;
        return (x - y) * dir;
      });
    } else {
      list.sort((a, b) => (b.age ?? -Infinity) - (a.age ?? -Infinity) || (b.total || 0) - (a.total || 0));
    }

    const value = sumOf(list, (r) => r.total);
    const collected = sumOf(list, (r) => r.collected);
    const rows = list.slice((page - 1) * limit, page * limit).map((r) => ({
      _id: r._id,
      invoiceNumber: r.invoiceNumber,
      ...(r.reportNumber ? { reportNumber: r.reportNumber } : {}),
      ...(r.source ? { source: r.source } : {}),
      kind: r.kind,
      subtype: SUBTYPE_KEYS.includes(r.payKind) ? r.payKind : '',
      payKind: r.payKind,
      total: r.total,
      collected: r.collected || 0,
      remaining: r2((r.total || 0) - (r.collected || 0)),
      partyName: r.partyName, partyCode: r.partyCode, party: r.party, partyKey: partyKey(r),
      invoiceDate: r.invoiceDate, deliveryDate: r.deliveryDate, status: r.status,
      creditDays: r.creditDays,
      term: termOf(r.creditDays), termIsDefault: !(Number(r.creditDays) > 0),
      officer: effectiveOfficer(r.officer, mgr), officerIsDefault: isDefaultOfficer(r.officer),
      issueState: r.issueState, issueNote: r.issueNote || '', issueSince: r.issueSince || null,
      basis: r.basis, dueDate: r.dueDate, daysLate: r.daysLate,
      dueState: r.dueState, lateBand: r.lateBand,
      age: r.age, ageBand: r.ageBand, risk: r.risk,
      attachments: r.attachments,
      ...(r.workflowId ? { workflowId: r.workflowId } : {}),
      ...(r.customs && r.customs.length ? { customs: r.customs } : {}),
    }));
    // والعددُ بوحدتيه: فواتيرُ ضريبيّة وكشوفُ تخريجٍ نقديّة — قد تجتمعان في شريحة.
    const taxCount = list.filter((r) => r.kind === 'tax').length;
    res.json({
      rows, total: list.length, taxCount, cashCount: list.length - taxCount,
      value, collected, remaining: r2(value - collected),
      customers: new Set(list.map(partyKey)).size,
      page, limit, pages: Math.max(1, Math.ceil(list.length / limit)),
    });
  } catch (e) {
    console.error('receivables rows', e);
    res.status(500).json({ message: 'تعذّر تحميل الصفوف' });
  }
};

/**
 * GET /api/collections-dept/receivables/column-options?col=<عمود>&cq=<بحث>&…
 * قيمُ عمودٍ واحدٍ بأعدادها — تحت كلِّ فلترٍ آخر إلّا قمعَه هو.
 */
exports.columnOptions = async (req, res) => {
  try {
    const q = req.query || {};
    const col = String(q.col || '');
    if (!COLS[col]) return res.status(400).json({ message: 'عمودٌ غير معروف' });
    const mgr = await collectionsManager();
    const base = await loadBase(q);
    const list = selectRows(base, q, mgr, col);
    const m = new Map();
    for (const r of list) { const v = COLS[col](r, mgr); m.set(v, (m.get(v) || 0) + 1); }
    const needle = String(q.cq || '').trim().toLowerCase();
    let values = [...m.entries()].map(([value, count]) => ({ value, count }))
      .filter((o) => !needle || o.value.toLowerCase().includes(needle))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
    const truncated = values.length > 500;
    if (truncated) values = values.slice(0, 500);
    res.json({ values, truncated });
  } catch (e) {
    console.error('receivables column options', e);
    res.status(500).json({ message: 'تعذّر تحميل القيم' });
  }
};

/**
 * GET /api/collections-dept/receivables/cases?state=negotiating,legal&officer=&pay=&dueState=&q=&from=&to=
 *
 * ── «القضايا»: العملاءُ الذين عليهم حالةُ خلاف ─────────────────────────────
 * حالةُ الخلاف صفةُ العميل (`CollectionsParty.issue`) لا الفاتورة، فالصفحةُ
 * تُبنى على العملاء: كلُّ مَن حالتُه «تحت التفاوض» أو «قضايا» — **ولو لم تبقَ
 * عليه فاتورةٌ مفتوحة**: قضيّةٌ قائمةٌ لا تختفي لأنّ الدفترَ سُوِّي.
 *
 * والمبالغُ من صفوف الدفتر نفسِها التي تعدّها اللوحة (`loadBase`) بفلاترها،
 * فالضغطُ على عميلٍ يفتح صفحةَ المديونيّة بـ`parties=<مفتاحه>&issue=<حالته>`
 * فيُرى العددُ والقيمةُ نفساهما.
 */
exports.cases = async (req, res) => {
  try {
    const q = req.query || {};
    const states = listOf(q.state).filter((v) => v === 'negotiating' || v === 'legal');
    const want = states.length ? states : ['negotiating', 'legal'];
    const mgr = await collectionsManager();
    const [base, partyDocs] = await Promise.all([
      loadBase(q),
      CollectionsParty.find({ 'issue.state': { $in: want } })
        .select('name code kind collectionOfficer creditDays issue').lean(),
    ]);
    // الفلاترُ التي تخصّ الصفوف: المسؤولُ ونوعُ الدفع والاستحقاق. والحالةُ
    // والعميلُ يُقرآن هنا لا من الرابط.
    const f = parseFilters({ officer: q.officer, pay: q.pay, dueState: q.dueState }, mgr);
    const rowsFiltered = !!(f.pay.size || f.dueState.size);
    const needle = String(q.q || '').trim().toLowerCase();

    const groups = new Map();
    for (const p of partyDocs) {
      const officer = effectiveOfficer(p.collectionOfficer, mgr);
      if (f.officer.size && !f.officer.has(String(officer || '').toLowerCase())) continue;
      if (needle && ![p.name, p.code].some((v) => String(v || '').toLowerCase().includes(needle))) continue;
      groups.set(String(p._id), {
        party: p._id, key: String(p._id), name: p.name || '—', code: p.code || '', kind: p.kind,
        state: p.issue?.state, note: p.issue?.note || '', since: p.issue?.since || null,
        updatedByName: p.issue?.updatedByName || '',
        officer, officerIsDefault: isDefaultOfficer(p.collectionOfficer),
        creditDays: Number(p.creditDays) || 0, term: termOf(p.creditDays),
        count: 0, tax: 0, cash: 0, value: 0, lateValue: 0, hardValue: 0, oldest: null,
        bands: Object.fromEntries(BAND_KEYS.map((b) => [b, 0])),
      });
    }
    for (const r of base.ledger) {
      const g = r.party && groups.get(String(r.party));
      if (!g || !passes(r, f, mgr)) continue;
      g.count += 1; g.value += owed(r);
      if (r.kind === 'tax') g.tax += 1; else g.cash += 1;
      if (r.dueState === 'late') g.lateValue += owed(r);
      if (r.risk === 'hard') g.hardValue += owed(r);
      g.bands[r.ageBand] = (g.bands[r.ageBand] || 0) + owed(r);
      if (r.age != null && (g.oldest == null || r.age > g.oldest)) g.oldest = r.age;
    }
    const parties = [...groups.values()]
      // تحت فلترِ نوعٍ أو استحقاق: مَن لا صفَّ له فيه خارجُ السؤال.
      .filter((g) => !rowsFiltered || g.count > 0)
      .map((g) => ({
        ...g, value: r2(g.value), lateValue: r2(g.lateValue), hardValue: r2(g.hardValue),
        bands: Object.fromEntries(Object.entries(g.bands).map(([k, v]) => [k, r2(v)])),
      }))
      .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), 'ar'));

    const summary = Object.fromEntries(['negotiating', 'legal'].map((s) => {
      const mine = parties.filter((p) => p.state === s);
      return [s, {
        customers: mine.length,
        count: mine.reduce((a, p) => a + p.count, 0),
        value: r2(mine.reduce((a, p) => a + p.value, 0)),
      }];
    }));
    const officers = [...new Set(partyDocs.map((p) => effectiveOfficer(p.collectionOfficer, mgr)).filter(Boolean))].sort();
    res.json({ parties, summary, officers, manager: mgr ? { name: mgr.name } : null });
  } catch (e) {
    console.error('receivables cases', e);
    res.status(500).json({ message: 'تعذّر تحميل القضايا' });
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
exports._ageBandOf = ageBandOf;
exports._riskOf = riskOf;
exports.DEFAULT_TERM_DAYS = DEFAULT_TERM_DAYS;
exports.AGE_BANDS = AGE_BANDS;
