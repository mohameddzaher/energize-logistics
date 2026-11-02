const mongoose = require('mongoose');
const DailyWallet = require('../models/DailyWallet');
const WalletTransaction = require('../models/WalletTransaction');
const { flexSpaceRegex } = require('../utils/plateKey');
const Vendor = require('../models/Vendor');
const Driver = require('../models/Driver');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const {
  WALLET_START_DATE, isBeforeWalletStart, isBeyondBook, mayWorkOutsideBook,
  todayStr, lastWritableDay, walletStartMessage, walletFutureMessage,
} = require('../config/walletStart');

// Helper: get YYYY-MM-DD string
const toDateStr = (d) => {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Helper: risk flags
const EXPENSE_THRESHOLD = 10000;

/**
 * The ledger is a window bounded on both ends (see config/walletStart). The bound applies to reads too, because opening a day creates its journal via getOrCreateWallet.
 * Tomorrow is inside the bound since work crosses midnight. Returns true when the request was rejected, so the controller stops.
 */
const denyOutsideBook = (res, date, user) => {
  // Super admin passes: the bounds guard against daily mistakes and are not an accounting rule; real corrections still need a way in (see config/walletStart).
  if (mayWorkOutsideBook(user)) return false;
  if (isBeforeWalletStart(date)) {
    res.status(400).json({ message: walletStartMessage(), walletStartDate: WALLET_START_DATE });
    return true;
  }
  if (isBeyondBook(date)) {
    res.status(400).json({ message: walletFutureMessage(), walletLastDate: lastWritableDay() });
    return true;
  }
  return false;
};

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
 * Branch wallet for a given day, created if missing. Keyed by branch and day because cash belongs to the branch; each entry still records who made it.
 * Opening balance is the branch's last closing, not the employee's.
 */
const getOrCreateWallet = async (branchId, date) => {
  let wallet = await DailyWallet.findOne({ branch: branchId, date });
  if (wallet) return wallet;

  const prevWallet = await DailyWallet.findOne({ branch: branchId, date: { $lt: date } }).sort({ date: -1 });
  const openingBalance = prevWallet ? prevWallet.closingBalance : 0;
  try {
    wallet = await DailyWallet.create({ branch: branchId, date, openingBalance, closingBalance: openingBalance });
  } catch (e) {
    // Two users opening the screen at once: the unique index rejects the second insert, so the first-created wallet is read instead of returning an error.
    if (e && e.code === 11000) wallet = await DailyWallet.findOne({ branch: branchId, date });
    else throw e;
  }
  return wallet;
};

// ─── RECALCULATE WALLET TOTALS ───────────────────────────────
/**
 * What a custody entry writes onto the dispatch sheet. Entered once: report number and amount come from the custody entry, the paying branch is the wallet's branch, the date is the journal day.
 * Uses $set on empty fields only, so manual corrections in the operations workflow are not overwritten.
 */
/**
 * What a purchase on this report should cost, read for the wallet's branch. Heavy transport pays the
 * truck rent: the full rent when the load has one, else the rent (the load's selling price). Every
 * other branch pays the report's purchase price.
 */
async function purchaseBasis(workflow, branchId) {
  const Branch = require('../models/Branch');
  const b = branchId && mongoose.isValidObjectId(String(branchId)) ? await Branch.findById(branchId).select('name').lean() : null;
  if (!b || !require('../utils/payingBranch').isHeavy(b.name)) {
    return { heavy: false, expected: Number(workflow.purchaseValue) || 0, selling: Number(workflow.sellingValue) || 0 };
  }
  let rent = Number(workflow.sellingValue) || 0;
  if (workflow.fleetShipment) {
    const { FleetShipment } = require('../models/FleetModels');
    const f = await FleetShipment.findById(workflow.fleetShipment).select('price fullRent').lean();
    if (f) rent = Number(f.fullRent) > 0 ? Number(f.fullRent) : (Number(f.price) || rent);
  }
  return { heavy: true, expected: rent, selling: rent };
}

async function fillReportFromWallet({ workflow, amount, date, branchId, documentNumber, role }) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const patch = {};
  if (!workflow.paymentAmount && amount > 0) patch.paymentAmount = amount;
  if (!workflow.paymentDate) patch.paymentDate = new Date(date);
  // The receipt number reaches its sheet column from the custody entry. Written only when empty, so a manual correction stays as left.
  if (documentNumber && !String(workflow.documentNumber || '').trim()) {
    patch.documentNumber = String(documentNumber).trim();
  }

  // The paying branch is the wallet's branch, not the user's: most active users have no branch on their account, so reading req.user.branch left the branch empty silently.
  // The wallet always knows its branch, and the money left that branch's custody; the person handing it over may be transferred or a visitor.
  if (!workflow.payingBranch) {
    // Branch name (the Arabic one staff type), not the id and not the English Branch.name. Details in utils/payingBranch.js.
    try {
      const { payingBranchOf } = require('../utils/payingBranch');
      const name = await payingBranchOf({ branchId, role, workflow });
      if (name) patch.payingBranch = name;
    } catch (e) { console.error('wallet→report branch lookup:', e.message); }
  }

  // Payment type is not inferred from the customer record: the same customer can be cash on one load and invoiced on another, so it is a shipment attribute.
  // The wallet writes only what it knows for certain (amount, date, branch); the type is left to the sheet owner.

  if (!Object.keys(patch).length) return null;
  await OperationsWorkflow.updateOne({ _id: workflow._id }, { $set: patch });
  try { emitToAll('workflow:updated', { _id: workflow._id, fromWallet: true }); } catch (_) {}
  return patch;
}

/**
 * The cash difference is derived (closing minus counted), so it is recomputed whenever either side changes. Writing it once at close left a stale difference after later entries or cascades.
 * actualCash == null means nobody counted, so it has no difference (neither zero nor any value).
 */
const r2c = (n) => Math.round((Number(n) || 0) * 100) / 100;
const syncCashCount = (wallet) => {
  if (wallet.actualCash == null) { wallet.cashDifference = null; return; }
  wallet.cashDifference = r2c((wallet.closingBalance || 0) - wallet.actualCash);
};

