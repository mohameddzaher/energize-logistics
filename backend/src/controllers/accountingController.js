const mongoose = require('mongoose');
const ChartAccount = require('../models/ChartAccount');
const JournalEntry = require('../models/JournalEntry');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const { ACCOUNT_TYPES, CODES, NORMAL_BALANCE } = require('../config/accountingDefaults');
const { emitToAll } = require('../websocket/socketManager');
const { grantedBySection } = require('../utils/sectionAccess');

// ── Roles / helpers ──────────────────────────────────────────────────────────
const FINANCE_STAFF_ROLES = ['super_admin', 'admin', 'finance_manager', 'accountant'];
const FINANCE_ADMIN_ROLES = ['super_admin', 'admin', 'finance_manager'];
const isStaff = (u) => FINANCE_STAFF_ROLES.includes(u.role);
// A role the super_admin granted this section to counts as staff too —
// otherwise the grant passes the route gate but the handler still rejects it.
const staffReq = (req) => isStaff(req.user) || grantedBySection(req);
const isAdmin = (u) => FINANCE_ADMIN_ROLES.includes(u.role);
const denyNonStaff = (req, res) => { if (!staffReq(req)) { res.status(403).json({ message: 'Insufficient permissions' }); return true; } return false; };
const denyNonAdmin = (req, res) => { if (!isAdmin(req.user)) { res.status(403).json({ message: 'Only finance managers can perform this action' }); return true; } return false; };
const badId = (id, res) => { if (!mongoose.isValidObjectId(id)) { res.status(400).json({ message: 'Invalid id' }); return true; } return false; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const emitAcc = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };

// Map { code -> account _id } for the posting engine.
const accountMap = async () => {
  const accts = await ChartAccount.find({}).select('code').lean();
  const m = {};
  accts.forEach((a) => { m[a.code] = a._id; });
  return m;
};

const nextEntryNumber = async () => {
  const count = await JournalEntry.estimatedDocumentCount();
  return `JE-${String(count + 1).padStart(6, '0')}`;
};

// ── Options ──────────────────────────────────────────────────────────────────
exports.getOptions = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const accounts = await ChartAccount.find({ isActive: true }).sort({ code: 1 }).lean();
    res.json({ ACCOUNT_TYPES, accounts });
  } catch (error) {
    console.error('getOptions error:', error);
    res.status(500).json({ message: 'Failed to load options' });
  }
};

