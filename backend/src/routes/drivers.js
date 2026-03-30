const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const driverController = require('../controllers/driverController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', driverController.getDrivers);

router.post(
  '/',
  authorize('super_admin', 'admin', 'operations_manager', 'operations'),
  [body('name').notEmpty().withMessage('Driver name is required')],
  validate,
  driverController.createDriver
);

router.put(
  '/:id',
  authorize('super_admin', 'admin', 'operations_manager', 'operations'),
  [body('name').notEmpty().withMessage('Driver name is required')],
  validate,
  driverController.updateDriver
);

router.delete('/:id', authorize('super_admin'), driverController.deleteDriver);

module.exports = router;