const recalcWallet = async (walletId) => {
  const txns = await WalletTransaction.find({ wallet: walletId }).select('type amount').lean();
  let totalCollections = 0;
  let totalExpenses = 0;
  let totalPurchases = 0;

  for (const t of txns) {
    if (t.type === 'collection') totalCollections += t.amount;
    else if (t.type === 'expense') totalExpenses += t.amount;
    else if (t.type === 'purchase') totalPurchases += t.amount;
    // The tax-invoice receipt entry records receiving the invoice by hand, with no money moving. It is skipped from the balance on purpose, so it is not mistaken for an omission and added later.
  }

  const wallet = await DailyWallet.findById(walletId);
  wallet.totalCollections = totalCollections;
  wallet.totalExpenses = totalExpenses;
  wallet.totalPurchases = totalPurchases;
  wallet.closingBalance = wallet.openingBalance + totalCollections - totalExpenses - totalPurchases;
  // Closing changed, so the difference tied to it is re-derived; otherwise yesterday's difference would remain.
  syncCashCount(wallet);
  await wallet.save();

  // Cascade: update opening balance of all future days for this user
  await cascadeBalances(wallet.branch, wallet.date, wallet.closingBalance);

  return wallet;
};

// CASCADE BALANCES TO FUTURE DAYS
// The chain follows the branch, since the balance is the branch's.
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
      // The cascade changes each following day's closing, so it needs the same difference recomputation as the first day.
      syncCashCount(day);
      await day.save();
    }
    prevClosing = day.closingBalance;
  }
};

