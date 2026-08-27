const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const disputeController = require('../controllers/disputeController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.post(
  '/',
  [
    body('invoice').isMongoId(),
    body('reason').notEmpty().trim(),
  ],
  validate,
  disputeController.createDispute
);

router.put(
  '/:id',
  authorize('super_admin', 'admin'),
  disputeController.updateDispute
);

router.get('/', disputeController.getDisputes);
router.delete('/:id', authorize('super_admin', 'admin'), disputeController.deleteDispute);

module.exports = router;
