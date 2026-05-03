const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

router.get('/', authorize('super_admin', 'admin', 'operations_manager'), userController.getUsers);

router.post(
  '/',
  authorize('super_admin'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').isIn(['super_admin', 'admin', 'employee', 'operations_manager', 'operations', 'moderator', 'client', 'workshop_manager', 'workshop_employee', 'purchasing', 'b2c_head', 'b2c_project_manager']),
  ],
  validate,
  userController.createUser
);

router.put('/:id', authorize('super_admin'), userController.updateUser);
router.delete('/:id', authorize('super_admin'), userController.deleteUser);
router.post('/:id/lock', authorize('super_admin'), userController.lockUser);
router.post(
  '/:id/reset-password',
  authorize('super_admin'),
  [body('newPassword').isLength({ min: 8 })],
  validate,
  userController.resetPassword
);

module.exports = router;
