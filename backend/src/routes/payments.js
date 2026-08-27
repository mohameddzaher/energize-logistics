const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.post(
  '/',
  [
    body('invoice').isMongoId(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').optional().isIn(['bank_transfer', 'check', 'cash', 'online', 'other']),
  ],
  validate,
  paymentController.logPayment
);

router.post(
  '/bulk',
  [
    body('customer').isMongoId(),
    body('allocations').isArray({ min: 1 }),
    body('allocations.*.invoice').isMongoId(),
    body('allocations.*.amount').isFloat({ min: 0.01 }),
    body('paymentMethod').optional().isIn(['bank_transfer', 'check', 'cash', 'online', 'other']),
  ],
  validate,
  paymentController.logBulkPayment
);

router.post(
  '/auto-allocate',
  [
    body('customer').isMongoId(),
    body('totalAmount').isFloat({ min: 0.01 }),
    body('paymentMethod').optional().isIn(['bank_transfer', 'check', 'cash', 'online', 'other']),
  ],
  validate,
  paymentController.autoAllocateFIFO
);

router.get('/', paymentController.getPayments);
router.get('/customer/:id', paymentController.getCustomerPayments);

// التعديل يعيد حساب أثر الدفعة على الفاتورة ورصيد العميل، لا يغيّر الصفّ وحده.
router.put('/:id', authorize('super_admin', 'admin'), paymentController.updatePayment);
router.delete('/:id', authorize('super_admin'), paymentController.deletePayment);

module.exports = router;
