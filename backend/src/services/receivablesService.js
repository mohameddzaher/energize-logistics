/**
 * Receivables computed from the operations sheets, the single source of truth.
 * sellingValue is owed by the customer and collectionDate marks it collected, the same source the collections section reads.
 * Overdue is measured against each party's own credit term, defaulting to 30 days when none is recorded.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const CollectionsParty = require('../models/CollectionsParty');
const { fold } = require('../models/CollectionsParty');

// A cancelled sheet was never executed and no money arrived, so counting it as debt would record something that does not exist.
const NOT_CANCELLED = {
  executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] },
};

const DEFAULT_TERM_DAYS = 30;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Parses a credit-term code: net_45 gives 45, cash gives 0, anything unreadable gives the default. */
function termDays(paymentTerms) {
  const t = String(paymentTerms || '').trim().toLowerCase();
  if (!t) return DEFAULT_TERM_DAYS;
  if (t === 'cash' || t === 'نقدي') return 0;
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : DEFAULT_TERM_DAYS;
}

/** Credit term per customer, indexed by folded name, from a single read of the whole register. */
async function termsByParty() {
  const rows = await CollectionsParty.find({ kind: 'customer' })
    .select('_id nameKey name paymentTerms creditLimit status phone').lean();
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

/** Home-page figures. The keys match what used to be read from invoices, so the screen is unchanged; only the source changed. */
async function dashboard({ dateFrom, dateTo } = {}) {
  const period = dateMatch(dateFrom, dateTo);
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const inPeriod = Object.keys(period).length ? period : { reportDate: { $gte: monthStart, $lte: now } };

  const [openAgg, periodAgg, yearAgg, parties] = await Promise.all([
    // All receivables: rows with no collection date. Not limited to a range, since the question is the balance, not a period.
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
          // Average days to collect (DSO), computed from actual data rather than a formula.
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

  // Both run in one parallel wave: round-trip latency is about 90 ms and running them sequentially would double it.
  const [overdue, trailingDso] = await Promise.all([
    overdueCount(),
    (periodAgg[0]?.daysCount || 0) ? Promise.resolve(0) : dsoTrend({ months: 12 }).then((t) => t.dso),
  ]);

  return {
    totalOutstanding: r2(openAgg[0]?.total || 0),
    openReports: openAgg[0]?.n || 0,
    monthlyCollected: r2(p.collected),
    monthlyBilled: r2(p.billed),
    yearlyCollected: r2(yearAgg[0]?.total || 0),
    collectionRate: p.billed > 0 ? Math.round((p.collected / p.billed) * 100) : 0,
    // Average days between the sheet and its collection, computed from actual data. When the period has no collections yet (for example the start of a month) zero would read as collected same day, so the trailing 12-month average is used instead.
    dso: p.daysCount ? Math.round(p.daysSum / p.daysCount) : trailingDso,
    overdueCount: overdue,
    customerCount: activeCustomers,
    creditTermDistribution: [...byTerm.entries()].sort((a, b) => a[0] - b[0]).map(([term, count]) => ({ term, count })),
  };
}

/** Aging of receivables in days since the sheet date. */
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

/** Month-by-month trend of average days to collect. */
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
 * Overdue sheets: past their owner's credit term and not collected.
 * Fetching every open sheet into Node and computing there made the request exceed the nginx timeout (502) because of transfer volume. Instead, party names with open sheets are grouped by term and one condition with a branch per term is built, so filtering and paging happen in the database.
 */
async function overdueMatch({ dateFrom, dateTo } = {}) {
  const base = {
    ...NOT_CANCELLED, ...dateMatch(dateFrom, dateTo),
    collectionDate: null, reportDate: { $ne: null }, username: { $nin: [null, ''] },
  };

  const [names, terms] = await Promise.all([
    OperationsWorkflow.aggregate([{ $match: base }, { $group: { _id: '$username' } }]),
    termsByParty(),
  ]);

  // Raw name to term, grouped by term so the condition has one branch per value rather than one per name.
  const byTerm = new Map();
  for (const row of names) {
    const raw = row._id;
    if (!raw) continue;
    const days = termDays(terms.get(fold(raw))?.paymentTerms);
    if (!byTerm.has(days)) byTerm.set(days, []);
    byTerm.get(days).push(raw);
  }

  const now = Date.now();
  const branches = [...byTerm.entries()].map(([days, list]) => ({
    username: { $in: list },
    reportDate: { ...(base.reportDate || {}), $lt: new Date(now - days * 86400000) },
  }));

  // With no branches nothing is overdue, and `$or: []` is a mongo error, so an explicitly impossible condition is returned instead of throwing.
  if (!branches.length) return { match: { _id: null }, terms };
  return { match: { ...base, $or: branches }, terms };
}

async function overdueList({ page = 1, limit = 50, dateFrom, dateTo, sortBy = 'overdueDays' } = {}) {
  const { match, terms } = await overdueMatch({ dateFrom, dateTo });

  const [total, rows, sums] = await Promise.all([
    OperationsWorkflow.countDocuments(match),
    OperationsWorkflow.find(match)
      .select('reportNumber reportDate username sellingValue branch fromLocation toLocation invoiceNumber')
      // Oldest first means most overdue; sorting is done in the database, not in Node.
      .sort(sortBy === 'balance' ? { sellingValue: -1 } : { reportDate: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean(),
    OperationsWorkflow.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$sellingValue', 0] } } } },
    ]),
  ]);

  const now = Date.now();
  const invoices = rows.map((w) => {
    const party = terms.get(fold(w.username));
    const days = termDays(party?.paymentTerms);
    const dueAt = new Date(new Date(w.reportDate).getTime() + days * 86400000);
    return {
      _id: w._id,
      invoiceNumber: w.invoiceNumber || w.reportNumber,
      reportNumber: w.reportNumber,
      customer: { _id: party?._id || null, companyName: party?.name || w.username },
      invoiceDate: w.reportDate,
      dueDate: dueAt,
      overdueDays: Math.floor((now - dueAt.getTime()) / 86400000),
      balance: r2(w.sellingValue),
      branch: w.branch || '',
      route: [w.fromLocation, w.toLocation].filter(Boolean).join(' — '),
      creditTerm: days,
      status: 'overdue',
    };
  });

  return {
    invoices,
    total,
    page: Number(page),
    pages: Math.max(1, Math.ceil(total / Number(limit))),
    totalBalance: r2(sums[0]?.total || 0),
  };
}

async function overdueCount(opts = {}) {
  const { match } = await overdueMatch(opts);
  return OperationsWorkflow.countDocuments(match);
}

/**
 * Credit alerts: parties over or near their limit.
 * The limit lives on the party record and the balance is computed from sheets. A party with no limit is not alerted: zero means not set, not forbidden.
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
