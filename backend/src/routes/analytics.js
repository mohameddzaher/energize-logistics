const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { getAgingReport } = require('../services/agingService');
const { calculateDSO, getDSOByBranch, getDSOByCreditTerm, getDSOByCollector, getDSOTrend, getDSOAlerts } = require('../services/dsoService');
const { calculateRiskScore, recalculateAllRiskScores, getHighRiskClients, getRiskDistribution } = require('../services/riskService');
const { getCashflowForecast, getProjectedVsExpected } = require('../services/forecastService');
const { getCollectorPerformance, getCollectorRanking, getPerformanceTrend } = require('../services/performanceService');
const { predictLatePayment, flagPotentialDefaults, suggestFollowUpTiming, suggestCreditTermReduction, detectAbnormalBehavior } = require('../services/predictionService');
const { getOverdueInvoices } = require('../controllers/analyticsController');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const User = require('../models/User');

router.use(authenticate);

// Executive Dashboard Summary
router.get('/dashboard', authorize('super_admin', 'admin', 'operations_manager', 'operations_staff', 'employee', 'moderator', 'workshop_manager', 'workshop_employee', 'procurement_staff'), async (req, res) => {
  try {
    const { dateFrom, dateTo, branch, collector } = req.query;

    // authorize() ran at the route, so the data is the same for every permitted
    // viewer (per filter set) — cache briefly to absorb concurrent loads / socket
    // reloads against the high-latency cluster.
    const cache = require('../utils/ttlCache');
    const _ck = `dash:analytics:${JSON.stringify(req.query)}`;
    const _hit = cache.get(_ck);
    if (_hit !== undefined) return res.json(_hit);

    const now = new Date();
    const hasDateFilter = dateFrom && dateTo;
    const periodStart = hasDateFilter ? new Date(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
    // dateTo is a bare YYYY-MM-DD = midnight — push it to end-of-day so the
    // selected last day's payments/invoices are INCLUDED, not silently dropped.
    const periodEnd = hasDateFilter ? new Date(new Date(dateTo).getTime() + 86400000 - 1) : now;
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Total Outstanding — when date-filtered, scope to invoices created in that period
    const outstandingMatch = { status: { $nin: ['paid'] } };
    if (hasDateFilter) outstandingMatch.invoiceDate = { $gte: periodStart, $lte: periodEnd };

    // Overdue — use periodEnd as reference date when filtered
    const overdueRef = hasDateFilter ? periodEnd : now;
    const overdueMatch = { status: { $nin: ['paid', 'frozen'] }, dueDate: { $lt: overdueRef } };
    if (hasDateFilter) overdueMatch.invoiceDate = { $lte: periodEnd };

    // The cluster has ~90ms per-query latency, so run every INDEPENDENT query in
    // one parallel wave instead of 8 sequential round-trips (~8x faster here).
    const [totalOutstanding, monthlyCollected, monthlyInvoiced, yearlyAgg, dso, creditTermDist, overdueCount, customerCount] = await Promise.all([
      Invoice.aggregate([{ $match: outstandingMatch }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
      Payment.aggregate([{ $match: { paymentDate: { $gte: periodStart, $lte: periodEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Invoice.aggregate([{ $match: { invoiceDate: { $gte: periodStart, $lte: periodEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      hasDateFilter ? Promise.resolve(null) : Payment.aggregate([{ $match: { paymentDate: { $gte: yearStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      calculateDSO({ dateFrom, dateTo, branch, collector }),
      Customer.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$creditTerm', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Invoice.countDocuments(overdueMatch),
      Customer.countDocuments({ isActive: true }),
    ]);

    const collectedAmt = monthlyCollected[0]?.total || 0;
    const invoicedAmt = monthlyInvoiced[0]?.total || 0;
    const collectionRate = invoicedAmt > 0 ? Math.round((collectedAmt / invoicedAmt) * 100) : 0;
    const yearlyCollected = hasDateFilter ? monthlyCollected : yearlyAgg;

    const payload = {
      totalOutstanding: totalOutstanding[0]?.total || 0,
      monthlyCollected: collectedAmt,
      yearlyCollected: yearlyCollected[0]?.total || 0,
      collectionRate,
      dso: dso.dso,
      overdueCount,
      customerCount,
      creditTermDistribution: creditTermDist.map((d) => ({ term: d._id, count: d.count })),
    };
    cache.set(_ck, payload, 12000);
    res.json(payload);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard data' });
  }
});

// Aging
router.get('/aging', authorize('super_admin', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator'), async (req, res) => {
  try {
    const report = await getAgingReport(req.query);
    res.json(report);
  } catch (error) {
    console.error('Aging error:', error);
    res.status(500).json({ message: 'Failed to load aging report' });
  }
});

// DSO
router.get('/dso', authorize('super_admin', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator'), async (req, res) => {
  try {
    const results = await Promise.allSettled([
      calculateDSO(req.query),
      getDSOByBranch(),
      getDSOByCreditTerm(),
      getDSOByCollector(),
      getDSOTrend(12),
      getDSOAlerts(),
    ]);

    const get = (i) => results[i].status === 'fulfilled' ? results[i].value : null;

    res.json({
      overall: get(0) || { dso: 0 },
      byBranch: get(1) || [],
      byCreditTerm: get(2) || [],
      byCollector: get(3) || [],
      trend: get(4) || [],
      alerts: get(5) || [],
    });
  } catch (error) {
    console.error('DSO error:', error);
    res.status(500).json({ message: 'Failed to load DSO data' });
  }
});

// Risk
router.get('/risk', authorize('super_admin', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator'), async (req, res) => {
  try {
    const [highRisk, distribution] = await Promise.all([
      getHighRiskClients(),
      getRiskDistribution(),
    ]);
    res.json({ highRiskClients: highRisk, distribution });
  } catch (error) {
    console.error('Risk error:', error);
    res.status(500).json({ message: 'Failed to load risk analysis' });
  }
});

router.get('/risk/:customerId', async (req, res) => {
  try {
    const result = await calculateRiskScore(req.params.customerId);
    if (!result) return res.status(404).json({ message: 'Customer not found' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to calculate risk score' });
  }
});

router.post('/risk/recalculate', authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const results = await recalculateAllRiskScores();
    res.json({ message: 'Risk scores recalculated', results });
  } catch (error) {
    res.status(500).json({ message: 'Failed to recalculate risk scores' });
  }
});

// Forecast
router.get('/forecast', authorize('super_admin', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator'), async (req, res) => {
  try {
    const [forecast, projected] = await Promise.all([
      getCashflowForecast(),
      getProjectedVsExpected(),
    ]);
    res.json({ forecast, projectedVsExpected: projected });
  } catch (error) {
    console.error('Forecast error:', error);
    res.status(500).json({ message: 'Failed to load forecast data' });
  }
});

// Performance
router.get('/performance', authorize('super_admin', 'admin', 'employee', 'operations_manager', 'operations_staff', 'moderator'), async (req, res) => {
  try {
    const ranking = await getCollectorRanking(req.query.dateFrom, req.query.dateTo);
    res.json({ ranking });
  } catch (error) {
    console.error('Performance error:', error);
    res.status(500).json({ message: 'Failed to load performance data' });
  }
});

router.get('/performance/:collectorId', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const [performance, trend] = await Promise.all([
      getCollectorPerformance(req.params.collectorId, dateFrom, dateTo),
      getPerformanceTrend(req.params.collectorId, 6),
    ]);

    const collector = await User.findById(req.params.collectorId).select('role');
    let assignedCustomersList = [];
    let teamRanking = null;

    if (collector && collector.role === 'admin') {
      // Admin: fetch team ranking for top/bottom display
      teamRanking = await getCollectorRanking(dateFrom, dateTo);
    } else {
      // Employee: fetch their assigned customers list
      assignedCustomersList = await Customer.find({
        assignedCollector: req.params.collectorId, isActive: true,
      }).select('companyName currentOutstanding lastPaymentDate grade clientStatus').lean();
    }

    res.json({ performance, trend, assignedCustomersList, teamRanking });
  } catch (error) {
    console.error('Collector performance error:', error);
    res.status(500).json({ message: 'Failed to load collector performance' });
  }
});

// Predictions
router.get('/predictions', authorize('super_admin', 'admin', 'employee'), async (req, res) => {
  try {
    const [defaults, creditSuggestions, anomalies] = await Promise.all([
      flagPotentialDefaults(),
      suggestCreditTermReduction(),
      detectAbnormalBehavior(),
    ]);
    res.json({ potentialDefaults: defaults, creditTermSuggestions: creditSuggestions, anomalies });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load predictions' });
  }
});

router.get('/predictions/late-payment/:invoiceId', async (req, res) => {
  try {
    const result = await predictLatePayment(req.params.invoiceId);
    if (!result) return res.status(404).json({ message: 'Invoice not found' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to predict late payment' });
  }
});

router.get('/predictions/follow-up/:customerId', async (req, res) => {
  try {
    const result = await suggestFollowUpTiming(req.params.customerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate follow-up suggestion' });
  }
});

// Credit Limit Alerts
router.get('/credit-alerts', authorize('super_admin', 'admin', 'operations_manager', 'employee', 'moderator'), async (req, res) => {
  try {
    const customers = await Customer.find({ isActive: true, creditLimit: { $gt: 0 } })
      .populate('assignedCollector', 'firstName lastName')
      .select('companyName customerNumber currentOutstanding creditLimit creditTerm grade clientStatus office salesManager assignedCollector lastPaymentDate lastPaymentAmount');

    const alerts = customers
      .map((c) => {
        const doc = c.toObject();
        doc.usagePercent = Math.round((doc.currentOutstanding / doc.creditLimit) * 100);
        doc.remaining = doc.creditLimit - doc.currentOutstanding;
        doc.isExceeded = doc.currentOutstanding > doc.creditLimit;
        doc.isNearLimit = doc.usagePercent >= 80 && !doc.isExceeded;
        return doc;
      })
      .filter((c) => c.usagePercent >= 70)
      .sort((a, b) => b.usagePercent - a.usagePercent);

    const exceeded = alerts.filter(a => a.isExceeded).length;
    const nearLimit = alerts.filter(a => a.isNearLimit).length;

    res.json({ alerts, exceeded, nearLimit, total: alerts.length });
  } catch (error) {
    console.error('Credit alerts error:', error);
    res.status(500).json({ message: 'Failed to load credit alerts' });
  }
});

// Overdue Invoices
router.get('/overdue', authorize('super_admin', 'admin', 'employee', 'operations_manager', 'moderator'), getOverdueInvoices);

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
    const CollectionTask = safeRequire('CollectionTask');
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
      tryQuery(() => CollectionTask.countDocuments({ status: 'pending' }), 0),
      tryQuery(() => CollectionTask.countDocuments({ status: 'pending', dueDate: { $gte: startOfDay, $lte: endOfDay } }), 0),
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
