/**
 * المستحقّ — محسوبًا من كشوف التشغيل، وهي المستندُ الوحيد.
 *
 * ── لماذا هذا الملفّ ───────────────────────────────────────────────────────
 * كانت الصفحةُ الرئيسة وصفحتا «الفواتير المتأخّرة» و«تنبيهات الائتمان» تقرأ من
 * `Invoice` و`Payment` و`Customer` — جداولِ ورك فلو «العملاء والمالية» الذي
 * زال. فبقيت تعرض أصفارًا لا لأنّ الشركة لا تُحصّل، بل لأنّها تسأل جدولًا لا
 * يكتب فيه أحد.
 *
 * والمصدرُ الحيّ هو الكشف: `sellingValue` مستحقٌّ على العميل، و`collectionDate`
 * هو ما يقول إنّه حُصِّل. وهو المصدرُ نفسُه الذي يقرأ منه قسمُ التحصيل — فلا
 * تقول الرئيسةُ رقمًا ويقول القسمُ غيرَه.
 *
 * ── والتأخّرُ يُقاس بشروط الطرف ────────────────────────────────────────────
 * «متأخّر» ليست عمرًا مطلقًا: عميلٌ شرطُه تسعون يومًا لم يتأخّر في اليوم
 * الأربعين. فتُقرأ مهلتُه من سجلّه في قسم التحصيل، وتُستعمل ثلاثون يومًا لمن
 * لا شرطَ مكتوبًا له.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const CollectionsParty = require('../models/CollectionsParty');
const { fold } = require('../models/CollectionsParty');

// الكشفُ الملغى لم يُنفَّذ ولم يصل عنه مال — فعدُّه دَينًا يقيّد ما لا وجودَ له.
const NOT_CANCELLED = {
  executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] },
};

const DEFAULT_TERM_DAYS = 30;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** «net_45» → 45 · «cash» → 0 · ما لا يُقرأ → الافتراضيّ. */
function termDays(paymentTerms) {
  const t = String(paymentTerms || '').trim().toLowerCase();
  if (!t) return DEFAULT_TERM_DAYS;
  if (t === 'cash' || t === 'نقدي') return 0;
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : DEFAULT_TERM_DAYS;
}

/** مهلةُ كلّ عميلٍ مفهرسةً بالاسم المطويّ — قراءةٌ واحدةٌ للسجلّ كلِّه. */
async function termsByParty() {
  const rows = await CollectionsParty.find({ kind: 'customer' })
    .select('nameKey name paymentTerms creditLimit status phone').lean();
  const map = new Map();
  for (const p of rows) map.set(p.nameKey || fold(p.name), p);
  return map;
}

const dateMatch = (from, to) => {
  if (!from && !to) return {};
  const r = {};
  if (from) r.$gte = new Date(from);
  if (to) r.$lte = new Date(new Date(to).getTime() + 86400000 - 1);
  return { reportDate: r };
};

/**
 * أرقامُ الصفحة الرئيسة.
 *
 * المفاتيحُ هي هي التي كانت تُقرأ من الفواتير، فالشاشةُ لا تتغيّر — المصدرُ
 * وحدَه هو الذي تغيّر.
 */
