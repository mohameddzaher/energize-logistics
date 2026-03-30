const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const { getCollectorRanking } = require('../services/performanceService');
const { calculateDSO, getDSOTrend } = require('../services/dsoService');
const { getAgingReport } = require('../services/agingService');
const { getHighRiskClients } = require('../services/riskService');

router.use(authenticate);

// Query patterns and their handlers
const queryHandlers = [
  {
    patterns: ['high risk', 'risky clients', 'risk clients'],
    handler: async () => {
      const clients = await getHighRiskClients();
      const summary = clients.length === 0
        ? 'No high-risk clients found.'
        : `Found ${clients.length} high-risk clients. Top: ${clients.slice(0, 5).map((c) => `${c.companyName} (Score: ${c.riskScore})`).join(', ')}`;
      return { type: 'risk', data: clients, summary };
    },
  },
  {
    patterns: ['lowest performance', 'worst collector', 'worst performing'],
    handler: async () => {
      const ranking = await getCollectorRanking();
      const worst = ranking[ranking.length - 1];
      const summary = worst
        ? `Lowest performing collector: ${worst.collector.name} with ${worst.efficiency}% efficiency (Collected: ${worst.totalCollected} / Target: ${worst.target})`
        : 'No collector data available.';
      return { type: 'performance', data: ranking, summary };
    },
  },
  {
    patterns: ['best performance', 'top collector', 'best performing'],
    handler: async () => {
      const ranking = await getCollectorRanking();
      const best = ranking[0];
      const summary = best
        ? `Top performing collector: ${best.collector.name} with ${best.efficiency}% efficiency (Collected: ${best.totalCollected} / Target: ${best.target})`
        : 'No collector data available.';
      return { type: 'performance', data: ranking, summary };
    },
  },
  {
    patterns: ['dso increasing', 'dso trend', 'dso going up', 'why is dso'],
    handler: async () => {
      const trend = await getDSOTrend(6);
      const recent = trend.slice(-3);
      const isIncreasing = recent.length >= 2 && recent[recent.length - 1].dso > recent[0].dso;
      const summary = isIncreasing
        ? `DSO has increased from ${recent[0].dso} to ${recent[recent.length - 1].dso} days over the last 3 months. This indicates slower collections. Review overdue accounts and collector performance.`
        : `DSO trend over last 3 months: ${recent.map((t) => `${t.month}: ${t.dso} days`).join(', ')}`;
      return { type: 'dso', data: trend, summary };
    },
  },
  {
    patterns: ['exceeding credit', 'over credit', 'credit agreement', 'credit limit'],
    handler: async () => {
      const customers = await Customer.find({
        isActive: true,
        $expr: { $gt: ['$currentOutstanding', '$creditLimit'] },
      }).sort({ currentOutstanding: -1 });
      const summary = customers.length === 0
        ? 'No clients are currently exceeding their credit limit.'
        : `${customers.length} clients exceeding their credit limit: ${customers.slice(0, 5).map((c) => `${c.companyName} (Outstanding: ${c.currentOutstanding} / Limit: ${c.creditLimit})`).join(', ')}`;
      return { type: 'credit', data: customers, summary };
    },
  },
  {
    patterns: ['overdue', 'past due', 'late invoices'],
    handler: async () => {
      const now = new Date();
      const invoices = await Invoice.find({
        status: { $nin: ['paid', 'frozen'] },
        dueDate: { $lt: now },
      })
        .populate('customer', 'companyName creditTerm')
        .sort({ dueDate: 1 })
        .limit(20);

      const totalOverdue = invoices.reduce((sum, inv) => sum + inv.balance, 0);
      const summary = `${invoices.length} overdue invoices totaling ${totalOverdue}. Oldest: ${invoices[0] ? `Invoice #${invoices[0].invoiceNumber} for ${invoices[0].customer?.companyName}` : 'None'}`;
      return { type: 'overdue', data: invoices, summary };
    },
  },
  {
    patterns: ['aging', 'aging report', 'aging breakdown'],
    handler: async () => {
      const report = await getAgingReport();
      const summary = report.buckets
        .map((b) => `${b.label}: ${b.count} invoices (${b.totalAmount})`)
        .join(' | ');
      return { type: 'aging', data: report, summary: `Aging breakdown: ${summary}` };
    },
  },
  {
    patterns: ['total outstanding', 'how much outstanding', 'total owed'],
    handler: async () => {
      const result = await Invoice.aggregate([
        { $match: { status: { $nin: ['paid'] } } },
        { $group: { _id: null, total: { $sum: '$balance' }, count: { $sum: 1 } } },
      ]);
      const total = result[0]?.total || 0;
      const count = result[0]?.count || 0;
      return { type: 'summary', data: result, summary: `Total outstanding: ${total} across ${count} invoices.` };
    },
  },
  {
    patterns: ['collected this month', 'monthly collection', 'collections this month'],
    handler: async () => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const result = await Payment.aggregate([
        { $match: { paymentDate: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      const total = result[0]?.total || 0;
      const count = result[0]?.count || 0;
      return { type: 'summary', data: result, summary: `Collected this month: ${total} across ${count} payments.` };
    },
  },
  {
    patterns: ['yesterday', 'collected yesterday', 'yesterday collections'],
    handler: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const result = await Payment.aggregate([
        { $match: { paymentDate: { $gte: yesterday, $lt: today } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      const total = result[0]?.total || 0;
      const count = result[0]?.count || 0;
      return { type: 'summary', data: result, summary: `Yesterday's collections: SAR ${Math.round(total).toLocaleString()} across ${count} payments.` };
    },
  },
  {
    patterns: ['nearing due', 'due soon', 'about to expire', 'invoices due'],
    handler: async () => {
      const now = new Date();
      const fiveDaysLater = new Date(now);
      fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);
      const invoices = await Invoice.find({
        status: { $nin: ['paid', 'frozen', 'refunded'] },
        dueDate: { $gte: now, $lte: fiveDaysLater },
      })
        .populate('customer', 'companyName')
        .sort({ dueDate: 1 });
      const totalAmount = invoices.reduce((sum, inv) => sum + inv.balance, 0);
      const summary = invoices.length === 0
        ? 'No invoices due in the next 5 days.'
        : `${invoices.length} invoices due within 5 days, totaling SAR ${Math.round(totalAmount).toLocaleString()}. First due: ${invoices[0].invoiceNumber} for ${invoices[0].customer?.companyName || 'Unknown'}.`;
      return { type: 'due_soon', data: invoices, summary, suggestions: ['Show overdue invoices', 'Total outstanding', 'Collections this month'] };
    },
  },
  {
    patterns: ['collection rate', 'compare', 'vs last', 'compared to', 'this week vs', 'weekly comparison'],
    handler: async () => {
      const now = new Date();
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(thisWeekStart);

      const [thisWeekResult, lastWeekResult] = await Promise.all([
        Payment.aggregate([
          { $match: { paymentDate: { $gte: thisWeekStart } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Payment.aggregate([
          { $match: { paymentDate: { $gte: lastWeekStart, $lt: lastWeekEnd } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
      ]);

      const thisWeek = thisWeekResult[0]?.total || 0;
      const lastWeek = lastWeekResult[0]?.total || 0;
      const change = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
      const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged';

      return {
        type: 'comparison',
        data: { thisWeek: Math.round(thisWeek), lastWeek: Math.round(lastWeek), change },
        summary: `This week: SAR ${Math.round(thisWeek).toLocaleString()} (${lastWeekResult[0]?.count || 0} → ${thisWeekResult[0]?.count || 0} payments). Last week: SAR ${Math.round(lastWeek).toLocaleString()}. Collection is ${direction} ${Math.abs(change)}%.`,
        suggestions: ['Collections this month', "How much collected yesterday?", 'Total outstanding'],
      };
    },
  },
  {
    patterns: ['top debtors', 'biggest debtors', 'highest outstanding', 'who owes most', 'most owed'],
    handler: async () => {
      const customers = await Customer.find({ isActive: true, currentOutstanding: { $gt: 0 } })
        .sort({ currentOutstanding: -1 })
        .limit(10)
        .select('companyName customerNumber currentOutstanding creditLimit creditTerm grade');
      const summary = customers.length === 0
        ? 'No outstanding balances found.'
        : `Top ${customers.length} debtors: ${customers.slice(0, 5).map((c) => `${c.companyName} (SAR ${Math.round(c.currentOutstanding).toLocaleString()})`).join(', ')}`;
      return { type: 'debtors', data: customers, summary, suggestions: ['Show high risk clients', 'Show overdue invoices', 'Show clients exceeding credit limit'] };
    },
  },
  {
    patterns: ['today', 'collected today', 'today collections'],
    handler: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const result = await Payment.aggregate([
        { $match: { paymentDate: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      const total = result[0]?.total || 0;
      const count = result[0]?.count || 0;
      return { type: 'summary', data: result, summary: `Today's collections so far: SAR ${Math.round(total).toLocaleString()} across ${count} payments.` };
    },
  },
  {
    patterns: ['stopped', 'stopped clients', 'blocked clients'],
    handler: async () => {
      const customers = await Customer.find({ isStopped: true })
        .select('companyName customerNumber currentOutstanding stoppedAt clientStatus');
      const summary = customers.length === 0
        ? 'No clients are currently stopped.'
        : `${customers.length} stopped clients: ${customers.map((c) => c.companyName).join(', ')}`;
      return { type: 'stopped', data: customers, summary };
    },
  },
  {
    patterns: ['collector ranking', 'collector performance', 'best collector', 'collector efficiency'],
    handler: async () => {
      const ranking = await getCollectorRanking();
      if (ranking.length === 0) return { type: 'performance', data: [], summary: 'No collector data available.' };
      const summary = `Top collectors: ${ranking.slice(0, 3).map((r, i) => `#${i+1} ${r.collector.name} (${r.efficiency}% efficiency, SAR ${Math.round(r.totalCollected).toLocaleString()} collected)`).join(' | ')}`;
      return { type: 'performance', data: ranking, summary, suggestions: ['Show high risk clients', 'Total outstanding', 'Show overdue invoices'] };
    },
  },
  {
    patterns: ['near limit', 'near credit', 'approaching limit', 'close to limit'],
    handler: async () => {
      const customers = await Customer.find({
        isActive: true,
        creditLimit: { $gt: 0 },
        $expr: { $gte: ['$currentOutstanding', { $multiply: ['$creditLimit', 0.8] }] },
      }).sort({ currentOutstanding: -1 }).select('companyName customerNumber currentOutstanding creditLimit');
      const summary = customers.length === 0
        ? 'No customers near their credit limit.'
        : `${customers.length} customers at 80%+ credit usage: ${customers.slice(0, 5).map((c) => `${c.companyName} (SAR ${Math.round(c.currentOutstanding).toLocaleString()} / ${Math.round(c.creditLimit).toLocaleString()})`).join(', ')}`;
      return { type: 'credit', data: customers, summary, suggestions: ['Show high risk clients', 'Top debtors', 'Total outstanding'] };
    },
  },
  {
    patterns: ['frozen', 'frozen invoices'],
    handler: async () => {
      const invoices = await Invoice.find({ status: 'frozen' })
        .populate('customer', 'companyName')
        .sort({ frozenAt: -1 });
      const totalFrozen = invoices.reduce((sum, inv) => sum + inv.balance, 0);
      const summary = invoices.length === 0
        ? 'No frozen invoices.'
        : `${invoices.length} frozen invoices totaling SAR ${Math.round(totalFrozen).toLocaleString()}.`;
      return { type: 'frozen', data: invoices, summary };
    },
  },
  {
    patterns: ['new customers', 'new clients', 'customers added'],
    handler: async () => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const customers = await Customer.find({ createdAt: { $gte: monthStart }, isActive: true })
        .select('companyName customerNumber creditTerm creditLimit createdAt');
      const summary = customers.length === 0
        ? 'No new customers this month.'
        : `${customers.length} new customers this month: ${customers.map((c) => c.companyName).join(', ')}`;
      return { type: 'summary', data: customers, summary };
    },
  },
  {
    patterns: ['exceed credit', 'exceeding credit', 'over credit', 'exceeded limit', 'exceed limit'],
    handler: async () => {
      const customers = await Customer.find({
        isActive: true,
        creditLimit: { $gt: 0 },
        $expr: { $gt: ['$currentOutstanding', '$creditLimit'] },
      }).sort({ currentOutstanding: -1 }).select('companyName customerNumber currentOutstanding creditLimit grade clientStatus');
      const summary = customers.length === 0
        ? 'No customers currently exceeding their credit limit.'
        : `${customers.length} customers exceeding credit limit: ${customers.slice(0, 5).map((c) => `${c.companyName} (SAR ${Math.round(c.currentOutstanding).toLocaleString()} / limit ${Math.round(c.creditLimit).toLocaleString()})`).join(', ')}`;
      return { type: 'credit', data: customers, summary, suggestions: ['Customers near credit limit', 'Show high risk clients', 'Show stopped clients'] };
    },
  },
  {
    patterns: ['aging', 'aging breakdown', 'aging report', 'overdue buckets'],
    handler: async () => {
      const report = await getAgingReport({});
      const bucketSummary = report.buckets.map((b) => `${b.label}: SAR ${Math.round(b.totalAmount).toLocaleString()} (${b.count} invoices)`).join('. ');
      return {
        type: 'aging',
        data: report.buckets,
        summary: `Aging breakdown — Total outstanding: SAR ${Math.round(report.totalOutstanding).toLocaleString()} across ${report.totalInvoices} invoices. ${bucketSummary}`,
        suggestions: ['Show overdue invoices', 'Total outstanding', 'Show high risk clients'],
      };
    },
  },
  {
    patterns: ['under review', 'review clients', 'clients being reviewed'],
    handler: async () => {
      const customers = await Customer.find({ clientStatus: 'under_review', isActive: true })
        .select('companyName customerNumber currentOutstanding creditLimit grade');
      const summary = customers.length === 0
        ? 'No clients currently under review.'
        : `${customers.length} clients under review: ${customers.map((c) => c.companyName).join(', ')}`;
      return { type: 'summary', data: customers, summary, suggestions: ['Show stopped clients', 'Show high risk clients', 'Customers near credit limit'] };
    },
  },
  {
    patterns: ['monthly comparison', 'this month vs', 'month over month', 'last month'],
    handler: async () => {
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const [thisMonthResult, lastMonthResult] = await Promise.all([
        Payment.aggregate([
          { $match: { paymentDate: { $gte: thisMonthStart } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Payment.aggregate([
          { $match: { paymentDate: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
      ]);

      const thisMonth = thisMonthResult[0]?.total || 0;
      const lastMonth = lastMonthResult[0]?.total || 0;
      const change = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;

      return {
        type: 'comparison',
        data: { thisMonth: Math.round(thisMonth), lastMonth: Math.round(lastMonth), change },
        summary: `This month: SAR ${Math.round(thisMonth).toLocaleString()} (${thisMonthResult[0]?.count || 0} payments). Last month: SAR ${Math.round(lastMonth).toLocaleString()} (${lastMonthResult[0]?.count || 0} payments). Change: ${change >= 0 ? '+' : ''}${change}%.`,
        suggestions: ['Collection rate vs last week', "How much collected yesterday?", 'Total outstanding'],
      };
    },
  },
];

router.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ message: 'Query is required' });

    const lowerQuery = query.toLowerCase();

    // Find matching handler
    for (const handler of queryHandlers) {
      if (handler.patterns.some((p) => lowerQuery.includes(p))) {
        const result = await handler.handler();
        return res.json(result);
      }
    }

    // Default: try to interpret as a customer name search
    const customers = await Customer.find({
      companyName: { $regex: query, $options: 'i' },
      isActive: true,
    });

    if (customers.length > 0) {
      return res.json({
        type: 'customer_search',
        data: customers,
        summary: `Found ${customers.length} matching customers: ${customers.map((c) => c.companyName).join(', ')}`,
      });
    }

    res.json({
      type: 'unknown',
      summary: 'I couldn\'t understand your query. Try asking about: high risk clients, DSO trend, overdue invoices, collector performance, aging breakdown, credit limits, or total outstanding.',
      suggestions: [
        'Show high risk clients',
        'Which collector has lowest performance?',
        'Why is DSO increasing?',
        'Show overdue invoices',
        'Show aging breakdown',
        'Show clients exceeding credit limit',
        'Total outstanding',
        'Collections this month',
      ],
    });
  } catch (error) {
    console.error('Assistant error:', error);
    res.status(500).json({ message: 'Failed to process assistant query' });
  }
});

module.exports = router;