// ── Posted-balance aggregation (shared by ledger / trial balance / reports) ───
// Returns Map(accountId -> { debit, credit }) over posted entries in a window.
const balancesByAccount = async (match = {}) => {
  const rows = await JournalEntry.aggregate([
    { $match: { status: 'posted', ...match } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const m = {};
  rows.forEach((r) => { m[String(r._id)] = { debit: round2(r.debit), credit: round2(r.credit) }; });
  return m;
};

// ── Dashboard ────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Same data for every staff viewer — cache briefly so concurrent loads and
    // socket-driven reloads share one computation. See crm dashboard.
    const cache = require('../utils/ttlCache');
    const _ck = `dash:accounting:${JSON.stringify(req.query)}`;
    const _hit = cache.get(_ck);
    if (_hit !== undefined) return res.json(_hit);
    const _send = res.json.bind(res);
    res.json = (b) => { if (res.statusCode < 300) cache.set(_ck, b, 12000); return _send(b); };
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const day = 24 * 60 * 60 * 1000;
    const d30 = new Date(now - 30 * day);
    const d60 = new Date(now - 60 * day);
    const d90 = new Date(now - 90 * day);

    const [accounts, balances, monthBalances, arAgg, agingAgg, journalCount, recentEntries, openInvoiceCount] = await Promise.all([
      ChartAccount.find({}).lean(),
      balancesByAccount(),
      balancesByAccount({ date: { $gte: startOfMonth } }),
      Invoice.aggregate([{ $match: { status: { $in: ['pending', 'partial', 'overdue'] } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
      // AR aging by days-since-due on open invoices.
      Invoice.aggregate([
        { $match: { status: { $in: ['pending', 'partial', 'overdue'] }, balance: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            current: { $sum: { $cond: [{ $gte: ['$dueDate', now] }, '$balance', 0] } },
            d30: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $gte: ['$dueDate', d30] }] }, '$balance', 0] } },
            d60: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', d30] }, { $gte: ['$dueDate', d60] }] }, '$balance', 0] } },
            d90: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', d60] }, { $gte: ['$dueDate', d90] }] }, '$balance', 0] } },
            d90plus: { $sum: { $cond: [{ $lt: ['$dueDate', d90] }, '$balance', 0] } },
          },
        },
      ]),
      JournalEntry.estimatedDocumentCount(),
      JournalEntry.find({}).sort({ date: -1, createdAt: -1 }).limit(8).populate('lines.account', 'code nameEn nameAr type').lean(),
      Invoice.countDocuments({ status: { $in: ['pending', 'partial', 'overdue'] }, balance: { $gt: 0 } }),
    ]);

    const byType = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
    const monthByType = { revenue: 0, expense: 0 };
    const expenseAccts = [];
    let cashBank = 0;
    let apFromGL = 0;
    accounts.forEach((a) => {
      const b = balances[String(a._id)] || { debit: 0, credit: 0 };
      const net = NORMAL_BALANCE[a.type] === 'debit' ? b.debit - b.credit : b.credit - b.debit;
      byType[a.type] += net;
      if (a.code === CODES.CASH || a.code === CODES.BANK) cashBank += net;
      if (a.code === CODES.AP) apFromGL += net;
      const mb = monthBalances[String(a._id)] || { debit: 0, credit: 0 };
      if (a.type === 'revenue') monthByType.revenue += mb.credit - mb.debit;
      if (a.type === 'expense') {
        monthByType.expense += mb.debit - mb.credit;
        const exp = mb.debit - mb.credit;
        if (exp > 0) expenseAccts.push({ id: String(a._id), code: a.code, nameEn: a.nameEn, nameAr: a.nameAr || a.nameEn, amount: round2(exp) });
      }
    });
    expenseAccts.sort((x, y) => y.amount - x.amount);

    const ag = agingAgg[0] || {};
    const recent = recentEntries.map((e) => ({
      _id: String(e._id),
      entryNumber: e.entryNumber || '',
      date: e.date,
      memo: e.memo || '',
      status: e.status,
      totalDebit: round2(e.totalDebit),
      source: e.source ? { type: e.source.type, auto: e.source.auto } : { type: 'manual' },
      lineCount: (e.lines || []).length,
    }));

    res.json({
      totals: {
        assets: round2(byType.asset),
        liabilities: round2(byType.liability),
        equity: round2(byType.equity),
        revenue: round2(byType.revenue),
        expenses: round2(byType.expense),
        netIncome: round2(byType.revenue - byType.expense),
      },
      thisMonth: { revenue: round2(monthByType.revenue), expenses: round2(monthByType.expense), netIncome: round2(monthByType.revenue - monthByType.expense) },
      accountsReceivable: round2(arAgg[0]?.total || 0),
      accountsPayable: round2(apFromGL),
      cashBank: round2(cashBank),
      arAging: {
        current: round2(ag.current || 0),
        d30: round2(ag.d30 || 0),
        d60: round2(ag.d60 || 0),
        d90: round2(ag.d90 || 0),
        d90plus: round2(ag.d90plus || 0),
      },
      topExpenses: expenseAccts.slice(0, 6),
      recentEntries: recent,
      openInvoiceCount,
      journalEntries: journalCount,
      accountsCount: accounts.length,
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Chart of accounts ────────────────────────────────────────────────────────
exports.listAccounts = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { type, q } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: rx }, { nameEn: rx }, { nameAr: rx }];
    }
    const accounts = await ChartAccount.find(filter).sort({ code: 1 }).lean();
    // Attach each account's current balance (net posting, signed to its normal
    // side) so the accounts list can show a real figure instead of 0.00.
    const balances = await balancesByAccount({});
    for (const a of accounts) {
      const b = balances[String(a._id)] || { debit: 0, credit: 0 };
      const net = b.debit - b.credit;
      a.balance = round2(a.normalBalance === 'credit' ? -net : net);
    }
    res.json({ accounts });
  } catch (error) {
    console.error('listAccounts error:', error);
    res.status(500).json({ message: 'Failed to load accounts' });
  }
};