async function dashboard({ dateFrom, dateTo } = {}) {
  const period = dateMatch(dateFrom, dateTo);
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const inPeriod = Object.keys(period).length ? period : { reportDate: { $gte: monthStart, $lte: now } };

  const [openAgg, periodAgg, yearAgg, parties] = await Promise.all([
    // المستحقُّ كلُّه: ما لا تاريخَ تحصيلٍ له. لا يُقيَّد بمدًى — «كم لنا عند
    // الناس» سؤالٌ عن الرصيد لا عن فترة.
    OperationsWorkflow.aggregate([
      { $match: { ...NOT_CANCELLED, collectionDate: null, username: { $nin: [null, ''] } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$sellingValue', 0] } }, n: { $sum: 1 } } },
    ]),
    OperationsWorkflow.aggregate([
      { $match: { ...NOT_CANCELLED, ...inPeriod } },
      {
        $group: {
          _id: null,
          billed: { $sum: { $ifNull: ['$sellingValue', 0] } },
          collected: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
          // متوسّطُ أيّام التحصيل — DSO محسوبًا من الواقع لا من معادلة.
          daysSum: {
            $sum: {
              $cond: [
                { $and: [{ $ifNull: ['$collectionDate', false] }, { $ifNull: ['$reportDate', false] }] },
                { $divide: [{ $subtract: ['$collectionDate', '$reportDate'] }, 86400000] },
                0,
              ],
            },
          },
          daysCount: {
            $sum: { $cond: [{ $and: [{ $ifNull: ['$collectionDate', false] }, { $ifNull: ['$reportDate', false] }] }, 1, 0] },
          },
        },
      },
    ]),
    OperationsWorkflow.aggregate([
      { $match: { ...NOT_CANCELLED, collectionDate: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$sellingValue', 0] } } } },
    ]),
    CollectionsParty.aggregate([
      { $match: { kind: 'customer' } },
      { $group: { _id: { active: '$isActive', terms: '$paymentTerms' }, n: { $sum: 1 } } },
    ]),
  ]);

  const p = periodAgg[0] || { billed: 0, collected: 0, daysSum: 0, daysCount: 0 };
  const activeCustomers = parties.filter((x) => x._id.active !== false).reduce((a, b) => a + b.n, 0);

  const byTerm = new Map();
  for (const row of parties) {
    if (row._id.active === false) continue;
    const t = termDays(row._id.terms);
    byTerm.set(t, (byTerm.get(t) || 0) + row.n);
  }

  const overdue = await overdueCount();
  const trailingDso = (periodAgg[0]?.daysCount || 0) ? 0 : (await dsoTrend({ months: 12 })).dso;

  return {
    totalOutstanding: r2(openAgg[0]?.total || 0),
    openReports: openAgg[0]?.n || 0,
    monthlyCollected: r2(p.collected),
    monthlyBilled: r2(p.billed),
    yearlyCollected: r2(yearAgg[0]?.total || 0),
    collectionRate: p.billed > 0 ? Math.round((p.collected / p.billed) * 100) : 0,
    // ── متوسّطُ الأيّام بين الكشف وتحصيله ────────────────────────────────
    // محسوبٌ من الواقع لا مقدَّرٌ بمعادلة. وحين لا يكون في الفترة تحصيلٌ بعد
    // (أوّلُ الشهر مثلًا) لا يُقال «صفر» — صفرٌ يُقرأ «نحصّل في يومه»، وهو
    // عكسُ الحقيقة تمامًا. يُؤخَذ متوسّطُ الاثني عشر شهرًا الأخيرة.
    dso: p.daysCount ? Math.round(p.daysSum / p.daysCount) : trailingDso,
    overdueCount: overdue,
    customerCount: activeCustomers,
    creditTermDistribution: [...byTerm.entries()].sort((a, b) => a[0] - b[0]).map(([term, count]) => ({ term, count })),
  };
}

/** تقادمُ المستحقّ بالأيّام منذ تاريخ الكشف. */
async function aging({ dateFrom, dateTo } = {}) {
  const [row] = await OperationsWorkflow.aggregate([
    {
      $match: {
        ...NOT_CANCELLED, ...dateMatch(dateFrom, dateTo),
        collectionDate: null, reportDate: { $ne: null }, username: { $nin: [null, ''] },
      },
    },
    { $addFields: { ageDays: { $divide: [{ $subtract: ['$$NOW', '$reportDate'] }, 86400000] } } },
    {
      $group: {
        _id: null,
        b0: { $sum: { $cond: [{ $lte: ['$ageDays', 15] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
        b1: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 15] }, { $lte: ['$ageDays', 30] }] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
        b2: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 30] }, { $lte: ['$ageDays', 60] }] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
        b3: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 60] }, { $lte: ['$ageDays', 90] }] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
        b4: { $sum: { $cond: [{ $gt: ['$ageDays', 90] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
        c0: { $sum: { $cond: [{ $lte: ['$ageDays', 15] }, 1, 0] } },
        c1: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 15] }, { $lte: ['$ageDays', 30] }] }, 1, 0] } },
        c2: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 30] }, { $lte: ['$ageDays', 60] }] }, 1, 0] } },
        c3: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 60] }, { $lte: ['$ageDays', 90] }] }, 1, 0] } },
        c4: { $sum: { $cond: [{ $gt: ['$ageDays', 90] }, 1, 0] } },
      },
    },
  ]);
  const a = row || {};
  const buckets = [
    { label: '0-15', amount: r2(a.b0), count: a.c0 || 0 },
    { label: '15-30', amount: r2(a.b1), count: a.c1 || 0 },
    { label: '30-60', amount: r2(a.b2), count: a.c2 || 0 },
    { label: '60-90', amount: r2(a.b3), count: a.c3 || 0 },
    { label: '90+', amount: r2(a.b4), count: a.c4 || 0 },
  ];
  return { buckets, total: r2(buckets.reduce((s, b) => s + b.amount, 0)) };
}