// ─── GET DAILY WALLET ────────────────────────────────────────
exports.getDailyWallet = async (req, res) => {
  try {
    const date = req.query.date || toDateStr();
    if (denyOutsideBook(res, date, req.user)) return;

    // The branch is selected, not the employee, since the wallet belongs to the branch. userId is still accepted (saved links, old app builds) and translated to its owner's branch instead of rejecting the request.
    let branchId = req.query.branchId || req.query.branch;
    if (!branchId && req.query.userId) {
      const User = require('../models/User');
      const targetUser = await User.findById(req.query.userId).select('branch').lean();
      branchId = targetUser && targetUser.branch;
    }
    if (!branchId) branchId = req.user.branch;

    // An operations employee sees only their own branch.
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
      // Records who made each entry. The wallet is shared per branch, so the line is the only place showing who acted.
      .populate('user', 'firstName lastName')
      .populate('customer', 'name kind')
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
/**
 * Who may write into a closed day. Closing counts cash, fixes the day's balance and carries it forward; a later entry recomputes that day and all following days and breaks the explained count difference.
 * Operations staff were in the allowed list although the comment said managers only, so closed days changed silently. Writing into a closed day requires reopening, which is super admin only (see maySettle), then closing again with a new count.
 */
// Finance roles are included (see config/financeAuthority).
const mayWriteIntoClosedDay = (role) => ['super_admin', 'admin', 'operations_manager', ...require('../config/financeAuthority').FINANCE_FULL_ROLES].includes(role);
const denyClosedDay = (res) => res.status(400).json({
  code: 'DAY_CLOSED',
  message: 'اليومُ مُقفل — لا يُكتب فيه إلّا بعد إعادة فتحه، وإعادةُ الفتح لمدير النظام.',
});

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
    if (denyOutsideBook(res, txDate, req.user)) return;

    // Receiving tax invoices records report numbers with no amount: no money moves, so the amount is not required (staff used to type zero to pass).
    // A receipt covers a bundle, so one request carries many reports. New shape is (report, receipt) pairs; the old shape is a list of numbers and both are accepted.
    const pairs = [];
    const seenReports = new Set();
    const addPair = (rn, dn) => {
      const n = String(rn ?? '').trim();
      if (!n || seenReports.has(n)) return;
      seenReports.add(n);
      pairs.push({ reportNumber: n, documentNumber: String(dn ?? '').trim() });
    };
    if (type === 'tax_invoice') {
      for (const x of (Array.isArray(req.body.receivedReports) ? req.body.receivedReports : [])) {
        addPair(x?.reportNumber, x?.documentNumber);
      }
      for (const x of (Array.isArray(req.body.receivedReportNumbers) ? req.body.receivedReportNumbers : [])) addPair(x, '');
      addPair(req.body.receivedDocNumber, '');   // Older shape
    }
    const receivedReports = pairs.map((x) => x.reportNumber);
    if (type === 'tax_invoice' && !receivedReports.length) {
      return res.status(400).json({ message: 'اكتب رقم أمر نقل واحدًا على الأقلّ.' });
    }

    // The entry is posted to a specific branch's wallet: the branch from the request if sent (a manager records for a branch they run), otherwise the account's own branch.
    const txBranch = req.body.branchId || req.body.branch || req.user.branch;
    if (!txBranch) {
      return res.status(400).json({ message: 'لا يوجد فرع محدَّد لهذه الحركة.' });
    }
    if (req.user.role === 'operations_staff' && String(txBranch) !== String(req.user.branch)) {
      return res.status(403).json({ message: 'لا تملك صلاحية التسجيل على فرعٍ آخر.' });
    }

    // Check if day is closed (only managers can add to closed days)
    const wallet = await getOrCreateWallet(txBranch, txDate);
    // A closed day accepts no writes (see mayWriteIntoClosedDay).
    if (wallet.isClosed && !mayWriteIntoClosedDay(req.user.role)) return denyClosedDay(res);

    // Collection is posted to the party, not to an invoice. The old lookup went through the removed workflow module and always came back empty.
    // The party is identified from the sheet itself: username is the customer, matched to the collections record by folded name, the only party reference now.
    let resolvedParty = customer || null;
    const source = collectionSource || 'client';
    if (type === 'collection' && source === 'client' && !resolvedParty && deliveryStatementNumber) {
      try {
        const OperationsWorkflow = require('../models/OperationsWorkflow');
        const CollectionsParty = require('../models/CollectionsParty');
        const wf = await OperationsWorkflow.findOne({ reportNumber: flexSpaceRegex(deliveryStatementNumber) })
          .select('username').lean();
        if (wf && wf.username) {
          const party = await CollectionsParty.findOne({
            kind: 'customer', nameKey: CollectionsParty.fold(wf.username),
          }).select('_id').lean();
          if (party) resolvedParty = party._id;
        }
      } catch (e) {
        console.error('Wallet: party lookup error', e.message);
      }
    }

    // Purchases read from and write to the sheet. The amount paid to the supplier is the real purchase price, so it is entered once: the amount goes to the payment amount column and the journal date to the payment date.
    // It is compared with the platform purchase value; a mismatch is allowed (it may be legitimate) but flagged for the manager to confirm or correct.
    let purchaseInvoiceAmountVal;
    let purchaseWorkflow = null;
    let purchaseMismatch = null;
    // An invoice-receipt entry carries report numbers and fills from them what purchases fill.
    let receivedWorkflows = [];
    if (type === 'tax_invoice' && receivedReports.length) {
      try {
        const OperationsWorkflow = require('../models/OperationsWorkflow');
        receivedWorkflows = await OperationsWorkflow.find({
          $or: receivedReports.map((n) => ({ reportNumber: flexSpaceRegex(n) })),
        });
      } catch (e) { console.error('walletController silent catch:', e.message); }
    }
    // A purchase must target an existing report, and only once. Checked on the server, since the screen only assists.
    // 1) The report must exist: a plate number and an ordinary number once passed as report numbers. 2) A report is bought once: a repeat pays twice from branch custody and is found only at stock count.
    // The message names the earlier entry with date and amount so the user can tell a mistake from a real second purchase.
    if (type === 'purchase') {
      const rn = String(purchaseDeliveryStatementNumber || '').trim();
      if (!rn) {
        return res.status(400).json({
          message: 'اكتب رقم أمر النقل — لا تُقيَّد مشترياتٌ بلا أمر نقل',
          fields: { purchaseDeliveryStatementNumber: 'مطلوب' },
        });
      }
      const OperationsWorkflow = require('../models/OperationsWorkflow');
      purchaseWorkflow = await OperationsWorkflow.findOne({ reportNumber: flexSpaceRegex(rn) });
      if (!purchaseWorkflow) {
        return res.status(404).json({
          message: `لا يوجد أمر نقل بالرقم «${rn}». ابحث عن الرقم أوّلًا فتظهر بياناته، ثمّ سجّل الشراء.`,
          fields: { purchaseDeliveryStatementNumber: 'غير موجود' },
        });
      }
      // The purchase itself declares receipt of the bond. Requiring the status first made staff open another screen before recording a payment already made, leaving purchases unrecorded.
      // Recording a purchase on a report means its bond was received; the status is written here and on the platform after the purchase succeeds, not before (see the post-save step below).

      const prior = await WalletTransaction.findOne({
        type: 'purchase',
        purchaseDeliveryStatementNumber: flexSpaceRegex(purchaseWorkflow.reportNumber),
      }).populate('user', 'firstName lastName').lean();
      if (prior) {
        const who = prior.user ? `${prior.user.firstName || ''} ${prior.user.lastName || ''}`.trim() : '';
        return res.status(409).json({
          message: `أمر النقل ${purchaseWorkflow.reportNumber} سُجِّلت له مشترياتٌ من قبل`
            + ` — ${prior.amount} ريال بتاريخ ${prior.date}${who ? ` بواسطة ${who}` : ''}.`
            + ' أمر النقل الواحد لا يُشترى مرّتين.',
          fields: { purchaseDeliveryStatementNumber: 'مكرَّر' },
          existing: { id: String(prior._id), amount: prior.amount, date: prior.date, by: who },
        });
      }
      const basis = await purchaseBasis(purchaseWorkflow, txBranch);
      if (basis.selling) purchaseInvoiceAmountVal = basis.selling;
      const { expected } = basis;
      if (expected > 0 && Math.abs(expected - amount) > 0.5) {
        purchaseMismatch = { reportNumber: purchaseWorkflow.reportNumber, expected, paid: amount, difference: Math.round((amount - expected) * 100) / 100, heavy: basis.heavy };
      }
    }

    // Check risk flags
    const riskFlags = checkRiskFlags({ amount, type });
    // A purchase price mismatch is flagged like other notes, with the same sentence the dashboard shows: who paid, on which report, and the recorded amount.
    if (purchaseMismatch) {
      riskFlags.push(
        `${purchaseMismatch.heavy ? 'المبلغُ يختلف عن الإيجار' : 'سعرُ الشراء مختلف'} — أمر النقل ${purchaseMismatch.reportNumber}: المسجَّل ${purchaseMismatch.expected}`
        + ` والمدفوع ${purchaseMismatch.paid} (فرق ${purchaseMismatch.difference})`,
      );
    }
    const isFlagged = riskFlags.length > 0;

    const transaction = await WalletTransaction.create({
      wallet: wallet._id,
      user: req.user._id,
      // The entry's branch is the custody branch it was recorded in, not the recorder's: a manager records for a branch they run, so stamping their own branch would be misread elsewhere.
      branch: txBranch,
      date: txDate,
      type,
      // A receipt entry without an amount affects neither the balance nor the day close.
      amount: type === 'tax_invoice' ? 0 : amount,
      collectionSource: type === 'collection' ? source : undefined,
      customer: resolvedParty || undefined,
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
      // The received document is always a tax invoice, so it is not asked for; the button already says so. The report numbers are what gets entered.
      receivedDocType: type === 'tax_invoice' ? 'invoice' : undefined,
      receivedDocNumber: type === 'tax_invoice' ? (receivedReports[0] || undefined) : undefined,
      receivedReportNumbers: type === 'tax_invoice' ? receivedReports : undefined,
      receivedReports: type === 'tax_invoice' ? pairs : undefined,

      reference: reference || undefined,
      notes: notes || undefined,
      isFlagged,
      flagReason: isFlagged ? riskFlags.join('; ') : undefined,
    });

    // No financial sync elsewhere. Collection used to create a Payment and update an invoice and customer balance in the removed workflow module. The wallet is branch custody (in, out, day balance), not a customer ledger; receivables are read from the operations sheets in the collections section.

    // The amount reaches the sheet after the entry is saved, so a failed save never leaves a payment on the sheet that custody lacks.
    // $set on empty fields only, so a manual correction in the operations workflow stays.
    if (type === 'purchase' && purchaseWorkflow) {
      await fillReportFromWallet({
        workflow: purchaseWorkflow,
        // What the employee paid by hand is the real purchase price.
        amount,
        date: txDate,
        // The receipt number is one pre-existing field: purchaseReceiptNumber on the server, shown as the receipt number on screen. It used to be entered twice (here and in the sheet column); it now arrives on its own.
        documentNumber: purchaseReceiptNumber,
        // The branch of the custody the money left, not the branch of the recording account.
        branchId: wallet.branch || transaction.branch || req.user.branch,
        role: req.user.role,
      });
      // The amount is written even when the field is filled, since the wallet is the reference.
      try { await require('../utils/walletPayment').syncSheetPayment(purchaseWorkflow.reportNumber); } catch (e) { console.error('wallet→sheet payment sync (create):', e.message); }

      // A purchase declares bond receipt, here and on the platform. The status is written after the purchase succeeds. It is pushed to the platform because applicationStatus is a mirror column that sync rewrites, so a local-only write would vanish within minutes.
      // A platform failure does not drop the purchase: the money left and the entry is saved, and the status is fixed by the next sync or by staff.
      try {
        const { pushApplicationStatus } = require('./workflowController');
        await pushApplicationStatus(purchaseWorkflow, 'bond_received', req.user);
      } catch (e) {
        console.error('wallet→ops bond_received:', e.message);
      }
    }
    // Every received report is stamped, not just the first. The entry has no amount, so each report takes its own purchase price; one amount for the bundle would write the first report's price on all.
    if (type === 'tax_invoice') {
      for (const wf of receivedWorkflows) {
        // eslint-disable-next-line no-await-in-loop
        await fillReportFromWallet({
          workflow: wf,
          amount: Number(wf.purchaseValue) || 0,
          date: txDate,
          // Each report has its own receipt, not one receipt copied across the bundle.
          documentNumber: pairs.find((x) => x.reportNumber === String(wf.reportNumber).trim())?.documentNumber,
          branchId: wallet.branch || transaction.branch || req.user.branch,
          role: req.user.role,
        });
      }
    }

    // Collection on a cash report collects it: whoever received and recorded the money has collected the report, shown as collected in cash invoices with the entry date and amount. Non-cash reports are untouched. See utils/walletCollection.
    if (type === 'collection' && deliveryStatementNumber) {
      try {
        await require('../utils/walletCollection').syncWalletCollection(deliveryStatementNumber, { user: req.user, reason: 'قيد تحصيل في المحفظة' });
      } catch (e) { console.error('wallet→cash collection (create):', e.message); }
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
      .populate('customer', 'name kind')
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

    // Unknown numbers are reported. The entry is saved with everything typed (the report may exist at the customer but not here yet), but a number with no report here is named since it may be a typo; silence would let staff think all seven were stamped when five were.
    const unknownReports = type === 'tax_invoice'
      ? receivedReports.filter((n) => !receivedWorkflows.some((w) => String(w.reportNumber).trim() === n))
      : [];
    res.status(201).json({
      transaction: populated,
      wallet: updatedWallet,
      ...(unknownReports.length ? {
        unknownReports,
        message: `حُفظ القيد. ولم نجد عندنا أوامر نقل بهذه الأرقام: ${unknownReports.join('، ')}`,
      } : {}),
      ...(type === 'tax_invoice' ? { matchedReports: receivedWorkflows.map((w) => w.reportNumber) } : {}),
    });
  } catch (error) {
    console.error('addTransaction error:', error);
    res.status(500).json({ message: error.message || 'Failed to add transaction' });
  }
};

// ─── DELETE TRANSACTION ──────────────────────────────────────

/**
 * Whether this user may touch a given wallet. Reads were guarded but writes were open, so a user who could not view a colleague's wallet could delete its entries; deleting a collection changes balances and invoice status.
 * Managers may touch any wallet; others only their own.
 */
/**
 * Correcting what was recorded is a single authority. Recording is daily work by whoever holds the cash box; changing a recorded entry rewrites history, moves the day's balance and all later days, and recomputes count differences on closed days. Reopening a closed day is the same kind of act.
 * These were open to three roles (eight for delete and edit) and are now super admin only. Adding stays with its users.
 */
// Super admin, or a role granted full powers (see utils/permissions.hasSuperAdminPowers).
const maySettle = async (user) => {
  if (!user) return false;
  // Also accountant, accounts manager and finance manager (see config/financeAuthority).
  return require('../config/financeAuthority').hasFinancePowers(user.role);
};
const denySettle = (res, what) => res.status(403).json({
  code: 'SUPER_ADMIN_ONLY',
  message: what === 'reopen'
    ? 'إعادةُ فتح يومٍ أُقفل لمدير النظام والإدارة الماليّة.'
    : 'تعديلُ حركةٍ مسجَّلةٍ أو حذفُها لمدير النظام والإدارة الماليّة — والتسجيلُ الجديد متاحٌ كما هو.',
});

const MANAGER_ROLES = ['super_admin', 'admin', 'operations_manager', ...require('../config/financeAuthority').FINANCE_FULL_ROLES];
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
    if (!(await maySettle(req.user))) return denySettle(res, 'edit');
    if (!mayTouchWallet(req, wallet)) return denyWallet(res);
    // An entry before the start date is not touched even if one remains in the database: editing it recomputes a finished balance chain and deleting it moves the approved September 1 balance.
    if (denyOutsideBook(res, transaction.date, req.user)) return;
    if (wallet && wallet.isClosed && !mayWriteIntoClosedDay(req.user.role)) return denyClosedDay(res);

    // No reversal of an effect that is no longer written. Deleting a collection used to reverse a customer balance and invoice in the removed workflow module; the entry itself is now the effect, so deleting it restores the balance and the chain is rebuilt as after any delete.

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

    await WalletTransaction.findByIdAndDelete(req.params.id);

    // Collection deleted: removed from the sheet, unless another entry still exists for it, in which case the total is recomputed.
    if (transaction.type === 'collection' && transaction.deliveryStatementNumber) {
      try {
        await require('../utils/walletCollection').syncWalletCollection(transaction.deliveryStatementNumber, { user: req.user, reason: 'حذف قيد المحفظة' });
      } catch (e) { console.error('wallet→cash collection (delete):', e.message); }
    }

    // Purchase deleted: no payment remains on the sheet, except an amount typed by hand that differs from the purchase amount.
    if (transaction.type === 'purchase' && transaction.purchaseDeliveryStatementNumber) {
      try {
        await require('../utils/walletPayment').syncSheetPayment(transaction.purchaseDeliveryStatementNumber, { previousAmount: transaction.amount });
      } catch (e) { console.error('wallet→sheet payment sync (delete):', e.message); }
    }

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

/**
 * Moving an entry between branches. Purchases, expenses or collections recorded on the wrong branch wallet used to be deleted and re-entered, losing who recorded it and when.
 * The move books the entry to the new branch's journal on the same day, then recomputes both branches (old rises, new falls) and cascades balances (recalcWallet -> cascadeBalances).
 * The date is unchanged: a move corrects the place, and changing the day too would hide two errors in one action. Super admin only, since responsibility for cash passes between two custody ledgers; the audit log records both branches and the amount.
 */
exports.moveTransaction = async (req, res) => {
  try {
    const Branch = require('../models/Branch');
    const transaction = await WalletTransaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'الحركة غير موجودة' });

    // Move destination: branch, date, or both. An entry can be on the wrong day as well as the wrong branch (yesterday's custody entered with today's date); the old fix of delete and re-enter lost the audit line and could reopen a closed day.
    // The two parts are independent: only what changed is sent and the rest is assumed unchanged.
    const toBranchId = String(req.body?.branch || transaction.branch);
    const toDate = String(req.body?.date || transaction.date).trim();

    if (!mongoose.isValidObjectId(toBranchId)) return res.status(400).json({ message: 'الفرعُ المنقول إليه غير صحيح' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate) || Number.isNaN(Date.parse(toDate))) {
      return res.status(400).json({ message: 'التاريخُ المنقول إليه غير صحيح' });
    }

    const sameBranch = String(transaction.branch) === toBranchId;
    const sameDate = String(transaction.date) === toDate;
    if (sameBranch && sameDate) {
      return res.status(400).json({ message: 'الحركةُ في هذا الفرع وهذا التاريخ أصلًا' });
    }

    const [fromBranch, toBranch] = await Promise.all([
      // Branch has a single name field in the schema (see models/Branch).
      Branch.findById(transaction.branch).select('name city').lean(),
      Branch.findById(toBranchId).select('name city').lean(),
    ]);
    if (!toBranch) return res.status(404).json({ message: 'الفرعُ المنقول إليه غير موجود' });

    const fromWallet = await DailyWallet.findById(transaction.wallet);
    const fromDate = transaction.date;

    // Both bounds are checked on both ends. Checking only the source would make a move a way into a day outside the ledger: record on an allowed day, then move to before the custody start or to tomorrow.
    if (denyOutsideBook(res, fromDate, req.user)) return;
    if (!sameDate && denyOutsideBook(res, toDate, req.user)) return;

    // A closed day on either end needs the same permission as any write into it, so a move is not a side door into a closed day.
    const toWallet = await getOrCreateWallet(toBranchId, toDate);
    if (((fromWallet && fromWallet.isClosed) || toWallet.isClosed) && !mayWriteIntoClosedDay(req.user.role)) {
      return denyClosedDay(res);
    }

    const before = {
      branch: String(transaction.branch), branchName: fromBranch?.name || '',
      wallet: String(transaction.wallet), date: fromDate,
    };

    transaction.branch = toWallet.branch;
    transaction.wallet = toWallet._id;
    transaction.date = toDate;
    // The branch-name snapshot on purchases follows the entry, otherwise a reviewer would read one branch on the row and another on the account.
    if (!sameBranch && transaction.type === 'purchase' && transaction.purchaseBranch) {
      transaction.purchaseBranch = toBranch.name || transaction.purchaseBranch;
    }
    // The audit line states only what changed: a 'moved from branch X' line on an entry that never left its branch would mislead a reviewer.
    const moves = [];
    if (!sameBranch) moves.push(`من فرع «${before.branchName}» إلى «${toBranch.name}»`);
    if (!sameDate) moves.push(`من تاريخ ${before.date} إلى ${toDate}`);
    transaction.notes = [transaction.notes, `نُقلت ${moves.join(' و')}`]
      .filter(Boolean).join(' · ').slice(0, 1000);
    await transaction.save();

    // On a cash report the date is the collection date and follows the entry to its new day.
    if (transaction.type === 'collection' && transaction.deliveryStatementNumber && !sameDate) {
      try {
        await require('../utils/walletCollection').syncWalletCollection(transaction.deliveryStatementNumber, { user: req.user, reason: 'نقل قيد المحفظة' });
      } catch (e) { console.error('wallet→cash collection (move):', e.message); }
    }

    // Both journals are recomputed, oldest first. Recomputing only one side leaves the other with totals not matching its entries, a silent fault found only at cash count.
    // Order matters when the branch is the same and the date differs: both days are in one chain and recalcWallet cascades to later days. The older goes first so its cascade passes through the newer, then the newer is computed with correct totals and cascades onward. Reversed, one day would keep an opening balance from before the move.
    const first = fromWallet && fromWallet.date <= toWallet.date ? fromWallet : toWallet;
    const second = first === toWallet ? fromWallet : toWallet;
    const recalced = {};
    if (first) recalced[String(first._id)] = await recalcWallet(first._id);
    if (second && String(second._id) !== String(first && first._id)) {
      recalced[String(second._id)] = await recalcWallet(second._id);
    }
    const updated = {
      from: fromWallet ? recalced[String(fromWallet._id)] || null : null,
      to: recalced[String(toWallet._id)] || null,
    };

    await logAudit({
      user: req.user._id, action: 'move_wallet_transaction', entity: 'WalletTransaction',
      entityId: transaction._id,
      changes: {
        before: { branch: before.branchName, date: before.date, amount: transaction.amount, type: transaction.type },
        after: { branch: toBranch.name, date: toDate },
      },
      ipAddress: req.ip,
    });

    // Every screen reading the wallet listens: both journals, the entry and the branches board.
    try {
      if (updated.to) emitToAll('wallet:transaction', { wallet: updated.to });
      if (updated.from && String(updated.from._id) !== String(updated.to && updated.to._id)) {
        emitToAll('wallet:transaction', { wallet: updated.from });
      }
      emitToAll('wallet:moved', {
        transactionId: String(transaction._id),
        from: before.branch, to: String(toWallet.branch),
        fromDate: before.date, date: toDate,
      });
    } catch (e) { console.error('walletController silent catch:', e.message); }

    res.json({
      message: `نُقلت الحركة ${moves.join(' و')}`,
      transaction,
      from: updated.from ? { _id: updated.from._id, closingBalance: updated.from.closingBalance } : null,
      to: updated.to ? { _id: updated.to._id, closingBalance: updated.to.closingBalance } : null,
    });
  } catch (error) {
    console.error('moveTransaction error:', error);
    res.status(500).json({ message: error.message || 'تعذّر نقل الحركة' });
  }
};

