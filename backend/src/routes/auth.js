const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, accountAuthLimiter } = require('../middleware/rateLimiter');

router.post(
  '/login',
  authLimiter,
  accountAuthLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

router.post('/refresh', authController.refresh);

router.post('/logout', authenticate, authController.logout);

router.get('/me', authenticate, authController.getMe);
// Self-service: a user edits their own name/email (not role/permissions).
router.patch('/me', authenticate, authController.updateMyProfile);

// Personal signatures (manage in profile, apply to leave approvals etc.)
router.get('/signatures', authenticate, authController.getMySignatures);
router.post('/signatures', authenticate, authController.addSignature);
router.put('/signatures/:id', authenticate, authController.updateSignature);
router.delete('/signatures/:id', authenticate, authController.deleteSignature);

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    // MUST match User.schema's minlength (8). When this said 6, a 7-character
    // password passed validation, then failed on save — and the user just saw
    // "Failed to change password" with no idea why.
    body('newPassword').isLength({ min: 8 })
      .withMessage('كلمة المرور 8 أحرف على الأقل | New password must be at least 8 characters'),
  ],
  validate,
  authController.changePassword
);

module.exports = router;
