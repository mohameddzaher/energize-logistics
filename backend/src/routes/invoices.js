const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoice);

router.post(
  '/',
  authorize('super_admin', 'admin'),
  [
    body('invoiceNumber').notEmpty().trim(),
    body('customer').isMongoId(),
    body('amount').isFloat({ min: 0.01 }),
    body('invoiceDate').isISO8601(),
  ],
  validate,
  invoiceController.createInvoice
);

router.put('/:id', authorize('super_admin', 'admin'), invoiceController.updateInvoice);
router.put('/:id/status', authorize('super_admin'), invoiceController.overrideStatus);
router.put('/:id/freeze', authorize('super_admin'), invoiceController.freezeInvoice);

router.post('/:id/refund', authorize('super_admin'), invoiceController.refundInvoice);
router.post('/:id/mark-paid', authorize('super_admin', 'admin'), invoiceController.markFullyPaid);

router.delete('/:id', authorize('super_admin'), invoiceController.deleteInvoice);

module.exports = router;
