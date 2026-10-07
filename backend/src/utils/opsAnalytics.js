/**
 * تحليلُ التشغيل — البطاقاتُ والرسومُ التي يقرؤها مديرُ التشغيل كلَّ يوم.
 *
 * ── من أين جاءت هذه الأسئلةُ بعينها ────────────────────────────────────────
 * مديرُ التشغيل بنى لنفسه لوحةً في إكسل (ورقةُ `Dashboard` في تقرير الفروع)
 * وعمل بها شهورًا. فهي ليست تخميننا لما يحتاجه: هي ما يحتاجه فعلًا، بعنوانه
 * وترتيبه. فنُقلت كما هي وبُنيت على بياناتنا الحيّة:
 *
 *   ① المال والرحلات: بيعٌ وشراءٌ وهامشٌ ونسبتُه · طلباتٌ ومحقَّقٌ وغيرُ محقَّق
 *   ② الأهداف: هدفُ السنة، وهدفُ الفترة مشتقًّا، والفجوةُ ونسبةُ الإنجاز
 *   ③ أسبابُ عدم التحقيق — ومساهمةُ كلّ سبب
 *   ④ الاتّجاهُ شهرًا بشهر (والشهرُ الجاري يُستثنى: ناقصٌ فيُقرأ هبوطًا)
 *   ⑤ الفروع: أعلاها وأدناها، وجدولُها كاملًا بالهامش
 *   ⑥ مناديبُ التشغيل: أعلاهم وأدناهم، وقائمتُهم
 *   ⑦ العملاءُ والموردون: الأعلى، وأعلى عشرة بمساهمة كلٍّ
 *   ⑧ التوزيعات: نوعُ الإيجار، ودفعُ العميل، ونوعُ المورد
 *
 * ── وصفُّ التقرير ليس رحلةً واحدة ──────────────────────────────────────────
 * `trips` عددُ الطلبات في الصفّ، و`sell` سعرُ العربة الواحدة. فالمبيعاتُ
 * `sellTotal` (المضروب) والرحلاتُ `trips` — ومن جمع `sell` أو عدَّ الصفوف أخطأ
 * خطأً لا يُعلن عن نفسه. راجع models/BranchReportRow.
 */

const round = (n, d = 2) => {
  const p = 10 ** d;
  return Math.round((Number(n) || 0) * p) / p;
};
const pct = (a, b) => (b ? round((a / b) * 100, 1) : 0);

/** مجموعُ حقلٍ على مجموعةٍ من الصفوف. */
const sum = (rows, k) => round(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));

/**
 * يجمع الصفوفَ على مفتاحٍ ويُعيدها مرتَّبةً بما يهمّ.
 * كلُّ عقدةٍ: رحلاتٌ ومحقَّقٌ وبيعٌ وشراءٌ وهامشٌ ونسبةُ مساهمةٍ من الإجماليّ.
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
  // ── والمساهمةُ تُقاس على المحقَّق ──────────────────────────────────────────
  // الورقةُ التي يعمل بها مديرُ التشغيل تقيس كلَّ مساهمةٍ على **الرحلات
  // المحقَّقة** لا على الطلبات: العميلُ الذي طلب خمسَ مئةٍ وأُنجز له مئتان
  // مساهمتُه مئتان. ولو قُسِم على الطلبات لتبدّل ترتيبُ العملاء والفروع عمّا
  // يقرؤه في ورقته — وهو أوّلُ ما يُفقِد الثقةَ في لوحة.
  return [...m.values()].map((g) => ({
    ...g,
    sell: round(g.sell), buy: round(g.buy), gp: round(g.gp),
    tripShare: pct(g.achieved, totals.achieved),
    sellShare: pct(g.sell, totals.sell),
    margin: pct(g.gp, g.sell),
  }));
};

/**
 * ── وأسطولُ الشركة ليس مندوبًا يُقاس ─────────────────────────────────────────
 * «شركه تنشيط» تُكتب في عمود مندوب التشغيل لما يُشغَّل بأسطول الشركة، فتتصدّر
 * القائمةَ بثلث الرحلات ويقرأ من يقارن المناديبَ أنّ أعلاهم ليس أحدًا منهم.
 * وورقةُ مدير التشغيل تستثنيها صراحةً («Company Fleet excluded»)، فتُستثنى
 * هنا من بطاقتَي الأعلى والأدنى — وتبقى في القائمة كما هي.
 */
const COMPANY_FLEET = ['شركه تنشيط', 'شركة تنشيط'];