exports.createAccount = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { code, nameEn, nameAr, type, parent, description } = req.body;
    if (!code || !nameEn || !type) return res.status(400).json({ message: 'Code, name and type are required' });
    if (!NORMAL_BALANCE[type]) return res.status(400).json({ message: 'Invalid account type' });
    const exists = await ChartAccount.findOne({ code });
    if (exists) return res.status(400).json({ message: 'Account code already exists' });
    const account = await ChartAccount.create({
      code, nameEn, nameAr, type, parent: parent || undefined, description,
      normalBalance: NORMAL_BALANCE[type], createdBy: req.user._id,
    });
    emitAcc('accounting:account', { id: String(account._id) });
    res.status(201).json({ account });
  } catch (error) {
    console.error('createAccount error:', error);
    res.status(500).json({ message: 'Failed to create account' });
  }
};

exports.updateAccount = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const account = await ChartAccount.findById(id);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    ['nameEn', 'nameAr', 'description', 'isActive', 'parent'].forEach((f) => { if (req.body[f] !== undefined) account[f] = req.body[f]; });
    if (req.body.type && NORMAL_BALANCE[req.body.type]) { account.type = req.body.type; account.normalBalance = NORMAL_BALANCE[req.body.type]; }
    await account.save();
    emitAcc('accounting:account', { id: String(id) });
    res.json({ account });
  } catch (error) {
    console.error('updateAccount error:', error);
    res.status(500).json({ message: 'Failed to update account' });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const account = await ChartAccount.findById(id);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    if (account.system) return res.status(400).json({ message: 'Cannot delete a system account' });
    const used = await JournalEntry.countDocuments({ 'lines.account': id });
    if (used > 0) return res.status(400).json({ message: `Account is used in ${used} journal entries` });
    await account.deleteOne();
    emitAcc('accounting:account', { id: String(id), deleted: true });
    res.json({ message: 'Account deleted' });
  } catch (error) {
    console.error('deleteAccount error:', error);
    res.status(500).json({ message: 'Failed to delete account' });
  }
};

// ── Journal ──────────────────────────────────────────────────────────────────
const popJournal = (q) => q.populate('lines.account', 'code nameEn nameAr type').populate('createdBy', 'firstName lastName');

exports.listJournal = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { from, to, source, q } = req.query;
    const filter = {};
    if (source) filter['source.type'] = source;
    if (from || to) { filter.date = {}; if (from) filter.date.$gte = new Date(from); if (to) filter.date.$lte = new Date(to); }
    if (q && q.trim()) { const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ memo: rx }, { entryNumber: rx }]; }
    const entries = await popJournal(JournalEntry.find(filter)).sort({ date: -1, createdAt: -1 }).limit(500).lean();
    res.json({ entries });
  } catch (error) {
    console.error('listJournal error:', error);
    res.status(500).json({ message: 'Failed to load journal' });
  }
};

