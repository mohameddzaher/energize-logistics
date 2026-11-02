/**
 * Analytics endpoint: the operations manager dashboard, live from the database.
 * Reads the branch-report rows (see models/BranchReportRow) and builds every card and chart of the `Dashboard` sheet the operations manager works with, with the same titles and order, using our own numbers (see utils/opsAnalytics).
 * One endpoint for two pages: it is read by operations-private and the shipment-orders dashboard. Computing twice would eventually make a number differ with no answer to which is right. So the computation and filter are here and both pages show what returns.
 */
const BranchReportRow = require('../models/BranchReportRow');
const OpsTarget = require('../models/OpsTarget');
const cache = require('../utils/ttlCache');
const { buildOpsAnalytics, periodTarget } = require('../utils/opsAnalytics');

const S = (v) => String(v ?? '').trim();
const { textIn, normKey } = require('../utils/colFilter');
const DAY = 86400000;

/** A list of filter values, sent comma-separated. */
const multi = (v) => S(v).split(',').map((x) => x.trim()).filter(Boolean);

/** Range: defaults to the current month, which is what the section opens on each morning. `period=all|day|month|quarter|range` as on the operations manager dashboard. */
const resolvePeriod = (q) => {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const p = S(q.period) || (q.from || q.to ? 'range' : 'month');
  if (p === 'range' && (q.from || q.to)) {
    const from = S(q.from) || '2000-01-01';
    const to = S(q.to) || iso(today);
    return { from, to, period: 'range' };
  }
  if (p === 'day') { const d = S(q.day) || iso(today); return { from: d, to: d, period: 'day' }; }
  if (p === 'quarter') {
    const y = Number(S(q.year)) || today.getUTCFullYear();
    const qn = Number(S(q.quarter)) || Math.floor(today.getUTCMonth() / 3) + 1;
    const m0 = (qn - 1) * 3;
    const from = `${y}-${String(m0 + 1).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(y, m0 + 3, 0));
    return { from, to: iso(end), period: 'quarter', quarter: qn, year: y };
  }
  if (p === 'all') return { from: '', to: '', period: 'all' };
  // Month: 'YYYY-MM' or the current one.
  const month = /^\d{4}-\d{2}$/.test(S(q.month)) ? S(q.month) : iso(today).slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const end = new Date(Date.UTC(yy, mm, 0));
  return { from: `${month}-01`, to: iso(end), period: 'month', month };
};

/** GET /analytics - all cards and charts. */
exports.analytics = async (req, res) => {
  try {
    const key = `opsan:${JSON.stringify(req.query || {})}`;
    const per = resolvePeriod(req.query);
    // The opener does not wait for the computation twice. Building the dashboard reads the year's rows (about 15,000), taking seconds over the cluster link. `wrapStale` serves the last built dashboard at once and refreshes it in the background after a minute, so nobody sees a spinner except the first time.
    const body = await cache.wrapStale(key, 60 * 1000, 10 * 60 * 1000, async () => buildBody(per, req.query));
    return res.json(body);
  } catch (e) {
    console.error('opsAnalytics', e);
    return res.status(500).json({ message: 'تعذّر حساب التحليل' });
  }
};

/** Dashboard build, called from `analytics` behind `wrapStale`. */
async function buildBody(per, query) {
  {
    const match = {};
    if (per.from) match.day = { $gte: per.from };
    if (per.to) match.day = { ...(match.day || {}), $lte: per.to };
    for (const [qk, field] of [['branch', 'branch'], ['rentType', 'rentType'], ['payType', 'payType'],
      ['vendorType', 'vendorType'], ['opsRep', 'opsRep'], ['salesRep', 'salesRep'],
      ['client', 'clientName'], ['vendor', 'vendorName']]) {
      const vals = multi(query[qk]);
      // The list shows the value trimmed ('Dammam') but rows also contain 'Dammam ' with a trailing space, so the value becomes a pattern that tolerates any whitespace. See utils/colFilter.
      const c = vals.length ? textIn(field, vals) : null;
      if (c) match[field] = c[field];
    }

    // The whole year is read once, not once for the period and once for the year. Cards are measured over the period while the monthly trend and year achievement use the whole year, so the year's rows (15,000 small rows) are read once and split in the node process instead of two database queries per open.
    const year = (per.from || new Date().toISOString().slice(0, 10)).slice(0, 4);
    const yearMatch = { ...match, day: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } };
    // Partial projection: the computation reads only these row fields, and transferring the rest is a cost with no benefit on a link that delivers about 95 KB/s.
    const [yearRows, target] = await Promise.all([
      BranchReportRow.find(yearMatch).select(
        'day month branch clientName vendorName vendorType opsRep salesRep rentType payType '
        + 'fromCity toCity trips achieved failed failReason sellTotal buyTotal gp sourceFile importedAt',
      ).lean(),
      OpsTarget.findOne({ key: 'ops' }).lean(),
    ]);

    const inPeriod = (r) => (!per.from || r.day >= per.from) && (!per.to || r.day <= per.to);
    const rows = per.period === 'all' ? yearRows : yearRows.filter(inPeriod);

    const days = per.from && per.to
      ? Math.max(1, Math.round((new Date(per.to) - new Date(per.from)) / DAY) + 1)
      : Math.max(1, new Set(rows.map((r) => r.day)).size);

    const ytd = {
      ytdTrips: yearRows.reduce((a, r) => a + (Number(r.achieved) || 0), 0),
      ytdRevenue: Math.round(yearRows.reduce((a, r) => a + (Number(r.sellTotal) || 0), 0) * 100) / 100,
    };
    // The annual target is read once and passed in. `periodTarget` used to receive the document itself, which does not exist until the target is set from the screen, so it read zero and the period target became zero: achievement showed 0% and the gap equaled the full achieved amount. So the target is built first with its defaults, then the period target derived from it.
    const annual = {
      annualTrips: target?.annualTrips ?? 36000,
      annualRevenue: target?.annualRevenue ?? 90000000,
      overrides: target?.overrides || [],
    };
    const t = {
      ...annual,
      ...periodTarget(annual, { from: per.from, to: per.to, days }),
      ...ytd,
    };

    const out = buildOpsAnalytics(rows, { from: per.from, to: per.to, days, target: t });
    // The monthly trend comes from the whole year, not the period; otherwise it would be a single bar.
    out.monthly = buildOpsAnalytics(yearRows, { days: 365, target: t }).monthly;
    out.monthPeak = buildOpsAnalytics(yearRows, { days: 365, target: t }).monthPeak;
    out.source = {
      kind: 'branch_report',
      file: yearRows[0]?.sourceFile || '',
      importedAt: yearRows[0]?.importedAt || null,
      rows: yearRows.length,
    };
    out.periodMeta = per;

    return out;
  }
}

/** GET /analytics/filters - the values to filter by, from the data itself. */
exports.filters = async (req, res) => {
  try {
    const key = 'opsan:filters';
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);
    const [branch, rentType, payType, vendorType, opsRep, salesRep, months] = await Promise.all([
      BranchReportRow.distinct('branch'),
      BranchReportRow.distinct('rentType'),
      BranchReportRow.distinct('payType'),
      BranchReportRow.distinct('vendorType'),
      BranchReportRow.distinct('opsRep'),
      BranchReportRow.distinct('salesRep'),
      BranchReportRow.distinct('month'),
    ]);
    // Spellings that differ only by whitespace are one name; one city used to appear twice.
    const clean = (a) => [...new Set(a.map(normKey).filter(Boolean))].sort();
    const body = {
      branch: clean(branch), rentType: clean(rentType), payType: clean(payType),
      vendorType: clean(vendorType), opsRep: clean(opsRep), salesRep: clean(salesRep),
      months: clean(months).reverse(),
    };
    cache.set(key, body, 5 * 60 * 1000);
    res.json(body);
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

/** GET/PUT /analytics/targets - the year's target, read and written. */
exports.getTargets = async (req, res) => {
  const doc = await OpsTarget.findOne({ key: 'ops' }).lean();
  res.json({ target: doc || { key: 'ops', annualTrips: 36000, annualRevenue: 90000000, overrides: [] } });
};

exports.setTargets = async (req, res) => {
  try {
    const annualTrips = Number(req.body?.annualTrips);
    const annualRevenue = Number(req.body?.annualRevenue);
    if (!Number.isFinite(annualTrips) || annualTrips < 0) return res.status(400).json({ message: 'هدفُ الرحلات غير صالح' });
    if (!Number.isFinite(annualRevenue) || annualRevenue < 0) return res.status(400).json({ message: 'هدفُ المبيعات غير صالح' });
    const doc = await OpsTarget.findOneAndUpdate(
      { key: 'ops' },
      {
        $set: {
          annualTrips, annualRevenue,
          updatedBy: req.user?._id,
          updatedByName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim(),
          ...(Array.isArray(req.body?.overrides) ? { overrides: req.body.overrides.filter((o) => /^\d{4}-\d{2}$/.test(S(o?.month))) } : {}),
        },
      },
      { new: true, upsert: true },
    ).lean();
    cache.clear('opsan:');
    res.json({ target: doc });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};
