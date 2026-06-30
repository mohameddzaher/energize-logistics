const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');

const calculateDSO = async (filters = {}) => {
  const { dateFrom, dateTo, branch, creditTerm, collector } = filters;
  const now = new Date();
  const periodStart = dateFrom ? new Date(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = dateTo ? new Date(dateTo) : now;
  const numberOfDays = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24)) || 30;

  // Build customer filter
  const customerFilter = { isActive: true };
  if (branch) customerFilter.office = branch;
  if (creditTerm) customerFilter.creditTerm = Number(creditTerm);
  if (collector) customerFilter.assignedCollector = collector;

  const customers = await Customer.find(customerFilter).select('_id').lean();
  const customerIds = customers.map((c) => c._id);

  // AR (current outstanding) and credit sales in period are independent — run
  // them in parallel (the cluster has high per-query latency, so one wave not two).
  const [arResult, salesResult] = await Promise.all([
    Invoice.aggregate([
      { $match: { customer: { $in: customerIds }, status: { $nin: ['paid'] } } },
      { $group: { _id: null, totalAR: { $sum: '$balance' } } },
    ]),
    Invoice.aggregate([
      { $match: { customer: { $in: customerIds }, invoiceDate: { $gte: periodStart, $lte: periodEnd } } },
      { $group: { _id: null, totalSales: { $sum: '$amount' } } },
    ]),
  ]);
  const totalAR = arResult[0]?.totalAR || 0;
  const totalSales = salesResult[0]?.totalSales || 0;

  const dso = totalSales > 0 ? Math.round((totalAR / totalSales) * numberOfDays) : 0;

  return { dso, totalAR, totalSales, numberOfDays, periodStart, periodEnd };
};

const getDSOByBranch = async () => {
  const offices = await Customer.distinct('office', { isActive: true });
  const results = [];

  for (const office of offices) {
    if (!office) continue;
    const data = await calculateDSO({ branch: office });
    results.push({ office, ...data });
  }

  return results;
};

const getDSOByCreditTerm = async () => {
  const results = [];
  for (const term of [15, 30, 45, 60]) {
    const data = await calculateDSO({ creditTerm: term });
    results.push({ creditTerm: term, ...data });
  }
  return results;
};

const getDSOByCollector = async () => {
  const User = require('../models/User');
  const collectors = await User.find({ role: 'employee', isActive: true }).select('_id firstName lastName');
  const results = [];

  for (const collector of collectors) {
    const data = await calculateDSO({ collector: collector._id });
    results.push({
      collector: { _id: collector._id, name: `${collector.firstName} ${collector.lastName}` },
      ...data,
    });
  }

  return results;
};

const getDSOTrend = async (months = 12) => {
  const now = new Date();
  const trend = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

    const data = await calculateDSO({ dateFrom: monthStart, dateTo: monthEnd });
    trend.push({
      month: monthStart.toLocaleString('default', { month: 'short', year: 'numeric' }),
      date: monthStart,
      ...data,
    });
  }

  return trend;
};

const getDSOAlerts = async () => {
  const alerts = [];

  const termData = await getDSOByCreditTerm();
  for (const item of termData) {
    if (item.dso > item.creditTerm) {
      alerts.push({
        type: 'dso_exceeds_credit_term',
        message: `DSO (${item.dso} days) exceeds ${item.creditTerm}-day credit term`,
        severity: 'high',
        creditTerm: item.creditTerm,
        dso: item.dso,
      });
    }
  }

  return alerts;
};

module.exports = { calculateDSO, getDSOByBranch, getDSOByCreditTerm, getDSOByCollector, getDSOTrend, getDSOAlerts };
