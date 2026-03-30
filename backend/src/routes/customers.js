const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { generateStatement } = require('../services/statementService');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', customerController.getCustomers);
router.get('/:id', customerController.getCustomer);

router.post(
  '/',
  authorize('super_admin', 'admin'),
  [
    body('companyName').notEmpty().trim(),
    body('contactPerson').notEmpty().trim(),
    body('email').isEmail().normalizeEmail(),
    body('creditTerm').toInt().isIn([15, 30, 45, 60]),
    body('creditLimit').toFloat(),
    body('customerNumber').optional({ values: 'falsy' }).trim(),
  ],
  validate,
  customerController.createCustomer
);

router.put('/:id', authorize('super_admin', 'admin'), customerController.updateCustomer);

router.put(
  '/:id/credit-term',
  authorize('super_admin', 'admin'),
  [body('creditTerm').isIn([15, 30, 45, 60])],
  validate,
  customerController.updateCreditTerm
);

router.post('/:id/stop', authorize('super_admin', 'admin'), customerController.stopCustomer);
router.post('/:id/unstop', authorize('super_admin', 'admin'), customerController.unstopCustomer);

router.get('/:id/statement', authorize('super_admin', 'admin', 'operations_manager'), async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const pdfBuffer = await generateStatement(req.params.id, dateFrom, dateTo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=statement-${req.params.id}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to generate statement' });
  }
});

router.delete('/:id', authorize('super_admin'), customerController.deleteCustomer);

module.exports = router;
