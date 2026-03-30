const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const CollectionActivity = require('../models/CollectionActivity');

const predictLatePayment = async (invoiceId) => {
  const invoice = await Invoice.findById(invoiceId).populate('customer');
  if (!invoice) return null;

  const customer = invoice.customer;
  const now = new Date();

  // Historical late payment rate for this customer
  const allInvoices = await Invoice.find({ customer: customer._id, status: 'paid' });
  const payments = await Payment.find({ customer: customer._id });

  let lateCount = 0;
  for (const inv of allInvoices) {
    const lastPayment = payments
      .filter((p) => p.invoice.toString() === inv._id.toString())
      .sort((a, b) => b.paymentDate - a.paymentDate)[0];
    if (lastPayment && lastPayment.paymentDate > inv.dueDate) {
      lateCount++;
    }
  }

  const historicalLateRate = allInvoices.length > 0 ? lateCount / allInvoices.length : 0.5;
  const riskFactor = customer.riskScore / 100;
  const daysUntilDue = Math.ceil((new Date(invoice.dueDate) - now) / (1000 * 60 * 60 * 24));

  // Urgency factor: closer to due date with no payment = higher risk
  let urgencyFactor = 0;
  if (daysUntilDue <= 0) urgencyFactor = 0.9;
  else if (daysUntilDue <= 5) urgencyFactor = 0.6;
  else if (daysUntilDue <= 15) urgencyFactor = 0.3;
  else urgencyFactor = 0.1;

  const probability = Math.min(0.99, (historicalLateRate * 0.4 + riskFactor * 0.35 + urgencyFactor * 0.25));

  return {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    customer: customer.companyName,
    latePaymentProbability: Math.round(probability * 100),
    factors: {
      historicalLateRate: Math.round(historicalLateRate * 100),
      riskScore: customer.riskScore,
      daysUntilDue,
      urgencyFactor: Math.round(urgencyFactor * 100),
    },
  };
};

const flagPotentialDefaults = async () => {
  const customers = await Customer.find({
    isActive: true,
    riskScore: { $gte: 70 },
  });

  const flags = [];
  for (const customer of customers) {
    const recentPayments = await Payment.find({
      customer: customer._id,
      paymentDate: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    });

    const overdueInvoices = await Invoice.find({
      customer: customer._id,
      status: { $nin: ['paid'] },
      dueDate: { $lt: new Date() },
    });

    const isDeclinig = recentPayments.length === 0 && overdueInvoices.length > 0;

    if (isDeclinig || customer.riskScore >= 80) {
      flags.push({
        customer: {
          _id: customer._id,
          companyName: customer.companyName,
          riskScore: customer.riskScore,
          creditTerm: customer.creditTerm,
        },
        overdueInvoices: overdueInvoices.length,
        totalOverdue: overdueInvoices.reduce((sum, inv) => sum + inv.balance, 0),
        recentPayments: recentPayments.length,
        reason: isDeclinig
          ? 'No payments in 90 days with outstanding invoices'
          : 'Extremely high risk score',
      });
    }
  }

  return flags;
};

const suggestFollowUpTiming = async (customerId) => {
  const payments = await Payment.find({ customer: customerId }).sort({ paymentDate: 1 });

  if (payments.length < 2) {
    return { suggestion: 'Insufficient data. Follow up weekly.', dayOfWeek: 'Monday', frequency: 7 };
  }

  // Analyze which day of week payments typically come
  const dayCount = [0, 0, 0, 0, 0, 0, 0];
  payments.forEach((p) => dayCount[p.paymentDate.getDay()]++);
  const bestDay = dayCount.indexOf(Math.max(...dayCount));
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Average gap between payments
  let totalGap = 0;
  for (let i = 1; i < payments.length; i++) {
    totalGap += (payments[i].paymentDate - payments[i - 1].paymentDate) / (1000 * 60 * 60 * 24);
  }
  const avgGap = Math.round(totalGap / (payments.length - 1));

  // Suggest follow-up 2 days before their typical payment day
  const followUpDay = (bestDay - 2 + 7) % 7;

  return {
    suggestion: `Follow up on ${dayNames[followUpDay]}s, ${Math.max(2, avgGap - 3)} days before typical payment`,
    bestPaymentDay: dayNames[bestDay],
    dayOfWeek: dayNames[followUpDay],
    avgPaymentGapDays: avgGap,
    frequency: Math.max(7, avgGap),
  };
};

