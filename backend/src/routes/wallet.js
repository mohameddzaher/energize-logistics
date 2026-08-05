const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const walletController = require('../controllers/walletController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

const walletRoles = ['super_admin', 'admin', 'operations_manager', 'operations_staff'];
const walletReadRoles = [...walletRoles, 'moderator'];
const managerRoles = ['super_admin', 'admin', 'operations_manager'];

router.use(authenticate);

// Daily wallet (moderator has read-only access)
router.get('/daily', authorize(...walletReadRoles), walletController.getDailyWallet);

// Lookup by report number (رقم كشف التخريج)
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
    body('type').isIn(['collection', 'expense', 'purchase']).withMessage('Type must be collection, expense, or purchase'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  ],
  validate,
  walletController.addTransaction
);

// Update transaction
router.put('/transactions/:id', authorize(...walletRoles), walletController.updateTransaction);

// Delete transaction
router.delete('/transactions/:id', authorize(...walletRoles), walletController.deleteTransaction);

// Close day
router.post('/close-day', authorize(...walletRoles), walletController.closeDay);

// Reopen day (operations team + managers)
router.post('/reopen/:walletId', authorize(...walletRoles), walletController.reopenDay);

// Branch dashboard (moderator has read-only access for review)
router.get('/branch/:branchId', authorize(...managerRoles, 'moderator'), walletController.getBranchDashboard);

// All branches dashboard (moderator has read-only access for review)
router.get('/dashboard', authorize(...managerRoles, 'moderator'), walletController.getAllBranchesDashboard);

// Risk alerts
router.get('/risk-alerts', authorize(...managerRoles, 'moderator'), walletController.getRiskAlerts);

// Reset every wallet to zero (super admin only — destructive)
router.post('/reset-all', authorize('super_admin'), walletController.resetAllWallets);

module.exports = router;
