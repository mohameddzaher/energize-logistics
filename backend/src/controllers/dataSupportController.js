/**
 * Data & Decision Support: one analysis page per company section.
 * Figures are not recomputed where a section already computes them: each section's own analytics handler is called
 * in-process (financeController.callController) and its result reshaped into cards, charts and tables, so a number
 * here always equals the number on the section's own screen. Only what no section computes (workflow sheets by month,
 * HR movement over a period) is aggregated here from the models.
 * Every block names its source endpoint (`sources`) so a reader can trace any figure back.
 * Cached under `exec:dss:` so the executive invalidation (any section event) clears it too.
 */
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');
const { callController, periodOf } = require('./financeController');

const FRESH = 60 * 1000;
const MAX = 15 * 60 * 1000;
const C = (name) => `../controllers/${name}`;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
const card = (key, ar, en, value, extra = {}) => ({ key, ar, en, value: value == null ? null : num(value), format: 'number', ...extra });
const col = (key, ar, en, format = 'text') => ({ key, ar, en, format });
const table = (key, ar, en, columns, rows, extra = {}) => ({ key, ar, en, columns, rows: rows || [], ...extra });
const series = (key, ar, en, format = 'number') => ({ key, ar, en, format });
const chart = (key, ar, en, kind, s, rows, extra = {}) => ({ key, ar, en, kind, x: 'label', series: s, rows: rows || [], ...extra });
const src = (ar, en, endpoint) => ({ ar, en, endpoint });
const nameOf = (r) => r?.name ?? r?.key ?? r?.reason ?? r?._id ?? '—';
const WEEKDAYS_AR = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const NOT_CANCELLED = { executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] } };

// Shipment figure columns as the shipments analytics returns them (shipmentInsightsController.figures).
const FIG_COLS = [
  col('orders', 'الشحنات', 'Orders', 'number'),
  col('live', 'القائمة', 'Live', 'number'),
  col('cancelled', 'الملغاة', 'Cancelled', 'number'),
  col('cancelRate', 'نسبة الإلغاء', 'Cancel rate', 'pct'),
  col('sell', 'قيمة البيع', 'Selling', 'money'),
  col('buy', 'قيمة الشراء', 'Purchase', 'money'),
  col('margin', 'الهامش', 'Margin', 'money'),
  col('marginPct', 'نسبة الهامش', 'Margin %', 'pct'),
];
const figRow = (r) => ({
  name: nameOf(r), orders: num(r.orders), live: num(r.live), cancelled: num(r.cancelled), cancelRate: r2(r.cancelRate),
  sell: r2(r.sell), buy: r2(r.buy), margin: r2(r.margin), marginPct: r.marginPct == null ? null : r2(r.marginPct), share: r2(r.share),
});

/** Workflow sheets (operations register): no section groups them by month, so they are aggregated here with the same match as finance operations. */
async function workflowSheets(p) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const inPeriod = { $or: [{ reportDate: { $gte: p.fromDate, $lte: p.toDate } }, { reportDate: null, createdAt: { $gte: p.fromDate, $lte: p.toDate } }] };
  const branchMatch = p.branch === '__blank__' ? { branch: { $in: ['', null] } } : p.branch ? { branch: p.branch } : {};
  const match = { ...NOT_CANCELLED, ...inPeriod, ...branchMatch };
  const acc = {
    sheets: { $sum: 1 },
    selling: { $sum: { $ifNull: ['$sellingValue', 0] } },
    purchase: { $sum: { $ifNull: ['$purchaseValue', 0] } },
    collected: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
  };
  const day = { $ifNull: ['$reportDate', '$createdAt'] };
  const [byMonth, byBranch] = await Promise.all([
    OperationsWorkflow.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: day, timezone: 'Asia/Riyadh' } }, ...acc } }, { $sort: { _id: 1 } }]),
    OperationsWorkflow.aggregate([{ $match: match }, { $group: { _id: '$branch', ...acc } }, { $sort: { selling: -1 } }]),
  ]);
  const shape = (r) => ({ name: r._id || '—', label: r._id || '—', sheets: r.sheets, selling: r2(r.selling), purchase: r2(r.purchase), margin: r2(r.selling - r.purchase), collected: r2(r.collected) });
  return { byMonth: byMonth.map(shape), byBranch: byBranch.map(shape) };
}
const SHEET_COLS = [
  col('sheets', 'أوامر النقل', 'Sheets', 'number'), col('selling', 'قيمة البيع', 'Selling', 'money'),
  col('purchase', 'قيمة الشراء', 'Purchase', 'money'), col('margin', 'الهامش', 'Margin', 'money'),
  col('collected', 'المحصَّل', 'Collected', 'money'),
];

