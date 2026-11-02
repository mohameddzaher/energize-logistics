/**
 * Operations analytics: the cards and charts the operations manager reads daily, replicating the manager's Excel dashboard on live data.
 * Sections: money and trips, targets, reasons for non-fulfilment, month-by-month trend, branches, operations reps, customers and vendors, distributions.
 * A report row is not one trip: `trips` is the order count in the row and `sell` is the price per vehicle. Sales are `sellTotal` and trips are `trips`; summing `sell` or counting rows is silently wrong. See models/BranchReportRow.
 */

const round = (n, d = 2) => {
  const p = 10 ** d;
  return Math.round((Number(n) || 0) * p) / p;
};
const pct = (a, b) => (b ? round((a / b) * 100, 1) : 0);

/** Sum of a field over a set of rows. */
const sum = (rows, k) => round(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));

/**
 * Groups rows by a key and returns them sorted by what matters.
 * Each node: trips, fulfilled, sell, buy, margin and contribution percent of the total.
 */
const groupBy = (rows, key, totals) => {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key] ?? '').trim() || '—';
    if (!m.has(k)) m.set(k, { name: k, trips: 0, achieved: 0, failed: 0, sell: 0, buy: 0, gp: 0 });
    const g = m.get(k);
    g.trips += Number(r.trips) || 0;
    g.achieved += Number(r.achieved) || 0;
    g.failed += Number(r.failed) || 0;
    g.sell += Number(r.sellTotal) || 0;
    g.buy += Number(r.buyTotal) || 0;
    g.gp += Number(r.gp) || 0;
  }
  // Contribution is measured on fulfilled trips, not orders, as in the manager's sheet: a customer who ordered 500 and got 200 contributes 200. Dividing by orders would change the customer and branch ranking from what he reads in his sheet, which quickly destroys trust in the dashboard.
  return [...m.values()].map((g) => ({
    ...g,
    sell: round(g.sell), buy: round(g.buy), gp: round(g.gp),
    tripShare: pct(g.achieved, totals.achieved),
    sellShare: pct(g.sell, totals.sell),
    margin: pct(g.gp, g.sell),
  }));
};

/**
 * The company fleet is not a rep to rank.
 * The company-fleet label is written in the operations rep column for loads run on the company fleet, so it tops the list with a third of the trips and misleads rep comparison. The manager's sheet excludes it explicitly ('Company Fleet excluded'), so it is excluded from the top and bottom cards and kept in the list.
 */
const COMPANY_FLEET = ['شركه تنشيط', 'شركة تنشيط'];

/** Top and bottom node by a measure, excluding what cannot be measured (zero and unknown). */
const peak = (list, by, { excludeFleet = false } = {}) => {
  const real = list.filter((x) => x.name !== '—' && (Number(x[by]) || 0) > 0
    && !(excludeFleet && COMPANY_FLEET.some((f) => x.name.includes(f))));
  if (!real.length) return { highest: null, lowest: null };
  const sorted = [...real].sort((a, b) => b[by] - a[by]);
  return { highest: sorted[0], lowest: sorted[sorted.length - 1] };
};

/**
 * The whole analysis from pre-filtered rows.
 * @param rows `BranchReportRow` rows (or the same shape)
 * @param opts { from, to, days, target: {annualTrips, annualRevenue, periodTrips, periodRevenue}, monthly }
 */
