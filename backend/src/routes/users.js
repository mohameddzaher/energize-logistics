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

/**
 * GET /api/users/roles — قائمةُ الأدوار التي يقبلها الخادم فعلًا.
 *
 * ── ولماذا تُقرأ ولا تُكتب في الشاشة ──────────────────────────────────────
 * كانت الشاشة تحمل قائمةً مكتوبةً بيدها، فانحرفت عن الحقيقة في الاتّجاهين معًا:
 * أربعةُ أدوار تعرضها ولا وجود لها («b2c_project_manager» بينما اسمه الحقيقيّ
 * `b2c_project_lead`) — تختارها فيردّ الخادم «الدور غير صالح» بلا أن يقول أيّ
 * دورٍ يقبل؛ وثلاثةٌ وعشرون دورًا صحيحًا لا تظهر أصلًا، فلا سبيل إلى إسنادها من
 * الشاشة إطلاقًا. وكلّ دورٍ يُضاف بعد اليوم كان سيغيب عنها بالطريقة نفسها.
 *
 * ومعها القسمُ ومَن يديره: الشاشة تحتاجهما لتقترح المدير المباشر عند اختيار
 * الدور، وحسابُهما هنا يجعل الاقتراح يتبع تعريف الأدوار وحده.
 */
router.get('/roles', (req, res) => {
  const R = require('../config/roles');
  const roles = R.ALL_ROLE_DEFS
    .filter((d) => VALID_ROLES.includes(d.key))
    .map((d) => ({
      key: d.key,
      ar: d.ar,
      en: d.en,
      section: R.sectionOfRole(d.key) || '',
      isManager: R.isManager(d.key),
    }));
  res.json({ roles });
});

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