// Operations: shipments
async function operations(p) {
  const q = { from: p.from, to: p.to, ...(p.branch ? { f_branch: p.branch } : {}) };
  const [ins, opts, sheets] = await Promise.all([
    callController(C('shipmentInsightsController'), 'insights', q),
    callController(C('shipmentInsightsController'), 'options', { from: p.from, to: p.to }),
    workflowSheets(p),
  ]);
  const t = ins?.totals || {};
  const prev = ins?.previous || {};
  const rq = ins?.requests || {};
  const branchOptions = (opts?.options?.branch || []).map((o) => ({ value: o.value, label: `${o.value === '__blank__' ? 'بلا فرع' : o.value} (${o.count})` }));
  return {
    branchOptions,
    cards: [
      card('orders', 'الشحنات', 'Shipments', t.orders, { prev: prev.orders, href: '/system/shipment-orders' }),
      card('live', 'القائمة (غير الملغاة)', 'Live', t.live, { prev: prev.live }),
      card('cancelRate', 'نسبة الإلغاء', 'Cancel rate', t.cancelRate, { format: 'pct', prev: prev.cancelRate, tone: num(t.cancelRate) > 10 ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('sell', 'قيمة البيع', 'Selling value', t.sell, { format: 'money', prev: prev.sell, tone: 'good' }),
      card('buy', 'قيمة الشراء', 'Purchase value', t.buy, { format: 'money', prev: prev.buy, tone: 'bad', lowerIsBetter: true }),
      card('margin', 'الهامش', 'Margin', t.margin, { format: 'money', prev: prev.margin, tone: num(t.margin) >= 0 ? 'good' : 'bad' }),
      card('marginPct', 'نسبة الهامش', 'Margin %', t.marginPct, { format: 'pct', prev: prev.marginPct }),
      card('customers', 'العملاء النشطون', 'Active customers', t.customers, { prev: prev.customers }),
      card('suppliers', 'الموردون النشطون', 'Active suppliers', t.suppliers),
      card('routes', 'المسارات', 'Routes', t.routes),
      card('losing', 'شحنات بخسارة', 'Loss-making shipments', t.losing, { tone: num(t.losing) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('fulfilment', 'نسبة تلبية طلبات المبيعات', 'Sales-request fulfilment', rq.fulfilment, { format: 'pct', href: '/system/shipment-orders/requests' }),
      card('sheets', 'أوامر النقل (سير العمل)', 'Workflow sheets', sheets.byMonth.reduce((a, r) => a + r.sheets, 0), { href: '/system/operations' }),
    ],
    charts: [
      chart('volume', 'حجم الشحنات عبر الفترة', 'Shipment volume over time', 'bar',
        [series('live', 'القائمة', 'Live'), series('cancelled', 'الملغاة', 'Cancelled')],
        (ins?.trend || []).map((r) => ({ label: r.key, live: num(r.live), cancelled: num(r.cancelled) })), { stacked: true }),
      chart('money', 'البيع والشراء والهامش', 'Selling, purchase and margin', 'line',
        [series('sell', 'البيع', 'Selling', 'money'), series('buy', 'الشراء', 'Purchase', 'money'), series('margin', 'الهامش', 'Margin', 'money')],
        (ins?.trend || []).map((r) => ({ label: r.key, sell: r2(r.sell), buy: r2(r.buy), margin: r2(r.margin) }))),
      chart('requests', 'طلبات المبيعات يوميًّا', 'Sales requests per day', 'bar',
        [series('trucks', 'الشاحنات المطلوبة', 'Trucks asked'), series('placed', 'المُسنَدة', 'Placed'), series('rejected', 'المرفوضة', 'Rejected')],
        (rq.trend || []).map((r) => ({ label: r.day, trucks: num(r.trucks), placed: num(r.placed), rejected: num(r.rejected) }))),
      chart('weekday', 'الشحنات حسب يوم الأسبوع', 'Shipments by weekday', 'bar',
        [series('orders', 'الشحنات', 'Orders')],
        (ins?.weekday || []).map((r) => ({ label: WEEKDAYS_AR[num(r.day ?? r.key)] || '—', orders: num(r.orders) }))),
    ],
    tables: [
      table('branches', 'ترتيب الفروع', 'Branches ranking', [col('name', 'الفرع', 'Branch'), ...FIG_COLS, col('share', 'الحصة', 'Share', 'pct')], (ins?.branches || []).map(figRow)),
      table('customers', 'ترتيب العملاء', 'Customers ranking',
        [col('name', 'العميل', 'Customer'), col('grade', 'التصنيف', 'Grade'), col('trend', 'الاتجاه', 'Trend'), ...FIG_COLS, col('share', 'الحصة', 'Share', 'pct'), col('last', 'آخر شحنة', 'Last', 'date')],
        (ins?.customers || []).map((r) => ({ ...figRow(r), grade: r.grade || '', trend: ({ up: 'صاعد', down: 'هابط', new: 'جديد', stopped: 'متوقّف', steady: 'ثابت' })[r.trend] || r.trend || '', last: r.last }))),
      table('routes', 'ترتيب المسارات', 'Routes ranking', [col('name', 'المسار', 'Route'), ...FIG_COLS], (ins?.routes || []).map(figRow)),
      table('suppliers', 'ترتيب الموردين', 'Suppliers ranking', [col('name', 'المورّد', 'Supplier'), ...FIG_COLS, col('share', 'الحصة', 'Share', 'pct')], (ins?.suppliers || []).map(figRow)),
      table('salesReps', 'مناديب المبيعات', 'Sales reps', [col('name', 'المندوب', 'Rep'), ...FIG_COLS], (ins?.salesReps || []).map(figRow)),
      table('truckTypes', 'أنواع الشاحنات', 'Truck types', [col('name', 'النوع', 'Type'), ...FIG_COLS], (ins?.truckTypes || []).map(figRow)),
      table('cancelReasons', 'أسباب الإلغاء', 'Cancel reasons', [col('name', 'السبب', 'Reason'), col('n', 'العدد', 'Count', 'number')],
        (ins?.cancelReasons || []).map((r) => ({ name: nameOf(r) || 'بلا سبب', n: num(r.n ?? r.count) }))),
      table('requestsBySales', 'طلبات المبيعات حسب المندوب', 'Sales requests by rep',
        [col('name', 'المندوب', 'Rep'), col('requests', 'الطلبات', 'Requests', 'number'), col('trucks', 'الشاحنات', 'Trucks', 'number'), col('placed', 'المُسنَدة', 'Placed', 'number'), col('rejected', 'المرفوضة', 'Rejected', 'number'), col('fulfilment', 'نسبة التلبية', 'Fulfilment', 'pct')],
        (rq.bySales || []).map((r) => ({ name: nameOf(r), requests: num(r.requests), trucks: num(r.trucks), placed: num(r.placed), rejected: num(r.rejected), fulfilment: r2(r.fulfilment) }))),
      table('rejectReasons', 'أسباب رفض الطلبات', 'Request reject reasons', [col('name', 'السبب', 'Reason'), col('n', 'العدد', 'Count', 'number')],
        (rq.reasons || []).map((r) => ({ name: nameOf(r), n: num(r.count ?? r.n) }))),
      table('sheetsByBranch', 'أوامر النقل (سير العمل) حسب الفرع', 'Workflow sheets by branch', [col('name', 'الفرع', 'Branch'), ...SHEET_COLS], sheets.byBranch),
      table('sheetsByMonth', 'أوامر النقل (سير العمل) حسب الشهر', 'Workflow sheets by month', [col('name', 'الشهر', 'Month'), ...SHEET_COLS], sheets.byMonth),
    ],
    notes: [
      { ar: 'الشحنات تُؤرَّخ بتاريخ التحميل، وتُقارَن بفترةٍ سابقةٍ بنفس الطول.', en: 'Shipments are dated by pickup and compared with the previous span of the same length.' },
    ],
    sources: [
      src('تحليلات الشحنات', 'Shipment analytics', 'GET /api/shipment-orders/insights'),
      src('سير عمل التشغيل', 'Operations workflow', 'operationsworkflows (reportDate, sellingValue, purchaseValue)'),
    ],
  };
}

// Heavy transport: fleet loads + LS2 telemetry
async function heavy(p) {
  const q = { from: p.from, to: p.to };
  const [loads, kpis, dash, ls2] = await Promise.all([
    callController(C('fleetController'), 'getLoadsAnalysis', { ...q, limit: 1 }),
    callController(C('fleetController'), 'getDriverKpis', q),
    callController(C('fleetController'), 'getDashboard', {}),
    callController(C('ls2Controller'), 'getDashboard', q),
  ]);
  const t = loads?.totals || {};
  const s = kpis?.summary || {};
  const loadCols = [col('loads', 'الحمولات', 'Loads', 'number'), col('income', 'الدخل', 'Income', 'money'), col('driverExpense', 'مصاريف السائقين', 'Driver expense', 'money'), col('net', 'الصافي', 'Net', 'money')];
  const loadRow = (r, name) => ({ name, loads: num(r.loads), income: r2(r.income), driverExpense: r2(r.driverExpense), net: r2(num(r.income) - num(r.driverExpense)) });
  return {
    cards: [
      card('loads', 'الحمولات', 'Loads', t.loads, { href: '/system/fleet' }),
      card('income', 'دخل الحمولات', 'Load income', t.income, { format: 'money', tone: 'good' }),
      card('driverExpense', 'مصاريف السائقين', 'Driver expense', t.driverExpense, { format: 'money', tone: 'bad', lowerIsBetter: true }),
      card('net', 'الصافي', 'Net', t.net, { format: 'money' }),
      card('avgIncome', 'متوسط دخل الحمولة', 'Avg income per load', t.avgIncome, { format: 'money' }),
      card('activeDrivers', 'السائقون العاملون في الفترة', 'Active drivers', s.activeDrivers, { href: '/system/fleet/driver-kpis' }),
      card('avgScore', 'متوسط تقييم السائقين', 'Avg driver score', s.averageScore),
      card('lateTrips', 'رحلات متأخرة', 'Late trips', s.lateTrips, { tone: num(s.lateTrips) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('vehicles', 'شاحناتنا', 'Our trucks', dash?.vehicles?.total, { href: '/system/fleet/vehicles' }),
      card('noDriver', 'شاحنات بلا سائق', 'Trucks without driver', dash?.vehicles?.withNoDriver, { tone: num(dash?.vehicles?.withNoDriver) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('tracked', 'المركبات المتتبَّعة (GPS)', 'Tracked units (GPS)', ls2?.fleet?.total, { href: '/system/ls2/live' }),
      card('alerts', 'تنبيهات مفتوحة', 'Open alerts', ls2?.alerts?.totalOpen, { tone: num(ls2?.alerts?.totalOpen) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('overdue', 'صيانة متأخرة', 'Overdue maintenance', ls2?.maintenance?.overdueCount, { tone: num(ls2?.maintenance?.overdueCount) ? 'bad' : 'neutral', lowerIsBetter: true }),
      card('km', 'المسافة المقطوعة (كم)', 'Distance (km)', ls2?.distance?.totalKm),
    ],
    charts: [
      chart('loadsByDay', 'الحمولات والدخل يوميًّا', 'Loads and income per day', 'line',
        [series('income', 'الدخل', 'Income', 'money'), series('driverExpense', 'مصاريف السائقين', 'Driver expense', 'money')],
        (loads?.byDay || []).map((r) => ({ label: r.day, income: r2(r.income), driverExpense: r2(r.driverExpense) }))),
      chart('loadsCount', 'عدد الحمولات يوميًّا', 'Loads per day', 'bar', [series('loads', 'الحمولات', 'Loads')],
        (loads?.byDay || []).map((r) => ({ label: r.day, loads: num(r.loads) }))),
      chart('topMovers', 'أكثر المركبات قطعًا للمسافة', 'Top movers (km)', 'bar', [series('km', 'كم', 'km')],
        (ls2?.distance?.topMovers || []).slice(0, 15).map((r) => ({ label: r.plate || String(r.unitId), km: num(r.km) }))),
    ],
    tables: [
      table('byVehicle', 'ترتيب الشاحنات', 'Trucks ranking', [col('name', 'اللوحة', 'Plate'), ...loadCols], (loads?.byVehicle || []).map((r) => loadRow(r, r.plate || '—'))),
      table('byDriver', 'ترتيب السائقين (حمولات)', 'Drivers ranking (loads)', [col('name', 'السائق', 'Driver'), ...loadCols], (loads?.byDriver || []).map((r) => loadRow(r, nameOf(r)))),
      table('byCustomer', 'عملاء الأسطول', 'Fleet customers', [col('name', 'العميل', 'Customer'), ...loadCols], (loads?.byCustomer || []).map((r) => loadRow(r, nameOf(r)))),
      table('bySupervisor', 'المشرفون', 'Supervisors', [col('name', 'المشرف', 'Supervisor'), ...loadCols], (loads?.bySupervisor || []).map((r) => loadRow(r, nameOf(r)))),
      table('driverKpis', 'تقييم السائقين', 'Driver scorecard',
        [col('name', 'السائق', 'Driver'), col('plate', 'الشاحنة', 'Truck'), col('score', 'التقييم', 'Score', 'number'), col('trips', 'الرحلات', 'Trips', 'number'),
          col('income', 'الدخل', 'Income', 'money'), col('onTimeRate', 'الالتزام بالوقت', 'On time', 'pct'), col('completionRate', 'الإنجاز', 'Completion', 'pct'), col('followUpRate', 'المتابعة', 'Follow-up', 'pct'), col('targetPct', 'تحقيق الهدف', 'Target', 'pct')],
        (kpis?.items || []).map((r) => ({ name: r.name, plate: r.vehicle?.plate || '', score: num(r.score), trips: num(r.trips), income: r2(r.income), onTimeRate: r2(r.onTimeRate), completionRate: r2(r.completionRate), followUpRate: r2(r.followUpRate), targetPct: r2(r.targetPct) }))
          .sort((a, b) => b.score - a.score)),
      table('maintenance', 'أقرب الصيانات', 'Nearest services',
        [col('name', 'اللوحة', 'Plate'), col('driver', 'السائق', 'Driver'), col('kmToService', 'المتبقي للصيانة (كم)', 'Km to service', 'number'), col('odometerKm', 'العدّاد', 'Odometer', 'number')],
        (ls2?.maintenance?.nearest || []).map((r) => ({ name: r.plate || String(r.unitId), driver: r.driver || '', kmToService: num(r.kmToService), odometerKm: num(r.odometerKm) }))),
    ],
    notes: [
      { ar: 'الحمولات من إدارة الأسطول (شاحناتنا)، والقياسات من نظام التتبّع (لوكيشن سوليوشن). تحليلُ موردي النقل الثقيل في صفحة الموردين.', en: 'Loads come from Fleet Management (our trucks), telemetry from Location Solutions. Heavy-transport carriers are on the vendors page.' },
    ],
    sources: [
      src('تحليل الحمولات', 'Loads analysis', 'GET /api/fleet (getLoadsAnalysis)'),
      src('تقييم السائقين', 'Driver KPIs', 'GET /api/fleet/driver-kpis'),
      src('لوحة الأسطول', 'Fleet dashboard', 'GET /api/fleet/dashboard'),
      src('لوحة التتبّع', 'Telemetry dashboard', 'GET /api/ls2/dashboard'),
    ],
  };
}

// Light transport (B2C riders)
async function light(p) {
  const Branch = require('../models/Branch');
  const q = { dateFrom: p.from, dateTo: p.to, ...(p.branch && mongoose.isValidObjectId(p.branch) ? { branch: p.branch } : {}) };
  const [d, branches] = await Promise.all([
    callController(C('b2cController'), 'getDashboardSummary', q),
    Branch.find({}).select('name city').sort({ name: 1 }).lean(),
  ]);
  const k = d?.kpis || {};
  const repName = (r) => r.arabicName || r.englishName || '—';
  return {
    branchOptions: branches.map((b) => ({ value: String(b._id), label: b.city ? `${b.name} — ${b.city}` : b.name })),
    cards: [
      card('orders', 'إجمالي الطلبات', 'Total orders', k.totalOrders, { href: '/system/b2c/dashboard' }),
      card('days', 'أيام العمل', 'Working days', k.totalWorkingDays),
      card('rate', 'متوسط الطلبات اليومي', 'Avg daily orders', r2(k.avgDailyRate)),
      card('reps', 'المناديب العاملون', 'Active reps', k.repsActive),
      card('above', 'فوق الهدف', 'Above target', k.aboveTargetReps, { tone: 'good' }),
      card('below', 'دون الهدف', 'Below target', k.belowTargetReps, { tone: num(k.belowTargetReps) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('atRisk', 'في خطر', 'At risk', k.atRiskReps, { tone: num(k.atRiskReps) ? 'bad' : 'neutral', lowerIsBetter: true }),
      card('performance', 'متوسط الأداء', 'Avg performance', r2(k.avgPerformance), { format: 'pct' }),
      card('capacity', 'استخدام الطاقة', 'Capacity used', r2(k.capacityUsedPercent), { format: 'pct' }),
    ],
    charts: [
      chart('byDay', 'الطلبات يوميًّا', 'Orders per day', 'line', [series('orders', 'الطلبات', 'Orders'), series('reps', 'المناديب العاملون', 'Reps worked')],
        (d?.byDay || []).map((r) => ({ label: r.dateKey, orders: num(r.totalOrders), reps: num(r.worked ?? r.repsActive) }))),
      chart('byMonth', 'الطلبات شهريًّا', 'Orders per month', 'bar', [series('orders', 'الطلبات', 'Orders')],
        (d?.byMonth || []).map((r) => ({ label: r.key, orders: num(r.totalOrders) }))),
      chart('byProject', 'الطلبات حسب المشروع', 'Orders by project', 'bar', [series('orders', 'الطلبات', 'Orders')],
        (d?.byProject || []).map((r) => ({ label: r.name || '—', orders: num(r.totalOrders) }))),
    ],
    tables: [
      table('byRep', 'ترتيب المناديب', 'Reps ranking',
        [col('name', 'المندوب', 'Rep'), col('project', 'المشروع', 'Project'), col('branch', 'الفرع', 'Branch'), col('orders', 'الطلبات', 'Orders', 'number'),
          col('days', 'أيام العمل', 'Days', 'number'), col('rate', 'المعدّل اليومي', 'Daily rate', 'number'), col('target', 'الهدف اليومي', 'Daily target', 'number'), col('performance', 'الأداء', 'Performance', 'pct')],
        (d?.byRep || []).map((r) => ({ name: repName(r), project: r.project || '', branch: r.branch || '', orders: num(r.totalOrders), days: num(r.workingDays), rate: r2(r.dailyRate), target: num(r.dailyTarget), performance: r2(r.performancePercent) }))),
      table('byProject', 'المشاريع', 'Projects', [col('name', 'المشروع', 'Project'), col('orders', 'الطلبات', 'Orders', 'number'), col('reps', 'المناديب', 'Reps', 'number')],
        (d?.byProject || []).map((r) => ({ name: r.name || '—', orders: num(r.totalOrders), reps: num(r.repsActive) }))),
      table('byBranch', 'الفروع', 'Branches', [col('name', 'الفرع', 'Branch'), col('city', 'المدينة', 'City'), col('orders', 'الطلبات', 'Orders', 'number'), col('reps', 'المناديب', 'Reps', 'number')],
        (d?.byBranch || []).map((r) => ({ name: r.name || '—', city: r.city || '', orders: num(r.totalOrders), reps: num(r.repsActive) }))),
      table('byMonth', 'الشهور', 'Months', [col('name', 'الشهر', 'Month'), col('orders', 'الطلبات', 'Orders', 'number'), col('days', 'أيام العمل', 'Days', 'number'), col('reps', 'المناديب', 'Reps', 'number'), col('rate', 'المعدّل اليومي', 'Daily rate', 'number')],
        (d?.byMonth || []).map((r) => ({ name: r.key, orders: num(r.totalOrders), days: num(r.workingDays), reps: num(r.repsActive), rate: r2(r.avgDailyRate) }))),
    ],
    notes: [{ ar: 'المناديب الذين انتهت خدمتهم لا يُحسَبون (قاعدة الموارد البشرية).', en: 'Reps whose service ended are not counted (HR rule).' }],
    sources: [src('لوحة النقل الخفيف', 'Light transport dashboard', 'GET /api/b2c/dashboard')],
  };
}

// Sales and CRM
async function sales(p) {
  const month = p.to.slice(0, 7);
  const [kpi, salesDash, crmDash, ins] = await Promise.all([
    callController(C('crmKpiController'), 'getCustomerKpis', { from: p.from, to: p.to }),
    callController(C('salesController'), 'getDashboard', { period: month }),
    callController(C('crmController'), 'getDashboard', {}),
    callController(C('shipmentInsightsController'), 'insights', { from: p.from, to: p.to }),
  ]);
  const s = kpi?.summary || {};
  const rq = ins?.requests || {};
  return {
    cards: [
      card('customers', 'عملاء لهم نشاط', 'Customers with activity', s.active, { href: '/system/crm/kpis' }),
      card('dormant', 'عملاء خاملون', 'Dormant customers', s.dormant, { tone: num(s.dormant) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('atRisk', 'عملاء في خطر', 'Customers at risk', s.atRisk, { tone: num(s.atRisk) ? 'bad' : 'neutral', lowerIsBetter: true }),
      card('avgScore', 'متوسط تقييم العملاء', 'Avg customer score', s.averageScore),
      card('revenue', 'إيراد العملاء', 'Customer revenue', s.totalRevenue, { format: 'money', tone: 'good' }),
      card('outstanding', 'المستحق على العملاء', 'Outstanding', s.totalOutstanding, { format: 'money' }),
      card('overdue', 'المتأخر', 'Overdue', s.totalOverdue, { format: 'money', tone: num(s.totalOverdue) ? 'bad' : 'neutral', lowerIsBetter: true }),
      card('requests', 'طلبات الشحن من المبيعات', 'Shipment requests', rq.requests, { href: '/system/shipment-orders/requests' }),
      card('trucks', 'الشاحنات المطلوبة', 'Trucks asked', rq.trucks),
      card('fulfilment', 'نسبة التلبية', 'Fulfilment', rq.fulfilment, { format: 'pct' }),
      card('pipeline', 'قيمة الفرص المفتوحة', 'Open pipeline', crmDash?.pipelineValue, { format: 'money', href: '/system/crm/dashboard' }),
      card('winRate', `نسبة الفوز (${month})`, `Win rate (${month})`, salesDash?.winRate, { format: 'pct', href: '/system/sales/dashboard' }),
      card('won', `قيمة المكسوب (${month})`, `Won value (${month})`, salesDash?.wonValue, { format: 'money' }),
      card('overdueTasks', 'مهام علاقات متأخرة', 'Overdue CRM tasks', crmDash?.overdueTasks, { tone: num(crmDash?.overdueTasks) ? 'warn' : 'neutral', lowerIsBetter: true }),
    ],
    charts: [
      chart('requests', 'طلبات المبيعات يوميًّا', 'Sales requests per day', 'line',
        [series('requests', 'الطلبات', 'Requests'), series('trucks', 'الشاحنات', 'Trucks'), series('placed', 'المُسنَدة', 'Placed')],
        (rq.trend || []).map((r) => ({ label: r.day, requests: num(r.requests), trucks: num(r.trucks), placed: num(r.placed) }))),
      chart('stages', 'الفرص حسب المرحلة', 'Deals by stage', 'bar', [series('count', 'العدد', 'Count'), series('value', 'القيمة', 'Value', 'money')],
        (salesDash?.byStage || []).map((r) => ({ label: r.stage, count: num(r.count), value: r2(r.value) }))),
      chart('scores', 'العملاء حسب التقييم', 'Customers by score band', 'bar', [series('count', 'العملاء', 'Customers')],
        (kpi?.bands || []).map((b) => ({ label: b.ar || b.key, count: (kpi?.items || []).filter((i) => i.band === b.key).length }))),
    ],
    tables: [
      table('customerKpis', 'تقييم العملاء', 'Customer scorecard',
        [col('name', 'العميل', 'Customer'), col('score', 'التقييم', 'Score', 'number'), col('band', 'الفئة', 'Band'), col('shipments', 'الشحنات', 'Shipments', 'number'),
          col('revenue', 'الإيراد', 'Revenue', 'money'), col('outstanding', 'المستحق', 'Outstanding', 'money'), col('overdue', 'المتأخر', 'Overdue', 'money'), col('flags', 'تنبيهات', 'Flags')],
        (kpi?.items || []).map((r) => ({
          name: r.arabicName || r.name || '—', score: num(r.score), band: (kpi?.bands || []).find((b) => b.key === r.band)?.ar || r.band || '', shipments: num(r.shipments),
          revenue: r2(r.revenue), outstanding: r2(r.outstanding), overdue: r2(r.overdueAmount),
          flags: (r.flags || []).map((f) => kpi?.flagLabels?.[f]?.ar || f).join('، '),
        }))),
      table('requestsBySales', 'طلبات المبيعات حسب المندوب', 'Requests by sales rep',
        [col('name', 'المندوب', 'Rep'), col('requests', 'الطلبات', 'Requests', 'number'), col('trucks', 'الشاحنات', 'Trucks', 'number'), col('placed', 'المُسنَدة', 'Placed', 'number'), col('rejected', 'المرفوضة', 'Rejected', 'number'), col('fulfilment', 'نسبة التلبية', 'Fulfilment', 'pct')],
        (rq.bySales || []).map((r) => ({ name: nameOf(r), requests: num(r.requests), trucks: num(r.trucks), placed: num(r.placed), rejected: num(r.rejected), fulfilment: r2(r.fulfilment) }))),
      table('salesReps', `أداء مناديب المبيعات (${month})`, `Sales reps (${month})`,
        [col('name', 'المندوب', 'Rep'), col('wonValue', 'المكسوب', 'Won', 'money'), col('wonCount', 'صفقات مكسوبة', 'Won deals', 'number'), col('openValue', 'المفتوح', 'Open', 'money'), col('target', 'الهدف', 'Target', 'money'), col('attainment', 'التحقيق', 'Attainment', 'pct')],
        (salesDash?.repRows || []).map((r) => ({ name: r.rep || '—', wonValue: r2(r.wonValue), wonCount: num(r.wonCount), openValue: r2(r.openValue), target: r2(r.target), attainment: r2(r.attainment) }))),
      table('shipmentRepRevenue', 'إيراد الشحنات حسب مندوب المبيعات', 'Shipment revenue by sales rep', [col('name', 'المندوب', 'Rep'), ...FIG_COLS], (ins?.salesReps || []).map(figRow)),
      table('rejectReasons', 'أسباب رفض الطلبات', 'Reject reasons', [col('name', 'السبب', 'Reason'), col('n', 'العدد', 'Count', 'number')], (rq.reasons || []).map((r) => ({ name: nameOf(r), n: num(r.count ?? r.n) }))),
    ],
    notes: [{ ar: `لوحة المبيعات (الفرص والأهداف) شهريةٌ في مصدرها، فتُعرَض لشهر نهاية الفترة (${month}).`, en: `The sales board is monthly at source, so it shows the period's last month (${month}).` }],
    sources: [
      src('تقييم العملاء', 'Customer KPIs', 'GET /api/crm/kpis/customers'),
      src('لوحة المبيعات', 'Sales dashboard', 'GET /api/sales/dashboard'),
      src('لوحة العلاقات', 'CRM dashboard', 'GET /api/crm/dashboard'),
      src('طلبات المبيعات', 'Sales requests', 'GET /api/shipment-orders/insights (requests)'),
    ],
  };
}

// Vendors (carriers)
async function vendors(p) {
  // The vendors analysis is yearly up to a month; the period's last month is passed so the register is read as of the period end.
  const month = p.to.slice(0, 7);
  // The vendors analysis filters shipments with the same keys as the shipments analysis (f_branch).
  const fb = p.branch ? { f_branch: p.branch } : {};
  const [ov, rank, ins, opts] = await Promise.all([
    callController(C('vendorsMgmtController'), 'overview', { month, ...fb }),
    callController(C('vendorsMgmtController'), 'ranking', { month, ...fb }),
    callController(C('shipmentInsightsController'), 'insights', { from: p.from, to: p.to, ...fb }),
    callController(C('shipmentInsightsController'), 'options', { from: p.from, to: p.to }),
  ]);
  const k = ov?.kpis || {};
  const t = ins?.totals || {};
  const branchOptions = (opts?.options?.branch || []).map((o) => ({ value: o.value, label: `${o.value === '__blank__' ? 'بلا فرع' : o.value} (${o.count})` }));
  const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return {
    branchOptions,
    cards: [
      card('suppliers', 'موردون عملوا في الفترة', 'Carriers used in period', t.suppliers, { href: '/system/vendors-mgmt' }),
      card('buy', 'تكلفة الشراء في الفترة', 'Purchase cost in period', t.buy, { format: 'money', tone: 'bad', lowerIsBetter: true }),
      card('avgBuy', 'متوسط تكلفة الشحنة', 'Avg cost per shipment', t.avgBuy, { format: 'money', lowerIsBetter: true }),
      card('master', 'الموردون المعتمدون', 'Approved carriers', k.masterVendors, { href: '/system/vendors-mgmt/vendors' }),
      card('masterActive', 'المعتمدون النشطون', 'Approved & active', k.masterActive),
      card('masterNever', 'معتمدون لم يعملوا قط', 'Approved, never worked', k.masterNeverWorked, { tone: num(k.masterNeverWorked) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('pending', 'بانتظار الاعتماد', 'Pending approval', k.pendingApproval, { href: '/system/vendors-mgmt/approvals' }),
      card('externalTrips', `رحلات خارجية (${ov?.year || ''})`, `External trips (${ov?.year || ''})`, k.externalTrips),
      card('fleetTrips', `رحلات أسطولنا (${ov?.year || ''})`, `Own-fleet trips (${ov?.year || ''})`, k.fleetTrips),
      card('masterShare', 'حصة المعتمدين من الرحلات الخارجية', 'Approved share of external trips', k.masterShare, { format: 'pct' }),
      card('followUpsDue', 'متابعات مستحقة', 'Follow-ups due', k.followUpsDue, { tone: num(k.followUpsDue) ? 'warn' : 'neutral', lowerIsBetter: true }),
    ],
    charts: [
      chart('months', `الرحلات شهريًّا حسب نوع المورّد (${ov?.year || ''})`, `Trips per month by carrier kind (${ov?.year || ''})`, 'bar',
        [series('master', 'معتمد', 'Approved'), series('outside', 'خارجي', 'Outside'), series('freelancer', 'فريلانسر', 'Freelancer'), series('fleet', 'أسطولنا', 'Own fleet')],
        (ov?.months || []).map((m) => ({ label: MONTHS_AR[m.month - 1] || String(m.month), master: num(m.master), outside: num(m.outside), freelancer: num(m.freelancer), fleet: num(m.fleet) })), { stacked: true }),
      chart('buyTrend', 'تكلفة الشراء عبر الفترة', 'Purchase cost over time', 'line', [series('buy', 'الشراء', 'Purchase', 'money')],
        (ins?.trend || []).map((r) => ({ label: r.key, buy: r2(r.buy) }))),
    ],
    tables: [
      table('suppliers', 'ترتيب الموردين في الفترة', 'Carriers ranking (period)', [col('name', 'المورّد', 'Carrier'), ...FIG_COLS, col('share', 'الحصة', 'Share', 'pct')], (ins?.suppliers || []).map(figRow)),
      table('ranking', `ترتيب الشهر (${rank?.year || ''}-${String(rank?.month || '').padStart(2, '0')})`, 'Month ranking',
        [col('rank', 'الترتيب', 'Rank', 'number'), col('name', 'المورّد', 'Carrier'), col('kind', 'النوع', 'Kind'), col('trips', 'الرحلات', 'Trips', 'number'), col('share', 'الحصة', 'Share', 'pct'), col('buy', 'الشراء', 'Purchase', 'money'), col('avg', 'المتوسط', 'Avg', 'money'), col('yearTrips', 'رحلات السنة', 'Year trips', 'number'), col('last', 'آخر رحلة', 'Last', 'date')],
        (rank?.rows || []).map((r) => ({ rank: num(r.rank), name: r.name, kind: ({ master: 'معتمد', outside: 'خارجي', freelancer: 'فريلانسر', fleet: 'أسطولنا' })[r.kind] || r.kind || '', trips: num(r.trips), share: r2(r.share), buy: r2(r.buy), avg: r2(r.avg), yearTrips: num(r.yearTrips), last: r.last }))),
      table('kinds', 'حسب نوع المورّد', 'By carrier kind', [col('name', 'النوع', 'Kind'), col('vendors', 'الموردون', 'Carriers', 'number'), col('active', 'النشطون', 'Active', 'number'), col('trips', 'الرحلات', 'Trips', 'number'), col('share', 'الحصة', 'Share', 'pct'), col('buy', 'الشراء', 'Purchase', 'money')],
        (ov?.kinds || []).map((r) => ({ name: r.label || r.kind, vendors: num(r.vendors), active: num(r.active), trips: num(r.trips), share: r2(r.share), buy: r2(r.buy) }))),
      table('followUps', 'المتابعات حسب الموظف', 'Follow-ups by member', [col('name', 'الموظف', 'Member'), col('followUps', 'المتابعات', 'Follow-ups', 'number'), col('carriers', 'الموردون', 'Carriers', 'number')],
        (ov?.followUpsByMember || []).map((r) => ({ name: r.name, followUps: num(r.followUps), carriers: num(r.carriers) }))),
    ],
    notes: [{ ar: 'سجلّ الموردين ورحلاتهم السنوية حتى تاريخ نهاية الفترة؛ الترتيب والتكلفة في الفترة من الشحنات نفسها.', en: 'Register and yearly trips are as of the period end; period ranking and cost come from the shipments themselves.' }],
    sources: [
      src('تحليل قسم الموردين', 'Vendors analysis', 'GET /api/vendors-mgmt/overview'),
      src('ترتيب الموردين', 'Vendors ranking', 'GET /api/vendors-mgmt/ranking'),
      src('تحليلات الشحنات', 'Shipment analytics', 'GET /api/shipment-orders/insights'),
    ],
  };
}

// Customs clearance
async function customs(p) {
  const CustomsClearance = require('../models/CustomsClearance');
  const ym = (k) => k.slice(0, 7);
  const [a, branchList] = await Promise.all([
    callController(C('customsClearanceController'), 'getAnalytics', { from: ym(p.from), to: ym(p.to), ...(p.branch ? { branch: p.branch } : {}) }),
    CustomsClearance.distinct('branch', { cancelled: { $ne: true } }),
  ]);
  const t = a?.totals || {};
  const i = a?.insight || {};
  const grpCols = [col('count', 'المعاملات', 'Files', 'number'), col('containers', 'الحاويات', 'Containers', 'number'), col('revenue', 'الإيراد', 'Revenue', 'money'),
    col('costs', 'التكاليف', 'Costs', 'money'), col('profit', 'الربح', 'Profit', 'money')];
  const grpRow = (r) => ({ name: r.key || '—', count: num(r.count), containers: num(r.containers), revenue: r2(r.revenue), costs: r2(r.costs), profit: r2(r.profit) });
  return {
    branchOptions: branchList.filter(Boolean).sort().map((b) => ({ value: b, label: b })),
    cards: [
      card('files', 'المعاملات', 'Files', t.clearances, { href: '/system/customs' }),
      card('containers', 'الحاويات', 'Containers', t.containers),
      card('customers', 'العملاء', 'Customers', t.customers),
      card('revenue', 'الإيراد', 'Revenue', t.totalRevenue, { format: 'money', tone: 'good' }),
      card('costs', 'التكاليف', 'Costs', t.totalCosts, { format: 'money', tone: 'bad', lowerIsBetter: true }),
      card('profit', 'صافي الربح', 'Net profit', t.netProfit, { format: 'money', tone: num(t.netProfit) >= 0 ? 'good' : 'bad' }),
      card('margin', 'هامش الربح', 'Margin', t.margin, { format: 'pct' }),
      card('open', 'معاملات مفتوحة', 'Open files', i.open),
      card('notInvoiced', 'لم تُفوتَر', 'Not invoiced', t.notInvoiced, { tone: num(t.notInvoiced) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('losing', 'معاملات بخسارة', 'Loss-making files', i.losing, { tone: num(i.losing) ? 'bad' : 'neutral', lowerIsBetter: true }),
      card('profitPerContainer', 'الربح لكل حاوية', 'Profit per container', i.profitPerContainer, { format: 'money' }),
    ],
    charts: [
      chart('byMonth', 'الإيراد والتكلفة والربح شهريًّا', 'Revenue, cost and profit per month', 'line',
        [series('revenue', 'الإيراد', 'Revenue', 'money'), series('costs', 'التكاليف', 'Costs', 'money'), series('profit', 'الربح', 'Profit', 'money')],
        (a?.byMonth || []).map((r) => ({ label: r.key, revenue: r2(r.revenue), costs: r2(r.costs), profit: r2(r.profit) }))),
      chart('files', 'المعاملات والحاويات شهريًّا', 'Files and containers per month', 'bar',
        [series('count', 'المعاملات', 'Files'), series('containers', 'الحاويات', 'Containers')],
        (a?.byMonth || []).map((r) => ({ label: r.key, count: num(r.count), containers: num(r.containers) }))),
      chart('costs', 'بنود التكلفة', 'Cost breakdown', 'bar', [series('amount', 'المبلغ', 'Amount', 'money')],
        (a?.costBreakdown || []).filter((r) => num(r.amount)).map((r) => ({ label: r.key, amount: r2(r.amount) }))),
    ],
    tables: [
      table('byCustomer', 'ترتيب العملاء', 'Customers ranking', [col('name', 'العميل', 'Customer'), ...grpCols], (a?.byCustomer || []).map(grpRow)),
      table('byAgent', 'الوكلاء الملاحيون', 'Shipping agents', [col('name', 'الوكيل', 'Agent'), ...grpCols], (a?.byAgent || []).map(grpRow)),
      table('byPort', 'المنافذ', 'Ports', [col('name', 'المنفذ', 'Port'), ...grpCols], (a?.byPort || []).map(grpRow)),
      table('byBranch', 'الفروع', 'Branches', [col('name', 'الفرع', 'Branch'), ...grpCols], (a?.byBranch || []).map(grpRow)),
      table('byStage', 'المراحل', 'Stages', [col('name', 'المرحلة', 'Stage'), ...grpCols], (a?.byStage || []).map(grpRow)),
      table('losing', 'المعاملات الخاسرة', 'Loss-making files',
        [col('name', 'المرجع', 'Ref'), col('customer', 'العميل', 'Customer'), col('revenue', 'الإيراد', 'Revenue', 'money'), col('costs', 'التكاليف', 'Costs', 'money'), col('profit', 'الربح', 'Profit', 'money')],
        (a?.losingDeals || []).map((r) => ({ name: r.refNumber || r.blNumber || '—', customer: r.customerName || '', revenue: r2(r.revenue), costs: r2(r.costs), profit: r2(r.profit) }))),
    ],
    notes: [{ ar: 'التخليص يُحسَب بالشهر في مصدره، فالفترة تُقرَّب إلى شهورها الكاملة. المعاملات القادمة لا تدخل الأرقام.', en: 'Customs is monthly at source, so the period rounds to whole months. Upcoming files are excluded.' }],
    sources: [src('تحليلات التخليص', 'Customs analytics', 'GET /api/customs-clearance/analytics')],
  };
}

// Collections
async function collections(p) {
  const q = { from: p.from, to: p.to, ...(p.branch ? { branch: p.branch } : {}) };
  const [d, all] = await Promise.all([
    callController(C('collectionsDeptController'), 'dashboard', q),
    p.branch ? callController(C('collectionsDeptController'), 'dashboard', { from: p.from, to: p.to }) : null,
  ]);
  const c = d?.customers || {};
  const s = d?.suppliers || {};
  const rate = (a, b) => (num(b) ? r2((num(a) / num(b)) * 100) : 0);
  return {
    branchOptions: ((all || d)?.byBranch || []).map((b) => ({ value: b.branch, label: b.branch })).filter((b) => b.value),
    cards: [
      card('custTotal', 'مستحقات العملاء (الفترة)', 'Customer billing (period)', c.total, { format: 'money', href: '/system/collections-dept/dashboard' }),
      card('custSettled', 'المحصَّل', 'Collected', c.settled, { format: 'money', tone: 'good' }),
      card('custOutstanding', 'المتبقّي على العملاء', 'Customer outstanding', c.outstanding, { format: 'money', tone: num(c.outstanding) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('collectRate', 'نسبة التحصيل', 'Collection rate', rate(c.settled, c.total), { format: 'pct' }),
      card('custOpen', 'تقارير عملاء مفتوحة', 'Open customer reports', c.openReports),
      card('supTotal', 'مستحقات الموردين (الفترة)', 'Supplier payables (period)', s.total, { format: 'money' }),
      card('supSettled', 'المسدَّد للموردين', 'Paid to suppliers', s.settled, { format: 'money' }),
      card('supOutstanding', 'المتبقّي للموردين', 'Supplier outstanding', s.outstanding, { format: 'money', lowerIsBetter: true }),
      card('payRate', 'نسبة السداد', 'Payment rate', rate(s.settled, s.total), { format: 'pct' }),
    ],
    charts: [
      chart('monthly', 'المستحق والمحصَّل شهريًّا', 'Billed vs collected per month', 'bar',
        [series('settled', 'المحصَّل', 'Collected', 'money'), series('outstanding', 'المتبقّي', 'Outstanding', 'money')],
        (d?.monthly || []).map((r) => ({ label: r.month, settled: r2(r.settled), outstanding: r2(r.outstanding) })), { stacked: true }),
      chart('agingCustomer', 'أعمار مستحقات العملاء', 'Customer aging', 'bar', [series('amount', 'المبلغ', 'Amount', 'money')],
        (d?.aging?.customer || []).map((r) => ({ label: r.bucket, amount: r2(r.amount) }))),
      chart('agingSupplier', 'أعمار مستحقات الموردين', 'Supplier aging', 'bar', [series('amount', 'المبلغ', 'Amount', 'money')],
        (d?.aging?.supplier || []).map((r) => ({ label: r.bucket, amount: r2(r.amount) }))),
    ],
    tables: [
      table('topCustomers', 'أكبر المتأخرين من العملاء', 'Top customers outstanding',
        [col('name', 'العميل', 'Customer'), col('reports', 'التقارير', 'Reports', 'number'), col('outstanding', 'المتبقّي', 'Outstanding', 'money'), col('oldest', 'أقدم تقرير', 'Oldest', 'date')],
        (c.top || []).map((r) => ({ name: r.name, reports: num(r.reports), outstanding: r2(r.outstanding), oldest: r.oldest }))),
      table('topSuppliers', 'أكبر مستحقات الموردين', 'Top supplier payables',
        [col('name', 'المورّد', 'Supplier'), col('reports', 'التقارير', 'Reports', 'number'), col('outstanding', 'المتبقّي', 'Outstanding', 'money'), col('oldest', 'أقدم تقرير', 'Oldest', 'date')],
        (s.top || []).map((r) => ({ name: r.name, reports: num(r.reports), outstanding: r2(r.outstanding), oldest: r.oldest }))),
      table('byBranch', 'الفروع', 'Branches',
        [col('name', 'الفرع', 'Branch'), col('reports', 'التقارير', 'Reports', 'number'), col('receivable', 'مستحق من العملاء', 'Receivable', 'money'), col('payable', 'مستحق للموردين', 'Payable', 'money')],
        (d?.byBranch || []).map((r) => ({ name: r.branch || '—', reports: num(r.reports), receivable: r2(r.receivable), payable: r2(r.payable) }))),
      table('monthly', 'الشهور', 'Months', [col('name', 'الشهر', 'Month'), col('total', 'المستحق', 'Billed', 'money'), col('settled', 'المحصَّل', 'Collected', 'money'), col('outstanding', 'المتبقّي', 'Outstanding', 'money')],
        (d?.monthly || []).map((r) => ({ name: r.month, total: r2(r.total), settled: r2(r.settled), outstanding: r2(r.outstanding) }))),
    ],
    notes: [],
    sources: [src('لوحة التحصيل', 'Collections dashboard', 'GET /api/collections-dept/dashboard')],
  };
}

// HR
async function hr(p) {
  const Employee = require('../models/Employee');
  const LeaveRequest = require('../models/LeaveRequest');
  const [d, hires, exits, leaves] = await Promise.all([
    callController(C('hrController'), 'getDashboard', {}),
    Employee.aggregate([{ $match: { hireDate: { $gte: p.from, $lte: p.to } } }, { $group: { _id: { $substrCP: ['$hireDate', 0, 7] }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Employee.aggregate([{ $match: { employmentStatus: 'terminated', terminatedAt: { $gte: p.fromDate, $lte: p.toDate } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$terminatedAt', timezone: 'Asia/Riyadh' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    LeaveRequest.aggregate([{ $match: { startDate: { $gte: p.from, $lte: p.to } } },
      { $group: { _id: { m: { $substrCP: ['$startDate', 0, 7] }, s: '$status' }, n: { $sum: 1 }, days: { $sum: { $ifNull: ['$days', 0] } } } }]),
  ]);
  const s = d?.summary || {};
  const months = [...new Set([...hires.map((x) => x._id), ...exits.map((x) => x._id), ...leaves.map((x) => x._id.m)])].filter(Boolean).sort();
  const at = (arr, m) => num(arr.find((x) => x._id === m)?.n);
  const leaveOf = (m, f) => leaves.filter((x) => x._id.m === m && (!f || f(x._id.s))).reduce((a, x) => a + x.n, 0);
  const sumN = (arr) => arr.reduce((a, x) => a + x.n, 0);
  const STATUS_AR = { active: 'على رأس العمل', on_leave: 'في إجازة', suspended: 'موقوف', terminated: 'منتهية خدمته' };
  return {
    cards: [
      card('total', 'إجمالي الموظفين', 'Employees', s.totalEmployees, { href: '/system/hr/master' }),
      card('active', 'على رأس العمل', 'Active', s.activeEmployees, { tone: 'good' }),
      card('onLeave', 'في إجازة', 'On leave', s.onLeaveCount),
      card('hires', 'التعيينات في الفترة', 'Hires in period', sumN(hires), { tone: 'good' }),
      card('exits', 'إنهاء الخدمة في الفترة', 'Exits in period', sumN(exits), { tone: sumN(exits) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('leaves', 'طلبات إجازة بدأت في الفترة', 'Leaves starting in period', leaves.reduce((a, x) => a + x.n, 0)),
      card('pendingLeaves', 'إجازات معلّقة', 'Pending leaves', s.pendingLeaves, { lowerIsBetter: true }),
      card('openRequests', 'طلبات موظفين مفتوحة', 'Open staff requests', s.openRequests, { lowerIsBetter: true }),
      card('expiredDocs', 'وثائق منتهية', 'Expired documents', s.expiredDocsCount, { tone: num(s.expiredDocsCount) ? 'bad' : 'neutral', lowerIsBetter: true }),
      card('expiringDocs', 'وثائق تنتهي قريبًا', 'Documents expiring soon', s.expiringDocsCount, { tone: num(s.expiringDocsCount) ? 'warn' : 'neutral', lowerIsBetter: true }),
      card('noContract', 'بلا عقد', 'Without contract', s.noContractCount, { tone: num(s.noContractCount) ? 'warn' : 'neutral', lowerIsBetter: true }),
    ],
    charts: [
      chart('movement', 'التعيينات وإنهاء الخدمة شهريًّا', 'Hires and exits per month', 'bar',
        [series('hires', 'تعيينات', 'Hires'), series('exits', 'إنهاء خدمة', 'Exits')],
        months.map((m) => ({ label: m, hires: at(hires, m), exits: at(exits, m) }))),
      chart('leaves', 'طلبات الإجازة شهريًّا', 'Leave requests per month', 'bar',
        [series('approved', 'معتمدة', 'Approved'), series('pending', 'قيد الاعتماد', 'Pending'), series('rejected', 'مرفوضة أو ملغاة', 'Rejected/cancelled')],
        months.map((m) => ({ label: m, approved: leaveOf(m, (x) => x === 'approved'), pending: leaveOf(m, (x) => /^pending|info_requested/.test(x)), rejected: leaveOf(m, (x) => x === 'rejected' || x === 'cancelled') })), { stacked: true }),
      chart('byDepartment', 'الموظفون العاملون حسب القسم', 'Active staff by department', 'bar', [series('count', 'الموظفون', 'Staff')],
        (d?.activeByDepartment || d?.byDepartment || []).map((r) => ({ label: r.name || '—', count: num(r.count) }))),
    ],
    tables: [
      table('byDepartment', 'الأقسام', 'Departments', [col('name', 'القسم', 'Department'), col('count', 'الموظفون', 'Staff', 'number')], (d?.byDepartment || []).map((r) => ({ name: r.name || '—', count: num(r.count) }))),
      table('byProject', 'المشاريع', 'Projects', [col('name', 'المشروع', 'Project'), col('count', 'الموظفون', 'Staff', 'number')], (d?.byProject || []).map((r) => ({ name: r.name || '—', count: num(r.count) }))),
      table('byNationality', 'الجنسيات', 'Nationalities', [col('name', 'الجنسية', 'Nationality'), col('count', 'الموظفون', 'Staff', 'number')], (d?.byNationality || []).map((r) => ({ name: r.name || '—', count: num(r.count) }))),
      table('byStatus', 'حالات العمل', 'Work status', [col('name', 'الحالة', 'Status'), col('count', 'الموظفون', 'Staff', 'number')], (d?.byStatus || []).map((r) => ({ name: STATUS_AR[r.status] || r.status, count: num(r.count) }))),
      table('expiringDocs', 'وثائق منتهية أو تنتهي قريبًا', 'Expired / expiring documents',
        [col('name', 'الموظف', 'Employee'), col('doc', 'الوثيقة', 'Document'), col('expiry', 'تاريخ الانتهاء', 'Expiry'), col('state', 'الحالة', 'State')],
        (d?.expiringDocs || []).map((r) => ({ name: r.arabicName || r.employeeName || '—', doc: r.docAr || r.docType, expiry: r.expiry || '', state: r.expired ? 'منتهية' : 'تنتهي قريبًا' }))),
      table('movement', 'الحركة الشهرية', 'Monthly movement',
        [col('name', 'الشهر', 'Month'), col('hires', 'تعيينات', 'Hires', 'number'), col('exits', 'إنهاء خدمة', 'Exits', 'number'), col('leaves', 'طلبات إجازة', 'Leave requests', 'number'), col('leaveDays', 'أيام الإجازات', 'Leave days', 'number')],
        months.map((m) => ({ name: m, hires: at(hires, m), exits: at(exits, m), leaves: leaveOf(m), leaveDays: leaves.filter((x) => x._id.m === m).reduce((a, x) => a + num(x.days), 0) }))),
    ],
    notes: [{ ar: 'أعداد الموظفين لحظيّةٌ من ملفات الموارد البشرية؛ التعيينات وإنهاء الخدمة والإجازات حسب الفترة.', en: 'Headcounts are current from HR files; hires, exits and leaves follow the period.' }],
    sources: [
      src('لوحة الموارد البشرية', 'HR dashboard', 'GET /api/hr/dashboard'),
      src('ملفات الموظفين', 'Employee files', 'employees (hireDate, terminatedAt)'),
      src('طلبات الإجازة', 'Leave requests', 'leaverequests (startDate, status, days)'),
    ],
  };
}

// Finance: the finance management overview, plus the monthly money trend of the workflow sheets
async function finance(p) {
  const [ov, sheets] = await Promise.all([
    callController(C('financeController'), 'overview', { from: p.from, to: p.to }),
    workflowSheets({ ...p, branch: null }),
  ]);
  const deps = ov?.departments || [];
  const rows = [];
  for (const d of deps) for (const c of d.cards || []) rows.push({ name: d.ar, item: c.ar, value: r2(c.value), unit: ({ money: 'ر.س', pct: '%', number: 'عدد' })[c.format] || '' });
  const h = ov?.headline || {};
  const href = { operations: '/system/finance/operations', fleet: '/system/finance/fleet', customs: '/system/finance/customs', light: '/system/finance/light-transport', marketing: '/system/finance/marketing', hr: '/system/finance/hr', it: '/system/finance/it', collections: '/system/finance/collections', vehicles: '/system/finance/vehicles' };
  const firstOf = (key, c) => deps.find((d) => d.key === key)?.cards?.find((x) => x.key === c)?.value;
  return {
    cards: [
      card('selling', 'قيمة البيع (التشغيل)', 'Selling (operations)', h.selling, { format: 'money', tone: 'good', href: href.operations }),
      card('margin', 'هامش التشغيل', 'Operating margin', firstOf('operations', 'margin'), { format: 'money', href: href.operations }),
      card('receivable', 'المستحق على العملاء (الدفتر)', 'Receivable (ledger)', h.receivable, { format: 'money', href: href.collections }),
      card('collected', 'المحصَّل في الفترة', 'Collected in period', h.collected, { format: 'money', tone: 'good', href: href.collections }),
      card('fleetNet', 'صافي الأسطول', 'Fleet net', firstOf('fleet', 'net'), { format: 'money', href: href.fleet }),
      card('customsProfit', 'ربح التخليص', 'Customs profit', firstOf('customs', 'profit'), { format: 'money', href: href.customs }),
      card('hrMonthly', 'التزامات الرواتب الشهرية', 'Monthly salary obligations', firstOf('hr', 'monthly'), { format: 'money', href: href.hr }),
      card('walletClosing', 'رصيد المحافظ الختامي', 'Wallets closing balance', firstOf('operations', 'walletClosing'), { format: 'money', href: '/system/wallet-dashboard' }),
    ],
    charts: [
      chart('sheets', 'البيع والشراء شهريًّا (أوامر النقل)', 'Selling vs purchase per month (sheets)', 'line',
        [series('selling', 'البيع', 'Selling', 'money'), series('purchase', 'الشراء', 'Purchase', 'money'), series('margin', 'الهامش', 'Margin', 'money')],
        sheets.byMonth.map((r) => ({ label: r.label, selling: r.selling, purchase: r.purchase, margin: r.margin }))),
      chart('collected', 'المحصَّل من أوامر النقل شهريًّا', 'Collected from sheets per month', 'bar', [series('collected', 'المحصَّل', 'Collected', 'money')],
        sheets.byMonth.map((r) => ({ label: r.label, collected: r.collected }))),
    ],
    tables: [
      table('headlines', 'المؤشّرات المالية لكل قسم', 'Finance headline per department',
        [col('name', 'القسم', 'Department'), col('item', 'البند', 'Item'), col('value', 'القيمة', 'Value', 'number'), col('unit', 'الوحدة', 'Unit')], rows, { noTotals: true }),
      table('sheetsByMonth', 'أوامر النقل شهريًّا', 'Sheets per month', [col('name', 'الشهر', 'Month'), ...SHEET_COLS], sheets.byMonth),
      table('sheetsByBranch', 'أوامر النقل حسب الفرع', 'Sheets by branch', [col('name', 'الفرع', 'Branch'), ...SHEET_COLS], sheets.byBranch),
    ],
    notes: [{ ar: 'المؤشّرات المالية هي نفسها أرقام صفحات الإدارة المالية لكل قسم (المصدر واحد).', en: 'Finance headlines are the same figures as each finance department page (single source).' }],
    sources: [
      src('لوحة الإدارة المالية', 'Finance overview', 'GET /api/finance/overview'),
      src('سير عمل التشغيل', 'Operations workflow', 'operationsworkflows'),
    ],
  };
}

const SECTIONS = {
  operations: { ar: 'تحليل العمليات والشحنات', en: 'Operations & Shipments Analysis', build: operations, branch: true },
  heavy: { ar: 'تحليل النقل الثقيل', en: 'Heavy Transport Analysis', build: heavy },
  light: { ar: 'تحليل النقل الخفيف', en: 'Light Transport Analysis', build: light, branch: true },
  sales: { ar: 'تحليل المبيعات والعلاقات', en: 'Sales & CRM Analysis', build: sales },
  vendors: { ar: 'تحليل الموردين', en: 'Vendors Analysis', build: vendors, branch: true },
  customs: { ar: 'تحليل التخليص الجمركي', en: 'Customs Analysis', build: customs, branch: true },
  collections: { ar: 'تحليل التحصيل', en: 'Collections Analysis', build: collections, branch: true },
  hr: { ar: 'تحليل الموارد البشرية', en: 'HR Analysis', build: hr },
  finance: { ar: 'التحليل المالي', en: 'Finance Analysis', build: finance },
};

function paramsOf(q = {}) {
  const p = periodOf(q);
  const branch = typeof q.branch === 'string' && q.branch.trim() ? q.branch.trim().slice(0, 120) : null;
  return { ...p, branch };
}

async function buildSection(key, p) {
  const s = SECTIONS[key];
  const b = s.branch ? p.branch : null;
  return cache.wrapStale(`exec:dss:${key}:${p.from}:${p.to}:${b || ''}`, FRESH, MAX, async () => {
    const body = await s.build({ ...p, branch: b });
    return { section: key, ar: s.ar, en: s.en, period: { from: p.from, to: p.to }, branch: b, hasBranch: !!s.branch, generatedAt: new Date(), branchOptions: [], charts: [], notes: [], sources: [], ...body };
  });
}

exports.section = async (req, res) => {
  try {
    const key = req.params.key;
    if (!SECTIONS[key]) return res.status(404).json({ message: 'قسم غير معروف' });
    const p = paramsOf(req.query);
    if (req.query.fresh === '1') cache.clear(`exec:dss:${key}:${p.from}:${p.to}:`);
    res.json(await buildSection(key, p));
  } catch (e) {
    console.error('data-support section', e);
    res.status(500).json({ message: 'تعذّر تحميل التحليل' });
  }
};

/** Section home: the headline cards of each analysis, sliced from the same payloads so the home never differs from a page. */
const HEADLINE = {
  operations: ['orders', 'sell', 'margin', 'cancelRate'],
  heavy: ['loads', 'income', 'net', 'alerts'],
  light: ['orders', 'reps', 'below'],
  sales: ['customers', 'requests', 'fulfilment'],
  vendors: ['suppliers', 'buy', 'pending'],
  customs: ['files', 'revenue', 'profit'],
  collections: ['custOutstanding', 'collectRate', 'supOutstanding'],
  hr: ['active', 'hires', 'expiredDocs'],
  finance: ['selling', 'receivable', 'collected'],
};
exports.overview = async (req, res) => {
  try {
    const p = { ...paramsOf(req.query), branch: null };
    const keys = Object.keys(SECTIONS);
    const built = await Promise.all(keys.map((k) => buildSection(k, p).catch((e) => { console.error('data-support overview', k, e.message); return null; })));
    res.json({
      period: { from: p.from, to: p.to },
      sections: keys.map((k, i) => ({
        key: k, ar: SECTIONS[k].ar, en: SECTIONS[k].en, ok: !!built[i],
        cards: (built[i]?.cards || []).filter((c) => HEADLINE[k].includes(c.key)),
      })),
    });
  } catch (e) {
    console.error('data-support overview', e);
    res.status(500).json({ message: 'تعذّر تحميل اللوحة' });
  }
};

exports.SECTIONS = SECTIONS;
exports.buildSection = buildSection;
