const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');
const User = require('../models/User');

// The ONE source of truth for valid roles is the User schema enum. A second
// hardcoded copy here silently rejected every role added after it was written
// (the IT, marketing, BD and fleet roles all bounced with "Role is invalid").
const VALID_ROLES = User.schema.path('role').enumValues;

router.use(authenticate);

router.get('/', authorize('super_admin', 'admin', 'operations_manager'), userController.getUsers);
router.get('/suggest-manager', authorize('super_admin'), userController.suggestManager);

router.post(
  '/',
  authorize('super_admin'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('كلمة المرور 8 أحرف على الأقل | Password must be at least 8 characters'),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').isIn(VALID_ROLES).withMessage('Role is invalid'),
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
  // Say what is actually wrong. The bare isLength() produced "New Password is
  // invalid", which tells an admin nothing about the rule they just broke.
  [body('newPassword').isLength({ min: 8 })
    .withMessage('كلمة المرور 8 أحرف على الأقل | Password must be at least 8 characters')],
  validate,
  userController.resetPassword
);

module.exports = router;
