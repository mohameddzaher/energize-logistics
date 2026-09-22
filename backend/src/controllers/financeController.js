/**
 * الإدارة الماليّة — مالُ كلّ قسمٍ في موضعٍ واحد.
 *
 * ── لماذا لا تُحسب الأرقامُ هنا من جديد ──────────────────────────────────────
 * لكلّ قسمٍ لوحتُه التي يعتمدها أهلُه: المحفظةُ تحسب رصيدَ الفرع بقاعدة
 * «ختامُ اليوم افتتاحُ غده»، والتحصيلُ يحسب المستحقَّ بتاريخ التحصيل لا بتاريخ
 * الفاتورة، والتخليصُ يستثني نقلَ الساحة من الربح كي لا يُعدّ مرّتين. ولو أعاد
 * هذا القسمُ حسابَها لافترق رقمُ المدير الماليّ عن رقم القسم في أوّل قاعدةٍ
 * تتغيّر — ولا يُعرف أيُّهما الصحيح.
 *
 * فيُنادى متحكّمُ كلّ قسمٍ في العمليّة نفسِها بصلاحيّةٍ كاملة، ويُعاد تشكيلُ ما
 * يردّه بطاقاتٍ وجداول. وما لا لوحةَ له (العقود، أصول التقنية، أقساط المركبات)
 * يُجمع هنا مباشرةً من نماذجه.
 *
 * ── وما لا يُسجَّل لا يُخترَع ────────────────────────────────────────────────
 * مسيرُ الرواتب الفعليّ، وأسعارُ باقات الجوّال، وتكلفةُ التراخيص — لا تُسجَّل
 * في النظام. فتقول الصفحةُ ذلك صراحةً في ملاحظة، بدل صفرٍ يُقرأ «لا تكلفة».
 *
 * ── ويسمع فورًا ──────────────────────────────────────────────────────────────
 * كلُّ بثٍّ ماليٍّ في أيّ قسم يمسح مخزنَ هذا القسم ويبثّ `finance:changed`
 * (websocket/socketManager.financeTouch)، فتُعيد الصفحةُ القراءة.
 */
const mongoose = require('mongoose');
const cache = require('../utils/ttlCache');

const TTL = 60 * 1000;
const RIYADH = 'Asia/Riyadh';

// ── الفترة ────────────────────────────────────────────────────────────────────
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d);
const validKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));
function periodOf(q = {}) {
  const today = dayKey();
  const to = validKey(q.to) ? q.to : today;
  const from = validKey(q.from) ? q.from : `${to.slice(0, 8)}01`;
  // حدودُ اليوم بتوقيت الرياض (+03:00) — لا بتوقيت الخادم.
  return {
    from, to,
    fromDate: new Date(`${from}T00:00:00+03:00`),
    toDate: new Date(`${to}T23:59:59.999+03:00`),
  };
}

// ── نداءُ متحكّم قسمٍ في العمليّة نفسِها ────────────────────────────────────────
function callController(mod, handler, query, user) {
  return new Promise((resolve) => {
    const m = typeof mod === 'string' ? require(mod) : mod;
    if (!m || typeof m[handler] !== 'function') return resolve(null);
    let done = false;
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { if (!done) { done = true; resolve(this.statusCode < 400 ? body : null); } return this; },
      setHeader() { return this; },
      send() { if (!done) { done = true; resolve(null); } return this; },
    };
    // صلاحيّةٌ كاملة: بعضُ اللوحات تحجب جانبَ المورّدين عن أدوار التحصيل، والإدارةُ
    // الماليّة ترى الجانبين. والحارسُ على هذا القسم نفسِه هو `sectionGate`.
    const req = { user: { ...(user || {}), role: 'super_admin' }, query: query || {}, params: {}, headers: {} };
    Promise.resolve(m[handler](req, res)).catch((e) => {
      console.error(`finance: ${handler} failed`, e.message);
      if (!done) { done = true; resolve(null); }
    });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, 45000);
  });
}

