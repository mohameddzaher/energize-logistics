const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('branchId', objectIdParam());
router.param('walletId', objectIdParam());
const walletController = require('../controllers/walletController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

// Who reads and writes custody.
// Accounting reads branch custody and writes into it: collections, expenses and purchases are financial entries that get reviewed and closed. It was outside the list, so an accountant opened the page and got 403 with no explanation.
const walletRoles = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'operations_team_leader', 'operations_staff',
  'cfo', 'accounting_manager', 'accountant',
];
const walletReadRoles = [...walletRoles, 'moderator', 'collections_manager', 'collections_staff'];
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const managerRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', ...FINANCE_FULL_ROLES];

// The custody dashboard is read by those who review it, not those who run it. It was limited to operations managers, leaving out the accountant, who is the one reading it: his job is to see what all branches did, not one branch. He opened the daily custody page and got 'no branch for your account', and opened the dashboard and did not find it in the list.
// Accounting is not tied to a branch: its accounts have no branch (all five), which is correct, not a gap.
const overviewRoles = [...managerRoles, 'cfo', 'accounting_manager', 'accountant', 'it_manager', 'it_specialist'];

router.use(authenticate);

// Daily wallet (moderator has read-only access)
router.get('/daily', authorize(...walletReadRoles), walletController.getDailyWallet);

// Lookup by report number (manifest number).
router.get('/lookup-report', authorize(...walletReadRoles), walletController.lookupByReport);

// Wallet history
router.get('/history', authorize(...walletReadRoles), walletController.getWalletHistory);

// Wallet range (one user across a date range — used by the Export modal)
router.get('/range', authorize(...walletReadRoles), walletController.getUserWalletRange);

// Add transaction
router.post(
  '/transactions',
  authorize(...walletRoles),
  [
    body('type').isIn(['collection', 'expense', 'purchase', 'tax_invoice'])
      .withMessage('النوع: تحصيل أو مصروف أو مشتريات أو استلام فاتورة ضريبية'),
    // A tax invoice with no amount: it is a receipt entry, not a money movement, so requiring an amount above zero would block recording what arrived without a known value yet, which is the most common case.
    body('amount').custom((v, { req }) => {
      if (req.body.type === 'tax_invoice') return true;
      if (!(Number(v) > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
      return true;
    }),
    // Receipt applies to a bundle of manifests, not one: the rep brings seven and they are recorded in one go. The check used to apply to the single field only and rejected the whole bundle with invoice-number-required although it held seven numbers.
    // The check is on the meaning, not the field's shape. The field has had three shapes: one number, then a list of numbers, then pairs (manifest and its voucher), and each time the check was written for the latest shape only, so the server rejected a request holding three.
    // The question is the same whatever the shape: does it carry at least one manifest?
    body('receivedReports').custom((v, { req }) => {
      if (req.body.type !== 'tax_invoice') return true;
      const list = [
        ...(Array.isArray(v) ? v : []).map((x) => x?.reportNumber),
        ...(Array.isArray(req.body.receivedReportNumbers) ? req.body.receivedReportNumbers : []),
        req.body.receivedDocNumber,
      ].map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!list.length) throw new Error('اكتب رقم أمر نقل واحدًا على الأقلّ');
      return true;
    }),
  ],
  validate,
  walletController.addTransaction
);

// Update transaction
router.put('/transactions/:id', authorize(...walletRoles), walletController.updateTransaction);

// Delete transaction
router.delete('/transactions/:id', authorize(...walletRoles), walletController.deleteTransaction);

// Moving an entry to another branch or day: system admin only. Cash responsibility moves between two custody ledgers, or an entry returns to the day it happened, and both journals are recomputed and their balances roll forward. See the header of `moveTransaction`.
router.patch('/transactions/:id/move', authorize('super_admin', ...FINANCE_FULL_ROLES), walletController.moveTransaction);
// The old route stays as an entry point for installed app versions: the app is distributed as a file, not from a store, so a phone's version stays until its owner updates it. Same guard.
router.patch('/transactions/:id/branch', authorize('super_admin', ...FINANCE_FULL_ROLES), walletController.moveTransaction);

// Close day
router.post('/close-day', authorize(...walletRoles), walletController.closeDay);

// Reopen day (operations team + managers)
router.post('/reopen/:walletId', authorize(...walletRoles), walletController.reopenDay);

// Branch dashboard (moderator has read-only access for review)
router.get('/branch/:branchId', authorize(...overviewRoles, 'moderator'), walletController.getBranchDashboard);

// All branches dashboard (moderator has read-only access for review)
router.get('/dashboard', authorize(...overviewRoles, 'moderator'), walletController.getAllBranchesDashboard);

// Risk alerts
router.get('/risk-alerts', authorize(...overviewRoles, 'moderator'), walletController.getRiskAlerts);

// Reset every wallet to zero (super admin only — destructive)
router.post('/reset-all', authorize('super_admin'), walletController.resetAllWallets);

module.exports = router;