// The old route name is kept: installed app builds call /branch, and the app is distributed as a file rather than a store, so old versions stay until the owner updates.
exports.moveTransactionBranch = exports.moveTransaction;

// ─── UPDATE TRANSACTION ─────────────────────────────────────
exports.updateTransaction = async (req, res) => {
  try {
    const transaction = await WalletTransaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    // What the entry held before the edit; used to correct its old sheet if the entry moved to another.
    const priorSheetNumber = transaction.purchaseDeliveryStatementNumber;
    const priorAmount = transaction.amount;
    const priorCollectionSheet = transaction.type === 'collection' ? transaction.deliveryStatementNumber : null;

    const wallet = await DailyWallet.findById(transaction.wallet);
    if (!(await maySettle(req.user))) return denySettle(res, 'edit');
    if (!mayTouchWallet(req, wallet)) return denyWallet(res);
    // An entry before the start date is not touched even if one remains in the database: editing it recomputes a finished balance chain and deleting it moves the approved September 1 balance.
    if (denyOutsideBook(res, transaction.date, req.user)) return;
    if (wallet && wallet.isClosed && !mayWriteIntoClosedDay(req.user.role)) return denyClosedDay(res);

    const {
      amount, customer, invoice, deliveryStatementNumber, vendor, driver,
      expenseCategory, itemName, reference, notes,
      collectionSource, description,
      purchaseDeliveryStatementNumber, purchaseDriverName, purchaseReceiptNumber, purchaseBranch,
    } = req.body;
    const newAmount = amount != null ? Number(amount) : transaction.amount;

    // REVERSE OLD FINANCIAL EFFECTS
    // Collection no longer has an effect outside the entry itself: no customer balance and no invoice.
    if (transaction.type === 'expense' && transaction.vendor) {
      const vendorDoc = await Vendor.findById(transaction.vendor);
      if (vendorDoc) { vendorDoc.totalPaid = Math.max(0, vendorDoc.totalPaid - transaction.amount); await vendorDoc.save(); }
    }
    if (transaction.type === 'expense' && transaction.driver) {
      const driverDoc = await Driver.findById(transaction.driver);
      if (driverDoc) { driverDoc.totalPaid = Math.max(0, driverDoc.totalPaid - transaction.amount); await driverDoc.save(); }
    }

    // Edits face the same two conditions. Moving a purchase to another report is an edit, and unchecked it would bypass the rule in two steps (record on a valid report, then move to an already-bought one). The entry itself is excluded from the duplicate check so it does not block itself.
    if (transaction.type === 'purchase' && purchaseDeliveryStatementNumber !== undefined) {
      const rn = String(purchaseDeliveryStatementNumber || '').trim();
      if (!rn) {
        return res.status(400).json({
          message: 'اكتب رقم أمر النقل — لا تُقيَّد مشترياتٌ بلا أمر نقل',
          fields: { purchaseDeliveryStatementNumber: 'مطلوب' },
        });
      }
      const OperationsWorkflow = require('../models/OperationsWorkflow');
      const wf = await OperationsWorkflow.findOne({ reportNumber: flexSpaceRegex(rn) });
      if (!wf) {
        return res.status(404).json({
          message: `لا يوجد أمر نقل بالرقم «${rn}». ابحث عن الرقم أوّلًا فتظهر بياناته، ثمّ احفظ.`,
          fields: { purchaseDeliveryStatementNumber: 'غير موجود' },
        });
      }
      // The condition is lifted here as in recording: moving a purchase to a report declares its bond in hand, so the status is written after the move succeeds (see post-save).

      const prior = await WalletTransaction.findOne({
        _id: { $ne: transaction._id },
        type: 'purchase',
        purchaseDeliveryStatementNumber: flexSpaceRegex(wf.reportNumber),
      }).populate('user', 'firstName lastName').lean();
      if (prior) {
        const who = prior.user ? `${prior.user.firstName || ''} ${prior.user.lastName || ''}`.trim() : '';
        return res.status(409).json({
          message: `أمر النقل ${wf.reportNumber} سُجِّلت له مشترياتٌ من قبل`
            + ` — ${prior.amount} ريال بتاريخ ${prior.date}${who ? ` بواسطة ${who}` : ''}.`
            + ' أمر النقل الواحد لا يُشترى مرّتين.',
          fields: { purchaseDeliveryStatementNumber: 'مكرَّر' },
          existing: { id: String(prior._id), amount: prior.amount, date: prior.date, by: who },
        });
      }
    }

    // ─── UPDATE TRANSACTION FIELDS ────────────────────────
    transaction.amount = newAmount;
    if (customer !== undefined) transaction.customer = customer || undefined;
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

    // Cash report collection follows the entry. When the amount or report number changes the report follows, and the old report is cleared if the entry moved off it. See utils/walletCollection.
    if (transaction.type === 'collection' || priorCollectionSheet) {
      try {
        await require('../utils/walletCollection').syncWalletCollection(
          [transaction.type === 'collection' ? transaction.deliveryStatementNumber : null, priorCollectionSheet],
          { user: req.user, reason: 'تعديل قيد المحفظة' },
        );
      } catch (e) { console.error('wallet→cash collection (update):', e.message); }
    }

    // The payment amount on the sheet follows the wallet. An amount edit updates the report; moving the entry to another report clears the old one and writes the new. See utils/walletPayment.
    if (transaction.type === 'purchase') {
      try {
        const { syncSheetPayment } = require('../utils/walletPayment');
        await syncSheetPayment(transaction.purchaseDeliveryStatementNumber);
        if (priorSheetNumber && String(priorSheetNumber).trim() !== String(transaction.purchaseDeliveryStatementNumber || '').trim()) {
          await syncSheetPayment(priorSheetNumber, { previousAmount: priorAmount });
        }
      } catch (e) { console.error('wallet→sheet payment sync (update):', e.message); }

      // A report that now carries the purchase gets the bond-received status, as when recording. Pushed to the platform rather than written locally only, and a failure does not drop the entry.
      try {
        const OperationsWorkflow = require('../models/OperationsWorkflow');
        const wfNow = await OperationsWorkflow.findOne({ reportNumber: flexSpaceRegex(transaction.purchaseDeliveryStatementNumber) })
          .select('externalSource externalId applicationStatus reportNumber paymentAmount paymentDate documentNumber payingBranch fleetShipment branch');
        if (wfNow) {
          // An entry pointed at a sheet by editing fills it like a new one. The recorder's
          // role counts here, not the role of whoever made the edit.
          const recorder = await require('../models/User').findById(transaction.user).select('role').lean();
          await fillReportFromWallet({
            workflow: wfNow,
            amount: transaction.amount,
            date: transaction.date,
            documentNumber: transaction.purchaseReceiptNumber,
            branchId: wallet?.branch || transaction.branch,
            role: recorder?.role,
          });
          const { pushApplicationStatus } = require('./workflowController');
          await pushApplicationStatus(wfNow, 'bond_received', req.user);
        }
      } catch (e) { console.error('wallet→ops bond_received (update):', e.message); }
    }

    // ─── APPLY NEW FINANCIAL EFFECTS ──────────────────────
    if (transaction.type === 'expense' && transaction.vendor) {
      const vendorDoc = await Vendor.findById(transaction.vendor);
      if (vendorDoc) { vendorDoc.totalPaid += newAmount; await vendorDoc.save(); }
    }
    if (transaction.type === 'expense' && transaction.driver) {
      const driverDoc = await Driver.findById(transaction.driver);
      if (driverDoc) { driverDoc.totalPaid += newAmount; await driverDoc.save(); }
    }

    // Recalculate wallet
    const updatedWallet = await recalcWallet(wallet._id);

    const populated = await WalletTransaction.findById(transaction._id)
      .populate('customer', 'name kind')
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
    if (denyOutsideBook(res, txDate, req.user)) return;

    // The branch's day is closed, not the person's: the cash is the branch's and closing is a declaration about it.
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

    // No count is written for cash that was not counted. Closing without a count used to write actualCash = closingBalance and difference 0, which made 'nobody counted' and 'counted and matched exactly' the same in the data. They are opposites: the first says nothing about the cash, the second asserts it is correct.
    // When the closing later moved, a count that never happened showed a difference of zero instead of the real amount. Empty stays empty: null means not counted, and every screen reads it so.
    const counted = actualCash !== undefined && actualCash !== null && actualCash !== '';
    wallet.actualCash = counted ? Number(actualCash) : null;
    syncCashCount(wallet);
    if (counted) {
      wallet.differenceReason = differenceReason || '';
      wallet.differenceNotes = differenceNotes || '';

      // Flag large cash differences
      if (Math.abs(wallet.cashDifference || 0) > 100) {
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
    // Reopening a closed day is super admin only (see maySettle).
    if (!(await maySettle(req.user))) return denySettle(res, 'reopen');
    if (denyOutsideBook(res, wallet.date, req.user)) return;

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
        // Does not populate what the document no longer has. invoice was removed with the workflow module but the line kept populating it, so the page returned 500 on every open (not in the schema). customer now points to the collections record, so its fields are name and type.
        .populate('customer', 'name kind')
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

    // Why journals of today alone are not read. The board asked for the journal dated today, which is created only when its owner opens the page, so a branch showed zero until someone opened it and then jumped.
    // Cash in an employee's hand does not vanish because the screen was not opened: the balance is the closing of the last journal up to that date. Movements are read from journals in the range and the balance from the last journal at or before it, giving the full picture without waiting.
    const hi = typeof dateFilter === 'string' ? dateFilter : dateFilter.$lte;
    const lo = typeof dateFilter === 'string' ? dateFilter : dateFilter.$gte;

    // Opening balance of a period. It is not the sum of its days' openings (that counts the same money per day) but what the branch held before the period: the closing of the last day before it. If no earlier day exists it is the first day's opening, the head of the chain.
    // This makes the balance hold: period opening + movements = period closing.
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
        // Last journal per branch up to the date. It used to group by user when the wallet was per user; now it is per branch with no user, so grouping by user put every branch in one null-keyed group and showed one branch with zeros for the rest.
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

      // Movements come only from journals in the range: what happened in the requested period.
      for (const w of wallets) {
        totalCollections += w.totalCollections || 0;
        totalExpenses += w.totalExpenses || 0;
        totalPurchases += w.totalPurchases || 0;
      }
      // Balance from each employee's last journal up to the date, whether or not they opened their screen.
      const carriedRows = carriedByBranch[branch._id.toString()] || [];
      // The opening is read from the first day in the period, not from the day before it. Opening equals the previous closing unless a balance was fixed manually, which happens at a cash count when the actual cash replaces the book figure and that day becomes the head of a new chain. Using the previous closing showed a balance that did not close.
      // The first day's opening is the head whatever its source; the earlier day is used only when the period has no day.
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

      // The count settlement is reported, not hidden. opening + movements = closing holds unless a balance was fixed manually inside the period, at a cash count where actual cash is adopted; that is a real difference, not a calculation error. Hiding it makes the numbers look contradictory, so it is computed and shown by name when non-zero.
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
        // A branch has one wallet; the count read is the number of people working on it.
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
        // A single wallet has actually reached one hundred, so its alerts were cut off at the limit.
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

    // Core dispatch-sheet data, always returned when the report exists. Purchases use purchaseValue/driverName/branch (no customer needed); collections use sellingValue + the linked customer's open invoices.
    // Also reports whether the report was already bought. Lookup runs before entry, so this is known before the form is filled, not after saving. The server blocks it anyway (see addTransaction), but a block after four fields are filled is a penalty rather than guidance.
    const priorPurchase = await WalletTransaction.findOne({
      type: 'purchase',
      purchaseDeliveryStatementNumber: flexSpaceRegex(workflow.reportNumber),
    }).populate('user', 'firstName lastName').populate('branch', 'name').lean();

    // The wallet's branch decides what a purchase costs (see purchaseBasis); heavy transport reads the rent.
    const basis = await purchaseBasis(workflow, req.query.branchId || req.user.branch);
    const base = {
      reportNumber: workflow.reportNumber,
      purchaseValue: basis.heavy ? basis.expected : (workflow.purchaseValue || 0),
      sellingValue: basis.heavy ? 0 : (workflow.sellingValue || 0),
      heavy: basis.heavy,
      driverName: workflow.driverName || '',
      branch: workflow.branch || '',
      // The order status is reported in the lookup: the condition is known before the form is filled, not after.
      applicationStatus: workflow.applicationStatus || '',
      bondReceived: String(workflow.applicationStatus || '').trim() === 'bond_received',
      alreadyPurchased: priorPurchase ? {
        amount: priorPurchase.amount,
        date: priorPurchase.date,
        by: priorPurchase.user ? `${priorPurchase.user.firstName || ''} ${priorPurchase.user.lastName || ''}`.trim() : '',
        receipt: priorPurchase.purchaseReceiptNumber || '',
        // Which branch's custody paid. Paying from a branch other than the report's branch is the common case (heavy transport trucks pay Jeddah and Dammam reports; Jeddah pays Yanbu, Rabigh and Jazan).
        // The payer's name alone is not enough: a Sudair employee would not know the report was paid from Riyadh custody and would take the block for a fault. The custody name makes the answer understandable and review possible.
        branch: priorPurchase.branch?.name || '',
      } : null,
    };

    // The party comes from the collections record. It used to be looked up in Customer and then its open invoices were fetched, both from the removed workflow module, so both trips returned empty. The customer is identified from username on the sheet and matched by folded name to the collections record.
    // No invoices are shown with it: what is owed is read from the sheets in the collections section, not from a second table giving another number.
    let customer = null;
    if (workflow.username) {
      const CollectionsParty = require('../models/CollectionsParty');
      const found = await CollectionsParty.findOne({
        kind: 'customer', nameKey: CollectionsParty.fold(workflow.username),
      }).select('name phone status').lean();
      if (found) customer = { _id: found._id, name: found.name, phone: found.phone, status: found.status };
    }

    res.json({ ...base, customer });
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

    // History is by branch: it reads the branch's cash history, not one person's.
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

    // Days that have not come yet are not counted. Closing a day prepares tomorrow's journal with the carried balance, which is correct, but the month view counts journals and would show 13 days on the 12th, a number contradicting the on-screen calendar; the last-day balance also read from a future journal.
    // The bound lives here and not only in the filter, because the export 'all' asks for 2100-12-31 and would otherwise include days that did not happen. Super admin reads outside the window as they can write there, otherwise a day written would be missing from the view.
    const free = mayWorkOutsideBook(req.user);
    const from = (!free && isBeforeWalletStart(dateFrom)) ? WALLET_START_DATE : dateFrom;
    const to = (!free && isBeyondBook(dateTo)) ? lastWritableDay() : dateTo;
    const filter = { branch: repBranch, date: { $gte: from, $lte: to } };
    const wallets = await DailyWallet.find(filter)
      .populate('user', 'firstName lastName')
      .populate('branch', 'name')
      .populate('closedBy', 'firstName lastName')
      .sort({ date: 1 });

    const rawTransactions = await WalletTransaction.find(filter)
      // Who recorded the entry. The wallet is per branch, so an export without the actor says what happened but not who did it.
      .populate('user', 'firstName lastName')
      .populate('customer', 'name kind')
      .populate('vendor', 'name')
      .populate('driver', 'name')
      .populate('expenseCategory', 'name')
      .sort({ date: 1, createdAt: 1 });

    const transactions = await enrichTransactionsWithOpsData(rawTransactions);

    // An empty tomorrow is not a work day. Closing prepares tomorrow's journal with the carried balance, a waiting row rather than a day with activity, and the days card counts journals (12 on the 12th when only 11 days have work); a number contradicting the calendar casts doubt on every number beside it.
    // The waiting row is dropped: after today, with no movement, amount or close. Once something is written (allowed; an entry after midnight is tomorrow's) it counts as a normal day.
    // Movement is read from loaded entries, not journal totals: a tax-invoice receipt entry has no amount, so a day with only that has zero totals but is certainly a work day.
    const T = todayStr();
    const datesWithWork = new Set(rawTransactions.map((t) => String(t.date)));
    const shownWallets = wallets.filter((w) => w.date <= T
      || w.isClosed
      || datesWithWork.has(String(w.date))
      || (w.totalCollections || 0) + (w.totalExpenses || 0) + (w.totalPurchases || 0) !== 0);

    const summary = shownWallets.reduce((acc, w) => ({
      totalCollections: acc.totalCollections + (w.totalCollections || 0),
      totalExpenses: acc.totalExpenses + (w.totalExpenses || 0),
      totalPurchases: acc.totalPurchases + (w.totalPurchases || 0),
      closingBalance: acc.closingBalance + (w.closingBalance || 0),
    }), { totalCollections: 0, totalExpenses: 0, totalPurchases: 0, closingBalance: 0 });

    // Returns the range actually used, not the requested one: the screen titles it with the month and shows what occurred, so returning the request would claim the whole month is shown.
    res.json({
      wallets: shownWallets,
      transactions,
      summary,
      dateFrom: from,
      dateTo: to,
      requestedFrom: dateFrom,
      requestedTo: dateTo,
    });
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
    if (process.env.ALLOW_DATA_WIPE !== 'yes') return res.status(403).json({ code: 'WIPE_DISABLED', message: 'تصفير المحافظ مقفول.' });
    const allTransactions = await WalletTransaction.find({}).lean();

    // No financial effect is reversed outside the wallet. Zeroing used to reverse customer balances and invoices in the removed workflow module and delete payments the wallet wrote. None of that is written any more, so nothing is reversed; the supplier and driver stay as they were.
    for (const t of allTransactions) {
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

    // Wipe transactions and wallets
    const txResult = await WalletTransaction.deleteMany({});
    // Zeroing removes every collection the wallet wrote on sheets, since no entry remains to back it.
    try {
      await require('../utils/walletCollection').resyncAllWalletCollections({ user: req.user, reason: 'تصفير المحافظ' });
    } catch (e) { console.error('wallet→cash collection (reset):', e.message); }
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
