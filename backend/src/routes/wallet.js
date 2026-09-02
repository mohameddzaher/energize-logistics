const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const walletController = require('../controllers/walletController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

// ── ومَن يقرأ العهدةَ ويكتب فيها ──────────────────────────────────────────
// المحاسبةُ تقرأ عهدةَ الفروع وتكتب فيها: التحصيلُ والمصروفُ والمشترياتُ قيودٌ
// ماليّةٌ تُراجَع وتُقفَل. وكانت خارجَ القائمة، فيفتح المحاسبُ الصفحةَ فيُردّ
// ٤٠٣ — ولا يُقال له لماذا.
const walletRoles = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'operations_staff',
  'finance_manager', 'accountant',
];
const walletReadRoles = [...walletRoles, 'moderator', 'collections_manager', 'collections_staff'];
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
    body('type').isIn(['collection', 'expense', 'purchase', 'tax_invoice'])
      .withMessage('النوع: تحصيل أو مصروف أو مشتريات أو استلام فاتورة ضريبية'),
    // ── و«فاتورة ضريبيّة» بلا مبلغ ────────────────────────────────────────
    // هي قيدُ استلامٍ لا حركةُ مال، فاشتراطُ مبلغٍ أكبرَ من صفرٍ عليها يمنع
    // تسجيلَ ما جاء بلا قيمةٍ معروفةٍ بعد — وهو أكثرُ ما يُستلم.
    body('amount').custom((v, { req }) => {
      if (req.body.type === 'tax_invoice') return true;
      if (!(Number(v) > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
      return true;
    }),
    // ── والاستلامُ يقع على حزمةِ كشوفٍ لا على واحد ────────────────────────
    // المندوبُ يأتي بسبعةٍ فتُسجَّل دفعةً. والشرطُ هنا كان على الحقل المفرد
    // وحدَه، فكان يردّ الحزمةَ كلَّها بـ«رقم الفاتورة مطلوب» وهي تحمل سبعةَ
    // أرقام. فالشرطُ على المعنى: كشفٌ واحدٌ على الأقلّ، من أيّ الشكلين.
    body('receivedReportNumbers').custom((v, { req }) => {
      if (req.body.type !== 'tax_invoice') return true;
      const list = [
        ...(Array.isArray(v) ? v : []),
        req.body.receivedDocNumber,          // الشكلُ القديم، ما زال يُقبَل
      ].map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!list.length) throw new Error('اكتب رقم كشف تخريج واحدًا على الأقلّ');
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
