const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');

const getCashflowForecast = async () => {
  const now = new Date();
  const periods = [
    { label: 'Next 7 Days', days: 7 },
    { label: 'Next 30 Days', days: 30 },
    { label: 'Next 60 Days', days: 60 },
  ];

  const results = [];

  for (const period of periods) {
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + period.days);

    // Get invoices due within this period
    const invoices = await Invoice.find({
      status: { $nin: ['paid'] },
      dueDate: { $lte: endDate },
    }).populate('customer', 'riskScore creditTerm');

    let expectedAmount = 0;
    let bestCase = 0;
    let worstCase = 0;

    for (const inv of invoices) {
      const riskScore = inv.customer?.riskScore || 0;
      // Higher risk = lower probability of collection
      const baseProbability = 1 - riskScore / 100;
      const adjustedProbability = Math.max(0.1, baseProbability);

      const expected = inv.balance * adjustedProbability;
      expectedAmount += expected;
      bestCase += inv.balance;
      worstCase += inv.balance * Math.max(0.05, adjustedProbability * 0.5);
    }

    // Historical collection rate for this period length
    const historicalStart = new Date(now);
    historicalStart.setDate(historicalStart.getDate() - period.days);
    const historicalPayments = await Payment.aggregate([
      { $match: { paymentDate: { $gte: historicalStart, $lte: now } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const historicalCollected = historicalPayments[0]?.total || 0;

    results.push({
      period: period.label,
      days: period.days,
      totalOutstanding: bestCase,
      expectedCollection: Math.round(expectedAmount),
      bestCase: Math.round(bestCase),
      worstCase: Math.round(worstCase),
      gap: Math.round(bestCase - expectedAmount),
      historicalCollected: Math.round(historicalCollected),
      invoiceCount: invoices.length,
    });
  }

  return results;
};

const getProjectedVsExpected = async () => {
  const now = new Date();
  const data = [];

  // Weekly projections for next 8 weeks
  for (let i = 1; i <= 8; i++) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() + (i - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const invoices = await Invoice.find({
      status: { $nin: ['paid'] },
      dueDate: { $gte: weekStart, $lte: weekEnd },
    }).populate('customer', 'riskScore');

    let projected = 0;
    let expected = 0;

    for (const inv of invoices) {
      projected += inv.balance;
      const probability = Math.max(0.1, 1 - (inv.customer?.riskScore || 0) / 100);
      expected += inv.balance * probability;
    }

    data.push({
      week: `Week ${i}`,
      startDate: weekStart,
      endDate: weekEnd,
      projected: Math.round(projected),
      expected: Math.round(expected),
    });
  }

  return data;
};

module.exports = { getCashflowForecast, getProjectedVsExpected };