const suggestCreditTermReduction = async () => {
  const customers = await Customer.find({ isActive: true });
  const suggestions = [];

  for (const customer of customers) {
    const invoices = await Invoice.find({ customer: customer._id, status: 'paid' });
    const payments = await Payment.find({ customer: customer._id });

    let totalDelay = 0;
    let delayCount = 0;

    for (const inv of invoices) {
      const lastPayment = payments
        .filter((p) => p.invoice.toString() === inv._id.toString())
        .sort((a, b) => b.paymentDate - a.paymentDate)[0];
      if (lastPayment) {
        const delay = Math.ceil((lastPayment.paymentDate - inv.dueDate) / (1000 * 60 * 60 * 24));
        if (delay > 0) {
          totalDelay += delay;
          delayCount++;
        }
      }
    }

    const avgDelay = delayCount > 0 ? totalDelay / delayCount : 0;

    if (avgDelay > customer.creditTerm * 0.5) {
      suggestions.push({
        customer: {
          _id: customer._id,
          companyName: customer.companyName,
          currentCreditTerm: customer.creditTerm,
          riskScore: customer.riskScore,
        },
        avgDelayDays: Math.round(avgDelay),
        suggestedAction: customer.creditTerm > 30
          ? `Reduce credit term from ${customer.creditTerm} to ${customer.creditTerm - 15} days`
          : 'Consider requiring advance payment',
        severity: avgDelay > customer.creditTerm ? 'critical' : 'warning',
      });
    }
  }

  return suggestions.sort((a, b) => b.avgDelayDays - a.avgDelayDays);
};

const detectAbnormalBehavior = async () => {
  const customers = await Customer.find({ isActive: true });
  const anomalies = [];

  for (const customer of customers) {
    const payments = await Payment.find({ customer: customer._id }).sort({ paymentDate: -1 });
    if (payments.length < 5) continue;

    // Compare recent 3 months vs historical average
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentPayments = payments.filter((p) => p.paymentDate >= threeMonthsAgo);
    const olderPayments = payments.filter((p) => p.paymentDate < threeMonthsAgo);

    if (olderPayments.length === 0) continue;

    const recentAvg = recentPayments.length > 0
      ? recentPayments.reduce((sum, p) => sum + p.amount, 0) / recentPayments.length
      : 0;
    const historicalAvg = olderPayments.reduce((sum, p) => sum + p.amount, 0) / olderPayments.length;

    // Detect significant drop in payment amounts (>40%)
    if (historicalAvg > 0 && recentAvg < historicalAvg * 0.6) {
      anomalies.push({
        customer: {
          _id: customer._id,
          companyName: customer.companyName,
          riskScore: customer.riskScore,
        },
        type: 'payment_amount_drop',
        message: `Average payment dropped ${Math.round(((historicalAvg - recentAvg) / historicalAvg) * 100)}% in last 3 months`,
        recentAvg: Math.round(recentAvg),
        historicalAvg: Math.round(historicalAvg),
      });
    }

    // Detect payment frequency drop
    const recentFreq = recentPayments.length;
    const expectedFreq = Math.round((olderPayments.length / ((payments[payments.length - 1].paymentDate - threeMonthsAgo) / (90 * 24 * 60 * 60 * 1000))) * 3);

    if (expectedFreq > 0 && recentFreq < expectedFreq * 0.5) {
      anomalies.push({
        customer: {
          _id: customer._id,
          companyName: customer.companyName,
          riskScore: customer.riskScore,
        },
        type: 'payment_frequency_drop',
        message: `Payment frequency dropped significantly. Expected ~${expectedFreq} payments, received ${recentFreq} in last 3 months`,
        recentCount: recentFreq,
        expectedCount: expectedFreq,
      });
    }
  }

  return anomalies;
};

module.exports = {
  predictLatePayment,
  flagPotentialDefaults,
  suggestFollowUpTiming,
  suggestCreditTermReduction,
  detectAbnormalBehavior,
};
