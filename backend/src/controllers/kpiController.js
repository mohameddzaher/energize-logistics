const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const CrmCompany = require('../models/CrmCompany');
const CrmDeal = require('../models/CrmDeal');
const CrmTask = require('../models/CrmTask');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const B2CDailyOrder = require('../models/B2CDailyOrder');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const JournalEntry = require('../models/JournalEntry');
const ChartAccount = require('../models/ChartAccount');
const { NORMAL_BALANCE } = require('../config/accountingDefaults');

// The executive KPI board pulls one headline number from every module so the
// leadership (super_admin / admin) sees the whole company at a glance.
const EXEC_ROLES = ['super_admin', 'admin', 'moderator'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const safe = (p) => p.catch(() => null);

exports.getOverview = async (req, res) => {
  try {
    if (!EXEC_ROLES.includes(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      arAgg, paymentsMonth, customersTotal, customersActive,
      crmCompanies, crmOpenDeals, crmWonMonth, crmTasksOpen,
      employeesActive, leavesPending,
      b2cMonthOrders, opsOpen,
      accounts, balances,
    ] = await Promise.all([
      safe(Invoice.aggregate([{ $match: { status: { $in: ['pending', 'partial', 'overdue'] } } }, { $group: { _id: null, total: { $sum: '$balance' } } }])),
      safe(Payment.aggregate([{ $match: { paymentDate: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$amount' } } }])),
      safe(Customer.countDocuments({})),
      safe(Customer.countDocuments({ isActive: true })),
      safe(CrmCompany.countDocuments({})),
      safe(CrmDeal.aggregate([{ $match: { status: 'open' } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } }])),
      safe(CrmDeal.aggregate([{ $match: { status: 'won', wonAt: { $gte: startOfMonth } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } }])),
      safe(CrmTask.countDocuments({ status: { $in: ['todo', 'in_progress'] } })),
      safe(Employee.countDocuments({ employmentStatus: 'active' })),
      safe(LeaveRequest.countDocuments({ status: { $in: ['pending_manager', 'pending_hr'] } })),
      safe(B2CDailyOrder.aggregate([{ $match: { date: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$orders' } } }])),
      safe(OperationsWorkflow.countDocuments({ status: { $nin: ['completed', 'cancelled', 'closed'] } })),
      safe(ChartAccount.find({ type: { $in: ['revenue', 'expense'] } }).lean()),
      safe(JournalEntry.aggregate([{ $match: { status: 'posted', date: { $gte: startOfMonth } } }, { $unwind: '$lines' }, { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } }])),
    ]);

    // P&L this month from journal (if accounting is in use).
    let revenue = 0, expenses = 0;
    if (accounts && balances) {
      const bmap = {}; balances.forEach((b) => { bmap[String(b._id)] = b; });
      accounts.forEach((a) => {
        const b = bmap[String(a._id)] || { debit: 0, credit: 0 };
        if (a.type === 'revenue') revenue += b.credit - b.debit;
        else expenses += b.debit - b.credit;
      });
    }

    res.json({
      finance: {
        accountsReceivable: round2(arAgg?.[0]?.total || 0),
        paymentsThisMonth: round2(paymentsMonth?.[0]?.total || 0),
        revenueThisMonth: round2(revenue),
        expensesThisMonth: round2(expenses),
        netIncomeThisMonth: round2(revenue - expenses),
      },
      customers: { total: customersTotal || 0, active: customersActive || 0 },
      crm: {
        companies: crmCompanies || 0,
        openDeals: crmOpenDeals?.[0]?.count || 0,
        openPipelineValue: round2(crmOpenDeals?.[0]?.value || 0),
        wonThisMonthValue: round2(crmWonMonth?.[0]?.value || 0),
        wonThisMonthCount: crmWonMonth?.[0]?.count || 0,
        openTasks: crmTasksOpen || 0,
      },
      hr: { activeEmployees: employeesActive || 0, pendingLeaves: leavesPending || 0 },
      b2c: { ordersThisMonth: b2cMonthOrders?.[0]?.total || 0 },
      operations: { openWorkflows: opsOpen || 0 },
      generatedAt: now,
    });
  } catch (error) {
    console.error('getOverview error:', error);
    res.status(500).json({ message: 'Failed to load KPIs' });
  }
};