exports.createJournal = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { date, memo, lines } = req.body;
    if (!Array.isArray(lines) || lines.length < 2) return res.status(400).json({ message: 'A journal entry needs at least two lines' });
    const clean = lines
      .map((l) => ({ account: l.account, debit: round2(l.debit), credit: round2(l.credit), description: l.description }))
      .filter((l) => l.account && (l.debit > 0 || l.credit > 0));
    const totalDebit = round2(clean.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(clean.reduce((s, l) => s + l.credit, 0));
    if (totalDebit !== totalCredit) return res.status(400).json({ message: `Entry is not balanced (debit ${totalDebit} ≠ credit ${totalCredit})` });
    if (totalDebit === 0) return res.status(400).json({ message: 'Entry total cannot be zero' });
    const entry = await JournalEntry.create({
      entryNumber: await nextEntryNumber(),
      date: date ? new Date(date) : new Date(),
      memo, lines: clean, totalDebit, totalCredit, status: 'posted',
      source: { type: 'manual', auto: false }, createdBy: req.user._id,
    });
    emitAcc('accounting:journal', { id: String(entry._id) });
    const full = await popJournal(JournalEntry.findById(entry._id)).lean();
    res.status(201).json({ entry: full });
  } catch (error) {
    console.error('createJournal error:', error);
    res.status(500).json({ message: 'Failed to create entry' });
  }
};

exports.deleteJournal = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const entry = await JournalEntry.findByIdAndDelete(id);
    if (!entry) return res.status(404).json({ message: 'Entry not found' });
    emitAcc('accounting:journal', { id: String(id), deleted: true });
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    console.error('deleteJournal error:', error);
    res.status(500).json({ message: 'Failed to delete entry' });
  }
};

// ── Ledger (one account) ─────────────────────────────────────────────────────
exports.getLedger = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const account = await ChartAccount.findById(id).lean();
    if (!account) return res.status(404).json({ message: 'Account not found' });
    const { from, to } = req.query;
    const match = { status: 'posted', 'lines.account': new mongoose.Types.ObjectId(id) };
    if (from || to) { match.date = {}; if (from) match.date.$gte = new Date(from); if (to) match.date.$lte = new Date(to); }
    const entries = await JournalEntry.find(match).sort({ date: 1, createdAt: 1 }).lean();
    let running = 0;
    const debitNormal = account.normalBalance === 'debit';
    const rows = [];
    for (const e of entries) {
      for (const l of e.lines) {
        if (String(l.account) !== String(id)) continue;
        running += debitNormal ? (l.debit - l.credit) : (l.credit - l.debit);
        rows.push({ entryId: e._id, entryNumber: e.entryNumber, date: e.date, memo: e.memo, debit: round2(l.debit), credit: round2(l.credit), balance: round2(running) });
      }
    }
    res.json({ account, rows, closingBalance: round2(running) });
  } catch (error) {
    console.error('getLedger error:', error);
    res.status(500).json({ message: 'Failed to load ledger' });
  }
};

// ── Trial balance ────────────────────────────────────────────────────────────
exports.getTrialBalance = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { from, to } = req.query;
    const match = {};
    if (from || to) { match.date = {}; if (from) match.date.$gte = new Date(from); if (to) match.date.$lte = new Date(to); }
    const [accounts, balances] = await Promise.all([ChartAccount.find({}).sort({ code: 1 }).lean(), balancesByAccount(match)]);
    let totalDebit = 0, totalCredit = 0;
    const rows = accounts.map((a) => {
      const b = balances[String(a._id)] || { debit: 0, credit: 0 };
      const net = b.debit - b.credit;
      const debit = net > 0 ? net : 0;
      const credit = net < 0 ? -net : 0;
      totalDebit += debit; totalCredit += credit;
      return { account: a, debit: round2(debit), credit: round2(credit) };
    }).filter((r) => r.debit || r.credit);
    res.json({ rows, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit), balanced: round2(totalDebit) === round2(totalCredit) });
  } catch (error) {
    console.error('getTrialBalance error:', error);
    res.status(500).json({ message: 'Failed to load trial balance' });
  }
};