const buildOpsAnalytics = (rows, opts = {}) => {
  const totals = {
    trips: rows.reduce((a, r) => a + (Number(r.trips) || 0), 0),
    achieved: rows.reduce((a, r) => a + (Number(r.achieved) || 0), 0),
    failed: rows.reduce((a, r) => a + (Number(r.failed) || 0), 0),
    sell: sum(rows, 'sellTotal'),
    buy: sum(rows, 'buyTotal'),
  };
  totals.gp = round(totals.sell - totals.buy);
  totals.marginPct = pct(totals.gp, totals.sell);
  totals.achievedPct = pct(totals.achieved, totals.trips);
  totals.failedPct = pct(totals.failed, totals.trips);
  totals.rows = rows.length;

  // Daily average is over the days of the period, not only days with work; dividing by working days would overstate the average, and the target is measured against it, reading as achievement that did not happen.
  const days = Math.max(1, Number(opts.days) || 1);
  totals.avgRevenuePerDay = round(totals.sell / days);
  totals.avgTripsPerDay = round(totals.achieved / days, 1);
  totals.days = days;

  // 2. Targets
  const t = opts.target || {};
  const targets = {
    annualTrips: Number(t.annualTrips) || 0,
    annualRevenue: Number(t.annualRevenue) || 0,
    periodTrips: Number(t.periodTrips) || 0,
    periodRevenue: Number(t.periodRevenue) || 0,
    ytdTrips: Number(t.ytdTrips) || 0,
    ytdRevenue: Number(t.ytdRevenue) || 0,
  };
  targets.tripsGap = round(totals.achieved - targets.periodTrips, 1);
  targets.revenueGap = round(totals.sell - targets.periodRevenue);
  targets.tripsAchievementPct = pct(totals.achieved, targets.periodTrips);
  targets.revenueAchievementPct = pct(totals.sell, targets.periodRevenue);
  targets.annualTripsPct = pct(targets.ytdTrips, targets.annualTrips);
  targets.annualRevenuePct = pct(targets.ytdRevenue, targets.annualRevenue);
  targets.remainingTrips = round(Math.max(0, targets.annualTrips - targets.ytdTrips), 0);
  targets.remainingRevenue = round(Math.max(0, targets.annualRevenue - targets.ytdRevenue));

  // 3. Reasons for non-fulfilment: contribution is of the unfulfilled total, not of all.
  const reasons = groupBy(rows.filter((r) => (Number(r.failed) || 0) > 0 && String(r.failReason || '').trim()), 'failReason', totals)
    .map((g) => ({ name: g.name, failed: g.failed, share: pct(g.failed, totals.failed) }))
    .sort((a, b) => b.failed - a.failed);

  // 4. Month-by-month trend: the current month is excluded from comparison and flagged.
  const byMonthMap = new Map();
  for (const r of rows) {
    const k = r.month || String(r.day || '').slice(0, 7);
    if (!k) continue;
    if (!byMonthMap.has(k)) byMonthMap.set(k, { month: k, trips: 0, achieved: 0, sell: 0, buy: 0 });
    const g = byMonthMap.get(k);
    g.trips += Number(r.trips) || 0;
    g.achieved += Number(r.achieved) || 0;
    g.sell += Number(r.sellTotal) || 0;
    g.buy += Number(r.buyTotal) || 0;
  }
  const nowMonth = new Date().toISOString().slice(0, 7);
  const monthly = [...byMonthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((g) => ({
      ...g, sell: round(g.sell), buy: round(g.buy), gp: round(g.sell - g.buy),
      margin: pct(g.sell - g.buy, g.sell),
      partial: g.month === nowMonth,   // Incomplete month
    }));
  const complete = monthly.filter((m) => !m.partial);
  const monthPeak = {
    bestSell: complete.length ? complete.reduce((a, b) => (b.sell > a.sell ? b : a)) : null,
    worstSell: complete.length ? complete.reduce((a, b) => (b.sell < a.sell ? b : a)) : null,
    bestTrips: complete.length ? complete.reduce((a, b) => (b.achieved > a.achieved ? b : a)) : null,
    worstTrips: complete.length ? complete.reduce((a, b) => (b.achieved < a.achieved ? b : a)) : null,
  };

  const byAch = (a, b) => b.achieved - a.achieved;
  const branches = groupBy(rows, 'branch', totals).sort(byAch);
  const opsReps = groupBy(rows, 'opsRep', totals).sort(byAch);
  const salesReps = groupBy(rows, 'salesRep', totals).sort((a, b) => b.sell - a.sell);
  const clients = groupBy(rows, 'clientName', totals).sort(byAch);
  const vendors = groupBy(rows, 'vendorName', totals).sort(byAch);
  const routes = groupBy(rows.map((r) => ({ ...r, route: `${r.fromCity || '—'} → ${r.toCity || '—'}` })), 'route', totals)
    .sort(byAch);

  // Distributions are over fulfilled trips, not orders. A cancelled order has no rental type or vendor, so over orders 'unrecorded' would be the largest slice, though it is cancelled rather than a real slice.
  const share = (key) => {
    const done = rows.filter((r) => (Number(r.achieved) || 0) > 0);
    const base = done.reduce((a, r) => a + (Number(r.achieved) || 0), 0);
    const m = new Map();
    for (const r of done) {
      const k = String(r[key] ?? '').trim() || '—';
      if (!m.has(k)) m.set(k, { name: k, trips: 0, sell: 0 });
      const g = m.get(k);
      g.trips += Number(r.achieved) || 0;
      g.sell += Number(r.sellTotal) || 0;
    }
    return [...m.values()]
      .map((g) => ({ ...g, sell: round(g.sell), share: pct(g.trips, base) }))
      .sort((a, b) => b.trips - a.trips);
  };

  // Each vendor's percentage is recomputed on its own base once the base is known.
  const rebase = (list, base) => list.map((x) => ({ ...x, tripShare: pct(x.achieved, base) }));
  // Total vendor trips is not all trips. In the manager's sheet the first vendor's contribution is 45.6%, not 33%, because the base is only vendor trips: individual-driver loads and our own fleet are not vendors. So the base is computed from vendor rows only and matches the sheet (660 of 1445 = 45.7%).
  const vendorBase = rows
    .filter((r) => String(r.vendorType || '').trim() === 'مورد')
    .reduce((a, r) => a + (Number(r.achieved) || 0), 0)
    || vendors.filter((c) => c.name !== '—').reduce((a, c) => a + c.achieved, 0);
  const clientBase = clients.filter((c) => c.name !== '—').reduce((a, c) => a + c.achieved, 0);

  return {
    period: { from: opts.from || '', to: opts.to || '', days },
    totals,
    targets,
    reasons,
    mainReason: reasons[0] || null,
    monthly,
    monthPeak,
    branches: { list: branches, byRevenue: peak(branches, 'sell'), byTrips: peak(branches, 'achieved') },
    opsReps: { list: opsReps, byTrips: peak(opsReps, 'achieved', { excludeFleet: true }), fleetExcluded: COMPANY_FLEET[0] },
    salesReps: { list: salesReps, byRevenue: peak(salesReps, 'sell') },
    clients: {
      top: rebase(clients.slice(0, 10), clientBase), count: clients.filter((c) => c.name !== '—').length,
      byTrips: peak(rebase(clients, clientBase), 'achieved'),
      // Of total customer trips: the base is rows with a named customer.
      base: clientBase,
    },
    vendors: {
      top: rebase(vendors.slice(0, 10), vendorBase), count: vendors.filter((c) => c.name !== '—').length,
      byTrips: peak(rebase(vendors, vendorBase), 'achieved'),
      // Vendor contribution base is vendor trips only. Loads on our fleet have no vendor, so dividing by all would show each vendor smaller than in the manager's sheet ('of Total Vendor Trips').
      base: vendorBase,
    },
    routes: routes.slice(0, 15),
    shares: {
      rentType: share('rentType'),
      payType: share('payType'),
      vendorType: share('vendorType'),
    },
  };
};

/**
 * Period target from the annual target, spread over its days.
 * `overrides` for a specific month take precedence over derivation: a target stated for a month beats a computed one.
 */
const periodTarget = (target, { from, to, days }) => {
  const annualTrips = Number(target?.annualTrips) || 0;
  const annualRevenue = Number(target?.annualRevenue) || 0;
  const month = String(from || '').slice(0, 7);
  const ov = (target?.overrides || []).find((o) => o.month === month);
  // Whole month with an override: the override is read as is.
  const sameMonth = month && month === String(to || '').slice(0, 7);
  if (ov && sameMonth) {
    return {
      periodTrips: Number(ov.trips) || round((annualTrips / 365) * days, 0),
      periodRevenue: Number(ov.revenue) || round((annualRevenue / 365) * days),
    };
  }
  return {
    periodTrips: round((annualTrips / 365) * days, 0),
    periodRevenue: round((annualRevenue / 365) * days),
  };
};

module.exports = { buildOpsAnalytics, periodTarget, round, pct, groupBy };
