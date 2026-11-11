const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const vendorController = require('../controllers/vendorController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', vendorController.getVendors);
router.get('/:id', vendorController.getVendor);

router.post(
  '/',
  authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'procurement_manager', 'procurement_staff'),
  [body('name').notEmpty().withMessage('Vendor name is required')],
  validate,
  vendorController.createVendor
);

router.put(
  '/:id',
  authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'operations_staff', 'procurement_manager', 'procurement_staff'),
  [body('name').notEmpty().withMessage('Vendor name is required')],
  validate,
  vendorController.updateVendor
);

router.delete('/:id', authorize('super_admin'), vendorController.deleteVendor);

module.exports = router;
