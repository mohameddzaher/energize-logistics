const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');

router.post(
  '/login',
  authLimiter,
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
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  validate,
  authController.changePassword
);

module.exports = router;