// ── بناءُ الحمولة ────────────────────────────────────────────────────────────
const card = (key, ar, en, value, extra = {}) => ({ key, ar, en, value: Number.isFinite(Number(value)) ? Number(value) : 0, format: 'money', ...extra });
const col = (key, ar, en, format = 'text') => ({ key, ar, en, format });
const sum = (rows, f) => (rows || []).reduce((a, r) => a + (Number(typeof f === 'function' ? f(r) : r?.[f]) || 0), 0);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const NOT_CANCELLED = { executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] } };

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات التشغيل
// ═══════════════════════════════════════════════════════════════════════════
async function operations(p, user) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const WalletTransaction = require('../models/WalletTransaction');
  require('../models/Branch');
  require('../models/ExpenseCategory');

  const inPeriod = { $or: [{ reportDate: { $gte: p.fromDate, $lte: p.toDate } }, { reportDate: null, createdAt: { $gte: p.fromDate, $lte: p.toDate } }] };
  const sheetGroup = (id) => ([
    { $match: { ...NOT_CANCELLED, ...inPeriod } },
    { $group: {
      _id: id,
      sheets: { $sum: 1 },
      selling: { $sum: { $ifNull: ['$sellingValue', 0] } },
      purchase: { $sum: { $ifNull: ['$purchaseValue', 0] } },
      paid: { $sum: { $cond: [{ $ifNull: ['$paymentDate', false] }, { $ifNull: ['$purchaseValue', 0] }, 0] } },
      collected: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
      net: { $sum: { $ifNull: ['$netInvoice', 0] } },
      vat: { $sum: { $ifNull: ['$tax', 0] } },
      invoiced: { $sum: { $ifNull: ['$totalInvoice', 0] } },
    } },
  ]);

  const [wallet, byBranch, byType, byCustomer, bySupplier, expenseCats, txns, losing] = await Promise.all([
    callController('../controllers/walletController', 'getAllBranchesDashboard', { dateFrom: p.from, dateTo: p.to }, user),
    OperationsWorkflow.aggregate([...sheetGroup('$branch'), { $sort: { selling: -1 } }]),
    OperationsWorkflow.aggregate(sheetGroup('$paymentType')),
    OperationsWorkflow.aggregate([...sheetGroup('$username'), { $sort: { selling: -1 } }, { $limit: 100 }]),
    OperationsWorkflow.aggregate([...sheetGroup('$carOwner'), { $sort: { purchase: -1 } }, { $limit: 100 }]),
    WalletTransaction.aggregate([
      { $match: { type: 'expense', date: { $gte: p.from, $lte: p.to } } },
      { $group: { _id: '$expenseCategory', amount: { $sum: '$amount' }, n: { $sum: 1 } } },
      { $lookup: { from: 'expensecategories', localField: '_id', foreignField: '_id', as: 'c' } },
      { $project: { amount: 1, n: 1, name: { $ifNull: [{ $first: '$c.name' }, 'بلا تصنيف'] } } },
      { $sort: { amount: -1 } },
    ]),
    WalletTransaction.find({ type: { $ne: 'tax_invoice' }, date: { $gte: p.from, $lte: p.to } })
      .populate('branch', 'name').populate('expenseCategory', 'name')
      .select('date type amount branch expenseCategory driverName purchaseDriverName vendorName deliveryStatementNumber purchaseDeliveryStatementNumber description itemName createdAt')
      .sort({ date: -1, createdAt: -1 }).limit(2000).lean(),
    // كشوفٌ شراؤها أكبرُ من بيعها — أغلبُها خطأ إدخالٍ في قيمة الشراء، وقليلٌ منها
    // خسارةٌ حقيقيّة. وسبعةٌ وأربعون كشفًا منها كانت تقلب هامشَ التشغيل كلَّه سالبًا.
    OperationsWorkflow.find({ ...NOT_CANCELLED, ...inPeriod, $expr: { $gt: [{ $ifNull: ['$purchaseValue', 0] }, { $ifNull: ['$sellingValue', 0] }] } })
      .select('reportNumber reportDate username carOwner branch sellingValue purchaseValue').lean(),
  ]);

  const branches = wallet?.branches || [];
  const TYPE_AR = { collection: 'تحصيل', expense: 'مصروف', purchase: 'مشتريات' };
  const PT = { cash: 'نقدي', tax: 'ضريبي', '': 'غير محدد', null: 'غير محدد' };
  const tot = {
    selling: sum(byBranch, 'selling'), purchase: sum(byBranch, 'purchase'), vat: sum(byBranch, 'vat'),
    paid: sum(byBranch, 'paid'), collected: sum(byBranch, 'collected'), sheets: sum(byBranch, 'sheets'),
  };
  const sheetCols = [
    col('sheets', 'الكشوف', 'Sheets', 'number'),
    col('selling', 'قيمة البيع', 'Selling', 'money'),
    col('purchase', 'قيمة الشراء', 'Purchase', 'money'),
    col('margin', 'الهامش', 'Margin', 'money'),
    col('collected', 'محصَّل من البيع', 'Collected', 'money'),
    col('paid', 'مسدَّد للموردين', 'Paid to suppliers', 'money'),
    col('vat', 'ضريبة القيمة المضافة', 'VAT', 'money'),
  ];
  const sheetRow = (r, name) => ({ name, sheets: r.sheets, selling: round(r.selling), purchase: round(r.purchase), margin: round(r.selling - r.purchase), collected: round(r.collected), paid: round(r.paid), vat: round(r.vat) });

  return {
    cards: [
      card('walletCollections', 'تحصيلات المحافظ', 'Wallet collections', sum(branches, 'totalCollections'), { tone: 'good', href: '/system/wallet-dashboard' }),
      card('walletExpenses', 'مصروفات المحافظ', 'Wallet expenses', sum(branches, 'totalExpenses'), { tone: 'bad', href: '/system/wallet-dashboard' }),
      card('walletPurchases', 'مشتريات المحافظ', 'Wallet purchases', sum(branches, 'totalPurchases'), { tone: 'warn', href: '/system/wallet-dashboard' }),
      card('walletClosing', 'رصيد المحافظ الختامي', 'Wallets closing balance', sum(branches, 'closingBalance'), { href: '/system/wallet-dashboard' }),
      card('selling', 'قيمة البيع (الكشوف)', 'Selling value (sheets)', tot.selling, { tone: 'good', href: '/system/operations' }),
      card('purchase', 'قيمة الشراء (الكشوف)', 'Purchase value (sheets)', tot.purchase, { tone: 'bad', href: '/system/operations' }),
      card('margin', 'هامش التشغيل', 'Operating margin', tot.selling - tot.purchase, { tone: tot.selling - tot.purchase >= 0 ? 'good' : 'bad' }),
      card('losing', 'كشوف شراؤها أكبر من بيعها', 'Sheets bought above selling', losing.length, { format: 'number', tone: losing.length ? 'warn' : 'neutral' }),
      card('vat', 'ضريبة القيمة المضافة', 'VAT', tot.vat),
      card('sheets', 'كشوف الفترة', 'Sheets', tot.sheets, { format: 'number', href: '/system/operations' }),
    ],
    tables: [
      {
        key: 'wallets', ar: 'المحافظ حسب الفرع', en: 'Wallets by branch',
        noteAr: 'الرصيد الافتتاحي هو رصيد أول يوم في الفترة، والختامي آخر يوم — ختامُ كلّ يومٍ افتتاحُ غده.',
        columns: [
          col('name', 'الفرع', 'Branch'), col('opening', 'الافتتاحي', 'Opening', 'money'),
          col('collections', 'التحصيلات', 'Collections', 'money'), col('expenses', 'المصروفات', 'Expenses', 'money'),
          col('purchases', 'المشتريات', 'Purchases', 'money'), col('net', 'صافي الحركة', 'Net movement', 'money'),
          col('closing', 'الختامي', 'Closing', 'money'), col('difference', 'فرق الجرد', 'Count difference', 'money'),
        ],
        rows: branches.map((b) => ({
          _href: b.branch?._id ? `/system/wallet-dashboard/branch/${b.branch._id}` : null,
          name: b.branch?.name || '—', opening: round(b.openingBalance), collections: round(b.totalCollections),
          expenses: round(b.totalExpenses), purchases: round(b.totalPurchases), net: round(b.netMovement),
          closing: round(b.closingBalance), difference: round(b.totalDifference),
        })),
      },
      {
        key: 'expenseCategories', ar: 'المصروفات حسب التصنيف', en: 'Expenses by category',
        columns: [col('name', 'التصنيف', 'Category'), col('n', 'العدد', 'Count', 'number'), col('amount', 'المبلغ', 'Amount', 'money')],
        rows: expenseCats.map((x) => ({ name: x.name, n: x.n, amount: round(x.amount) })),
      },
      {
        key: 'sheetsByBranch', ar: 'الكشوف حسب الفرع', en: 'Sheets by branch',
        columns: [col('name', 'الفرع', 'Branch'), ...sheetCols],
        rows: byBranch.map((r) => sheetRow(r, r._id || '—')),
      },
      {
        key: 'sheetsByType', ar: 'الكشوف حسب نوع الدفع', en: 'Sheets by payment type',
        columns: [col('name', 'النوع', 'Type'), ...sheetCols],
        rows: byType.map((r) => sheetRow(r, PT[r._id] || r._id || 'غير محدد')),
      },
      {
        key: 'customers', ar: 'أكبر العملاء (قيمة البيع)', en: 'Top customers (selling)',
        columns: [col('name', 'العميل', 'Customer'), ...sheetCols],
        rows: byCustomer.map((r) => sheetRow(r, r._id || '—')),
      },
      {
        key: 'suppliers', ar: 'أكبر الموردين (قيمة الشراء)', en: 'Top suppliers (purchase)',
        columns: [col('name', 'المورد', 'Supplier'), ...sheetCols],
        rows: bySupplier.map((r) => sheetRow(r, r._id || '—')),
      },
      {
        key: 'losing', ar: 'كشوف قيمة شرائها أكبر من بيعها', en: 'Sheets bought above their selling value',
        noteAr: 'راجعها أولًا: أغلبها خطأ في إدخال قيمة الشراء، وهي التي تقلب هامش التشغيل.',
        columns: [col('report', 'رقم الكشف', 'Sheet'), col('date', 'التاريخ', 'Date', 'date'), col('branch', 'الفرع', 'Branch'), col('customer', 'العميل', 'Customer'), col('supplier', 'المورد', 'Supplier'), col('selling', 'البيع', 'Selling', 'money'), col('purchase', 'الشراء', 'Purchase', 'money'), col('loss', 'الفرق', 'Loss', 'money')],
        rows: losing.map((w) => ({ report: w.reportNumber, date: w.reportDate, branch: w.branch, customer: w.username, supplier: w.carOwner, selling: round(w.sellingValue), purchase: round(w.purchaseValue), loss: round((w.sellingValue || 0) - (w.purchaseValue || 0)) })).sort((a, b) => a.loss - b.loss),
      },
      {
        key: 'transactions', ar: 'حركات المحافظ', en: 'Wallet transactions',
        columns: [
          col('date', 'التاريخ', 'Date', 'date'), col('branch', 'الفرع', 'Branch'), col('type', 'النوع', 'Type'),
          col('amount', 'المبلغ', 'Amount', 'money'), col('category', 'التصنيف', 'Category'),
          col('driver', 'السائق', 'Driver'), col('vendor', 'المورد', 'Vendor'), col('statement', 'رقم الكشف', 'Sheet no.'),
          col('details', 'البيان', 'Details'),
        ],
        rows: txns.map((x) => ({
          date: x.date, branch: x.branch?.name || '', type: TYPE_AR[x.type] || x.type, amount: round(x.amount),
          category: x.expenseCategory?.name || '', driver: x.driverName || x.purchaseDriverName || '',
          vendor: x.vendorName || '', statement: x.deliveryStatementNumber || x.purchaseDeliveryStatementNumber || '',
          details: x.description || x.itemName || '',
        })),
        capped: txns.length >= 2000,
      },
    ],
    notes: [
      { ar: 'قيمة البيع في الكشوف تُحدَّث من منصّة التشغيل، وقد تختلف عمّا فُوتر فعلًا — الفواتير في «ماليات التحصيل».', en: 'Sheet selling value syncs from the ops platform and may differ from what was invoiced.' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات التحصيل
// ═══════════════════════════════════════════════════════════════════════════
async function collections(p, user) {
  const [dash, aging, perf] = await Promise.all([
    callController('../controllers/collectionsDeptController', 'dashboard', { from: p.from, to: p.to }, user),
    callController('../controllers/collectionsLedgerController', 'aging', { limit: 1000 }, user),
    callController('../controllers/collectionsLedgerController', 'performance', { from: p.from, to: p.to }, user),
  ]);
  const c = dash?.customers || {};
  const s = dash?.suppliers || {};
  const bands = aging?.totals?.bands || {};
  const BAND_AR = { '15-': 'أقل من 15 يوم', '30-': '15–30 يوم', '45-': '30–45 يوم', '60-': '45–60 يوم', '60+': '60–90 يوم', '90+': '90–120 يوم', '120+': '120 يوم – سنة', '1Y+': 'أكثر من سنة', noDate: 'بلا تاريخ' };
  return {
    cards: [
      card('ledgerOutstanding', 'المستحق على العملاء (دفتر الأعمار)', 'Receivable (aging ledger)', aging?.totals?.outstanding, { tone: 'warn', href: '/system/collections-dept/aging' }),
      card('collectedPeriod', 'المحصَّل في الفترة', 'Collected in period', perf?.totals?.collectedAmount, { tone: 'good', href: '/system/collections-dept/ledger' }),
      card('overdue', 'المتأخّر عن أجله', 'Overdue', perf?.totals?.overdueAmount, { tone: 'bad' }),
      card('aged60', 'متقادم أكثر من 60 يوم', 'Aged over 60 days', perf?.totals?.agedOver60Amount, { tone: 'bad' }),
      card('creditLimit', 'مجموع حدود الائتمان', 'Total credit limits', aging?.totals?.creditLimit),
      card('custTotal', 'قيمة كشوف العملاء في الفترة', 'Customer sheets in period', c.total, { href: '/system/collections-dept/dashboard' }),
      card('custOutstanding', 'غير المحصَّل من كشوف الفترة', 'Uncollected sheets (period)', c.outstanding, { tone: 'warn' }),
      card('suppOutstanding', 'المستحق للموردين (كشوف الفترة)', 'Payable to suppliers (period)', s.outstanding, { tone: 'warn' }),
    ],
    tables: [
      {
        key: 'agingBands', ar: 'أعمار الديون — دفتر الفواتير', en: 'Receivable aging — invoice ledger',
        columns: [col('band', 'الشريحة', 'Band'), col('amount', 'المبلغ', 'Amount', 'money')],
        rows: Object.entries(bands).map(([k, v]) => ({ band: BAND_AR[k] || k, amount: round(v) })),
      },
      {
        key: 'officers', ar: 'أداء موظفي التحصيل', en: 'Collectors performance',
        columns: [
          col('officer', 'الموظف', 'Collector'), col('accounts', 'الحسابات', 'Accounts', 'number'),
          col('collectedAmount', 'المحصَّل', 'Collected', 'money'), col('openAmount', 'المفتوح', 'Open', 'money'),
          col('overdueAmount', 'المتأخّر', 'Overdue', 'money'), col('agedOver60Amount', 'فوق 60 يوم', 'Over 60 days', 'money'),
          col('collectionRate', 'نسبة التحصيل ٪', 'Collection %', 'pct'),
        ],
        rows: (perf?.rows || []).map((r) => ({ ...r, collectedAmount: round(r.collectedAmount), openAmount: round(r.openAmount), overdueAmount: round(r.overdueAmount), agedOver60Amount: round(r.agedOver60Amount), collectionRate: round(r.collectionRate) })),
      },
      {
        key: 'accounts', ar: 'حسابات العملاء — المستحق', en: 'Customer accounts — outstanding',
        columns: [
          col('code', 'الكود', 'Code'), col('name', 'العميل', 'Customer'), col('officer', 'موظف التحصيل', 'Collector'),
          col('outstanding', 'المستحق', 'Outstanding', 'money'), col('tax', 'ضريبي', 'Tax', 'money'), col('cash', 'نقدي', 'Cash', 'money'),
          col('creditLimit', 'حد الائتمان', 'Credit limit', 'money'), col('creditDays', 'أيام الائتمان', 'Credit days', 'number'),
          col('invoices', 'الفواتير', 'Invoices', 'number'),
        ],
        rows: (aging?.rows || []).map((r) => ({
          _href: r._id ? `/system/collections-dept/parties/${r._id}` : null,
          code: r.code, name: r.name, officer: r.collectionOfficer, outstanding: round(r.outstanding),
          tax: round(r.taxOutstanding), cash: round(r.cashOutstanding), creditLimit: round(r.creditLimit),
          creditDays: r.creditDays, invoices: r.invoiceCount,
        })),
      },
      {
        key: 'byBranch', ar: 'المستحق حسب الفرع (كشوف الفترة)', en: 'By branch (period sheets)',
        columns: [col('branch', 'الفرع', 'Branch'), col('reports', 'الكشوف', 'Sheets', 'number'), col('receivable', 'على العملاء', 'Receivable', 'money'), col('payable', 'للموردين', 'Payable', 'money')],
        rows: (dash?.byBranch || []).map((r) => ({ branch: r.branch || '—', reports: r.reports, receivable: round(r.receivable), payable: round(r.payable) })),
      },
      {
        key: 'monthly', ar: 'كشوف العملاء شهرًا بشهر', en: 'Customer sheets by month',
        columns: [col('month', 'الشهر', 'Month'), col('total', 'القيمة', 'Value', 'money'), col('settled', 'المحصَّل', 'Collected', 'money'), col('outstanding', 'المتبقي', 'Open', 'money')],
        rows: (dash?.monthly || []).map((r) => ({ month: r.month, total: round(r.total), settled: round(r.settled), outstanding: round(r.outstanding) })),
      },
      {
        key: 'topSuppliers', ar: 'أكبر المستحقات للموردين', en: 'Largest supplier balances',
        columns: [col('name', 'المورد', 'Supplier'), col('reports', 'الكشوف', 'Sheets', 'number'), col('outstanding', 'المستحق', 'Outstanding', 'money')],
        rows: (s.top || []).map((r) => ({ name: r.name, reports: r.reports, outstanding: round(r.outstanding) })),
      },
    ],
    notes: [
      { ar: 'دفتر الأعمار (الفواتير) وكشوف التشغيل مصدران منفصلان: الأول ما فوتره المحاسب، والثاني قيمة الكشوف المنفَّذة. لا يُجمعان.', en: 'The aging ledger (invoices) and operations sheets are separate sources and are not added together.' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات إدارة الأسطول
// ═══════════════════════════════════════════════════════════════════════════
async function fleet(p, user) {
  const Ls2Repair = require('../models/Ls2Repair');
  const Ls2ServiceLog = require('../models/Ls2ServiceLog');
  const [loads, expenses, vlog, store, repairs, services] = await Promise.all([
    callController('../controllers/fleetController', 'getLoadsAnalysis', { from: p.from, to: p.to }, user),
    callController('../controllers/fleetController', 'getDriverExpenses', { from: p.from, to: p.to }, user),
    callController('../controllers/fleetController', 'getVehicleLogsSummary', { from: p.from, to: p.to }, user),
    callController('../controllers/ls2StoreController', 'dashboard', {}, user),
    Ls2Repair.find({ repairDate: { $gte: p.fromDate, $lte: p.toDate } }).select('plate title category cost repairDate workshop status').sort({ repairDate: -1 }).lean(),
    Ls2ServiceLog.find({ $or: [{ serviceDate: { $gte: p.fromDate, $lte: p.toDate } }, { serviceDate: null, createdAt: { $gte: p.fromDate, $lte: p.toDate } }] })
      .select('plate serviceType intervalName cost serviceDate createdAt').lean(),
  ]);
  const T = loads?.totals || {};
  const E = expenses?.summary || {};
  const vrows = vlog?.rows || [];
  const logCost = sum(vrows, 'logCost');
  const repairCost = sum(repairs, 'cost');
  const serviceCost = sum(services, 'cost');
  return {
    cards: [
      card('income', 'إيراد الحمولات', 'Load income', T.income, { tone: 'good', href: '/system/fleet/loads-analysis' }),
      card('driverExpense', 'مصروف السائقين', 'Driver expenses', T.driverExpense, { tone: 'bad', href: '/system/fleet/driver-expenses' }),
      card('unpaid', 'مصروف سائقين غير مصروف', 'Driver expenses unpaid', E.unpaid, { tone: 'warn', href: '/system/fleet/driver-expenses' }),
      card('logCost', 'تكاليف سجل المركبات', 'Vehicle log costs', logCost, { tone: 'bad', href: '/system/fleet/vehicle-logs' }),
      card('repairCost', 'تكلفة الإصلاحات (الورشة)', 'Workshop repairs', repairCost, { tone: 'bad', href: '/system/ls2/repairs' }),
      card('serviceCost', 'تكلفة الصيانة الدورية', 'Scheduled service cost', serviceCost, { tone: 'bad', href: '/system/ls2/maintenance' }),
      card('net', 'الصافي بعد التكاليف', 'Net after costs', (T.income || 0) - (T.driverExpense || 0) - logCost - repairCost - serviceCost, { tone: 'good' }),
      card('storeValue', 'قيمة مخزون قطع الغيار', 'Spare-parts stock value', store?.totals?.totalValue, { href: '/system/ls2/store' }),
      card('loads', 'الحمولات', 'Loads', T.loads, { format: 'number' }),
    ],
    tables: [
      {
        key: 'vehicles', ar: 'صافي كل شاحنة', en: 'Net per truck',
        columns: [
          col('plate', 'الشاحنة', 'Truck'), col('supervisor', 'المشرف', 'Supervisor'), col('loads', 'الحمولات', 'Loads', 'number'),
          col('income', 'الإيراد', 'Income', 'money'), col('driverExpense', 'مصروف السائق', 'Driver expense', 'money'),
          col('logCost', 'تكاليف السجل', 'Log costs', 'money'), col('net', 'الصافي', 'Net', 'money'), col('target', 'المستهدف', 'Target', 'money'),
        ],
        rows: vrows.map((r) => ({ _href: `/system/fleet/vehicle-logs/${encodeURIComponent(r.plate)}`, plate: r.plate, supervisor: r.supervisorName, loads: r.loads, income: round(r.income), driverExpense: round(r.driverExpense), logCost: round(r.logCost), net: round(r.net), target: round(r.target) })),
      },
      {
        key: 'customers', ar: 'الإيراد حسب العميل', en: 'Income by customer',
        columns: [col('name', 'العميل', 'Customer'), col('loads', 'الحمولات', 'Loads', 'number'), col('income', 'الإيراد', 'Income', 'money'), col('driverExpense', 'مصروف السائقين', 'Driver expense', 'money')],
        rows: (loads?.byCustomer || []).map((r) => ({ _href: r._id && mongoose.isValidObjectId(r._id) ? `/system/fleet/customers/${r._id}` : null, name: r.name, loads: r.loads, income: round(r.income), driverExpense: round(r.driverExpense) })),
      },
      {
        key: 'drivers', ar: 'مصروف السائقين حسب السائق', en: 'Driver expenses by driver',
        columns: [col('name', 'السائق', 'Driver'), col('loads', 'الحمولات', 'Loads', 'number'), col('income', 'إيراد حمولاته', 'Income', 'money'), col('driverExpense', 'مصروفه', 'Expense', 'money')],
        rows: (loads?.byDriver || []).map((r) => ({ name: r.name, loads: r.loads, income: round(r.income), driverExpense: round(r.driverExpense) })),
      },
      {
        key: 'supervisors', ar: 'حسب المشرف', en: 'By supervisor',
        columns: [col('name', 'المشرف', 'Supervisor'), col('loads', 'الحمولات', 'Loads', 'number'), col('income', 'الإيراد', 'Income', 'money'), col('driverExpense', 'مصروف السائقين', 'Driver expense', 'money')],
        rows: (loads?.bySupervisor || []).map((r) => ({ name: r.name, loads: r.loads, income: round(r.income), driverExpense: round(r.driverExpense) })),
      },
      {
        key: 'repairs', ar: 'الإصلاحات في الفترة', en: 'Repairs in period',
        columns: [col('date', 'التاريخ', 'Date', 'date'), col('plate', 'الشاحنة', 'Truck'), col('title', 'الإصلاح', 'Repair'), col('category', 'الفئة', 'Category'), col('workshop', 'الورشة', 'Workshop'), col('cost', 'التكلفة', 'Cost', 'money')],
        rows: repairs.map((r) => ({ date: r.repairDate, plate: r.plate, title: r.title, category: r.category, workshop: r.workshop, cost: round(r.cost) })),
      },
      {
        key: 'daily', ar: 'يومًا بيوم', en: 'Day by day',
        columns: [col('day', 'اليوم', 'Day'), col('loads', 'الحمولات', 'Loads', 'number'), col('income', 'الإيراد', 'Income', 'money'), col('driverExpense', 'مصروف السائقين', 'Driver expense', 'money')],
        rows: (loads?.byDay || []).map((r) => ({ day: r.day, loads: r.loads, income: round(r.income), driverExpense: round(r.driverExpense) })),
      },
    ],
    notes: [
      { ar: 'مكافأة الجمعة داخلة في مصروف السائق عند تسجيل الحمولة — لا تُضاف مرّة ثانية.', en: 'The Friday bonus is already inside the driver expense.' },
      { ar: 'قيمة المخزون هي الكمية الحالية × سعر الوحدة الحالي، لا تكلفة ما صُرف تاريخيًا.', en: 'Stock value is current quantity × current unit price.' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات التخليص الجمركي
// ═══════════════════════════════════════════════════════════════════════════
async function customs(p, user) {
  const CustomsClearance = require('../models/CustomsClearance');
  const ym = (k) => k.slice(0, 7);
  const ymNum = (k) => Number(k.slice(0, 4)) * 100 + Number(k.slice(5, 7));
  const pk = { $add: [{ $multiply: [{ $ifNull: ['$periodYear', 0] }, 100] }, { $ifNull: ['$periodMonth', 0] }] };
  const [a, files] = await Promise.all([
    callController('../controllers/customsClearanceController', 'getAnalytics', { from: ym(p.from), to: ym(p.to) }, user),
    // الشهرُ يُصفّى في القاعدة: كانت تُنقَل المعاملاتُ كلُّها (٢٢٠ كيلوبايت)
    // ليُعرَض منها شهر.
    CustomsClearance.find({
      cancelled: { $ne: true },
      $expr: { $and: [{ $gte: [pk, ymNum(p.from)] }, { $lte: [pk, ymNum(p.to)] }] },
    })
      .select('refNumber blNumber customerName agentParty shippingAgent branch port periodYear periodMonth costs revenue containerCount billing stage').lean(),
  ]);
  const inRange = (f) => {
    if (!f.periodYear || !f.periodMonth) return false;
    const k = `${f.periodYear}-${String(f.periodMonth).padStart(2, '0')}`;
    return k >= ym(p.from) && k <= ym(p.to);
  };
  const mine = files.filter(inRange);
  const COST_AR = {
    deliveryOrder: 'إذن التسليم', customsDuty: 'الرسوم الجمركية', portFees: 'رسوم الميناء', unloadingFees: 'التفريغ',
    transport: 'النقل', transportToYard: 'النقل للساحة', appointmentBooking: 'حجز المواعيد', yardFees: 'رسوم الساحة',
    demurrage: 'الأرضيات/التأخير', inspection: 'الكشف', extension: 'التمديد', consolidator: 'المجمِّع',
    commissions: 'العمولات', extraFees: 'أجور إضافية', storage: 'التخزين', exitPermit: 'إذن الخروج',
  };
  const costRows = Object.entries(COST_AR).map(([k, ar]) => ({ item: ar, amount: round(sum(mine, (f) => f.costs?.[k])) })).filter((r) => r.amount);
  const T = a?.totals || {};
  const groupCols = [col('name', 'الاسم', 'Name'), col('count', 'المعاملات', 'Files', 'number'), col('containers', 'الحاويات', 'Containers', 'number'), col('revenue', 'الإيراد', 'Revenue', 'money'), col('costs', 'التكاليف', 'Costs', 'money'), col('profit', 'الربح', 'Profit', 'money'), col('clearanceFee', 'أتعاب التخليص', 'Clearance fees', 'money')];
  const g = (rows) => (rows || []).map((r) => ({ name: r.key, count: r.count, containers: r.containers, revenue: round(r.revenue), costs: round(r.costs), profit: round(r.profit), clearanceFee: round(r.clearanceFee) }));
  return {
    cards: [
      card('revenue', 'إجمالي الإيراد', 'Total revenue', T.totalRevenue, { tone: 'good' }),
      card('costs', 'إجمالي التكاليف', 'Total costs', T.totalCosts, { tone: 'bad' }),
      card('profit', 'صافي الربح', 'Net profit', T.netProfit, { tone: (T.netProfit || 0) >= 0 ? 'good' : 'bad' }),
      card('margin', 'هامش الربح', 'Margin', (T.margin || 0) * 100, { format: 'pct' }),
      card('fees', 'أتعاب التخليص', 'Clearance fees', T.clearanceFees),
      card('avgInvoice', 'متوسط الفاتورة', 'Average invoice', T.avgInvoice),
      card('files', 'المعاملات', 'Files', T.clearances, { format: 'number' }),
      card('notInvoiced', 'معاملات لم تُفوتر', 'Not invoiced', T.notInvoiced, { format: 'number', tone: T.notInvoiced ? 'warn' : 'neutral' }),
    ],
    tables: [
      { key: 'byCustomer', ar: 'حسب العميل', en: 'By customer', columns: groupCols, rows: g(a?.byCustomer) },
      { key: 'byAgent', ar: 'حسب الوكيل الملاحي', en: 'By shipping agent', columns: groupCols, rows: g(a?.byAgent) },
      { key: 'byMonth', ar: 'شهرًا بشهر', en: 'By month', columns: groupCols, rows: g(a?.byMonth) },
      { key: 'byBranch', ar: 'حسب الفرع', en: 'By branch', columns: groupCols, rows: g(a?.byBranch) },
      { key: 'costItems', ar: 'التكاليف حسب البند', en: 'Costs by item', columns: [col('item', 'البند', 'Item'), col('amount', 'المبلغ', 'Amount', 'money')], rows: costRows.sort((x, y) => y.amount - x.amount) },
      {
        key: 'files', ar: 'المعاملات', en: 'Files',
        columns: [col('ref', 'رقم المعاملة', 'Transaction'), col('customer', 'العميل', 'Customer'), col('bl', 'رقم البوليصة', 'BL'), col('branch', 'الفرع', 'Branch'), col('period', 'الشهر', 'Month'), col('containers', 'الحاويات', 'Containers', 'number'), col('revenue', 'الإيراد', 'Revenue', 'money'), col('costs', 'التكاليف', 'Costs', 'money'), col('profit', 'الربح', 'Profit', 'money'), col('invoice', 'حالة الفوترة', 'Invoicing')],
        rows: mine.map((f) => ({ _open: true, _customsId: String(f._id), ref: f.refNumber, bl: f.blNumber, customer: f.customerName, branch: f.branch === 'dammam' ? 'الدمام' : f.branch === 'jeddah' ? 'جدة' : f.branch, period: `${f.periodYear}-${String(f.periodMonth).padStart(2, '0')}`, containers: f.containerCount, revenue: round(f.revenue?.totalInvoiced), costs: round(f.costs?.total), profit: round(f.revenue?.profit), invoice: f.billing?.invoiceStatus || '' })),
      },
    ],
    notes: [{ ar: 'نقلُ الساحة وبيعُ النقل مستثنيان من الربح عمدًا في حساب القسم كي لا يُعدّا مرّتين.', en: 'Yard transport and transport selling are excluded from profit by design.' }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات النقل الخفيف — مناديب الأفراد ودرّاجاتهم
// ═══════════════════════════════════════════════════════════════════════════
async function light(p, user) {
  const B2CWalletEntry = require('../models/B2CWalletEntry');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');
  const User = require('../models/User');
  const [managers, periodByPm, entries, bikes, allClaims] = await Promise.all([
    callController('../controllers/b2cWalletController', 'managers', {}, user),
    B2CWalletEntry.aggregate([
      { $match: { createdAt: { $gte: p.fromDate, $lte: p.toDate } } },
      { $group: { _id: '$projectManager', in: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amount', 0] } }, out: { $sum: { $cond: [{ $eq: ['$direction', 'out'] }, '$amount', 0] } }, n: { $sum: 1 } } },
    ]),
    B2CWalletEntry.find({ createdAt: { $gte: p.fromDate, $lte: p.toDate } }).populate('projectManager', 'firstName lastName').sort({ createdAt: -1 }).limit(2000).lean(),
    VehicleMaster.find({ sectorAr: 'النقل الخفيف', isActive: { $ne: false } }).select('plateNumber departmentAr registrationTypeAr insurance.premiumSar insurance.premiumStatusAr insurance.companyAr fuelCard.limitSar').lean(),
    VehicleClaim.find({ isActive: { $ne: false } }).select('claimId vehicle vehiclePlate vehiclePlateKey vehicleSectorAr accidentDate claim statusAr').lean(),
  ]);
  // المطالبةُ تُنسب للدرّاجة بالمركبة نفسِها: سبعٌ وعشرون مطالبةً بلا قطاعٍ مكتوب.
  const bikeIds = new Set(bikes.map((b) => String(b._id)));
  const claims = allClaims.filter((c) => c.vehicleSectorAr === 'النقل الخفيف' || (c.vehicle && bikeIds.has(String(c.vehicle))));
  const byPm = new Map(periodByPm.map((x) => [String(x._id), x]));
  const pms = managers?.managers || [];
  void User;
  const byProject = new Map();
  for (const b of bikes) {
    const k = b.departmentAr || 'غير محدد';
    const cur = byProject.get(k) || { project: k, vehicles: 0, premium: 0, noPremium: 0 };
    cur.vehicles += 1;
    if (b.insurance?.premiumSar != null) cur.premium += Number(b.insurance.premiumSar) || 0; else cur.noPremium += 1;
    byProject.set(k, cur);
  }
  const premium = sum(bikes, (b) => b.insurance?.premiumSar);
  return {
    cards: [
      card('custodyIn', 'عُهَد مُسلَّمة في الفترة', 'Custody given (period)', sum(periodByPm, 'in'), { tone: 'warn', href: '/system/b2c/custody' }),
      card('custodyOut', 'مصروف من العُهَد في الفترة', 'Custody spent (period)', sum(periodByPm, 'out'), { tone: 'bad', href: '/system/b2c/custody' }),
      card('custodyBalance', 'أرصدة العُهَد القائمة', 'Open custody balances', sum(pms, 'balance'), { href: '/system/b2c/custody' }),
      card('premium', 'أقساط تأمين الدرّاجات', 'Motorcycle insurance premiums', premium, { tone: 'bad', href: '/system/vehicles/registry/insurance/vehicles' }),
      card('claims', 'تقديرات حوادث الدرّاجات', 'Motorcycle claim estimates', sum(claims, (c) => c.claim?.estimatedAmountSar), { tone: 'bad', href: '/system/vehicles/registry/claims' }),
      card('recovery', 'المتوقّع استرداده', 'Expected recovery', sum(claims, (c) => c.claim?.expectedRecoverySar), { tone: 'good' }),
      card('bikes', 'مركبات النقل الخفيف', 'Light-transport vehicles', bikes.length, { format: 'number' }),
    ],
    tables: [
      {
        key: 'managers', ar: 'عُهَد مديري المشاريع', en: 'Project managers custody',
        columns: [col('name', 'مدير المشروع', 'Project manager'), col('periodIn', 'مُسلَّم في الفترة', 'Given (period)', 'money'), col('periodOut', 'مصروف في الفترة', 'Spent (period)', 'money'), col('totalIn', 'إجمالي المُسلَّم', 'Total given', 'money'), col('totalOut', 'إجمالي المصروف', 'Total spent', 'money'), col('balance', 'الرصيد', 'Balance', 'money')],
        rows: pms.map((m) => ({ _href: '/system/b2c/custody', name: `${m.firstName || ''} ${m.lastName || ''}`.trim(), periodIn: round(byPm.get(String(m._id))?.in), periodOut: round(byPm.get(String(m._id))?.out), totalIn: round(m.totalIn), totalOut: round(m.totalOut), balance: round(m.balance) })),
      },
      {
        key: 'projects', ar: 'الدرّاجات والأقساط حسب المشروع', en: 'Vehicles and premiums by project',
        columns: [col('project', 'المشروع', 'Project'), col('vehicles', 'المركبات', 'Vehicles', 'number'), col('premium', 'الأقساط', 'Premiums', 'money'), col('noPremium', 'بلا قسط مسجَّل', 'No premium recorded', 'number')],
        rows: [...byProject.values()].map((r) => ({ ...r, premium: round(r.premium) })).sort((x, y) => y.vehicles - x.vehicles),
      },
      {
        key: 'entries', ar: 'حركات العُهَد', en: 'Custody entries',
        columns: [col('date', 'التاريخ', 'Date', 'date'), col('pm', 'مدير المشروع', 'Project manager'), col('direction', 'الاتجاه', 'Direction'), col('amount', 'المبلغ', 'Amount', 'money'), col('method', 'الطريقة', 'Method'), col('reason', 'السبب', 'Reason')],
        rows: entries.map((e) => ({ date: e.createdAt, pm: `${e.projectManager?.firstName || ''} ${e.projectManager?.lastName || ''}`.trim(), direction: e.direction === 'in' ? 'تسليم' : 'صرف', amount: round(e.amount), method: { cash: 'نقدي', bank_transfer: 'تحويل', other: 'أخرى' }[e.method] || '', reason: e.reason || '' })),
      },
      {
        key: 'claims', ar: 'حوادث الدرّاجات', en: 'Motorcycle claims',
        columns: [col('claimId', 'رقم المطالبة', 'Claim'), col('plate', 'اللوحة', 'Plate'), col('date', 'تاريخ الحادث', 'Accident date', 'date'), col('insurer', 'شركة التأمين', 'Insurer'), col('estimated', 'التقدير', 'Estimate', 'money'), col('recovery', 'المتوقّع استرداده', 'Recovery', 'money'), col('status', 'الحالة', 'Status')],
        rows: claims.map((c) => ({ _href: '/system/vehicles/registry/claims', claimId: c.claimId, plate: c.vehiclePlate, date: c.accidentDate, insurer: c.claim?.insurerAr, estimated: round(c.claim?.estimatedAmountSar), recovery: round(c.claim?.expectedRecoverySar), status: c.statusAr })),
      },
    ],
    notes: [{ ar: 'النقل الخفيف = مناديب الأفراد ودرّاجاتهم (كيتا، هنجرستيشن، أمازون، نينجا). طلبات المناديب في النظام أعدادٌ لا مبالغ، فلا إيراد مسجَّل لها هنا.', en: 'Light transport = B2C riders and motorcycles. Rider orders are counts, not amounts, so no revenue is recorded.' }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات التسويق والتطوير
// ═══════════════════════════════════════════════════════════════════════════
async function marketing(p, user) {
  const BdTender = require('../models/BdTender');
  const MarketingCampaign = require('../models/MarketingCampaign');
  const [mk, bd, tenders, campaigns] = await Promise.all([
    callController('../controllers/marketingController', 'getDashboard', { from: p.from, to: p.to }, user),
    callController('../controllers/bdController', 'getDashboard', { from: p.from, to: p.to }, user),
    BdTender.find({}).select('title status estimatedValue bidBondAmount submissionDeadline').lean(),
    MarketingCampaign.find({}).select('name platform status budget spend revenue startDate endDate').lean(),
  ]);
  const M = mk?.totals || {};
  const B = bd?.totals || {};
  return {
    cards: [
      card('budget', 'ميزانيات الحملات', 'Campaign budgets', M.budget, { href: '/system/marketing' }),
      card('spend', 'الإنفاق التسويقي', 'Marketing spend', M.spend, { tone: 'bad', href: '/system/marketing' }),
      card('revenue', 'إيراد الحملات', 'Campaign revenue', sum(campaigns, 'revenue'), { tone: 'good' }),
      card('cpl', 'تكلفة العميل المحتمل', 'Cost per lead', M.cpl),
      card('pipeline', 'قيمة فرص التطوير', 'BD pipeline value', B.pipelineValue, { tone: 'good', href: '/system/bd' }),
      card('weighted', 'القيمة المرجَّحة بالاحتمال', 'Weighted pipeline', B.weightedPipelineValue),
      card('bonds', 'خطابات الضمان للمناقصات', 'Tender bid bonds', sum(tenders, 'bidBondAmount'), { tone: 'warn' }),
    ],
    tables: [
      { key: 'platforms', ar: 'الإنفاق حسب المنصّة', en: 'Spend by platform', columns: [col('name', 'المنصّة', 'Platform'), col('budget', 'الميزانية', 'Budget', 'money'), col('spend', 'الإنفاق', 'Spend', 'money'), col('leads', 'العملاء المحتملون', 'Leads', 'number')], rows: (mk?.byPlatform || []).map((r) => ({ name: r.platform || r.key || r._id, budget: round(r.budget), spend: round(r.spend), leads: r.leads })) },
      { key: 'campaigns', ar: 'الحملات', en: 'Campaigns', columns: [col('name', 'الحملة', 'Campaign'), col('platform', 'المنصّة', 'Platform'), col('status', 'الحالة', 'Status'), col('budget', 'الميزانية', 'Budget', 'money'), col('spend', 'الإنفاق', 'Spend', 'money'), col('revenue', 'الإيراد', 'Revenue', 'money'), col('start', 'البداية', 'Start', 'date')], rows: campaigns.map((c) => ({ _href: '/system/marketing', name: c.name, platform: c.platform, status: c.status, budget: round(c.budget), spend: round(c.spend), revenue: round(c.revenue), start: c.startDate })) },
      { key: 'funnel', ar: 'قيمة الفرص حسب المرحلة', en: 'Pipeline by stage', columns: [col('stage', 'المرحلة', 'Stage'), col('count', 'الفرص', 'Opportunities', 'number'), col('value', 'القيمة', 'Value', 'money')], rows: (bd?.funnel || []).map((r) => ({ stage: r.stage, count: r.count, value: round(r.value) })) },
      { key: 'tenders', ar: 'المناقصات', en: 'Tenders', columns: [col('title', 'المناقصة', 'Tender'), col('status', 'الحالة', 'Status'), col('estimated', 'القيمة التقديرية', 'Estimated value', 'money'), col('bond', 'خطاب الضمان', 'Bid bond', 'money'), col('deadline', 'آخر موعد', 'Deadline', 'date')], rows: tenders.map((t) => ({ _href: '/system/bd', title: t.title, status: t.status, estimated: round(t.estimatedValue), bond: round(t.bidBondAmount), deadline: t.submissionDeadline })) },
    ],
    notes: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات الموارد البشرية
// ═══════════════════════════════════════════════════════════════════════════
async function hr() {
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');
  const Asset = require('../models/Asset');
  require('../models/Branch');
  const [employees, contracts, hrAssets] = await Promise.all([
    // حساباتُ الدخول التلقائيّة ليست موظّفين (isHrRecord:false) — لا رواتبَ لها.
    Employee.find({ employmentStatus: { $ne: 'terminated' }, isHrRecord: { $ne: false } })
      .select('firstName lastName arabicName employeeNumber department jobTitle branch branchName basicSalary allowances employmentStatus')
      .populate('branch', 'name').lean(),
    Contract.find({ status: 'active' }).select('employee basicSalary allowances endDate type').lean(),
    Asset.find({ issuedBySection: 'hr' }).select('name value status telecom.package').lean(),
  ]);
  const byEmp = new Map(contracts.map((c) => [String(c.employee), c]));
  const rows = employees.map((e) => {
    const c = byEmp.get(String(e._id));
    const basic = Number(c?.basicSalary ?? e.basicSalary) || 0;
    const allow = Number(c?.allowances ?? e.allowances) || 0;
    return {
      _href: `/system/hr/employees/${e._id}`,
      number: e.employeeNumber, name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
      department: e.department || '', branch: e.branch?.name || e.branchName || '', job: e.jobTitle || '',
      basic: round(basic), allowances: round(allow), total: round(basic + allow),
      source: c ? 'العقد' : 'ملف الموظف', contractEnd: c?.endDate || '',
    };
  });
  const group = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key] || 'غير محدد';
      const cur = m.get(k) || { name: k, employees: 0, basic: 0, allowances: 0, total: 0 };
      cur.employees += 1; cur.basic += r.basic; cur.allowances += r.allowances; cur.total += r.total;
      m.set(k, cur);
    }
    return [...m.values()].map((x) => ({ ...x, basic: round(x.basic), allowances: round(x.allowances), total: round(x.total), annual: round(x.total * 12) })).sort((a, b) => b.total - a.total);
  };
  const monthly = sum(rows, 'total');
  const noSalary = rows.filter((r) => !r.total).length;
  const groupCols = [col('name', 'الاسم', 'Name'), col('employees', 'الموظفون', 'Employees', 'number'), col('basic', 'الأساسي', 'Basic', 'money'), col('allowances', 'البدلات', 'Allowances', 'money'), col('total', 'الشهري', 'Monthly', 'money'), col('annual', 'السنوي', 'Annual', 'money')];
  return {
    cards: [
      card('monthly', 'الرواتب الشهرية (حسب العقود)', 'Monthly salaries (contracts)', monthly, { tone: 'bad', href: '/system/hr/contracts' }),
      card('annual', 'التكلفة السنوية للرواتب', 'Annual salary cost', monthly * 12, { tone: 'bad' }),
      card('basic', 'الأساسي', 'Basic', sum(rows, 'basic')),
      card('allowances', 'البدلات', 'Allowances', sum(rows, 'allowances')),
      card('headcount', 'الموظفون', 'Employees', rows.length, { format: 'number', href: '/system/hr/employees' }),
      card('noSalary', 'موظفون بلا راتب مسجَّل', 'Employees with no salary recorded', noSalary, { format: 'number', tone: noSalary ? 'warn' : 'neutral' }),
      card('assets', 'قيمة عُهَد الموارد البشرية', 'HR custody value', sum(hrAssets, 'value'), { href: '/system/hr/custody' }),
    ],
    tables: [
      { key: 'departments', ar: 'الرواتب حسب القسم', en: 'Salaries by department', columns: groupCols, rows: group('department') },
      { key: 'branches', ar: 'الرواتب حسب الفرع', en: 'Salaries by branch', columns: groupCols, rows: group('branch') },
      {
        key: 'employees', ar: 'رواتب الموظفين', en: 'Employee salaries',
        columns: [col('number', 'الرقم الوظيفي', 'Emp. no.'), col('name', 'الموظف', 'Employee'), col('department', 'القسم', 'Department'), col('branch', 'الفرع', 'Branch'), col('job', 'المسمى', 'Job title'), col('basic', 'الأساسي', 'Basic', 'money'), col('allowances', 'البدلات', 'Allowances', 'money'), col('total', 'الإجمالي', 'Total', 'money'), col('source', 'المصدر', 'Source'), col('contractEnd', 'نهاية العقد', 'Contract end', 'date')],
        rows,
      },
    ],
    notes: [
      { ar: 'مسير الرواتب الفعلي (الخصومات، الإضافي، نهاية الخدمة) لا يُسجَّل في النظام — الأرقام هنا التزامات العقود السارية، ومن ملف الموظف حين لا عقد.', en: 'Actual payroll is not recorded in the system — these are active-contract obligations.' },
      { ar: 'أسعار باقات الجوال وتكاليف التراخيص غير مسجّلة في النظام.', en: 'Mobile package prices and licence costs are not recorded.' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات تقنية المعلومات
// ═══════════════════════════════════════════════════════════════════════════
async function it(p) {
  const Asset = require('../models/Asset');
  const AssetEvent = require('../models/AssetEvent');
  const ItSystem = require('../models/ItSystem');
  const [assets, sales, charges, systems] = await Promise.all([
    Asset.find({ issuedBySection: { $ne: 'hr' } }).select('name type category brand model value status soldPrice soldDate holderName').lean(),
    Asset.find({ status: 'sold', soldDate: { $gte: p.from, $lte: p.to } }).select('name type soldPrice soldDate soldToName value').populate('soldTo', 'firstName lastName arabicName').lean(),
    AssetEvent.find({ cost: { $gt: 0 }, $or: [{ date: { $gte: p.from, $lte: p.to } }, { createdAt: { $gte: p.fromDate, $lte: p.toDate } }] }).select('action cost date notes toEmployee').populate('asset', 'name').lean(),
    ItSystem.find({ status: { $ne: 'retired' } }).select('name nameAr type vendor cost costPeriod renewalDate status').lean(),
  ]);
  const monthlyOf = (s) => (s.costPeriod === 'monthly' ? s.cost : s.costPeriod === 'yearly' ? s.cost / 12 : 0);
  const byType = new Map();
  for (const a of assets) {
    const k = a.category || a.type || 'أخرى';
    const cur = byType.get(k) || { type: k, count: 0, value: 0, inStock: 0, assigned: 0 };
    cur.count += 1; cur.value += Number(a.value) || 0;
    if (a.status === 'in_stock') cur.inStock += 1;
    if (a.status === 'assigned') cur.assigned += 1;
    byType.set(k, cur);
  }
  return {
    cards: [
      card('assetsValue', 'قيمة الأصول التقنية', 'IT assets value', sum(assets.filter((a) => a.status !== 'sold'), 'value'), { href: '/system/it/custody' }),
      card('systemsMonthly', 'اشتراكات الأنظمة شهريًا', 'Systems — monthly', sum(systems, monthlyOf), { tone: 'bad', href: '/system/it/systems' }),
      card('systemsAnnual', 'اشتراكات الأنظمة سنويًا', 'Systems — annual', sum(systems, monthlyOf) * 12, { tone: 'bad' }),
      card('sales', 'مبيعات العُهَد في الفترة', 'Custody sales (period)', sum(sales, 'soldPrice'), { tone: 'good' }),
      card('charges', 'تحميلات تلف/فقد في الفترة', 'Damage/loss charges (period)', sum(charges, 'cost'), { tone: 'good' }),
      card('assets', 'عدد الأصول', 'Assets', assets.length, { format: 'number' }),
    ],
    tables: [
      { key: 'byType', ar: 'الأصول حسب النوع', en: 'Assets by type', columns: [col('type', 'النوع', 'Type'), col('count', 'العدد', 'Count', 'number'), col('assigned', 'مُسلَّمة', 'Assigned', 'number'), col('inStock', 'في المخزن', 'In stock', 'number'), col('value', 'القيمة', 'Value', 'money')], rows: [...byType.values()].map((r) => ({ ...r, value: round(r.value) })).sort((x, y) => y.value - x.value) },
      { key: 'systems', ar: 'الأنظمة والاشتراكات', en: 'Systems & subscriptions', columns: [col('name', 'النظام', 'System'), col('type', 'النوع', 'Type'), col('vendor', 'المزوّد', 'Vendor'), col('cost', 'التكلفة', 'Cost', 'money'), col('period', 'الدورية', 'Period'), col('monthly', 'ما يعادل شهريًا', 'Monthly equivalent', 'money'), col('renewal', 'التجديد', 'Renewal', 'date')], rows: systems.map((s) => ({ _href: '/system/it/systems', name: s.nameAr || s.name, type: s.type, vendor: s.vendor, cost: round(s.cost), period: { monthly: 'شهري', yearly: 'سنوي', one_time: 'مرة واحدة' }[s.costPeriod] || s.costPeriod, monthly: round(monthlyOf(s)), renewal: s.renewalDate })) },
      { key: 'sales', ar: 'العُهَد المباعة في الفترة', en: 'Custody sold in period', columns: [col('date', 'التاريخ', 'Date', 'date'), col('name', 'الصنف', 'Item'), col('buyer', 'المشتري', 'Buyer'), col('value', 'القيمة الدفترية', 'Book value', 'money'), col('price', 'سعر البيع', 'Sale price', 'money')], rows: sales.map((s) => ({ date: s.soldDate, name: s.name, buyer: s.soldTo ? (s.soldTo.arabicName || `${s.soldTo.firstName || ''} ${s.soldTo.lastName || ''}`.trim()) : s.soldToName, value: round(s.value), price: round(s.soldPrice) })) },
      { key: 'charges', ar: 'تحميلات التلف والفقد', en: 'Damage & loss charges', columns: [col('date', 'التاريخ', 'Date', 'date'), col('asset', 'الصنف', 'Item'), col('action', 'الحدث', 'Event'), col('cost', 'المبلغ', 'Amount', 'money'), col('notes', 'ملاحظات', 'Notes')], rows: charges.map((c) => ({ date: c.date || c.createdAt, asset: c.asset?.name, action: c.action, cost: round(c.cost), notes: c.notes })) },
    ],
    notes: [{ ar: 'صناديق البريد والتذاكر لا تحمل تكلفة في النظام.', en: 'Mailboxes and tickets carry no cost in the system.' }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ماليات المركبات
// ═══════════════════════════════════════════════════════════════════════════
async function vehicles(p, user) {
  const { VehicleMaster, VehicleInsurancePolicy } = require('../models/VehicleMaster');
  const [vs, policies, corp, claimsRes] = await Promise.all([
    VehicleMaster.find({ isActive: { $ne: false } }).select('plateNumber sectorAr departmentAr insurance.premiumSar insurance.premiumStatusAr insurance.companyAr insurance.policyNumber fuelCard.limitSar renewals').lean(),
    VehicleInsurancePolicy.find({}).select('policyNumber companyAr coverageTypeAr expiryDate totalPremiumSar vehicleCount renewals').lean(),
    callController('../controllers/vehicleRegistryController', 'listCorporatePolicies', {}, user),
    callController('../controllers/vehicleRegistryController', 'listClaims', {}, user),
  ]);
  const DOC_AR = { insurance: 'التأمين', vehicleLicense: 'الاستمارة', inspection: 'الفحص الدوري', operatingCard: 'بطاقة التشغيل', gps: 'GPS', authorization: 'التفويض', fuelCard: 'بترو اب' };
  const inP = (d) => { const t = d ? new Date(d).getTime() : NaN; return t >= p.fromDate.getTime() && t <= p.toDate.getTime(); };
  const renewals = [];
  for (const v of vs) for (const r of v.renewals || []) if (inP(r.at)) renewals.push({ _href: `/system/vehicles/registry/${v._id}`, date: r.at, plate: v.plateNumber, document: DOC_AR[r.document] || r.document, newExpiry: r.newExpiry, cost: round(r.cost), reference: r.reference || '' });
  for (const pl of policies) for (const r of pl.renewals || []) if (inP(r.at)) renewals.push({ _href: '/system/vehicles/registry/insurance/vehicles', date: r.at, plate: `وثيقة ${pl.policyNumber}`, document: 'وثيقة تأمين مجمّعة', newExpiry: r.newExpiry, cost: round(r.cost), reference: r.reference || '' });
  for (const pl of corp?.policies || []) for (const r of pl.renewals || []) if (inP(r.at)) renewals.push({ _href: '/system/vehicles/registry/corporate', date: r.at, plate: pl.scopeAr, document: 'وثيقة الشركة', newExpiry: r.newExpiry, cost: round(r.cost), reference: r.reference || '' });

  const bySector = new Map();
  for (const v of vs) {
    const k = v.sectorAr || 'غير محدد';
    const cur = bySector.get(k) || { sector: k, vehicles: 0, premium: 0, financed: 0, noPremium: 0, fuelLimit: 0 };
    cur.vehicles += 1;
    if (v.insurance?.premiumSar != null) cur.premium += Number(v.insurance.premiumSar) || 0;
    else if (v.insurance?.premiumStatusAr) cur.financed += 1; else cur.noPremium += 1;
    cur.fuelLimit += Number(v.fuelCard?.limitSar) || 0;
    bySector.set(k, cur);
  }
  const corpTotal = sum(corp?.policies || [], (x) => x.computedPremiumSar ?? x.premiumSar);
  const ct = claimsRes?.totals || {};
  return {
    cards: [
      card('vehiclePremiums', 'أقساط تأمين المركبات', 'Vehicle insurance premiums', sum(vs, (v) => v.insurance?.premiumSar), { tone: 'bad', href: '/system/vehicles/registry/insurance/vehicles' }),
      card('corporate', 'أقساط وثائق الشركة', 'Company policies premiums', corpTotal, { tone: 'bad', href: '/system/vehicles/registry/corporate' }),
      card('renewalsCost', 'تكلفة التجديدات في الفترة', 'Renewal costs (period)', sum(renewals, 'cost'), { tone: 'bad', href: '/system/vehicles/registry/expiring' }),
      card('claimsEstimated', 'تقديرات الحوادث', 'Claim estimates', ct.estimatedSar, { tone: 'bad', href: '/system/vehicles/registry/claims' }),
      card('recovery', 'المتوقّع استرداده', 'Expected recovery', ct.expectedRecoverySar, { tone: 'good' }),
      card('gap', 'فجوة الاسترداد', 'Recovery gap', ct.gapSar, { tone: 'warn' }),
      card('fuelLimits', 'حدود صرف بترو اب', 'Petro App limits', sum(vs, (v) => v.fuelCard?.limitSar), { href: '/system/vehicles/registry/fuel-cards' }),
      card('vehicles', 'المركبات', 'Vehicles', vs.length, { format: 'number', href: '/system/vehicles/registry' }),
    ],
    tables: [
      { key: 'sectors', ar: 'الأقساط حسب القطاع', en: 'Premiums by sector', noteAr: '«قسطها على جهة التمويل» مركبات مؤمَّنة يدفع قسطها البنك أو المؤجِّر.', columns: [col('sector', 'القطاع', 'Sector'), col('vehicles', 'المركبات', 'Vehicles', 'number'), col('premium', 'الأقساط', 'Premiums', 'money'), col('financed', 'قسطها على جهة التمويل', 'Premium paid by financier', 'number'), col('noPremium', 'بلا قسط مسجَّل', 'No premium recorded', 'number'), col('fuelLimit', 'حدود بترو اب', 'Fuel limits', 'money')], rows: [...bySector.values()].map((r) => ({ ...r, premium: round(r.premium), fuelLimit: round(r.fuelLimit) })).sort((x, y) => y.premium - x.premium) },
      { key: 'policies', ar: 'وثائق التأمين المجمّعة', en: 'Group insurance policies', noteAr: 'قسط الوثيقة كما في الملف — لا يُجمع مع أقساط المركبات فيُعدّ مرتين.', columns: [col('policy', 'رقم الوثيقة', 'Policy'), col('company', 'الشركة', 'Insurer'), col('coverage', 'نوع التأمين', 'Coverage'), col('vehicles', 'المركبات', 'Vehicles', 'number'), col('premium', 'القسط', 'Premium', 'money'), col('expiry', 'الانتهاء', 'Expiry', 'date')], rows: policies.map((x) => ({ _href: '/system/vehicles/registry/insurance/vehicles', policy: x.policyNumber, company: x.companyAr, coverage: x.coverageTypeAr, vehicles: x.vehicleCount, premium: round(x.totalPremiumSar), expiry: x.expiryDate })) },
      { key: 'corporate', ar: 'وثائق الشركة', en: 'Company policies', columns: [col('name', 'الوثيقة', 'Policy'), col('company', 'الشركة', 'Insurer'), col('premium', 'القسط', 'Premium', 'money'), col('expiry', 'الانتهاء', 'Expiry', 'date')], rows: (corp?.policies || []).map((x) => ({ _href: '/system/vehicles/registry/corporate', name: x.scopeAr, company: x.companyAr, premium: round(x.computedPremiumSar ?? x.premiumSar), expiry: x.expiryDate })) },
      { key: 'renewals', ar: 'التجديدات في الفترة', en: 'Renewals in period', columns: [col('date', 'التاريخ', 'Date', 'date'), col('plate', 'المركبة / الوثيقة', 'Vehicle / policy'), col('document', 'المستند', 'Document'), col('newExpiry', 'الانتهاء الجديد', 'New expiry', 'date'), col('cost', 'التكلفة', 'Cost', 'money'), col('reference', 'المرجع', 'Reference')], rows: renewals.sort((a, b) => new Date(b.date) - new Date(a.date)) },
      { key: 'claims', ar: 'الحوادث والمطالبات', en: 'Accidents & claims', columns: [col('claimId', 'رقم المطالبة', 'Claim'), col('plate', 'اللوحة', 'Plate'), col('sector', 'القطاع', 'Sector'), col('date', 'تاريخ الحادث', 'Accident date', 'date'), col('insurer', 'شركة التأمين', 'Insurer'), col('estimated', 'التقدير', 'Estimate', 'money'), col('recovery', 'المتوقّع استرداده', 'Recovery', 'money'), col('gap', 'الفجوة', 'Gap', 'money'), col('status', 'الحالة', 'Status')], rows: (claimsRes?.claims || []).map((c) => ({ _href: '/system/vehicles/registry/claims', claimId: c.claimId, plate: c.vehiclePlate, sector: c.vehicleSectorAr, date: c.accidentDate, insurer: c.claim?.insurerAr, estimated: round(c.claim?.estimatedAmountSar), recovery: round(c.claim?.expectedRecoverySar), gap: round(c.claim?.recoveryGapSar), status: c.statusAr })) },
    ],
    notes: [{ ar: 'لا تُسجَّل في النظام رسوم GPS ولا رسوم بطاقات التشغيل، ولا استهلاك بترو اب الفعلي (الحدود فقط).', en: 'GPS fees, operating-card fees and actual Petro App consumption are not recorded.' }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
const DEPARTMENTS = {
  operations: { ar: 'ماليات التشغيل', en: 'Operations finance', build: operations },
  fleet: { ar: 'ماليات إدارة الأسطول', en: 'Fleet finance', build: fleet },
  customs: { ar: 'ماليات التخليص الجمركي', en: 'Customs finance', build: customs },
  light: { ar: 'ماليات النقل الخفيف', en: 'Light transport finance', build: light },
  marketing: { ar: 'ماليات التسويق والتطوير', en: 'Marketing & BD finance', build: marketing },
  hr: { ar: 'ماليات الموارد البشرية', en: 'HR finance', build: hr },
  it: { ar: 'ماليات تقنية المعلومات', en: 'IT finance', build: it },
  collections: { ar: 'ماليات التحصيل', en: 'Collections finance', build: collections },
  vehicles: { ar: 'ماليات المركبات', en: 'Vehicles finance', build: vehicles },
};

async function buildDept(key, p, user) {
  const d = DEPARTMENTS[key];
  // تُقدَّم آخرُ حمولةٍ فورًا وتُعاد في الخلف بعد المهلة (ttlCache.wrapStale):
  // صفحاتُ الماليّة تُعاد قراءتُها مع كلّ حركةٍ في قسمها.
  return cache.wrapStale(`finance:${key}:${p.from}:${p.to}`, TTL, 15 * 60 * 1000, async () => {
    const body = await d.build(p, user);
    return { dept: key, ar: d.ar, en: d.en, period: { from: p.from, to: p.to }, generatedAt: new Date(), ...body };
  });
}

exports.department = async (req, res) => {
  try {
    const key = req.params.dept;
    if (!DEPARTMENTS[key]) return res.status(404).json({ message: 'قسم غير معروف' });
    res.json(await buildDept(key, periodOf(req.query), req.user));
  } catch (e) {
    console.error('finance department', e);
    res.status(500).json({ message: 'تعذّر تحميل ماليات القسم' });
  }
};

/** اللوحة: أهمُّ بطاقات كلّ قسم — من الحمولات نفسِها، فلا يختلف رقمٌ بين اللوحة وصفحته. */
const HEADLINE = {
  operations: ['selling', 'purchase', 'margin', 'walletClosing'],
  fleet: ['income', 'driverExpense', 'net', 'unpaid'],
  customs: ['revenue', 'costs', 'profit'],
  light: ['custodyBalance', 'premium', 'claims'],
  marketing: ['spend', 'pipeline'],
  hr: ['monthly', 'annual', 'headcount'],
  it: ['assetsValue', 'systemsAnnual'],
  collections: ['ledgerOutstanding', 'collectedPeriod', 'overdue'],
  vehicles: ['vehiclePremiums', 'renewalsCost', 'claimsEstimated'],
};
exports.overview = async (req, res) => {
  try {
    const p = periodOf(req.query);
    const keys = Object.keys(DEPARTMENTS);
    const built = await Promise.all(keys.map((k) => buildDept(k, p, req.user).catch((e) => { console.error('finance overview', k, e.message); return null; })));
    const cardOf = (k, c) => (built[keys.indexOf(k)]?.cards || []).find((x) => x.key === c)?.value ?? null;
    res.json({
      period: { from: p.from, to: p.to },
      // قراءةٌ مسطّحة لبطاقات الشاشة الرئيسية في التطبيق (HomeInsight).
      headline: { selling: cardOf('operations', 'selling'), receivable: cardOf('collections', 'ledgerOutstanding'), collected: cardOf('collections', 'collectedPeriod') },
      departments: keys.map((k, i) => ({
        key: k, ar: DEPARTMENTS[k].ar, en: DEPARTMENTS[k].en, ok: !!built[i],
        cards: (built[i]?.cards || []).filter((c) => HEADLINE[k].includes(c.key)),
      })),
    });
  } catch (e) {
    console.error('finance overview', e);
    res.status(500).json({ message: 'تعذّر تحميل اللوحة' });
  }
};

exports.DEPARTMENTS = DEPARTMENTS;
exports.buildDept = buildDept;
exports.periodOf = periodOf;
exports.callController = callController;