// ── Profit & Loss ────────────────────────────────────────────────────────────
exports.getProfitAndLoss = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { from, to } = req.query;
    const match = {};
    if (from || to) { match.date = {}; if (from) match.date.$gte = new Date(from); if (to) match.date.$lte = new Date(to); }
    const [accounts, balances] = await Promise.all([ChartAccount.find({ type: { $in: ['revenue', 'expense'] } }).sort({ code: 1 }).lean(), balancesByAccount(match)]);
    const revenue = [], expenses = [];
    let totalRevenue = 0, totalExpenses = 0;
    accounts.forEach((a) => {
      const b = balances[String(a._id)] || { debit: 0, credit: 0 };
      if (a.type === 'revenue') { const amt = round2(b.credit - b.debit); if (amt) { revenue.push({ account: a, amount: amt }); totalRevenue += amt; } }
      else { const amt = round2(b.debit - b.credit); if (amt) { expenses.push({ account: a, amount: amt }); totalExpenses += amt; } }
    });
    res.json({ revenue, expenses, totalRevenue: round2(totalRevenue), totalExpenses: round2(totalExpenses), netIncome: round2(totalRevenue - totalExpenses) });
  } catch (error) {
    console.error('getProfitAndLoss error:', error);
    res.status(500).json({ message: 'Failed to load P&L' });
  }
};

// ── Receivables (AR aging from invoices) ─────────────────────────────────────
exports.getReceivables = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const invoices = await Invoice.find({ status: { $in: ['pending', 'partial', 'overdue'] }, balance: { $gt: 0 } })
      .populate('customer', 'companyName customerNumber').sort({ dueDate: 1 }).lean();
    const now = Date.now();
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    const rows = invoices.map((inv) => {
      const daysOverdue = Math.floor((now - new Date(inv.dueDate).getTime()) / 86400000);
      const bal = round2(inv.balance);
      if (daysOverdue <= 0) buckets.current += bal;
      else if (daysOverdue <= 30) buckets.d30 += bal;
      else if (daysOverdue <= 60) buckets.d60 += bal;
      else if (daysOverdue <= 90) buckets.d90 += bal;
      else buckets.over90 += bal;
      return { invoice: inv.invoiceNumber, customer: inv.customer, balance: bal, dueDate: inv.dueDate, daysOverdue };
    });
    Object.keys(buckets).forEach((k) => { buckets[k] = round2(buckets[k]); });
    res.json({ rows, buckets, total: round2(invoices.reduce((s, i) => s + i.balance, 0)) });
  } catch (error) {
    console.error('getReceivables error:', error);
    res.status(500).json({ message: 'Failed to load receivables' });
  }
};

// ── Payables (A/P aging from vendor bills) ───────────────────────────────────
exports.getPayables = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const VendorBill = require('../models/VendorBill');
    const bills = await VendorBill.find({ status: { $in: ['unpaid', 'partial'] }, balance: { $gt: 0 } })
      .populate('vendor', 'name').sort({ dueDate: 1 }).lean();
    const now = Date.now();
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    const rows = bills.map((b) => {
      const daysOverdue = b.dueDate ? Math.floor((now - new Date(b.dueDate).getTime()) / 86400000) : 0;
      const bal = round2(b.balance);
      if (daysOverdue <= 0) buckets.current += bal;
      else if (daysOverdue <= 30) buckets.d30 += bal;
      else if (daysOverdue <= 60) buckets.d60 += bal;
      else if (daysOverdue <= 90) buckets.d90 += bal;
      else buckets.over90 += bal;
      return { bill: b.billNumber, vendor: b.vendor, balance: bal, dueDate: b.dueDate, daysOverdue };
    });
    Object.keys(buckets).forEach((k) => { buckets[k] = round2(buckets[k]); });
    res.json({ rows, buckets, total: round2(bills.reduce((s, b) => s + b.balance, 0)) });
  } catch (error) {
    console.error('getPayables error:', error);
    res.status(500).json({ message: 'Failed to load payables' });
  }
};

