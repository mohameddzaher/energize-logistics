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

  // Fetch all matching workflows in one query. Exact $in on the indexed field —
  // a case-insensitive-regex $in cannot use the unique index and was scanning
  // the whole 30k-workflow collection on EVERY wallet dashboard load. Case
  // variants are covered by querying the typed value + upper + lower forms.
  const uniqueNumbers = [...new Set(reportNumbers)];
  const variants = [...new Set(uniqueNumbers.flatMap((n) => [String(n), String(n).toUpperCase(), String(n).toLowerCase()]))];
  const workflows = await OperationsWorkflow.find({
    reportNumber: { $in: variants },
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
/**
 * محفظةُ الفرع في يومٍ ما — تُنشأ إن لم تكن.
 *
 * كانت لكلّ موظّفٍ محفظتُه، فنقدُ الفرع الواحد موزَّعٌ على محافظَ لا تُقرأ إلّا
 * بجمعها. والنقدُ في الواقع نقدُ الفرع: يعمل عليه أكثرُ من موظّفٍ في اليوم،
 * ويُسلَّم بينهم، ويُسأل عنه الفرعُ لا الشخص. فصار المفتاحُ الفرعَ واليوم،
 * وبقيت كلُّ حركةٍ منسوبةً إلى مَن سجّلها.
 *
 * والافتتاحيُّ ختاميُّ آخر يومٍ للفرع — لا لآخر يومٍ لهذا الموظّف.
 */
const getOrCreateWallet = async (branchId, date) => {
  let wallet = await DailyWallet.findOne({ branch: branchId, date });
  if (wallet) return wallet;

  const prevWallet = await DailyWallet.findOne({ branch: branchId, date: { $lt: date } }).sort({ date: -1 });
  const openingBalance = prevWallet ? prevWallet.closingBalance : 0;
  try {
    wallet = await DailyWallet.create({ branch: branchId, date, openingBalance, closingBalance: openingBalance });
  } catch (e) {
    // موظّفان يفتحان الشاشةَ في اللحظة نفسِها: الفهرسُ الفريد يمنع الثانية،
    // فتُقرأ التي سبقت بدل أن يُردّ على أحدهما بخطأ.
    if (e && e.code === 11000) wallet = await DailyWallet.findOne({ branch: branchId, date });
    else throw e;
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

  // Cascade: update opening balance of all future days for this user
  await cascadeBalances(wallet.branch, wallet.date, wallet.closingBalance);

  return wallet;
};

// ─── CASCADE BALANCES TO FUTURE DAYS ─────────────────────────
// السلسلةُ تتبع الفرعَ لا الموظّف: الرصيدُ رصيدُ الفرع، فالانتقالُ من يومٍ إلى
// ما بعده انتقالُ نقدِه هو.
const cascadeBalances = async (branchId, fromDate, newClosingBalance) => {
  const futureDays = await DailyWallet.find({
    branch: branchId,
    date: { $gt: fromDate },
  }).sort({ date: 1 });

  let prevClosing = newClosingBalance;
  for (const day of futureDays) {
    if (day.openingBalance !== prevClosing) {
      day.openingBalance = prevClosing;
      day.closingBalance = prevClosing + day.totalCollections - day.totalExpenses - day.totalPurchases;
      await day.save();
    }
    prevClosing = day.closingBalance;
  }
};

// ─── GET DAILY WALLET ────────────────────────────────────────
exports.getDailyWallet = async (req, res) => {
  try {
    const date = req.query.date || toDateStr();

    // ── يُختار الفرعُ لا الموظّف ────────────────────────────────────────────
    // المحفظةُ للفرع، فالسؤالُ «أيُّ فرع» لا «أيُّ موظّف». و`userId` يبقى
    // مقبولًا في الطلب — روابطُ محفوظةٌ ونسخُ التطبيق القديمة ترسله — فيُترجَم
    // إلى فرع صاحبه بدل أن يُردّ الطلب.
    let branchId = req.query.branchId || req.query.branch;
    if (!branchId && req.query.userId) {
      const User = require('../models/User');
      const targetUser = await User.findById(req.query.userId).select('branch').lean();
      branchId = targetUser && targetUser.branch;
    }
    if (!branchId) branchId = req.user.branch;

    // موظّفُ التشغيل يرى فرعَه وحدَه.
    if (req.user.role === 'operations_staff' && String(branchId) !== String(req.user.branch)) {
      return res.status(403).json({ message: 'لا تملك صلاحية عرض محفظة فرعٍ آخر.' });
    }

    if (!branchId) {
      return res.status(400).json({ message: 'لا يوجد فرع محدَّد. اختر الفرع، أو اطلب من الإدارة ربط حسابك بفرع.' });
    }

    const wallet = await getOrCreateWallet(branchId, date);
    const populated = await DailyWallet.findById(wallet._id)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .populate('closedBy', 'firstName lastName');

    const rawTransactions = await WalletTransaction.find({ wallet: wallet._id })
      // ── ومَن سجّل كلَّ حركة ────────────────────────────────────────────────
      // المحفظةُ صارت للفرع، فالسطرُ هو ما يقول مَن فعل. وبدونه يصير النقدُ
      // المشتركُ بلا مسؤولٍ عن أيّ حركةٍ فيه — وهو عكسُ المقصود.
      .populate('user', 'firstName lastName')
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
      mismatchReason, mismatchNote,
    } = req.body;

    // Validate the amount-mismatch reason: only these enum values, and 'other'
    // needs an explanatory note (so a difference is never left unexplained).
    const validMismatch = ['daily', 'violation', 'other'];
    const cleanMismatchReason = validMismatch.includes(mismatchReason) ? mismatchReason : null;
    if (cleanMismatchReason === 'other' && !(mismatchNote && String(mismatchNote).trim())) {
      return res.status(400).json({ message: 'A note is required when the mismatch reason is "other"' });
    }

    const txDate = date || toDateStr();

    // الحركةُ تُقيَّد على محفظة فرعٍ بعينه. والفرعُ من الطلب إن أُرسل — المدير
    // يسجّل عن فرعٍ يديره — وإلّا فرعُ صاحب الحساب.
    const txBranch = req.body.branchId || req.body.branch || req.user.branch;
    if (!txBranch) {
      return res.status(400).json({ message: 'لا يوجد فرع محدَّد لهذه الحركة.' });
    }
    if (req.user.role === 'operations_staff' && String(txBranch) !== String(req.user.branch)) {
      return res.status(403).json({ message: 'لا تملك صلاحية التسجيل على فرعٍ آخر.' });
    }

    // Check if day is closed (only managers can add to closed days)
    const wallet = await getOrCreateWallet(txBranch, txDate);
    const isManager = ['super_admin', 'admin', 'operations_manager', 'operations_staff'].includes(req.user.role);

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
      mismatchReason: cleanMismatchReason || undefined,
      mismatchNote: cleanMismatchReason === 'other' ? (mismatchNote || undefined) : undefined,
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

/**
 * هل يجوز لهذا المستخدم أن يمسّ محفظةً بعينها؟
 *
 * القراءة كانت محروسة («Cannot view other wallets») والكتابةُ مفتوحة — فموظّف
 * عملياتٍ لا يُسمح له برؤية محفظة زميله كان يستطيع حذف حركةٍ منها. وحذفُ تحصيلٍ
 * يُعيد المبلغ إلى رصيد العميل ويعيد كتابة حالة الفاتورة، فالأثر مالٌ لا شاشة.
 *
 * والمديرون يمسّون أيّ محفظة؛ وغيرهم محفظتَه وحدها.
 */
const MANAGER_ROLES = ['super_admin', 'admin', 'operations_manager'];
const mayTouchWallet = (req, wallet) => {
  if (MANAGER_ROLES.includes(req.user.role)) return true;
  if (!wallet) return false;
  return String(wallet.user) === String(req.user._id);
};
const denyWallet = (res) => res.status(403).json({ message: 'لا تملك صلاحية التعديل على هذه المحفظة' });

exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await WalletTransaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    const wallet = await DailyWallet.findById(transaction.wallet);
    if (!mayTouchWallet(req, wallet)) return denyWallet(res);
    const isManager = ['super_admin', 'admin', 'operations_manager', 'operations_staff'].includes(req.user.role);

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
    if (!mayTouchWallet(req, wallet)) return denyWallet(res);
    const isManager = ['super_admin', 'admin', 'operations_manager', 'operations_staff'].includes(req.user.role);

    if (wallet && wallet.isClosed && !isManager) {
      return res.status(400).json({ message: 'Day is closed' });
    }

    const {
      amount, customer, invoice, deliveryStatementNumber, vendor, driver,
      expenseCategory, itemName, reference, notes,
      collectionSource, description,
      purchaseDeliveryStatementNumber, purchaseDriverName, purchaseReceiptNumber, purchaseBranch,
    } = req.body;
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
    // Collection source + company-collection description
    if (collectionSource !== undefined && transaction.type === 'collection') {
      transaction.collectionSource = collectionSource || 'client';
    }
    if (description !== undefined) transaction.description = description || undefined;
    // Purchase-specific fields
    if (purchaseDeliveryStatementNumber !== undefined) transaction.purchaseDeliveryStatementNumber = purchaseDeliveryStatementNumber || undefined;
    if (purchaseDriverName !== undefined) transaction.purchaseDriverName = purchaseDriverName || undefined;
    if (purchaseReceiptNumber !== undefined) transaction.purchaseReceiptNumber = purchaseReceiptNumber || undefined;
    if (purchaseBranch !== undefined) transaction.purchaseBranch = purchaseBranch || undefined;

    // If purchase delivery statement changed, refresh selling-value lookup
    if (transaction.type === 'purchase' && purchaseDeliveryStatementNumber !== undefined && purchaseDeliveryStatementNumber) {
      try {
        const wf = await OperationsWorkflow.findOne({
          reportNumber: { $regex: `^${purchaseDeliveryStatementNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        });
        transaction.purchaseInvoiceAmount = wf && wf.sellingValue ? wf.sellingValue : undefined;
      } catch (e) { console.error('walletController silent catch (update purchase wf lookup):', e.message); }
    }

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

    // يُقفَل يومُ الفرع لا يومُ الشخص: النقدُ نقدُ الفرع، وإقفالُه إقرارٌ عنه.
    const closeBranch = req.body.branchId || req.body.branch || req.user.branch;
    if (!closeBranch) return res.status(400).json({ message: 'لا يوجد فرع محدَّد.' });
    if (req.user.role === 'operations_staff' && String(closeBranch) !== String(req.user.branch)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إقفال يوم فرعٍ آخر.' });
    }
    const wallet = await DailyWallet.findOne({ branch: closeBranch, date: txDate });
    if (!wallet) return res.status(404).json({ message: 'لا توجد يوميّة لهذا الفرع في هذا التاريخ.' });
    if (wallet.isClosed) return res.status(400).json({ message: 'Day is already closed' });

    wallet.isClosed = true;
    wallet.closedAt = new Date();
    wallet.closedBy = req.user._id;

    const cashAmount = (actualCash !== undefined && actualCash !== null) ? Number(actualCash) : wallet.closingBalance;
    wallet.actualCash = cashAmount;
    wallet.cashDifference = wallet.closingBalance - cashAmount;
    if (actualCash !== undefined && actualCash !== null) {
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
    const existingNext = await DailyWallet.findOne({ branch: wallet.branch, date: nextDateStr });
    if (!existingNext) {
      await DailyWallet.create({
        branch: wallet.branch,
        date: nextDateStr,
        openingBalance: wallet.closingBalance,
        closingBalance: wallet.closingBalance,
      });
    } else if (existingNext.openingBalance !== wallet.closingBalance) {
      // Update existing next day and cascade forward
      await cascadeBalances(wallet.branch, txDate, wallet.closingBalance);
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
    // إعادة فتح يومٍ أُقفل قرارٌ إداريّ — لم يكن عليه أيّ فحصٍ إطلاقًا.
    if (!MANAGER_ROLES.includes(req.user.role)) return denyWallet(res);

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

    // The two finds are independent — one parallel wave, lean (read-only), at
    // ~90ms/query RTT this alone halves the dashboard's DB time.
    const [wallets, rawTransactions] = await Promise.all([
      DailyWallet.find({ branch: branchId, date: dateFilter })
        .populate('user', 'firstName lastName')
        .populate('branch', 'name')
        .lean(),
      WalletTransaction.find({ branch: branchId, date: dateFilter })
        .populate('user', 'firstName lastName')
        .populate('customer', 'companyName customerNumber')
        .populate('invoice', 'invoiceNumber amount balance')
        .populate('vendor', 'name')
        .populate('driver', 'name')
        .populate('expenseCategory', 'name')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

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

    const branchIds = branches.map((b) => b._id);

    // ── ولماذا لا تُقرأ يوميّاتُ اليوم وحدَها ─────────────────────────────────
    // كانت اللوحةُ تسأل عن يوميّةٍ **بتاريخ اليوم**، ويوميّةُ اليوم لا تُنشأ
    // إلّا حين يفتح صاحبُها صفحتَه. فالفرعُ يظهر صفرًا حتّى يفتح أحدُهم محفظتَه،
    // ثمّ يظهر فجأةً — وقد قرأ المديرُ الصفرَ قبلها ولم يكن صفرًا.
    //
    // والنقدُ في يد الموظّف لا يختفي لأنّه لم يفتح شاشة: رصيدُه هو ختاميُّ آخرِ
    // يوميّةٍ له **حتّى** ذلك التاريخ. فالحركاتُ تُقرأ من يوميّات المدى، والرصيدُ
    // من آخر يوميّةٍ قبله أو فيه — فتُقرأ الصورةُ كاملةً بلا انتظار أحد.
    const hi = typeof dateFilter === 'string' ? dateFilter : dateFilter.$lte;
    const lo = typeof dateFilter === 'string' ? dateFilter : dateFilter.$gte;

    // ── ورصيدُ أوّل الفترة ────────────────────────────────────────────────────
    // «الافتتاحيُّ» لفترةٍ ليس مجموعَ افتتاحيّات أيّامها — ذلك يعدُّ المالَ
    // نفسَه مرّةً لكلّ يوم. هو ما كان في يد الفرع **قبل** أن تبدأ: ختاميُّ آخر
    // يومٍ يسبقها. فإن لم يسبقها يومٌ فهو افتتاحيُّ أوّل يومٍ فيها — رأسُ
    // السلسلة نفسُه.
    //
    // وبه يصحّ الميزان: افتتاحيُّ الفترة + حركاتُها = ختاميُّها. وبدونه تُقرأ
    // الحركاتُ بلا ما جرت عليه.
    const opening = await DailyWallet.aggregate([
      { $match: { branch: { $in: branchIds }, date: { $lt: lo } } },
      { $sort: { date: 1 } },
      { $group: { _id: '$branch', closingBalance: { $last: '$closingBalance' } } },
    ]);
    const openingByBranch = new Map(opening.map((o) => [String(o._id), o.closingBalance || 0]));

    const [movementWallets, carried] = await Promise.all([
      DailyWallet.find({ branch: { $in: branchIds }, date: dateFilter }).lean(),
      DailyWallet.aggregate([
        { $match: { branch: { $in: branchIds }, date: { $lte: hi } } },
        { $sort: { date: 1 } },
        // ── آخرُ يوميّةٍ لكلّ **فرع** حتّى التاريخ ──────────────────────────
        // كانت تُجمَّع بالمستخدم حين كانت المحفظةُ له. وقد صارت للفرع ولا
        // مستخدمَ لها، فكان الجمعُ بالمستخدم يضع الفروعَ كلَّها في مجموعةٍ
        // واحدةٍ مفتاحُها `null` — فيظهر فرعٌ واحدٌ والباقي أصفار.
        { $group: {
          _id: '$branch',
          branch: { $last: '$branch' },
          date: { $last: '$date' },
          closingBalance: { $last: '$closingBalance' },
          isClosed: { $last: '$isClosed' },
          actualCash: { $last: '$actualCash' },
          cashDifference: { $last: '$cashDifference' },
        } },
      ]),
    ]);

    const walletsByBranch = {};
    for (const w of movementWallets) {
      const bId = String(w.branch);
      if (!walletsByBranch[bId]) walletsByBranch[bId] = [];
      walletsByBranch[bId].push(w);
    }
    const carriedByBranch = {};
    for (const c of carried) {
      const bId = String(c.branch);
      if (!carriedByBranch[bId]) carriedByBranch[bId] = [];
      carriedByBranch[bId].push(c);
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

      // الحركاتُ من يوميّات المدى وحدَها: ما جرى في الفترة المطلوبة.
      for (const w of wallets) {
        totalCollections += w.totalCollections || 0;
        totalExpenses += w.totalExpenses || 0;
        totalPurchases += w.totalPurchases || 0;
      }
      // والرصيدُ من آخر يوميّةٍ لكلّ موظّفٍ حتّى التاريخ — سواءٌ فتح شاشتَه أم لا.
      const carriedRows = carriedByBranch[branch._id.toString()] || [];
      // ── الافتتاحيُّ يُقرأ من أوّل يومٍ في الفترة لا من اليوم الذي يسبقها ────
      // القاعدةُ أنّ افتتاحيَّ اليوم ختاميُّ ما قبله، وهي تصحّ ما لم يُثبَّت
      // رصيدٌ يدويًّا. ويُثبَّت حين تُجرَد الخزنةُ فيُعتمَد ما فيها فعلًا بدل ما
      // يقوله الدفتر — فيصير ذلك اليومُ رأسًا لسلسلةٍ جديدة، ولا يُشتقّ ممّا
      // قبله. فأخذُ ختاميّ اليوم السابق كان يُظهر ميزانًا لا يقفل.
      //
      // فيُقرأ افتتاحيُّ أوّل يومٍ في الفترة — وهو رأسُها أيًّا كان مصدرُه —
      // ولا يُرجَع إلى ما قبلها إلّا حين لا يكون فيها يومٌ أصلًا.
      const inRange = (walletsByBranch[branch._id.toString()] || []).slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const openingBalance = inRange.length
        ? (inRange[0].openingBalance || 0)
        : (openingByBranch.get(branch._id.toString()) || 0);
      for (const c of carriedRows) {
        totalClosingBalance += c.closingBalance || 0;
        if (c.isClosed) {
          closedWallets++;
          totalExpectedCash += c.closingBalance || 0;
          totalActualCash += c.actualCash != null ? c.actualCash : (c.closingBalance || 0);
          totalDifference += c.cashDifference || 0;
        }
      }

      // ── وتسويةُ الجرد تُقال ولا تُخبَّأ ──────────────────────────────────
      // «افتتاحيٌّ + حركات = ختاميّ» تصحّ ما لم يُثبَّت رصيدٌ يدويًّا داخل
      // الفترة. ويُثبَّت حين تُجرَد الخزنةُ فيُعتمَد ما فيها فعلًا — وهو فرقٌ
      // حقيقيٌّ لا خطأَ حساب. وإخفاؤه يجعل الأرقامَ تبدو متناقضةً بلا تفسير،
      // فيُحسب ويُعرَض باسمه حين لا يكون صفرًا.
      const r2 = (x) => Math.round(x * 100) / 100;
      const netMovement = totalCollections - totalExpenses - totalPurchases;
      const adjustment = r2(totalClosingBalance - (openingBalance + netMovement));

      branchData.push({
        branch: { _id: branch._id, name: branch.name, code: branch.code },
        openingBalance: r2(openingBalance),
        adjustment,
        totalCollections,
        totalExpenses,
        totalPurchases,
        netMovement: totalCollections - totalExpenses - totalPurchases,
        closingBalance: totalClosingBalance,
        // محفظةُ الفرع واحدة؛ والعددُ الذي يُقرأ هو عددُ من يعمل عليها.
        activeWallets: carriedRows.length,
        movedToday: wallets.length,
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
        // محفظةٌ واحدة بلغت المئة بالفعل، فكانت تنبيهاتها تُبتَر عند حدّها.
        .limit(2000);

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

    // Core dispatch-sheet data — always returned when the report exists. Purchases
    // use purchaseValue/driverName/branch (no customer needed); collections use
    // sellingValue + the linked customer's open invoices.
    const base = {
      reportNumber: workflow.reportNumber,
      purchaseValue: workflow.purchaseValue || 0,
      sellingValue: workflow.sellingValue || 0,
      driverName: workflow.driverName || '',
      branch: workflow.branch || '',
    };

    // Try to resolve the customer + open invoices (collections need this). Missing
    // customer is NOT an error — purchases don't require it.
    let customer = null;
    let invoices = [];
    if (workflow.username) {
      const found = await Customer.findOne({
        companyName: { $regex: `^${workflow.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isActive: true,
      });
      if (found) {
        customer = { _id: found._id, companyName: found.companyName, customerNumber: found.customerNumber, currentOutstanding: found.currentOutstanding };
        invoices = await Invoice.find({
          customer: found._id,
          status: { $in: ['pending', 'partial', 'overdue'] },
          balance: { $gt: 0 },
        }).select('invoiceNumber amount balance status').sort({ createdAt: -1 });
      }
    }

    res.json({ ...base, customer, invoices });
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

    // السجلُّ بالفرع: يُقرأ تاريخُ نقدِ الفرع لا تاريخُ شخصٍ فيه.
    const histBranch = req.query.branchId || req.query.branch
      || (userId ? (await require('../models/User').findById(userId).select('branch').lean() || {}).branch : null)
      || req.user.branch;
    if (req.user.role === 'operations_staff' && String(histBranch) !== String(req.user.branch)) {
      return res.status(403).json({ message: 'لا تملك صلاحية عرض محفظة فرعٍ آخر.' });
    }

    const filter = { branch: histBranch };
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

// ─── USER WALLET RANGE (for Excel export of date ranges) ─────
// Returns every wallet AND every transaction belonging to one user across
// a date range, enriched with operations workflow details. Mirrors the
// access rules used by getDailyWallet.
exports.getUserWalletRange = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const userId = req.query.userId || req.user._id;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: 'dateFrom and dateTo are required' });
    }
    const repBranch = req.query.branchId || req.query.branch
      || (userId ? (await require('../models/User').findById(userId).select('branch').lean() || {}).branch : null)
      || req.user.branch;
    if (req.user.role === 'operations_staff' && String(repBranch) !== String(req.user.branch)) {
      return res.status(403).json({ message: 'لا تملك صلاحية عرض محفظة فرعٍ آخر.' });
    }

    const filter = { branch: repBranch, date: { $gte: dateFrom, $lte: dateTo } };
    const wallets = await DailyWallet.find(filter)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .populate('closedBy', 'firstName lastName')
      .sort({ date: 1 });

    const rawTransactions = await WalletTransaction.find(filter)
      .populate('customer', 'companyName customerNumber')
      .populate('invoice', 'invoiceNumber amount balance')
      .populate('vendor', 'name')
      .populate('driver', 'name')
      .populate('expenseCategory', 'name')
      .sort({ date: 1, createdAt: 1 });

    const transactions = await enrichTransactionsWithOpsData(rawTransactions);

    const summary = wallets.reduce((acc, w) => ({
      totalCollections: acc.totalCollections + (w.totalCollections || 0),
      totalExpenses: acc.totalExpenses + (w.totalExpenses || 0),
      totalPurchases: acc.totalPurchases + (w.totalPurchases || 0),
      closingBalance: acc.closingBalance + (w.closingBalance || 0),
    }), { totalCollections: 0, totalExpenses: 0, totalPurchases: 0, closingBalance: 0 });

    res.json({ wallets, transactions, summary, dateFrom, dateTo });
  } catch (error) {
    console.error('getUserWalletRange error:', error);
    res.status(500).json({ message: error.message || 'Failed to load wallet range' });
  }
};

// ─── RESET ALL WALLETS (SUPER ADMIN ONLY) ────────────────────
// Zeroes out all transactions and balances across every wallet so users
// can start fresh. Also reverses any customer/invoice/vendor/driver balances
// that were previously sourced from wallet collections / payments.
exports.resetAllWallets = async (req, res) => {
  try {
    const allTransactions = await WalletTransaction.find({}).lean();

    // Reverse financial effects of every collection on customers + invoices
    for (const t of allTransactions) {
      if (t.type === 'collection') {
        if (t.customer) {
          const c = await Customer.findById(t.customer);
          if (c) {
            c.currentOutstanding += t.amount;
            await c.save();
          }
        }
        if (t.invoice) {
          const inv = await Invoice.findById(t.invoice);
          if (inv) {
            inv.paidAmount = Math.max(0, inv.paidAmount - t.amount);
            inv.balance = inv.amount - inv.paidAmount;
            if (inv.balance >= inv.amount) inv.status = 'pending';
            else if (inv.balance > 0) inv.status = 'partial';
            else { inv.status = 'paid'; inv.balance = 0; }
            await inv.save();
          }
        }
      }
      if (t.type === 'expense') {
        if (t.vendor) {
          const v = await Vendor.findById(t.vendor);
          if (v) { v.totalPaid = Math.max(0, v.totalPaid - t.amount); await v.save(); }
        }
        if (t.driver) {
          const d = await Driver.findById(t.driver);
          if (d) { d.totalPaid = Math.max(0, d.totalPaid - t.amount); await d.save(); }
        }
      }
    }

    // Drop every wallet-derived Payment record
    await Payment.deleteMany({ reference: /^WALLET-/ });

    // Wipe transactions and wallets
    const txResult = await WalletTransaction.deleteMany({});
    const walletResult = await DailyWallet.deleteMany({});

    await logAudit({
      user: req.user._id,
      action: 'reset_all_wallets',
      entity: 'DailyWallet',
      changes: {
        before: {
          transactionsDeleted: txResult.deletedCount,
          walletsDeleted: walletResult.deletedCount,
        },
      },
      ipAddress: req.ip,
    });

    try {
      emitToAll('wallet:reset', {});
      emitToAll('customer:updated', {});
      emitToAll('invoice:updated', {});
      emitToAll('payment:logged', {});
    } catch (e) { console.error('walletController silent catch (reset emit):', e.message); }

    res.json({
      message: 'All wallets reset',
      transactionsDeleted: txResult.deletedCount,
      walletsDeleted: walletResult.deletedCount,
    });
  } catch (error) {
    console.error('resetAllWallets error:', error);
    res.status(500).json({ message: error.message || 'Failed to reset wallets' });
  }
};
