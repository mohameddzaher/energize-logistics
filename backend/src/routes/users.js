const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');
const User = require('../models/User');

// ── مصدرُ الأدوار الصحيحة ────────────────────────────────────────────────────
// كان `User.schema.path('role').enumValues` — وهي `enum` تُبنى مرّةً عند تحميل
// الملفّ من `config/roles.js`. وقد سقطت تلك `enum` حين صار النظامُ يقبل أنواعًا
// تُصنَع من الشاشة (راجع models/User)، فصار المصدرُ ملفَّ الأدوار مباشرةً — وهو
// ما كانت تعنيه `enum` أصلًا.
const { ALL_ROLE_DEFS, sectionOfRole, isManager } = require('../config/roles');

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
router.get('/roles', async (req, res) => {
  const roles = ALL_ROLE_DEFS.map((d) => ({
    key: d.key,
    ar: d.ar,
    en: d.en,
    section: sectionOfRole(d.key) || '',
    isManager: isManager(d.key),
    custom: false,
  }));

  // ── وما صُنع من شاشة الصلاحيّات يُسنَد كغيره ──────────────────────────────
  // نوعٌ يُصنَع ولا يظهر في قائمة إنشاء المستخدمين نوعٌ لا يمكن استعمالُه —
  // يُضبط بابُه ثمّ لا يدخله أحد.
  try {
    const CustomRole = require('../models/CustomRole');
    const custom = await CustomRole.find({ isActive: true }).sort({ createdAt: 1 }).lean();
    custom.forEach((c) => roles.push({
      key: c.key, ar: c.nameAr, en: c.nameEn, section: '', isManager: false, custom: true,
    }));
  } catch (_) { /* الأنواعُ المصنوعة إضافةٌ لا شرط */ }

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
    // ── والدورُ يُقاس على المصدرين ────────────────────────────────────────
    // `isIn` بقائمةٍ تُبنى مرّةً عند التحميل ترفض النوعَ المصنوعَ بعد إقلاع
    // الخادم: يظهر في القائمة المنسدلة ويُرفَض عند الحفظ.
    body('role').custom(async (v) => {
      const { ALL_ROLES } = require('../config/roles');
      if (ALL_ROLES.includes(v)) return true;
      const { customRoleKeys } = require('../utils/permissions');
      if ((await customRoleKeys()).has(String(v))) return true;
      throw new Error('Role is invalid');
    }),
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
