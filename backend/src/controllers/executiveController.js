/**
 * النظرة التنفيذية — الشركةُ كلُّها في شاشةٍ واحدة، حيّة.
 *
 * ── لماذا أُعيد بناؤها ────────────────────────────────────────────────────────
 * كانت الصفحةُ تنادي ثماني نقاطٍ من المتصفّح، أوّلُها لوحةُ «العملاء والمالية»
 * التي تقرأ `Invoice`/`Payment` — جدولين لا يكتب فيهما أحدٌ منذ زال ذلك القسم
 * — فتعرض أصفارًا، وتُفتح بطاقاتُها على اثنتي عشرة صفحةً حُذفت. وكانت تسمع خمسةَ
 * أحداثٍ من عشرات، فلا تتحرّك لأغلب ما يجري.
 *
 * فصارت نقطةً واحدةً على الخادم تجمع كلَّ قسمٍ من مصدره الحيّ نفسِه — الأرقامُ
 * الماليّةُ من الإدارة الماليّة (نفسُ حمولتها)، والتشغيليّةُ من لوحة كلّ قسم —
 * وكلُّ بطاقةٍ تُفتح على صفحةٍ موجودة. وأيُّ حدثٍ في أيّ قسمٍ يمسح مخزنَها
 * ويبثّ `executive:changed` (websocket/socketManager).
 */
const cache = require('../utils/ttlCache');
const finance = require('./financeController');

const TTL = 60 * 1000;
const { callController } = finance;

const kpi = (ar, en, value, extra = {}) => ({ ar, en, value: value == null || Number.isNaN(Number(value)) ? null : Number(value), format: 'number', ...extra });
const money = (ar, en, value, extra = {}) => kpi(ar, en, value, { format: 'money', ...extra });

const RIYADH = 'Asia/Riyadh';
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

