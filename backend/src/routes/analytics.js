const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const User = require('../models/User');
// ── وهذه الثلاثةُ لبوّابة العميل وحدَها ─────────────────────────────────────
// لوحةُ البوّابة تعرض فواتيرَ الشريك ومدفوعاتِه، وسيرُ عمل التشغيل ما زال
// مصدرَ ما يُنشأ منها. فتبقى هنا لتلك النقطةِ وحدَها، لا لأرقام الشركة.
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');

/**
 * ── المصدرُ صار كشوفَ التشغيل ───────────────────────────────────────────────
 *
 * كانت هذه النقاطُ تقرأ من `Invoice` و`Payment` و`Customer` — جداولِ ورك فلو
 * «العملاء والمالية» الذي زال. فكانت الصفحةُ الرئيسة تعرض أصفارًا لا لأنّ
 * الشركة لا تُحصّل، بل لأنّها تسأل جدولًا لا يكتب فيه أحد.
 *
 * وما بقي من تلك الخدمات (تقديرُ المخاطر، والتنبّؤُ بالتأخّر، وتدفّقُ النقد
 * المتوقَّع، وأداءُ المحصّلين) نماذجُ مبنيّةٌ على سجلّ فواتيرَ ومدفوعاتٍ لم يعد
 * يُكتب — لا مدخلاتٍ لها ولا مقابلَ لها في البيانات الحيّة، فأُزيلت بدل أن
 * تبقى تعرض أرقامًا مخترَعة. والمخاطرُ الحقيقيّةُ اليوم تُقرأ في تقادم المستحقّ
 * وتنبيهات الائتمان، وكلاهما محسوبٌ من الكشوف.
 */
const receivables = require('../services/receivablesService');

router.use(authenticate);

