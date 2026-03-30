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
router.get('/dashboard', authorize('super_admin', 'admin', 'operations_manager', 'operations', 'employee', 'moderator'), async (req, res) => {
  try {
    const { dateFrom, dateTo, branch, collector } = req.query;

    const now = new Date();
    const hasDateFilter = dateFrom && dateTo;
    const periodStart = hasDateFilter ? new Date(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = hasDateFilter ? new Date(dateTo) : now;
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Total Outstanding — when date-filtered, scope to invoices created in that period
    const outstandingMatch = { status: { $nin: ['paid'] } };
    if (hasDateFilter) outstandingMatch.invoiceDate = { $gte: periodStart, $lte: periodEnd };
    const totalOutstanding = await Invoice.aggregate([
      { $match: outstandingMatch },
      { $group: { _id: null, total: { $sum: '$balance' } } },
    ]);

    // Collections in period
    const monthlyCollected = await Payment.aggregate([
      { $match: { paymentDate: { $gte: periodStart, $lte: periodEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    // Collections this year (when date-filtered, show same period total)
    const yearlyCollected = hasDateFilter
      ? monthlyCollected
      : await Payment.aggregate([
          { $match: { paymentDate: { $gte: yearStart } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

    // Total invoiced in period
    const monthlyInvoiced = await Invoice.aggregate([
      { $match: { invoiceDate: { $gte: periodStart, $lte: periodEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const collectedAmt = monthlyCollected[0]?.total || 0;
    const invoicedAmt = monthlyInvoiced[0]?.total || 0;
    const collectionRate = invoicedAmt > 0 ? Math.round((collectedAmt / invoicedAmt) * 100) : 0;

    // DSO
    const dso = await calculateDSO({ dateFrom, dateTo, branch, collector });

    // Credit term distribution (current state — no date filter)
    const creditTermDist = await Customer.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$creditTerm', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    // Overdue count — use periodEnd as reference date when filtered
    const overdueRef = hasDateFilter ? periodEnd : now;
    const overdueMatch = { status: { $nin: ['paid', 'frozen'] }, dueDate: { $lt: overdueRef } };
    if (hasDateFilter) overdueMatch.invoiceDate = { $lte: periodEnd };
    const overdueCount = await Invoice.countDocuments(overdueMatch);

    // Customer count (current state)
    const customerCount = await Customer.countDocuments({ isActive: true });

    res.json({
      totalOutstanding: totalOutstanding[0]?.total || 0,
      monthlyCollected: collectedAmt,
      yearlyCollected: yearlyCollected[0]?.total || 0,
      collectionRate,
      dso: dso.dso,
      overdueCount,
      customerCount,
      creditTermDistribution: creditTermDist.map((d) => ({ term: d._id, count: d.count })),
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard data' });
  }
});

// Aging
router.get('/aging', authorize('super_admin', 'admin', 'employee', 'moderator'), async (req, res) => {
  try {
    const report = await getAgingReport(req.query);
    res.json(report);
  } catch (error) {
    console.error('Aging error:', error);
    res.status(500).json({ message: 'Failed to load aging report' });
  }
});

// DSO
router.get('/dso', authorize('super_admin', 'admin', 'employee', 'moderator'), async (req, res) => {
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
router.get('/risk', authorize('super_admin', 'admin', 'employee', 'moderator'), async (req, res) => {
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
router.get('/forecast', authorize('super_admin', 'admin', 'employee', 'moderator'), async (req, res) => {
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
router.get('/performance', authorize('super_admin', 'admin', 'employee', 'moderator'), async (req, res) => {
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