// ── Auto-posting engine ──────────────────────────────────────────────────────
// Scans source documents and creates a balanced, idempotent journal entry for
// each one it hasn't posted yet. Safe to re-run.
exports.sync = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const map = await accountMap();
    const need = [CODES.CASH, CODES.AR, CODES.SALES_REVENUE, CODES.OPEX, CODES.INVENTORY];
    if (need.some((c) => !map[c])) return res.status(400).json({ message: 'Chart of accounts not seeded. Restart the server to seed defaults.' });

    const existing = await JournalEntry.find({ 'source.auto': true }).select('source').lean();
    const posted = new Set(existing.map((e) => `${e.source.type}:${e.source.refId}`));
    const toCreate = [];
    let num = await JournalEntry.estimatedDocumentCount();
    const mk = (date, memo, lines, type, refId) => {
      const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
      const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
      if (!totalDebit || totalDebit !== totalCredit) return;
      toCreate.push({ entryNumber: `JE-${String(++num).padStart(6, '0')}`, date, memo, lines, totalDebit, totalCredit, status: 'posted', source: { type, refId, auto: true }, createdBy: req.user._id });
    };

    // Invoices → Dr AR, Cr Sales Revenue (revenue recognised on issue).
    const invoices = await Invoice.find({}).select('invoiceNumber amount invoiceDate').lean();
    invoices.forEach((inv) => {
      if (posted.has(`invoice:${inv._id}`)) return;
      mk(inv.invoiceDate, `Invoice ${inv.invoiceNumber}`, [
        { account: map[CODES.AR], debit: round2(inv.amount), credit: 0 },
        { account: map[CODES.SALES_REVENUE], debit: 0, credit: round2(inv.amount) },
      ], 'invoice', inv._id);
    });

    // Payments → Dr Cash, Cr AR.
    const payments = await Payment.find({}).select('amount paymentDate reference').lean();
    payments.forEach((p) => {
      if (posted.has(`payment:${p._id}`)) return;
      mk(p.paymentDate, `Payment ${p.reference || ''}`.trim(), [
        { account: map[CODES.CASH], debit: round2(p.amount), credit: 0 },
        { account: map[CODES.AR], debit: 0, credit: round2(p.amount) },
      ], 'payment', p._id);
    });

    // Wallet transactions → collection / expense / purchase.
    const wallet = await WalletTransaction.find({}).select('type amount date description itemName').lean();
    wallet.forEach((w) => {
      if (posted.has(`wallet:${w._id}`)) return;
      const d = w.date ? new Date(w.date) : new Date();
      if (w.type === 'collection') {
        mk(d, `Wallet collection`, [
          { account: map[CODES.CASH], debit: round2(w.amount), credit: 0 },
          { account: map[CODES.AR], debit: 0, credit: round2(w.amount) },
        ], 'wallet', w._id);
      } else if (w.type === 'expense') {
        mk(d, `Wallet expense ${w.itemName || w.description || ''}`.trim(), [
          { account: map[CODES.OPEX], debit: round2(w.amount), credit: 0 },
          { account: map[CODES.CASH], debit: 0, credit: round2(w.amount) },
        ], 'wallet', w._id);
      } else if (w.type === 'purchase') {
        mk(d, `Wallet purchase ${w.itemName || ''}`.trim(), [
          { account: map[CODES.INVENTORY], debit: round2(w.amount), credit: 0 },
          { account: map[CODES.CASH], debit: 0, credit: round2(w.amount) },
        ], 'wallet', w._id);
      }
    });

    let created = 0;
    if (toCreate.length) {
      // insertMany ordered:false so a rare duplicate (race) doesn't abort the batch.
      const r = await JournalEntry.insertMany(toCreate, { ordered: false }).catch((e) => e.insertedDocs || []);
      created = Array.isArray(r) ? r.length : toCreate.length;
    }
    emitAcc('accounting:journal', {});
    res.json({ message: `Synced. ${created} new journal entr${created === 1 ? 'y' : 'ies'} posted.`, created, scanned: invoices.length + payments.length + wallet.length });
  } catch (error) {
    console.error('sync error:', error);
    res.status(500).json({ message: 'Failed to sync' });
  }
};