/** أعلى وأدنى عقدةٍ بمقياسٍ — مع استثناء ما لا يُقاس (الصفرُ والمجهول). */
const peak = (list, by, { excludeFleet = false } = {}) => {
  const real = list.filter((x) => x.name !== '—' && (Number(x[by]) || 0) > 0
    && !(excludeFleet && COMPANY_FLEET.some((f) => x.name.includes(f))));
  if (!real.length) return { highest: null, lowest: null };
  const sorted = [...real].sort((a, b) => b[by] - a[by]);
  return { highest: sorted[0], lowest: sorted[sorted.length - 1] };
};

/**
 * التحليلُ كلُّه من صفوفٍ مُصفّاةٍ سلفًا.
 * @param rows صفوفُ `BranchReportRow` (أو ما يُطابق شكلَها)
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

  // ── المتوسّطُ اليوميُّ على أيّام الفترة لا على الأيّام التي فيها عمل ──────
  // لو قُسِم على الأيّام العاملة وحدَها بدا المتوسّطُ أعلى ممّا هو، ويُقاس
  // عليه الهدفُ فيُقرأ إنجازٌ لم يحدث.
  const days = Math.max(1, Number(opts.days) || 1);
  totals.avgRevenuePerDay = round(totals.sell / days);
  totals.avgTripsPerDay = round(totals.achieved / days, 1);
  totals.days = days;

  // ② الأهداف
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

  // ③ أسبابُ عدم التحقيق — المساهمةُ من **غير المحقَّق** لا من الكلّ.
  const reasons = groupBy(rows.filter((r) => (Number(r.failed) || 0) > 0 && String(r.failReason || '').trim()), 'failReason', totals)
    .map((g) => ({ name: g.name, failed: g.failed, share: pct(g.failed, totals.failed) }))
    .sort((a, b) => b.failed - a.failed);

  // ④ الاتّجاهُ شهرًا بشهر — والشهرُ الجاري يُستثنى من المقارنة ويُقال.
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
      partial: g.month === nowMonth,   // شهرٌ غيرُ مكتمل
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

  // ── والتوزيعاتُ على **المحقَّق** لا على الطلبات ──────────────────────────
  // الطلبُ الملغى لا نوعَ إيجارٍ له ولا موردًا، فلو قُسِمت على الطلبات صارت
  // «غير مسجَّل ٤٣٪» أكبرَ شريحةٍ في الرسم — وهي ليست شريحةً بل ملغًى.
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

  // ونسبةُ كلّ موردٍ تُعاد على أساسه هو — بعد أن عُرِف الأساس.
  const rebase = (list, base) => list.map((x) => ({ ...x, tripShare: pct(x.achieved, base) }));
  // ── و«إجماليُّ رحلات الموردين» ليس كلَّ الرحلات ──────────────────────────
  // في ورقة مدير التشغيل مساهمةُ المورد الأوّل ٤٥٫٦٪ لا ٣٣٪ — لأنّ الأساسَ
  // رحلاتُ **الموردين** وحدَهم: ما شُغِّل بسائقٍ فرديٍّ ليس موردًا، وما شُغِّل
  // بأسطولنا ليس موردًا. فيُحسَب الأساسُ من صفوفِ «مورد» وحدَها، ويُطابق
  // الورقةَ (٦٦٠ من ١٤٤٥ = ٤٥٫٧٪).
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
      // «من إجماليّ رحلات العملاء» — الأساسُ ما له عميلٌ مسمّى.
      base: clientBase,
    },
    vendors: {
      top: rebase(vendors.slice(0, 10), vendorBase), count: vendors.filter((c) => c.name !== '—').length,
      byTrips: peak(rebase(vendors, vendorBase), 'achieved'),
      // ── وأساسُ مساهمةِ المورد رحلاتُ الموردين وحدَها ────────────────────
      // ما شُغِّل بأسطولنا لا موردَ له، فلو قُسِم على الكلّ بدت مساهمةُ كلّ
      // موردٍ أصغرَ ممّا هي في ورقة مدير التشغيل («of Total Vendor Trips»).
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
 * هدفُ الفترة من الهدف السنويّ: موزَّعًا على أيّامها.
 * و`overrides` لشهرٍ بعينه تسبق الاشتقاق — هدفٌ يُقال لشهرٍ أولى من حسابٍ عنه.
 */
const periodTarget = (target, { from, to, days }) => {
  const annualTrips = Number(target?.annualTrips) || 0;
  const annualRevenue = Number(target?.annualRevenue) || 0;
  const month = String(from || '').slice(0, 7);
  const ov = (target?.overrides || []).find((o) => o.month === month);
  // الشهرُ كاملًا ومعه تخصيصٌ: يُقرأ التخصيصُ كما هو.
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
