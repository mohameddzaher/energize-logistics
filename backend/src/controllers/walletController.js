const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Vendor = require('../models/Vendor');
const Driver = require('../models/Driver');
const Payment = require('../models/Payment');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

// Helper: get YYYY-MM-DD string
const toDateStr = (d) => {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Helper: risk flags
const EXPENSE_THRESHOLD = 10000;

const checkRiskFlags = (transaction) => {
  const flags = [];
  if (transaction.amount >= EXPENSE_THRESHOLD) {
    flags.push(`Large transaction: ${transaction.amount} SAR`);
  }
  const hour = new Date().getHours();
  if (hour < 6 || hour > 22) {
    flags.push('Transaction outside working hours');
  }
  return flags;
};

// ─── ENRICH TRANSACTIONS WITH OPERATIONS DATA ────────────────
const OperationsWorkflow = require('../models/OperationsWorkflow');

const enrichTransactionsWithOpsData = async (transactions) => {
  // Collect all delivery statement numbers from collections and purchases
  const reportNumbers = [];
  for (const tx of transactions) {
    const txObj = tx.toObject ? tx.toObject() : tx;
    if (txObj.deliveryStatementNumber) reportNumbers.push(txObj.deliveryStatementNumber);
    if (txObj.purchaseDeliveryStatementNumber) reportNumbers.push(txObj.purchaseDeliveryStatementNumber);
  }

  if (reportNumbers.length === 0) return transactions;

  // Fetch all matching workflows in one query
  const uniqueNumbers = [...new Set(reportNumbers)];
  const workflows = await OperationsWorkflow.find({
    reportNumber: { $in: uniqueNumbers.map(n => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) },
  }).select('reportNumber username fromLocation toLocation ownerType truckSize carNumber reportDate branch').lean();

  // Build lookup map
  const wfMap = {};
  for (const wf of workflows) {
    wfMap[wf.reportNumber.toUpperCase()] = {
      client: wf.username || '',
      from: wf.fromLocation || '',
      to: wf.toLocation || '',
      carType: wf.ownerType || '',
      length: wf.truckSize || '',
      carNumber: wf.carNumber || '',
      reportDate: wf.reportDate || null,
      branch: wf.branch || '',
    };
  }

  // Attach operation data to each transaction
  return transactions.map((tx) => {
    const txObj = tx.toObject ? tx.toObject() : { ...tx };
    const dsNum = txObj.deliveryStatementNumber || txObj.purchaseDeliveryStatementNumber;
    if (dsNum) {
      const opsData = wfMap[dsNum.toUpperCase()];
      if (opsData) txObj.operationDetails = opsData;
    }
    return txObj;
  });
};

// ─── GET OR CREATE DAILY WALLET ──────────────────────────────
const getOrCreateWallet = async (userId, branchId, date) => {
  let wallet = await DailyWallet.findOne({ user: userId, date });

  if (!wallet) {
    // Find previous day's wallet for opening balance
    const prevWallet = await DailyWallet.findOne({ user: userId, date: { $lt: date } }).sort({ date: -1 });
    const openingBalance = prevWallet ? prevWallet.closingBalance : 0;

    wallet = await DailyWallet.create({
      user: userId,
      branch: branchId,
      date,
      openingBalance,
      closingBalance: openingBalance,
    });
  }

  return wallet;
};

// ─── RECALCULATE WALLET TOTALS ───────────────────────────────
const recalcWallet = async (walletId) => {
  const txns = await WalletTransaction.find({ wallet: walletId }).select('type amount').lean();
  let totalCollections = 0;
  let totalExpenses = 0;
  let totalPurchases = 0;

  for (const t of txns) {
    if (t.type === 'collection') totalCollections += t.amount;
    else if (t.type === 'expense') totalExpenses += t.amount;
    else if (t.type === 'purchase') totalPurchases += t.amount;
  }

  const wallet = await DailyWallet.findById(walletId);
  wallet.totalCollections = totalCollections;
  wallet.totalExpenses = totalExpenses;
  wallet.totalPurchases = totalPurchases;
  wallet.closingBalance = wallet.openingBalance + totalCollections - totalExpenses - totalPurchases;
  await wallet.save();

  return wallet;
};

// ─── GET DAILY WALLET ────────────────────────────────────────
exports.getDailyWallet = async (req, res) => {
  try {
    const date = req.query.date || toDateStr();
    const userId = req.query.userId || req.user._id;

    // Operations users can only see their own wallet
    if (req.user.role === 'operations' && userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Cannot view other wallets' });
    }

    // Super admin and operations_manager can view any user's wallet by looking up their branch
    let branchId = req.user.branch;
    if (['super_admin', 'operations_manager'].includes(req.user.role) && userId.toString() !== req.user._id.toString()) {
      const User = require('../models/User');
      const targetUser = await User.findById(userId);
      if (targetUser?.branch) branchId = targetUser.branch;
    }

    if (!branchId) {
      return res.status(400).json({ message: 'No branch assigned to this user. Please assign a branch in user settings.' });
    }

    const wallet = await getOrCreateWallet(userId, branchId, date);
    const populated = await DailyWallet.findById(wallet._id)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .populate('closedBy', 'firstName lastName');

    const rawTransactions = await WalletTransaction.find({ wallet: wallet._id })
      .populate('customer', 'companyName customerNumber')
      .populate('invoice', 'invoiceNumber amount balance')
      .populate('vendor', 'name')
      .populate('driver', 'name')
      .populate('expenseCategory', 'name')
      .sort({ createdAt: -1 });

    const transactions = await enrichTransactionsWithOpsData(rawTransactions);

    res.json({ wallet: populated, transactions });
  } catch (error) {
    console.error('getDailyWallet error:', error);
    res.status(500).json({ message: error.message || 'Failed to load wallet' });
  }
};

// ─── ADD TRANSACTION ─────────────────────────────────────────
exports.addTransaction = async (req, res) => {
  try {
    const {
      date, type, amount, customer, invoice, deliveryStatementNumber,
      vendor, driver, vendorName, driverName, expenseCategory, itemName, reference, notes,
      collectionSource, description,
      purchaseDeliveryStatementNumber, purchaseDriverName, purchaseReceiptNumber, purchaseBranch,
    } = req.body;

    const txDate = date || toDateStr();

    if (!req.user.branch) {
      return res.status(400).json({ message: 'No branch assigned' });
    }

    // Check if day is closed (only managers can add to closed days)
    const wallet = await getOrCreateWallet(req.user._id, req.user.branch, txDate);
    const isManager = ['super_admin', 'admin', 'operations_manager', 'operations'].includes(req.user.role);

    if (wallet.isClosed && !isManager) {
      return res.status(400).json({ message: 'Day is closed. Contact manager to reopen.' });
    }

    // For collections: validate based on source
    let invoiceDoc = null;
    let resolvedCustomer = customer;
    let resolvedInvoice = invoice;
    const source = collectionSource || 'client';
    if (type === 'collection') {
      if (source === 'client') {
        // Auto-lookup customer AND invoice from delivery statement number
        if (deliveryStatementNumber) {
          const dsEscaped = deliveryStatementNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          // Step 1: Try to find workflow by reportNumber
          try {
            const OperationsWorkflow = require('../models/OperationsWorkflow');
            const wf = await OperationsWorkflow.findOne({
              reportNumber: { $regex: `^${dsEscaped}$`, $options: 'i' },
            });
            if (wf && !resolvedCustomer && wf.username) {
              const custDoc = await Customer.findOne({
                companyName: { $regex: `^${wf.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
                isActive: true,
              });
              if (custDoc) resolvedCustomer = custDoc._id;
            }
          } catch (e) {
            console.error('Wallet: workflow lookup error', e.message);
          }

          // Step 2: Find invoice by invoiceNumber = deliveryStatementNumber
          if (!resolvedInvoice) {
            const invoiceQuery = {
              invoiceNumber: { $regex: `^${dsEscaped}$`, $options: 'i' },
            };
            if (resolvedCustomer) invoiceQuery.customer = resolvedCustomer;
            const matchedInvoice = await Invoice.findOne(invoiceQuery);
            if (matchedInvoice && !matchedInvoice.isFrozen) {
              resolvedInvoice = matchedInvoice._id;
              invoiceDoc = matchedInvoice;
              if (!resolvedCustomer && matchedInvoice.customer) {
                resolvedCustomer = matchedInvoice.customer;
              }
            }
          }
        }

        // If invoice specified directly, validate
        if (resolvedInvoice && !invoiceDoc) {
          invoiceDoc = await Invoice.findById(resolvedInvoice);
          if (!invoiceDoc) return res.status(404).json({ message: 'Invoice not found' });
          if (invoiceDoc.isFrozen) return res.status(400).json({ message: 'Invoice is frozen' });
        }
      }
      // Company collections don't require customer - just description and amount
    }

    // For purchases: look up selling value from delivery statement
    let purchaseInvoiceAmountVal;
    if (type === 'purchase' && purchaseDeliveryStatementNumber) {
      try {
        const OperationsWorkflow = require('../models/OperationsWorkflow');
        const wf = await OperationsWorkflow.findOne({
          reportNumber: { $regex: `^${purchaseDeliveryStatementNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        });
        if (wf && wf.sellingValue) purchaseInvoiceAmountVal = wf.sellingValue;
      } catch (e) { console.error('walletController silent catch:', e.message); }
    }

    // Check risk flags
    const riskFlags = checkRiskFlags({ amount, type });
    const isFlagged = riskFlags.length > 0;

    const transaction = await WalletTransaction.create({
      wallet: wallet._id,
      user: req.user._id,
      branch: req.user.branch,
      date: txDate,
      type,
      amount,
      collectionSource: type === 'collection' ? source : undefined,
      customer: resolvedCustomer || undefined,
      invoice: resolvedInvoice || undefined,
      deliveryStatementNumber: deliveryStatementNumber || undefined,
      description: description || undefined,
      vendor: vendor || undefined,
      vendorName: vendorName || undefined,
      driver: driver || undefined,
      driverName: driverName || undefined,
      expenseCategory: expenseCategory || undefined,
      itemName: itemName || undefined,
      purchaseDeliveryStatementNumber: purchaseDeliveryStatementNumber || undefined,
      purchaseInvoiceAmount: purchaseInvoiceAmountVal || undefined,
      purchaseDriverName: purchaseDriverName || undefined,
      purchaseReceiptNumber: purchaseReceiptNumber || undefined,
      purchaseBranch: purchaseBranch || undefined,
      reference: reference || undefined,
      notes: notes || undefined,
      isFlagged,
      flagReason: isFlagged ? riskFlags.join('; ') : undefined,
    });

    // ─── FINANCIAL SYNC ──────────────────────────────────────
    if (type === 'collection' && source === 'client' && resolvedCustomer) {
      // Update customer outstanding
      const customerDoc = await Customer.findById(resolvedCustomer);
      if (customerDoc) {
        customerDoc.currentOutstanding = Math.max(0, customerDoc.currentOutstanding - amount);
        customerDoc.lastPaymentDate = new Date();
        customerDoc.lastPaymentAmount = amount;
        await customerDoc.save();
      }

      // Update invoice if linked
      if (invoiceDoc) {
        invoiceDoc.paidAmount += amount;
        invoiceDoc.balance = invoiceDoc.amount - invoiceDoc.paidAmount;
        if (invoiceDoc.balance <= 0) {
          invoiceDoc.status = 'paid';
          invoiceDoc.balance = 0;
        } else {
          invoiceDoc.status = 'partial';
        }
        await invoiceDoc.save();
      }

      // Log payment in Payments collection for sync
      await Payment.create({
        invoice: resolvedInvoice || undefined,
        customer: resolvedCustomer,
        amount,
        paymentDate: new Date(),
        paymentMethod: 'cash',
        receivedBy: req.user._id,
        reference: `WALLET-${transaction._id}`,
        notes: `Cash collection via wallet${notes ? ': ' + notes : ''}`,
      });
    }

    // Update vendor total if expense paid to vendor
    if (type === 'expense' && vendor) {
      const vendorDoc = await Vendor.findById(vendor);
      if (vendorDoc) {
        vendorDoc.totalPaid += amount;
        await vendorDoc.save();
      }
    }

    // Update driver total if expense paid to driver
    if (type === 'expense' && driver) {
      const driverDoc = await Driver.findById(driver);
      if (driverDoc) {
        driverDoc.totalPaid += amount;
        await driverDoc.save();
      }
    }

    // Recalculate wallet totals
    const updatedWallet = await recalcWallet(wallet._id);

    const populated = await WalletTransaction.findById(transaction._id)
      .populate('customer', 'companyName customerNumber')
      .populate('invoice', 'invoiceNumber amount balance')
      .populate('vendor', 'name')
      .populate('driver', 'name')
      .populate('expenseCategory', 'name');

    await logAudit({
      user: req.user._id, action: 'wallet_transaction', entity: 'WalletTransaction',
      entityId: transaction._id, changes: { after: { type, amount, date: txDate } }, ipAddress: req.ip,
    });

    try {
      emitToAll('wallet:transaction', { transaction: populated, wallet: updatedWallet });
      if (type === 'collection') {
        emitToAll('payment:logged', { walletTransaction: true });
        emitToAll('customer:updated', {});
        emitToAll('invoice:updated', {});
      }
    } catch (e) { console.error('walletController silent catch:', e.message); }

    res.status(201).json({ transaction: populated, wallet: updatedWallet });
  } catch (error) {
    console.error('addTransaction error:', error);
    res.status(500).json({ message: error.message || 'Failed to add transaction' });
  }
};

// ─── DELETE TRANSACTION ──────────────────────────────────────
exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await WalletTransaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const wallet = await DailyWallet.findById(transaction.wallet);
    const isManager = ['super_admin', 'admin', 'operations_manager', 'operations'].includes(req.user.role);

    if (wallet && wallet.isClosed && !isManager) {
      return res.status(400).json({ message: 'Day is closed' });
    }

    // Reverse financial effects
    if (transaction.type === 'collection' && transaction.customer) {
      const customerDoc = await Customer.findById(transaction.customer);
      if (customerDoc) {
        customerDoc.currentOutstanding += transaction.amount;
        await customerDoc.save();
      }
      if (transaction.invoice) {
        const invoiceDoc = await Invoice.findById(transaction.invoice);
        if (invoiceDoc) {
          invoiceDoc.paidAmount = Math.max(0, invoiceDoc.paidAmount - transaction.amount);
          invoiceDoc.balance = invoiceDoc.amount - invoiceDoc.paidAmount;
          if (invoiceDoc.balance <= 0) {
            invoiceDoc.status = 'paid';
            invoiceDoc.balance = 0;
          } else if (invoiceDoc.balance >= invoiceDoc.amount) {
            invoiceDoc.status = 'pending';
          } else {
            invoiceDoc.status = 'partial';
          }
          await invoiceDoc.save();
        }
      }
    }

    if (transaction.type === 'expense' && transaction.vendor) {
      const vendorDoc = await Vendor.findById(transaction.vendor);
      if (vendorDoc) {
        vendorDoc.totalPaid = Math.max(0, vendorDoc.totalPaid - transaction.amount);
        await vendorDoc.save();
      }
    }

    if (transaction.type === 'expense' && transaction.driver) {
      const driverDoc = await Driver.findById(transaction.driver);
      if (driverDoc) {
        driverDoc.totalPaid = Math.max(0, driverDoc.totalPaid - transaction.amount);
        await driverDoc.save();
      }
    }

    // Delete linked Payment record if it was a collection
    if (transaction.type === 'collection') {
      await Payment.deleteMany({ reference: `WALLET-${transaction._id}` });
    }

    await WalletTransaction.findByIdAndDelete(req.params.id);

    if (wallet) {
      const updatedWallet = await recalcWallet(wallet._id);
      try { emitToAll('wallet:transaction', { wallet: updatedWallet }); } catch (e) { console.error('walletController silent catch:', e.message); }
    }

    await logAudit({
      user: req.user._id, action: 'delete_wallet_transaction', entity: 'WalletTransaction',
      entityId: transaction._id, changes: { before: { type: transaction.type, amount: transaction.amount } }, ipAddress: req.ip,
    });

    try {
      emitToAll('wallet:transactionDeleted', { transactionId: req.params.id });
      emitToAll('payment:logged', {});
      emitToAll('customer:updated', {});
      emitToAll('invoice:updated', {});
    } catch (e) { console.error('walletController silent catch:', e.message); }

    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    console.error('deleteTransaction error:', error);
    res.status(500).json({ message: error.message || 'Failed to delete transaction' });
  }
};

// ─── UPDATE TRANSACTION ─────────────────────────────────────
exports.updateTransaction = async (req, res) => {
  try {
    const transaction = await WalletTransaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const wallet = await DailyWallet.findById(transaction.wallet);
    const isManager = ['super_admin', 'admin', 'operations_manager', 'operations'].includes(req.user.role);

    if (wallet && wallet.isClosed && !isManager) {
      return res.status(400).json({ message: 'Day is closed' });
    }

    const { amount, customer, invoice, deliveryStatementNumber, vendor, driver, expenseCategory, itemName, reference, notes } = req.body;
    const newAmount = amount != null ? Number(amount) : transaction.amount;

    // ─── REVERSE OLD FINANCIAL EFFECTS ────────────────────
    if (transaction.type === 'collection' && transaction.customer) {
      const customerDoc = await Customer.findById(transaction.customer);
      if (customerDoc) {
        customerDoc.currentOutstanding += transaction.amount;
        await customerDoc.save();
      }
      if (transaction.invoice) {
        const oldInvoice = await Invoice.findById(transaction.invoice);
        if (oldInvoice) {
          oldInvoice.paidAmount = Math.max(0, oldInvoice.paidAmount - transaction.amount);
          oldInvoice.balance = oldInvoice.amount - oldInvoice.paidAmount;
          if (oldInvoice.balance <= 0) {
            oldInvoice.status = 'paid';
            oldInvoice.balance = 0;
          } else if (oldInvoice.balance >= oldInvoice.amount) {
            oldInvoice.status = 'pending';
          } else {
            oldInvoice.status = 'partial';
          }
          await oldInvoice.save();
        }
      }
    }
    if (transaction.type === 'expense' && transaction.vendor) {
      const vendorDoc = await Vendor.findById(transaction.vendor);
      if (vendorDoc) { vendorDoc.totalPaid = Math.max(0, vendorDoc.totalPaid - transaction.amount); await vendorDoc.save(); }
    }
    if (transaction.type === 'expense' && transaction.driver) {
      const driverDoc = await Driver.findById(transaction.driver);
      if (driverDoc) { driverDoc.totalPaid = Math.max(0, driverDoc.totalPaid - transaction.amount); await driverDoc.save(); }
    }

    // ─── UPDATE TRANSACTION FIELDS ────────────────────────
    transaction.amount = newAmount;
    if (customer !== undefined) transaction.customer = customer || undefined;
    if (invoice !== undefined) transaction.invoice = invoice || undefined;
    if (deliveryStatementNumber !== undefined) transaction.deliveryStatementNumber = deliveryStatementNumber || undefined;
    if (vendor !== undefined) transaction.vendor = vendor || undefined;
    if (driver !== undefined) transaction.driver = driver || undefined;
    if (expenseCategory !== undefined) transaction.expenseCategory = expenseCategory || undefined;
    if (itemName !== undefined) transaction.itemName = itemName || undefined;
    if (reference !== undefined) transaction.reference = reference || undefined;
    if (notes !== undefined) transaction.notes = notes || undefined;

    // Re-check risk flags
    const riskFlags = checkRiskFlags({ amount: newAmount, type: transaction.type });
    transaction.isFlagged = riskFlags.length > 0;
    transaction.flagReason = transaction.isFlagged ? riskFlags.join('; ') : undefined;

    await transaction.save();

    // ─── APPLY NEW FINANCIAL EFFECTS ──────────────────────
    const newCustomer = transaction.customer;
    const newInvoice = transaction.invoice;

    if (transaction.type === 'collection' && newCustomer) {
      const customerDoc = await Customer.findById(newCustomer);
      if (customerDoc) {
        customerDoc.currentOutstanding = Math.max(0, customerDoc.currentOutstanding - newAmount);
        customerDoc.lastPaymentDate = new Date();
        customerDoc.lastPaymentAmount = newAmount;
        await customerDoc.save();
      }
      if (newInvoice) {
        const invoiceDoc = await Invoice.findById(newInvoice);
        if (invoiceDoc) {
          invoiceDoc.paidAmount += newAmount;
          invoiceDoc.balance = invoiceDoc.amount - invoiceDoc.paidAmount;
          if (invoiceDoc.balance <= 0) { invoiceDoc.status = 'paid'; invoiceDoc.balance = 0; }
          else { invoiceDoc.status = 'partial'; }
          await invoiceDoc.save();
        }
      }
    }
    if (transaction.type === 'expense' && transaction.vendor) {
      const vendorDoc = await Vendor.findById(transaction.vendor);
      if (vendorDoc) { vendorDoc.totalPaid += newAmount; await vendorDoc.save(); }
    }
    if (transaction.type === 'expense' && transaction.driver) {
      const driverDoc = await Driver.findById(transaction.driver);
      if (driverDoc) { driverDoc.totalPaid += newAmount; await driverDoc.save(); }
    }

    // Update linked Payment record if collection
    if (transaction.type === 'collection') {
      await Payment.updateMany(
        { reference: `WALLET-${transaction._id}` },
        { amount: newAmount, customer: transaction.customer || undefined, invoice: transaction.invoice || undefined }
      );
    }

    // Recalculate wallet
    const updatedWallet = await recalcWallet(wallet._id);

    const populated = await WalletTransaction.findById(transaction._id)
      .populate('customer', 'companyName customerNumber')
      .populate('invoice', 'invoiceNumber amount balance')
      .populate('vendor', 'name')
      .populate('driver', 'name')
      .populate('expenseCategory', 'name');

    await logAudit({
      user: req.user._id, action: 'update_wallet_transaction', entity: 'WalletTransaction',
      entityId: transaction._id, changes: { after: { amount: newAmount } }, ipAddress: req.ip,
    });

    try {
      emitToAll('wallet:transaction', { transaction: populated, wallet: updatedWallet });
      emitToAll('payment:logged', {});
      emitToAll('customer:updated', {});
      emitToAll('invoice:updated', {});
    } catch (e) { console.error('walletController silent catch:', e.message); }

    res.json({ transaction: populated, wallet: updatedWallet });
  } catch (error) {
    console.error('updateTransaction error:', error);
    res.status(500).json({ message: error.message || 'Failed to update transaction' });
  }
};

// ─── CLOSE DAY ───────────────────────────────────────────────
exports.closeDay = async (req, res) => {
  try {
    const { date, actualCash, differenceReason, differenceNotes } = req.body;
    const txDate = date || toDateStr();

    const wallet = await DailyWallet.findOne({ user: req.user._id, date: txDate });
    if (!wallet) return res.status(404).json({ message: 'No wallet found for this date' });
    if (wallet.isClosed) return res.status(400).json({ message: 'Day is already closed' });

    wallet.isClosed = true;
    wallet.closedAt = new Date();
    wallet.closedBy = req.user._id;

    if (actualCash !== undefined && actualCash !== null) {
      wallet.actualCash = actualCash;
      wallet.cashDifference = wallet.closingBalance - actualCash;
      wallet.differenceReason = differenceReason || '';
      wallet.differenceNotes = differenceNotes || '';

      // Flag large cash differences
      if (Math.abs(wallet.cashDifference) > 100) {
        // Create risk alert for large differences
        await logAudit({
          user: req.user._id, action: 'cash_difference_alert', entity: 'DailyWallet',
          entityId: wallet._id, changes: { after: { expected: wallet.closingBalance, actual: actualCash, difference: wallet.cashDifference } }, ipAddress: req.ip,
        });
      }
    }

    await wallet.save();

    // Auto-create next day's wallet with closing balance as opening balance
    const nextDate = new Date(txDate + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    const existingNext = await DailyWallet.findOne({ user: req.user._id, date: nextDateStr });
    if (!existingNext) {
      await DailyWallet.create({
        user: req.user._id,
        branch: wallet.branch,
        date: nextDateStr,
        openingBalance: wallet.closingBalance,
        closingBalance: wallet.closingBalance,
      });
    }

    const populated = await DailyWallet.findById(wallet._id)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .populate('closedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id, action: 'close_wallet_day', entity: 'DailyWallet',
      entityId: wallet._id, changes: { after: { date: txDate, closingBalance: wallet.closingBalance, actualCash } }, ipAddress: req.ip,
    });

    try { emitToAll('wallet:dayClosed', { wallet: populated }); } catch (e) { console.error('walletController silent catch:', e.message); }

    res.json({ wallet: populated });
  } catch (error) {
    console.error('closeDay error:', error);
    res.status(500).json({ message: error.message || 'Failed to close day' });
  }
};

// ─── REOPEN DAY (MANAGER ONLY) ──────────────────────────────
exports.reopenDay = async (req, res) => {
  try {
    const { walletId } = req.params;
    const wallet = await DailyWallet.findById(walletId);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    wallet.isClosed = false;
    wallet.closedAt = null;
    wallet.closedBy = null;
    await wallet.save();

    const populated = await DailyWallet.findById(wallet._id)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name');

    await logAudit({
      user: req.user._id, action: 'reopen_wallet_day', entity: 'DailyWallet',
      entityId: wallet._id, changes: { after: { date: wallet.date } }, ipAddress: req.ip,
    });

    try { emitToAll('wallet:dayReopened', { wallet: populated }); } catch (e) { console.error('walletController silent catch:', e.message); }

    res.json({ wallet: populated });
  } catch (error) {
    console.error('reopenDay error:', error);
    res.status(500).json({ message: error.message || 'Failed to reopen day' });
  }
};

// ─── BRANCH DASHBOARD (ADMIN VIEW) ──────────────────────────
exports.getBranchDashboard = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { dateFrom, dateTo } = req.query;

    // Build date filter: support range or single date
    let dateFilter;
    if (dateFrom && dateTo) {
      dateFilter = { $gte: dateFrom, $lte: dateTo };
    } else if (dateFrom) {
      dateFilter = { $gte: dateFrom, $lte: dateFrom };
    } else {
      const date = req.query.date || toDateStr();
      dateFilter = date;
    }

    const wallets = await DailyWallet.find({ branch: branchId, date: dateFilter })
      .populate('user', 'firstName lastName')
      .populate('branch', 'name');

    let totalCollections = 0;
    let totalExpenses = 0;
    let totalPurchases = 0;
    let totalClosingBalance = 0;

    for (const w of wallets) {
      totalCollections += w.totalCollections;
      totalExpenses += w.totalExpenses;
      totalPurchases += w.totalPurchases;
      totalClosingBalance += w.closingBalance;
    }

    const rawTransactions = await WalletTransaction.find({ branch: branchId, date: dateFilter })
      .populate('user', 'firstName lastName')
      .populate('customer', 'companyName customerNumber')
      .populate('invoice', 'invoiceNumber amount balance')
      .populate('vendor', 'name')
      .populate('driver', 'name')
      .populate('expenseCategory', 'name')
      .sort({ createdAt: -1 });

    const transactions = await enrichTransactionsWithOpsData(rawTransactions);

    res.json({
      date: typeof dateFilter === 'string' ? dateFilter : `${dateFrom} to ${dateTo}`,
      summary: {
        totalCollections,
        totalExpenses,
        totalPurchases,
        netMovement: totalCollections - totalExpenses - totalPurchases,
        closingBalance: totalClosingBalance,
        activeWallets: wallets.length,
      },
      wallets,
      transactions,
    });
  } catch (error) {
    console.error('getBranchDashboard error:', error);
    res.status(500).json({ message: error.message || 'Failed to load branch dashboard' });
  }
};

// ─── ALL BRANCHES OVERVIEW (SUPER ADMIN DASHBOARD) ──────────
exports.getAllBranchesDashboard = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    // Build date filter: support range or single date
    let dateFilter;
    if (dateFrom && dateTo) {
      dateFilter = { $gte: dateFrom, $lte: dateTo };
    } else if (dateFrom) {
      dateFilter = { $gte: dateFrom, $lte: dateFrom };
    } else {
      const date = req.query.date || toDateStr();
      dateFilter = date;
    }

    const Branch = require('../models/Branch');
    const branches = await Branch.find({ isActive: true }).sort({ name: 1 });

    const allWallets = await DailyWallet.find({
      branch: { $in: branches.map(b => b._id) },
      date: dateFilter
    });

    // Group by branch
    const walletsByBranch = {};
    for (const w of allWallets) {
      const bId = w.branch.toString();
      if (!walletsByBranch[bId]) walletsByBranch[bId] = [];
      walletsByBranch[bId].push(w);
    }

    const branchData = [];

    for (const branch of branches) {
      const wallets = walletsByBranch[branch._id.toString()] || [];
      let totalCollections = 0;
      let totalExpenses = 0;
      let totalPurchases = 0;
      let totalClosingBalance = 0;
      let totalExpectedCash = 0;
      let totalActualCash = 0;
      let totalDifference = 0;
      let closedWallets = 0;

      for (const w of wallets) {
        totalCollections += w.totalCollections;
        totalExpenses += w.totalExpenses;
        totalPurchases += w.totalPurchases;
        totalClosingBalance += w.closingBalance;
        if (w.isClosed) {
          closedWallets++;
          totalExpectedCash += w.closingBalance;
          totalActualCash += w.actualCash != null ? w.actualCash : w.closingBalance;
          totalDifference += w.cashDifference || 0;
        }
      }

      branchData.push({
        branch: { _id: branch._id, name: branch.name, code: branch.code },
        totalCollections,
        totalExpenses,
        totalPurchases,
        netMovement: totalCollections - totalExpenses - totalPurchases,
        closingBalance: totalClosingBalance,
        activeWallets: wallets.length,
        closedWallets,
        totalExpectedCash,
        totalActualCash,
        totalDifference,
      });
    }

    res.json({ date: typeof dateFilter === 'string' ? dateFilter : `${dateFrom} to ${dateTo}`, branches: branchData });
  } catch (error) {
    console.error('getAllBranchesDashboard error:', error);
    res.status(500).json({ message: error.message || 'Failed to load dashboard' });
  }
};