/** اتّجاهُ متوسّط أيّام التحصيل، شهرًا بشهر. */
async function dsoTrend({ months = 12 } = {}) {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const rows = await OperationsWorkflow.aggregate([
    { $match: { ...NOT_CANCELLED, collectionDate: { $gte: since }, reportDate: { $ne: null } } },
    {
      $group: {
        _id: { $dateToString: { date: '$collectionDate', format: '%Y-%m', timezone: 'Asia/Riyadh' } },
        daysSum: { $sum: { $divide: [{ $subtract: ['$collectionDate', '$reportDate'] }, 86400000] } },
        n: { $sum: 1 },
        collected: { $sum: { $ifNull: ['$sellingValue', 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const trend = rows.map((m) => ({
    month: m._id,
    dso: m.n ? Math.round(m.daysSum / m.n) : 0,
    collected: r2(m.collected),
    reports: m.n,
  }));
  const all = trend.reduce((a, b) => ({ d: a.d + b.dso * b.reports, n: a.n + b.reports }), { d: 0, n: 0 });
  return { dso: all.n ? Math.round(all.d / all.n) : 0, trend };
}

/**
 * الكشوفُ المتأخّرة — تجاوزت مهلةَ صاحبها ولم تُحصَّل.
 *
 * تُبنى الصفوفُ بشكل الصفحة القديمة (رقمٌ، عميل، تاريخ، استحقاق، أيّام، رصيد)
 * حتى لا تُعاد كتابةُ الشاشة، والمصدرُ وحدَه هو الذي تغيّر.
 */
async function overdueList({ page = 1, limit = 50, dateFrom, dateTo, sortBy = 'overdueDays' } = {}) {
  const terms = await termsByParty();
  const rows = await OperationsWorkflow.find({
    ...NOT_CANCELLED, ...dateMatch(dateFrom, dateTo),
    collectionDate: null, reportDate: { $ne: null }, username: { $nin: [null, ''] },
  })
    .select('reportNumber reportDate username sellingValue branch fromLocation toLocation invoiceNumber')
    .lean();

  const now = Date.now();
  const mapped = [];
  for (const w of rows) {
    const party = terms.get(fold(w.username));
    const days = termDays(party?.paymentTerms);
    const due = new Date(new Date(w.reportDate).getTime() + days * 86400000);
    const overdueDays = Math.floor((now - due.getTime()) / 86400000);
    if (overdueDays <= 0) continue; // داخلَ مهلته — ليس متأخّرًا
    mapped.push({
      _id: w._id,
      invoiceNumber: w.invoiceNumber || w.reportNumber,
      reportNumber: w.reportNumber,
      customer: { _id: null, companyName: party?.name || w.username },
      invoiceDate: w.reportDate,
      dueDate: due,
      overdueDays,
      balance: r2(w.sellingValue),
      branch: w.branch || '',
      route: [w.fromLocation, w.toLocation].filter(Boolean).join(' — '),
      creditTerm: days,
      status: 'overdue',
    });
  }

  mapped.sort((a, b) => (sortBy === 'balance' ? b.balance - a.balance : b.overdueDays - a.overdueDays));
  const total = mapped.length;
  const start = (Number(page) - 1) * Number(limit);
  return {
    invoices: mapped.slice(start, start + Number(limit)),
    total,
    page: Number(page),
    pages: Math.max(1, Math.ceil(total / Number(limit))),
    totalBalance: r2(mapped.reduce((s, m) => s + m.balance, 0)),
  };
}

async function overdueCount() {
  const { total } = await overdueList({ page: 1, limit: 1 });
  return total;
}

/**
 * تنبيهاتُ الائتمان — مَن تجاوز حدَّه أو قاربه.
 *
 * الحدُّ مكتوبٌ في سجلّ الطرف، والمستحقُّ محسوبٌ من الكشوف. ومَن لا حدَّ له لا
 * يُنبَّه عليه: صفرٌ يعني «لم يُحدَّد» لا «ممنوع».
 */
async function creditAlerts() {
  const [parties, byCustomer] = await Promise.all([
    CollectionsParty.find({ kind: 'customer', isActive: true, creditLimit: { $gt: 0 } })
      .select('name nameKey creditLimit paymentTerms status phone').lean(),
    OperationsWorkflow.aggregate([
      { $match: { ...NOT_CANCELLED, collectionDate: null, username: { $nin: [null, ''] } } },
      { $group: { _id: '$username', outstanding: { $sum: { $ifNull: ['$sellingValue', 0] } }, reports: { $sum: 1 } } },
    ]),
  ]);

  const due = new Map();
  for (const row of byCustomer) {
    const k = fold(row._id);
    if (!k) continue;
    const cur = due.get(k) || { outstanding: 0, reports: 0 };
    cur.outstanding += row.outstanding;
    cur.reports += row.reports;
    due.set(k, cur);
  }

  const alerts = parties.map((p) => {
    const d = due.get(p.nameKey || fold(p.name)) || { outstanding: 0, reports: 0 };
    const usage = p.creditLimit > 0 ? Math.round((d.outstanding / p.creditLimit) * 100) : 0;
    return {
      _id: p._id,
      companyName: p.name,
      creditLimit: r2(p.creditLimit),
      currentOutstanding: r2(d.outstanding),
      remaining: r2(p.creditLimit - d.outstanding),
      usagePercent: usage,
      openReports: d.reports,
      creditTerm: termDays(p.paymentTerms),
      clientStatus: p.status || '',
      phone: p.phone || '',
    };
  })
    .filter((a) => a.usagePercent >= 80)
    .sort((a, b) => b.usagePercent - a.usagePercent);

  return {
    alerts,
    total: alerts.length,
    breached: alerts.filter((a) => a.usagePercent >= 100).length,
  };
}

module.exports = { dashboard, aging, dsoTrend, overdueList, overdueCount, creditAlerts, termDays, NOT_CANCELLED };
