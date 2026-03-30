const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Dispute = require('../models/Dispute');
const Customer = require('../models/Customer');

const calculateRiskScore = async (customerId) => {
  const customer = await Customer.findById(customerId);
  if (!customer) return null;

  const invoices = await Invoice.find({ customer: customerId });
  const payments = await Payment.find({ customer: customerId });
  const disputes = await Dispute.find({ customer: customerId });

  if (invoices.length === 0) {
    return { score: 0, level: 'low', factors: {} };
  }

  const now = new Date();

  // Factor 1: Historical delay frequency (20%)
  const completedInvoices = invoices.filter((inv) => inv.status === 'paid');
  let latePayments = 0;
  for (const inv of completedInvoices) {
    const lastPayment = payments
      .filter((p) => p.invoice.toString() === inv._id.toString())
      .sort((a, b) => b.paymentDate - a.paymentDate)[0];
    if (lastPayment && lastPayment.paymentDate > inv.dueDate) {
      latePayments++;
    }
  }
  const delayFrequency = completedInvoices.length > 0
    ? (latePayments / completedInvoices.length) * 100
    : 0;

  // Factor 2: Average overdue days (20%)
  let totalOverdueDays = 0;
  let overdueCount = 0;
  for (const inv of invoices) {
    if (inv.status !== 'paid') {
      const overdueDays = Math.max(0, Math.ceil((now - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24)));
      if (overdueDays > 0) {
        totalOverdueDays += overdueDays;
        overdueCount++;
      }
    }
  }
  const avgOverdueDays = overdueCount > 0 ? totalOverdueDays / overdueCount : 0;
  const overdueScore = Math.min(100, avgOverdueDays * 1.5);

  // Factor 3: Outstanding ratio vs credit limit (15%)
  const outstandingRatio = customer.creditLimit > 0
    ? (customer.currentOutstanding / customer.creditLimit) * 100
    : (customer.currentOutstanding > 0 ? 80 : 0);

  // Factor 4: Payment consistency (15%) — std dev of payment timing
  const paymentDelays = [];
  for (const inv of completedInvoices) {
    const invPayments = payments.filter((p) => p.invoice.toString() === inv._id.toString());
    if (invPayments.length > 0) {
      const firstPayment = invPayments.sort((a, b) => a.paymentDate - b.paymentDate)[0];
      const delayDays = Math.ceil((firstPayment.paymentDate - inv.dueDate) / (1000 * 60 * 60 * 24));
      paymentDelays.push(delayDays);
    }
  }
  let consistencyScore = 0;
  if (paymentDelays.length > 1) {
    const mean = paymentDelays.reduce((a, b) => a + b, 0) / paymentDelays.length;
    const variance = paymentDelays.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / paymentDelays.length;
    const stdDev = Math.sqrt(variance);
    consistencyScore = Math.min(100, stdDev * 5);
  }

  // Factor 5: Late payment percentage (15%)
  const latePaymentPercentage = invoices.length > 0
    ? (latePayments / invoices.length) * 100
    : 0;

  // Factor 6: Dispute history (10%)
  const disputeScore = Math.min(100, disputes.length * 20);

  // Factor 7: Credit term behavior (5%) — paying within % of credit term
  const termBehavior = avgOverdueDays > customer.creditTerm * 0.5 ? 80 : avgOverdueDays > 0 ? 40 : 0;

  // Weighted score
  const score = Math.round(
    delayFrequency * 0.20 +
    overdueScore * 0.20 +
    Math.min(100, outstandingRatio) * 0.15 +
    consistencyScore * 0.15 +
    latePaymentPercentage * 0.15 +
    disputeScore * 0.10 +
    termBehavior * 0.05
  );

  const finalScore = Math.min(100, Math.max(0, score));
  const level = finalScore <= 30 ? 'low' : finalScore <= 60 ? 'medium' : 'high';

  // Update customer
  customer.riskScore = finalScore;
  customer.riskLevel = level;
  await customer.save();

  return {
    score: finalScore,
    level,
    factors: {
      delayFrequency: Math.round(delayFrequency),
      avgOverdueDays: Math.round(avgOverdueDays),
      outstandingRatio: Math.round(Math.min(100, outstandingRatio)),
      consistencyScore: Math.round(consistencyScore),
      latePaymentPercentage: Math.round(latePaymentPercentage),
      disputeScore: Math.round(disputeScore),
      termBehavior: Math.round(termBehavior),
    },
  };
};

const recalculateAllRiskScores = async () => {
  const customers = await Customer.find({ isActive: true });
  const results = [];

  for (const customer of customers) {
    const result = await calculateRiskScore(customer._id);
    results.push({ customerId: customer._id, companyName: customer.companyName, ...result });
  }

  return results;
};

const getHighRiskClients = async () => {
  return Customer.find({ riskLevel: 'high', isActive: true })
    .populate('assignedCollector', 'firstName lastName')
    .sort({ riskScore: -1 });
};

const getRiskDistribution = async () => {
  const result = await Customer.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$riskLevel', count: { $sum: 1 }, totalOutstanding: { $sum: '$currentOutstanding' } } },
  ]);

  return result.map((r) => ({
    level: r._id,
    count: r.count,
    totalOutstanding: r.totalOutstanding,
  }));
};

module.exports = { calculateRiskScore, recalculateAllRiskScores, getHighRiskClients, getRiskDistribution };
