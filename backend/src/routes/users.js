const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');
const User = require('../models/User');

// Source of the valid roles. It used to be `User.schema.path('role').enumValues`, an `enum` built once at file load from `config/roles.js`. That `enum` was dropped when the system began accepting types created from the screen (see models/User), so the source is now the roles file directly, which is what the `enum` always meant.
const { ALL_ROLE_DEFS, sectionOfRole, isManager } = require('../config/roles');

router.use(authenticate);

/**
 * GET /api/users/roles: the list of roles the server actually accepts.
 * Why it is read, not hand-written in the screen: the screen carried a hand-written list that drifted both ways. Four roles it showed do not exist (for example 'b2c_project_manager' where the real name is `b2c_project_lead`), so choosing one got 'invalid role' without saying which roles are accepted; and twenty-three valid roles never appeared, so they could not be assigned from the screen at all. Every role added later would have been missed the same way.
 * It also returns the section and who manages it: the screen needs them to suggest the direct manager when a role is chosen, and computing them here keeps the suggestion following the role definitions alone.
 */
// Read after login. It used to be registered before `authenticate`, so it was open to the internet: anyone could get the whole role structure with names, sections and who counts as a manager, the company's org chart. Not a dangerous secret, but not for the public, and nothing needs it public: it is only read from screens behind login.
// (Found by the API documentation check: a route with no readable guard; see `scripts/checkApiDocs`.)
router.get('/roles', async (req, res) => {
  const roles = ALL_ROLE_DEFS.map((d) => ({
    key: d.key,
    ar: d.ar,
    en: d.en,
    // Grouped by the company structure: vendors and follow-up appear under Operations (config/roles orgSectionOfRole).
    section: require('../config/roles').orgSectionOfRole(d.key) || '',
    isManager: isManager(d.key),
    // What distinguishes the role is sent with it. `distinct` was written in `config/roles` but not returned, so the create-user screen could not read it. Someone wanting a duty-check supervisor searched for a role by that name and did not find it; duty check is an assignment, not a role, and this line says so.
    distinct: d.distinct || '',
    custom: false,
  }));

  // A type created from the permissions screen is assignable like any other. A type that is created but missing from the create-user list is unusable: its access is configured and nobody can enter.
  try {
    const CustomRole = require('../models/CustomRole');
    const custom = await CustomRole.find({ isActive: true }).sort({ createdAt: 1 }).lean();
    custom.forEach((c) => roles.push({
      key: c.key, ar: c.nameAr, en: c.nameEn, section: '', isManager: false, custom: true,
    }));
  } catch (_) { /* Created types are an addition, not a requirement. */ }

  res.json({ roles });
});

router.get('/', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'), userController.getUsers);
router.get('/suggest-manager', authorize('super_admin'), userController.suggestManager);

router.post(
  '/',
  authorize('super_admin'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('كلمة المرور 8 أحرف على الأقل | Password must be at least 8 characters'),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    // The role is checked against both sources. `isIn` with a list built once at load rejects a type created after the server started: it shows in the dropdown and is rejected on save.
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