async function build(user) {
  const today = dayKey();
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthDate = new Date(`${monthStart}T00:00:00+03:00`); lastMonthDate.setDate(0);
  const lastMonthEnd = dayKey(lastMonthDate);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  const month = finance.periodOf({ from: monthStart, to: today });

  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const NOT_CANCELLED = { executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] } };
  const inRange = (from, to) => ({ reportDate: { $gte: new Date(`${from}T00:00:00+03:00`), $lte: new Date(`${to}T23:59:59.999+03:00`) } });

  const safe = (p) => Promise.resolve(p).catch((e) => { console.error('executive:', e.message); return null; });
  const [
    fOps, fCol, fFleet, fCustoms, fHr, fVeh, fLight,
    sheetsMonth, sheetsLast, sheetsByBranch, wfStats, walletToday,
    fleetDash, ls2, hr, regOverview, customsYear, duty, crm, sales, proc,
  ] = await Promise.all([
    safe(finance.buildDept('operations', month, user)),
    safe(finance.buildDept('collections', month, user)),
    safe(finance.buildDept('fleet', month, user)),
    safe(finance.buildDept('customs', month, user)),
    safe(finance.buildDept('hr', month, user)),
    safe(finance.buildDept('vehicles', month, user)),
    safe(finance.buildDept('light', month, user)),
    safe(OperationsWorkflow.countDocuments({ ...NOT_CANCELLED, ...inRange(monthStart, today) })),
    safe(OperationsWorkflow.countDocuments({ ...NOT_CANCELLED, ...inRange(lastMonthStart, lastMonthEnd) })),
    safe(OperationsWorkflow.aggregate([{ $match: { ...NOT_CANCELLED, ...inRange(monthStart, today) } }, { $group: { _id: '$branch', n: { $sum: 1 } } }, { $sort: { n: -1 } }])),
    safe(callController('./workflowController', 'getWorkflowStats', {}, user)),
    safe(callController('./walletController', 'getAllBranchesDashboard', { date: today }, user)),
    safe(callController('./fleetController', 'getDashboard', {}, user)),
    safe(callController('./ls2Controller', 'getDashboard', {}, user)),
    safe(callController('./hrController', 'getDashboard', {}, user)),
    safe(callController('./vehicleRegistryController', 'overview', {}, user)),
    safe(callController('./customsClearanceController', 'getAnalytics', { from: `${today.slice(0, 4)}-01`, to: today.slice(0, 7) }, user)),
    safe(callController('./b2cDutyController', 'analytics', {}, user)),
    safe(callController('./crmController', 'getDashboard', {}, user)),
    safe(callController('./salesController', 'getDashboard', {}, user)),
    safe(callController('./procurementController', 'getDashboard', {}, user)),
  ]);

  const card = (dept, key) => (dept?.cards || []).find((c) => c.key === key)?.value ?? null;
  const branches = walletToday?.branches || [];
  const docs = regOverview?.documents || [];
  const expiredDocs = docs.reduce((a, d) => a + (d.states?.expired || 0), 0);
  const trend = sheetsLast ? Math.round(((sheetsMonth - sheetsLast) / sheetsLast) * 100) : null;
  const perfCollected = card(fCol, 'collectedPeriod');

  const sections = [
    {
      key: 'finance', ar: 'الإدارة المالية (هذا الشهر)', en: 'Finance (this month)', color: 'emerald', href: '/system/finance',
      kpis: [
        money('قيمة البيع — التشغيل', 'Operations selling', card(fOps, 'selling'), { href: '/system/finance/operations' }),
        money('هامش التشغيل', 'Operating margin', card(fOps, 'margin'), { tone: 'auto', href: '/system/finance/operations' }),
        money('المستحق على العملاء', 'Receivable', card(fCol, 'ledgerOutstanding'), { tone: 'warn', href: '/system/finance/collections' }),
        money('المحصَّل هذا الشهر', 'Collected this month', perfCollected, { tone: 'good', href: '/system/finance/collections' }),
        money('صافي الأسطول', 'Fleet net', card(fFleet, 'net'), { tone: 'auto', href: '/system/finance/fleet' }),
        money('ربح التخليص', 'Customs profit', card(fCustoms, 'profit'), { tone: 'auto', href: '/system/finance/customs' }),
        money('الرواتب الشهرية', 'Monthly salaries', card(fHr, 'monthly'), { href: '/system/finance/hr' }),
        money('أقساط المركبات', 'Vehicle premiums', card(fVeh, 'vehiclePremiums'), { href: '/system/finance/vehicles' }),
      ],
    },
    {
      key: 'operations', ar: 'التشغيل', en: 'Operations', color: 'orange', href: '/system/operations',
      kpis: [
        kpi('كشوف هذا الشهر', 'Sheets this month', sheetsMonth, { trend, href: '/system/operations' }),
        kpi('كشوف الشهر الماضي', 'Sheets last month', sheetsLast),
        kpi('كشوف بلا فاتورة', 'Sheets awaiting invoice', wfStats?.pendingInvoices, { tone: 'warn', href: '/system/operations' }),
        money('تحصيلات المحافظ اليوم', 'Wallet collections today', branches.reduce((a, b) => a + (b.totalCollections || 0), 0), { tone: 'good', href: '/system/wallet-dashboard' }),
        money('مشتريات المحافظ اليوم', 'Wallet purchases today', branches.reduce((a, b) => a + (b.totalPurchases || 0), 0), { href: '/system/wallet-dashboard' }),
        money('أرصدة المحافظ', 'Wallet balances', branches.reduce((a, b) => a + (b.closingBalance || 0), 0), { tone: 'auto', href: '/system/wallet-dashboard' }),
      ],
      chart: { kind: 'bar', ar: 'كشوف الشهر حسب الفرع', data: (sheetsByBranch || []).map((b) => ({ name: String(b._id || '—').trim(), value: b.n })) },
    },
    {
      key: 'collections', ar: 'التحصيل', en: 'Collections', color: 'indigo', href: '/system/collections-dept/dashboard',
      kpis: [
        money('المستحق (دفتر الأعمار)', 'Outstanding (aging)', card(fCol, 'ledgerOutstanding'), { href: '/system/collections-dept/aging' }),
        money('المتأخّر عن أجله', 'Overdue', card(fCol, 'overdue'), { tone: 'bad', href: '/system/collections-dept/aging' }),
        money('فوق 60 يوم', 'Over 60 days', card(fCol, 'aged60'), { tone: 'bad' }),
        money('المحصَّل هذا الشهر', 'Collected this month', perfCollected, { tone: 'good', href: '/system/collections-dept/ledger' }),
        money('المستحق للموردين', 'Payable to suppliers', card(fCol, 'suppOutstanding'), { href: '/system/collections-dept/suppliers' }),
      ],
      chart: { kind: 'bar', ar: 'أعمار الديون', data: ((fCol?.tables || []).find((t) => t.key === 'agingBands')?.rows || []).map((r) => ({ name: r.band, value: Math.round(r.amount) })) },
    },
    {
      key: 'fleet', ar: 'إدارة الأسطول', en: 'Fleet management', color: 'orange', href: '/system/fleet/board',
      kpis: [
        kpi('شحنات اليوم', 'Loads today', fleetDash?.shipmentsToday, { href: '/system/fleet' }),
        kpi('شحنات الأسبوع', 'Loads this week', fleetDash?.shipmentsWeek, { href: '/system/fleet' }),
        kpi('في الطريق', 'On the way', fleetDash?.byStatus?.on_way, { href: '/system/fleet/board' }),
        kpi('سائقون على رأس العمل', 'Drivers working', fleetDash?.drivers?.working, { href: '/system/fleet/drivers' }),
        kpi('متابعات اليوم', 'Follow-ups today', fleetDash?.followupsToday),
        money('مصروف سائقين غير مصروف', 'Driver expenses unpaid', card(fFleet, 'unpaid'), { tone: 'warn', href: '/system/fleet/driver-expenses' }),
      ],
      chart: { kind: 'bar', ar: 'الشحنات حسب الحالة', data: Object.entries(fleetDash?.byStatus || {}).map(([k, v]) => ({ name: k, value: Number(v) })) },
    },
    {
      key: 'ls2', ar: 'لوكيشن سوليوشن', en: 'Location Solutions', color: 'blue', href: '/system/ls2',
      kpis: [
        kpi('متصل من الأسطول', 'Online', ls2?.fleet?.online, { suffix: ls2?.fleet?.total != null ? ` / ${ls2.fleet.total}` : '', href: '/system/ls2/live' }),
        kpi('تتحرك الآن', 'Moving now', ls2?.fleet?.statusCounts?.moving, { tone: 'good', href: '/system/ls2/live' }),
        kpi('تنبيهات حرجة', 'Critical alerts', ls2?.alerts?.bySeverity?.critical, { tone: 'bad', href: '/system/ls2/alerts' }),
        kpi('صيانة متأخرة', 'Maintenance overdue', ls2?.maintenance?.overdueCount, { tone: 'bad', href: '/system/ls2/maintenance' }),
        kpi('كاوتشات ساخنة', 'Hot tires', ls2?.temperature?.hotTires, { tone: 'warn', href: '/system/ls2/temperature' }),
      ],
      chart: { kind: 'pie', ar: 'حالة الأسطول', data: Object.entries(ls2?.fleet?.statusCounts || {}).map(([k, v]) => ({ name: k, value: Number(v) })) },
    },
    {
      key: 'vehicles', ar: 'المركبات', en: 'Vehicles', color: 'cyan', href: '/system/vehicles/registry/overview',
      kpis: [
        kpi('المركبات', 'Vehicles', regOverview?.totals?.vehicles, { href: '/system/vehicles/registry' }),
        kpi('تحتاج متابعة', 'Need attention', regOverview?.totals?.needsAttention, { tone: 'warn', href: '/system/vehicles/registry/expiring' }),
        kpi('مستندات منتهية', 'Expired documents', expiredDocs, { tone: 'bad', href: '/system/vehicles/registry/expiring' }),
        kpi('مطالبات مفتوحة', 'Open claims', regOverview?.claims?.open, { tone: 'warn', href: '/system/vehicles/registry/claims' }),
        money('تقديرات الحوادث', 'Claim estimates', regOverview?.claims?.estimatedSar, { href: '/system/vehicles/registry/claims' }),
      ],
      chart: { kind: 'bar', ar: 'مستندات تحتاج متابعة', data: docs.map((d) => ({ name: d.ar, value: d.needsAttention || 0 })) },
    },
    {
      key: 'hr', ar: 'الموارد البشرية', en: 'Human resources', color: 'violet', href: '/system/hr/master',
      kpis: [
        kpi('موظفون على رأس العمل', 'Active employees', hr?.summary?.activeEmployees, { href: '/system/hr/employees' }),
        kpi('في إجازة', 'On leave', hr?.summary?.onLeaveCount, { href: '/system/hr/leaves' }),
        kpi('مستندات تنتهي قريبًا', 'Documents expiring', hr?.summary?.expiringDocsCount, { tone: 'warn', href: '/system/hr/master/expiring' }),
        kpi('مستندات منتهية', 'Documents expired', hr?.summary?.expiredDocsCount, { tone: 'bad', href: '/system/hr/master/expiring' }),
        kpi('طلبات إجازة معلّقة', 'Pending leaves', hr?.summary?.pendingLeaves, { href: '/system/hr/leaves' }),
        kpi('تراخيص تنتهي', 'Licences expiring', hr?.summary?.licensesExpiringCount, { tone: 'warn', href: '/system/hr/licenses' }),
      ],
      chart: { kind: 'bar', ar: 'الموظفون حسب القسم', data: (hr?.byDepartment || []).slice(0, 10).map((x) => ({ name: x.name, value: x.count })) },
    },
    {
      key: 'customs', ar: 'التخليص الجمركي (هذه السنة)', en: 'Customs (this year)', color: 'amber', href: '/system/customs/analytics',
      kpis: [
        kpi('المعاملات', 'Files', customsYear?.totals?.clearances, { href: '/system/customs' }),
        kpi('الحاويات', 'Containers', customsYear?.totals?.containers),
        money('الإيراد', 'Revenue', customsYear?.totals?.totalRevenue, { tone: 'good', href: '/system/customs/analytics' }),
        money('صافي الربح', 'Net profit', customsYear?.totals?.netProfit, { tone: 'auto', href: '/system/finance/customs' }),
        kpi('لم تُفوتر', 'Not invoiced', customsYear?.totals?.notInvoiced, { tone: 'warn', href: '/system/customs' }),
      ],
      chart: { kind: 'bar', ar: 'الإيراد شهريًا', data: (customsYear?.byMonth || []).map((x) => ({ name: x.key, value: Math.round(x.revenue || 0) })) },
    },
    {
      key: 'b2c', ar: 'الأفراد (النقل الخفيف)', en: 'B2C (light transport)', color: 'rose', href: '/system/b2c/dashboard',
      kpis: [
        kpi('مناديب تحت الإشراف', 'Supervised riders', duty?.totals?.expected, { href: '/system/b2c/reps' }),
        kpi('تفقّد اليوم', 'Checked today', duty?.totals?.checks, { href: '/system/b2c/duty' }),
        kpi('التزام التفقّد اليوم ٪', 'Check compliance today %', duty?.totals?.compliance, { format: 'pct', tone: 'auto', href: '/system/b2c/duty' }),
        money('أرصدة العُهَد', 'Custody balances', card(fLight, 'custodyBalance'), { href: '/system/b2c/custody' }),
        kpi('مركبات النقل الخفيف', 'Light vehicles', card(fLight, 'bikes')),
      ],
    },
    {
      key: 'commercial', ar: 'العملاء والمبيعات والمشتريات', en: 'CRM, sales & procurement', color: 'slate', href: '/system/crm/dashboard',
      kpis: [
        kpi('الشركات في CRM', 'CRM companies', crm?.companiesTotal, { href: '/system/crm/companies' }),
        money('قيمة الصفقات المفتوحة', 'Open pipeline', crm?.pipelineValue, { href: '/system/crm/deals' }),
        money('مبيعات مكسوبة (الفترة)', 'Won sales (period)', sales?.wonValue, { tone: 'good', href: '/system/sales/dashboard' }),
        kpi('طلبات شراء معلّقة', 'Pending purchase requests', proc?.prPending, { href: '/system/procurement/requests' }),
        money('فواتير موردين غير مدفوعة', 'Unpaid vendor bills', proc?.unpaidBills, { tone: 'warn', href: '/system/procurement/bills' }),
      ],
    },
  ];

  return {
    generatedAt: new Date(),
    sections,
    // قراءةٌ مسطّحة لبطاقات الشاشة الرئيسية في التطبيق (HomeInsight).
    headline: {
      sheetsMonth, receivable: card(fCol, 'ledgerOutstanding'), collectedMonth: perfCollected,
      walletCollectionsToday: branches.reduce((a, b) => a + (b.totalCollections || 0), 0),
      fleetOnline: ls2?.fleet?.online ?? null,
    },
  };
}

exports.overview = async (req, res) => {
  try {
    res.json(await cache.wrap('exec:overview', TTL, () => build(req.user)));
  } catch (e) {
    console.error('executive overview', e);
    res.status(500).json({ message: 'تعذّر تحميل النظرة التنفيذية' });
  }
};
