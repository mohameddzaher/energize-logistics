/**
 * نقطةُ التحليل — لوحةُ مدير التشغيل، حيّةً من القاعدة.
 *
 * تقرأ صفوفَ «تقرير الفروع» (راجع models/BranchReportRow) وتبني منها كلَّ
 * بطاقةٍ ورسمٍ في ورقة `Dashboard` التي يعمل بها مديرُ التشغيل — بالعناوين
 * نفسِها والترتيب نفسِه، والأرقامُ أرقامُنا (راجع utils/opsAnalytics).
 *
 * ── ولماذا نقطةٌ واحدةٌ لصفحتين ─────────────────────────────────────────────
 * تُقرأ في «التشغيل — خاصّ» وفي «لوحة طلبات الشحنات». ولو حُسبت مرّتين لاختلف
 * رقمٌ بينهما يومًا، فيُسأل أيُّهما الصحيح ولا جواب. فالحسابُ هنا، والفلترُ
 * واحدٌ، والصفحتان تعرضان ما يعود.
 */
const BranchReportRow = require('../models/BranchReportRow');
const OpsTarget = require('../models/OpsTarget');
const cache = require('../utils/ttlCache');
const { buildOpsAnalytics, periodTarget } = require('../utils/opsAnalytics');

const S = (v) => String(v ?? '').trim();
const DAY = 86400000;

/** قائمةُ قيمٍ تُفلتَر بها — تُرسَل مفصولةً بفواصل. */
const multi = (v) => S(v).split(',').map((x) => x.trim()).filter(Boolean);

/**
 * المدى: الافتراضُ الشهرُ الجاري — وهو ما يُفتَح عليه القسم كلَّ صباح.
 * و`period=all|day|month|quarter|range` كما في لوحة مدير التشغيل.
 */
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
  // الشهر: «YYYY-MM» أو الجاري.
  const month = /^\d{4}-\d{2}$/.test(S(q.month)) ? S(q.month) : iso(today).slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const end = new Date(Date.UTC(yy, mm, 0));
  return { from: `${month}-01`, to: iso(end), period: 'month', month };
};

/** GET /analytics — البطاقاتُ والرسومُ كلُّها. */
exports.analytics = async (req, res) => {
  try {
    const key = `opsan:${JSON.stringify(req.query || {})}`;
    const per = resolvePeriod(req.query);
    // ── ولا ينتظر الفاتحُ الحسابَ مرّتين ──────────────────────────────────
    // بناءُ اللوحة يقرأ صفوفَ السنة (خمسةَ عشرَ ألفًا) فيستغرق ثوانيَ على
    // وصلةِ العنقود. و`wrapStale` تُقدّم آخرَ لوحةٍ بُنيت فورًا وتُجدّدها في
    // الخلف إن مضت عليها دقيقة — فلا يرى أحدٌ شاشةً تدور إلّا أوّلَ مرّة.
    const body = await cache.wrapStale(key, 60 * 1000, 10 * 60 * 1000, async () => buildBody(per, req.query));
    return res.json(body);
  } catch (e) {
    console.error('opsAnalytics', e);
    return res.status(500).json({ message: 'تعذّر حساب التحليل' });
  }
};

/** بناءُ اللوحة — يُنادى من `analytics` خلف `wrapStale`. */
async function buildBody(per, query) {
  {
    const match = {};
    if (per.from) match.day = { $gte: per.from };
    if (per.to) match.day = { ...(match.day || {}), $lte: per.to };
    for (const [qk, field] of [['branch', 'branch'], ['rentType', 'rentType'], ['payType', 'payType'],
      ['vendorType', 'vendorType'], ['opsRep', 'opsRep'], ['salesRep', 'salesRep'],
      ['client', 'clientName'], ['vendor', 'vendorName']]) {
      const vals = multi(query[qk]);
      if (vals.length) match[field] = { $in: vals };
    }

    // ── ويُقرأ العامُ كلُّه مرّةً، لا مرّةً للفترة ومرّةً للسنة ─────────────
    // البطاقاتُ تُقاس على الفترة، والاتّجاهُ الشهريُّ وإنجازُ السنة يُقاسان على
    // السنة كلِّها. فتُقرأ صفوفُ السنة قراءةً واحدة (١٥ ألفَ صفٍّ صغير) ويُقسَم
    // في العقدة — بدل استعلامين على القاعدة لكلّ فتحة.
    const year = (per.from || new Date().toISOString().slice(0, 10)).slice(0, 4);
    const yearMatch = { ...match, day: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } };
    // ومشروعٌ جزئيّ: الحسابُ لا يقرأ من الصفّ إلّا هذه الحقول، ونقلُ الباقي
    // ثمنٌ بلا مقابل على وصلةٍ تسلّم نحوَ ٩٥ ك.ب/ث.
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
    // ── والهدفُ السنويُّ يُقرأ مرّةً ويُمرَّر ───────────────────────────────
    // كان `periodTarget` يتلقّى المستندَ نفسَه، وهو غيرُ موجودٍ قبل أن يُضبَط
    // الهدفُ من الشاشة — فيقرأ صفرًا ويُحسَب هدفُ الفترة صفرًا، فتظهر نسبةُ
    // الإنجاز صفرًا والفجوةُ كاملةَ المحقَّق. فيُبنى الهدفُ أوّلًا بافتراضاته،
    // ثمّ يُشتقّ هدفُ الفترة منه.
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
    // والاتّجاهُ الشهريُّ من السنة كلِّها لا من الفترة — وإلّا كان عمودًا واحدًا.
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

/** GET /analytics/filters — القيمُ التي تُفلتَر بها، من البيانات نفسِها. */
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
    const clean = (a) => a.map(S).filter(Boolean).sort();
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

/** GET/PUT /analytics/targets — هدفُ السنة، يُقرأ ويُكتب. */
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