// ─── RISK ALERTS ─────────────────────────────────────────────
exports.getRiskAlerts = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const filter = { isFlagged: true };

    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = dateFrom;
      if (dateTo) filter.date.$lte = dateTo;
    }

    const alerts = await WalletTransaction.find(filter)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .populate('customer', 'companyName')
      .populate('vendor', 'name')
      .sort({ createdAt: -1 })
      .limit(100);

    // Also get cash difference alerts
    const diffFilter = { cashDifference: { $ne: 0, $exists: true } };
    if (dateFrom || dateTo) {
      diffFilter.date = {};
      if (dateFrom) diffFilter.date.$gte = dateFrom;
      if (dateTo) diffFilter.date.$lte = dateTo;
    }

    const cashDiffs = await DailyWallet.find(diffFilter)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .sort({ date: -1 })
      .limit(50);

    res.json({ transactionAlerts: alerts, cashDifferenceAlerts: cashDiffs });
  } catch (error) {
    console.error('getRiskAlerts error:', error);
    res.status(500).json({ message: error.message || 'Failed to load risk alerts' });
  }
};

// ─── LOOKUP BY REPORT NUMBER ─────────────────────────────────
exports.lookupByReport = async (req, res) => {
  try {
    const { reportNumber } = req.query;
    if (!reportNumber) return res.status(400).json({ message: 'reportNumber is required' });

    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const workflow = await OperationsWorkflow.findOne({
      reportNumber: { $regex: `^${reportNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (!workflow) return res.status(404).json({ message: 'Report not found' });
    if (!workflow.username) return res.status(404).json({ message: 'No customer linked to this report' });

    const customer = await Customer.findOne({
      companyName: { $regex: `^${workflow.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      isActive: true,
    });

    if (!customer) return res.status(404).json({ message: `Customer "${workflow.username}" not found` });

    const invoices = await Invoice.find({
      customer: customer._id,
      status: { $in: ['pending', 'partial', 'overdue'] },
      balance: { $gt: 0 },
    }).select('invoiceNumber amount balance status').sort({ createdAt: -1 });

    res.json({
      customer: { _id: customer._id, companyName: customer.companyName, customerNumber: customer.customerNumber, currentOutstanding: customer.currentOutstanding },
      reportNumber: workflow.reportNumber,
      sellingValue: workflow.sellingValue,
      invoices,
    });
  } catch (error) {
    console.error('lookupByReport error:', error);
    res.status(500).json({ message: error.message || 'Failed to lookup report' });
  }
};

// ─── WALLET HISTORY (for a user) ─────────────────────────────
exports.getWalletHistory = async (req, res) => {
  try {
    const userId = req.query.userId || req.user._id;
    const { dateFrom, dateTo } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

    if (req.user.role === 'operations' && userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Cannot view other wallets' });
    }

    const filter = { user: userId };
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = dateFrom;
      if (dateTo) filter.date.$lte = dateTo;
    }

    const skip = (page - 1) * limit;
    const [wallets, total] = await Promise.all([
      DailyWallet.find(filter)
        .populate('branch', 'name')
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      DailyWallet.countDocuments(filter),
    ]);

    res.json({ wallets, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('getWalletHistory error:', error);
    res.status(500).json({ message: error.message || 'Failed to load wallet history' });
  }
};