// Executive Dashboard Summary
router.get('/dashboard', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'employee', 'moderator', 'procurement_staff', 'collections_manager', 'collections_staff', 'finance_manager', 'accountant'), async (req, res) => {
  try {
    // authorize() ran at the route, so the data is the same for every permitted
    // viewer (per filter set) — cache briefly to absorb concurrent loads.
    const cache = require('../utils/ttlCache');
    const key = `dash:analytics:${JSON.stringify(req.query)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const payload = await receivables.dashboard(req.query);
    cache.set(key, payload, 12000);
    res.json(payload);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard data' });
  }
});

// Aging
router.get('/aging', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'employee', 'operations_manager', 'operations_staff', 'moderator', 'collections_manager', 'collections_staff', 'finance_manager', 'accountant'), async (req, res) => {
  try {
    res.json(await receivables.aging(req.query));
  } catch (error) {
    console.error('Aging error:', error);
    res.status(500).json({ message: 'Failed to load aging report' });
  }
});

// أيّامُ التحصيل — متوسّطُ ما بين الكشف وتحصيله، محسوبًا من الواقع لا مقدَّرًا.
router.get('/dso', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'employee', 'operations_manager', 'operations_staff', 'moderator', 'collections_manager', 'collections_staff', 'finance_manager', 'accountant'), async (req, res) => {
  try {
    const t = await receivables.dsoTrend({ months: 12 });
    res.json({ overall: { dso: t.dso }, trend: t.trend, byBranch: [], byCreditTerm: [], byCollector: [], alerts: [] });
  } catch (error) {
    console.error('DSO error:', error);
    res.status(500).json({ message: 'Failed to load DSO data' });
  }
});

router.get('/credit-alerts', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'employee', 'moderator', 'collections_manager', 'collections_staff', 'finance_manager', 'accountant'), async (req, res) => {
  try {
    res.json(await receivables.creditAlerts());
  } catch (error) {
    console.error('Credit alerts error:', error);
    res.status(500).json({ message: 'Failed to load credit alerts' });
  }
});

router.get('/overdue', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'employee', 'operations_manager', 'moderator', 'collections_manager', 'collections_staff', 'finance_manager', 'accountant'), async (req, res) => {
  try {
    res.json(await receivables.overdueList(req.query));
  } catch (error) {
    console.error('Overdue error:', error);
    res.status(500).json({ message: 'Failed to load overdue reports' });
  }
});

// Super-admin "everything at a glance" overview. Returns aggregate counts +
// quick stats from every major module in a single response so the dashboard
// can render a clickable grid without N round-trips. Each query is wrapped
// in Promise.allSettled so one slow/broken module doesn't stall the others.
//
// Cached in-process for 30s — the dashboard refetches on view focus, so this
// just keeps page reloads cheap during quick navigation.
const SUPER_OVERVIEW_TTL = 30 * 1000;
let superOverviewCache = { at: 0, key: '', data: null };

router.get('/super-overview', authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const now = Date.now();
    const cacheKey = String(req.user._id);
    if (superOverviewCache.data && superOverviewCache.key === cacheKey && now - superOverviewCache.at < SUPER_OVERVIEW_TTL) {
      return res.json({ ...superOverviewCache.data, cached: true });
    }

    // Defensive model loading — if any one model file fails to load, we don't
    // want to take down the entire overview. Missing models just zero out
    // their metrics in the response. The console log makes the gap obvious
    // during dev so the user can fix the underlying issue.
    const safeRequire = (name) => {
      try { return require(`../models/${name}`); }
      catch (e) { console.error(`[super-overview] model load failed: ${name} — ${e.message}`); return null; }
    };
    const OperationsWorkflow = safeRequire('OperationsWorkflow');
    const B2CRep = safeRequire('B2CRep');
    const B2CDailyOrder = safeRequire('B2CDailyOrder');
    const B2CProject = safeRequire('B2CProject');
    const DailyWallet = safeRequire('DailyWallet');
    const WalletTransaction = safeRequire('WalletTransaction');
    const WorkshopTask = safeRequire('WorkshopTask');
    const WorkshopPurchaseRequest = safeRequire('WorkshopPurchaseRequest');
    const InventoryItem = safeRequire('InventoryItem');
    const Driver = safeRequire('Driver');
    const Vendor = safeRequire('Vendor');
    const Branch = safeRequire('Branch');
    const Complaint = safeRequire('Complaint');
    const Dispute = safeRequire('Dispute');
    const MaintenanceRequest = safeRequire('MaintenanceRequest');

    // tryQuery turns each metric into a promise that never rejects — failed
    // queries just resolve to the fallback. Without this wrapper a single
    // model with a malformed schema or aggregation pipeline kills the whole
    // overview and the user sees the empty-state error banner.
    const tryQuery = async (fn, fallback) => {
      try { return await fn(); }
      catch (e) { console.error('[super-overview] query failed:', e.message); return fallback; }
    };
    const zero = () => 0;
    const empty = () => [];

    const startOfMonth = new Date(now);
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // WalletTransaction.date is stored as a YYYY-MM-DD STRING (not Date) — comparing
    // a string to a Date object via $gte silently fails. Build string sentinels.
    const pad2 = (n) => String(n).padStart(2, '0');
    const yyyymmdd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const startOfMonthStr = yyyymmdd(startOfMonth);
    const startOfLastMonthStr = yyyymmdd(startOfLastMonth);
    const endOfLastMonthStr = yyyymmdd(new Date(startOfMonth.getTime() - 1));

    // Every metric is wrapped in tryQuery so one bad model or aggregation
    // can't take down the whole overview. The result is a partial response
    // (missing pieces zero out) rather than a 500.
    const [
      opsStagesRaw,
      b2cReps, b2cProjects, b2cMonthRaw,
      walletOpen, walletTxRaw,
      workshopTasks, workshopPurchases, inventoryAggRaw,
      driversActive, vendorsActive, branchesCount,
      tasksOpen, tasksDueToday,
      complaintsOpen, disputesOpen,
      maintenanceOpen,
      opsThisMonth, opsLastMonth,
      b2cLastRaw, walletLastRaw,
      todayCollections, topDriversRaw,
    ] = await Promise.all([
      tryQuery(() => OperationsWorkflow.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]), []),
      tryQuery(() => B2CRep.countDocuments({}), 0),
      tryQuery(() => B2CProject.countDocuments({}), 0),
      tryQuery(() => B2CDailyOrder.aggregate([
        { $match: { date: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$orders', 0] } }, working: { $sum: { $cond: ['$worked', 1, 0] } } } },
      ]), []),
      tryQuery(() => DailyWallet.countDocuments({ isClosed: false }), 0),
      tryQuery(() => WalletTransaction.aggregate([
        { $match: { date: { $gte: startOfMonthStr } } },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]), []),
      tryQuery(() => WorkshopTask.countDocuments({ status: { $in: ['pending', 'in_progress'] } }), 0),
      tryQuery(() => WorkshopPurchaseRequest.countDocuments({ status: 'pending' }), 0),
      tryQuery(() => InventoryItem.aggregate([
        { $project: { quantity: 1, minQuantity: { $ifNull: ['$minQuantity', 0] } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            low: {
              $sum: {
                $cond: [
                  { $and: [{ $gt: ['$minQuantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] }, 1, 0,
                ],
              },
            },
            outOfStock: { $sum: { $cond: [{ $lte: ['$quantity', 0] }, 1, 0] } },
          },
        },
      ]), []),
      tryQuery(() => Driver.countDocuments({}), 0),
      tryQuery(() => Vendor.countDocuments({}), 0),
      tryQuery(() => Branch.countDocuments({}), 0),
      Promise.resolve(0), // لوحُ مهامّ التحصيل القديم زال — والمهامُّ الآن في قسم التحصيل
      Promise.resolve(0),
      tryQuery(() => Complaint.countDocuments({ status: { $in: ['open', 'in_progress'] } }), 0),
      tryQuery(() => Dispute.countDocuments({ status: { $in: ['open', 'under_review'] } }), 0),
      tryQuery(() => MaintenanceRequest.countDocuments({ status: { $in: ['open', 'in_progress'] } }), 0),
      // Exclude cancelled shipments — we only want operations that actually
      // completed and generated revenue. UPL's status lands in executionStatus.
      tryQuery(() => OperationsWorkflow.countDocuments({ reportDate: { $gte: startOfMonth }, executionStatus: { $ne: 'cancelled' } }), 0),
      tryQuery(() => OperationsWorkflow.countDocuments({ reportDate: { $gte: startOfLastMonth, $lt: startOfMonth }, executionStatus: { $ne: 'cancelled' } }), 0),
      tryQuery(() => B2CDailyOrder.aggregate([
        { $match: { date: { $gte: startOfLastMonth, $lt: startOfMonth } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$orders', 0] } } } },
      ]), []),
      tryQuery(() => WalletTransaction.aggregate([
        { $match: { date: { $gte: startOfLastMonthStr, $lte: endOfLastMonthStr } } },
        { $group: { _id: '$type', total: { $sum: '$amount' } } },
      ]), []),
      tryQuery(() => WalletTransaction.countDocuments({ date: yyyymmdd(startOfDay), type: 'collection' }), 0),
      tryQuery(() => OperationsWorkflow.aggregate([
        { $match: { driverName: { $exists: true, $ne: '' }, reportDate: { $gte: startOfMonth } } },
        { $group: { _id: '$driverName', trips: { $sum: 1 } } },
        { $sort: { trips: -1 } },
        { $limit: 5 },
      ]), []),
    ]);

    // Reshape — every input is guaranteed to be the right shape (the fallback
    // matches the success type) so no further null-guarding needed.
    const opsByStage = Object.fromEntries((opsStagesRaw || []).map((s) => [s._id || 'unknown', s.count]));
    const opsTotal = (opsStagesRaw || []).reduce((s, x) => s + (x.count || 0), 0);
    const b2cMonth = (b2cMonthRaw || [])[0] || { total: 0, working: 0 };
    const walletByType = (arr) => Object.fromEntries((arr || []).map((t) => [t._id, t]));
    const txByType = walletByType(walletTxRaw);
    const walletInflow = (txByType.collection || {}).total || 0;
    const walletOutflow = ((txByType.expense || {}).total || 0) + ((txByType.purchase || {}).total || 0);
    const walletTxCount = (walletTxRaw || []).reduce((s, t) => s + (t.count || 0), 0);
    const walletNet = walletInflow - walletOutflow;
    const inventoryAgg = (inventoryAggRaw || [])[0] || { total: 0, low: 0, outOfStock: 0 };
    const opsTrendPct = opsLastMonth > 0 ? Math.round(((opsThisMonth - opsLastMonth) / opsLastMonth) * 100) : null;
    const b2cLast = ((b2cLastRaw || [])[0] || {}).total || 0;
    const b2cTrendPct = b2cLast > 0 ? Math.round(((b2cMonth.total - b2cLast) / b2cLast) * 100) : null;
    const walletLastTx = walletByType(walletLastRaw);
    const walletLastInflow = (walletLastTx.collection || {}).total || 0;
    const walletTrendPct = walletLastInflow > 0 ? Math.round(((walletInflow - walletLastInflow) / walletLastInflow) * 100) : null;
    const topDrivers = (topDriversRaw || []).map((d) => ({ name: d._id, trips: d.trips }));

    const payload = {
      generatedAt: new Date().toISOString(),
      operations: {
        total: opsTotal,
        byStage: opsByStage,
        thisMonth: opsThisMonth,
        lastMonth: opsLastMonth,
        trendPct: opsTrendPct,
      },
      b2c: {
        reps: b2cReps,
        projects: b2cProjects,
        monthOrders: b2cMonth.total,
        lastMonthOrders: b2cLast,
        monthWorkingDays: b2cMonth.working,
        trendPct: b2cTrendPct,
      },
      wallet: {
        openWallets: walletOpen,
        monthInflow: walletInflow,
        monthOutflow: walletOutflow,
        monthNet: walletNet,
        monthTransactions: walletTxCount,
        todayCollections,
        trendPct: walletTrendPct,
      },
      workshop: {
        openTasks: workshopTasks,
        pendingPurchases: workshopPurchases,
        inventoryItems: inventoryAgg.total,
        lowStockItems: inventoryAgg.low,
        outOfStockItems: inventoryAgg.outOfStock,
        openMaintenance: maintenanceOpen,
      },
      roster: { drivers: driversActive, vendors: vendorsActive, branches: branchesCount, topDrivers },
      tasks: { open: tasksOpen, dueToday: tasksDueToday },
      service: { complaintsOpen, disputesOpen },
    };

    superOverviewCache = { at: now, key: cacheKey, data: payload };
    res.json({ ...payload, cached: false });
  } catch (error) {
    console.error('Super overview error:', error);
    // Surface the actual error so we can diagnose. The frontend hides this
    // banner outside of admin/super_admin, so it isn't leaking to end users.
    res.status(500).json({
      message: error.message || 'Failed to load super overview',
      where: error.stack ? error.stack.split('\n')[1]?.trim() : undefined,
    });
  }
});

// Client Portal Dashboard
router.get('/portal/dashboard', authorize('client'), async (req, res) => {
  try {
    const customerId = req.user.linkedCustomer;
    if (!customerId) return res.status(400).json({ message: 'No linked customer' });

    const customer = await Customer.findById(customerId);
    const invoices = await Invoice.find({ customer: customerId }).sort({ invoiceDate: -1 });
    const payments = await Payment.find({ customer: customerId }).sort({ paymentDate: -1 });

    const now = new Date();
    const enrichedInvoices = invoices.map((inv) => {
      const doc = inv.toObject();
      const diffMs = new Date(doc.dueDate) - now;
      doc.remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      doc.overdueDays = doc.remainingDays < 0 ? Math.abs(doc.remainingDays) : 0;
      doc.isOverdue = doc.remainingDays < 0 && doc.status !== 'paid';
      doc.isDueSoon = doc.remainingDays > 0 && doc.remainingDays <= 5 && doc.status !== 'paid';

      if (doc.status === 'paid') doc.statusColor = 'green';
      else if (doc.isDueSoon) doc.statusColor = 'yellow';
      else if (doc.isOverdue) doc.statusColor = 'red';
      else doc.statusColor = 'green';

      if (doc.isOverdue) {
        doc.message = `This invoice is ${doc.overdueDays} days overdue according to your ${customer.creditTerm}-day credit agreement.`;
      } else if (doc.isDueSoon) {
        doc.message = `You must pay Invoice #${doc.invoiceNumber} within ${doc.remainingDays} days according to your ${customer.creditTerm}-day credit agreement.`;
      }

      return doc;
    });

    const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.balance, 0);
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    res.json({
      customer: {
        companyName: customer.companyName,
        creditTerm: customer.creditTerm,
        creditLimit: customer.creditLimit,
      },
      totalOutstanding,
      totalPaid,
      invoices: enrichedInvoices,
      recentPayments: payments.slice(0, 20),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load portal dashboard' });
  }
});

module.exports = router;
