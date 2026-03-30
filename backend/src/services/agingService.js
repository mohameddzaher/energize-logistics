const Invoice = require('../models/Invoice');
const { AGING_BUCKETS } = require('../config/constants');

const getAgingReport = async (filters = {}) => {
  const matchStage = {
    status: { $nin: ['paid'] },
  };

  if (filters.branch || filters.office) matchStage['customerData.office'] = filters.branch || filters.office;
  if (filters.collector) matchStage['customerData.assignedCollector'] = filters.collector;

  const invoiceFilter = { status: { $nin: ['paid'] } };
  if (filters.dateFrom) invoiceFilter.invoiceDate = { ...(invoiceFilter.invoiceDate || {}), $gte: new Date(filters.dateFrom) };
  if (filters.dateTo) invoiceFilter.invoiceDate = { ...(invoiceFilter.invoiceDate || {}), $lte: new Date(filters.dateTo) };
  const invoices = await Invoice.find(invoiceFilter)
    .populate('customer', 'companyName office assignedCollector creditTerm');

  const now = new Date();
  const buckets = AGING_BUCKETS.map((b) => ({
    ...b,
    count: 0,
    totalAmount: 0,
    invoices: [],
  }));

  let filteredInvoices = invoices;
  if (filters.branch || filters.office) {
    const officeVal = filters.branch || filters.office;
    filteredInvoices = filteredInvoices.filter((inv) => inv.customer?.office === officeVal);
  }
  if (filters.collector) {
    filteredInvoices = filteredInvoices.filter(
      (inv) => inv.customer?.assignedCollector?.toString() === filters.collector
    );
  }

  filteredInvoices.forEach((inv) => {
    const dueDate = new Date(inv.dueDate);
    const diffMs = now - dueDate;
    const overdueDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    // For non-overdue invoices, put them in 0-15 bucket
    const daysValue = diffMs < 0 ? 0 : overdueDays;

    for (const bucket of buckets) {
      if (daysValue >= bucket.min && daysValue < bucket.max) {
        bucket.count++;
        bucket.totalAmount += inv.balance;
        bucket.invoices.push({
          _id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          customer: inv.customer?.companyName,
          amount: inv.balance,
          overdueDays: daysValue,
          dueDate: inv.dueDate,
        });
        break;
      }
    }
  });

  const totalOutstanding = buckets.reduce((sum, b) => sum + b.totalAmount, 0);

  return {
    buckets: buckets.map(({ invoices, ...b }) => ({
      ...b,
      percentage: totalOutstanding > 0 ? ((b.totalAmount / totalOutstanding) * 100).toFixed(1) : 0,
    })),
    totalOutstanding,
    totalInvoices: filteredInvoices.length,
    details: buckets,
  };
};

module.exports = { getAgingReport };
