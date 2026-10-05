const express = require('express');
const router = express.Router();
const { clearData } = require('../controllers/adminController');
const {
  getPermissions, updateRolePermissions,
  listCustomRoles, createCustomRole, updateCustomRole, deleteCustomRole,
} = require('../controllers/permissionController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);
// ── وهذه الأبوابُ لا تُفتَح بمنحٍ من المصفوفة ─────────────────────────────────
// `authorize.strict` لا يقرأ ختمَ قسمٍ ولا تأشيرةَ صفحة. والسببُ أنّ هذه هي
// المصفوفةُ نفسُها: من يُؤشَّر له على شاشة «الأدوار والصلاحيات» يمنح نفسَه كلَّ
// شيءٍ في ضغطتين — فتكون التأشيرةُ تسليمًا للنظام لا فتحًا لشاشة. ومعها محوُ
// البيانات: فعلٌ لا رجعةَ فيه.
router.post('/clear-data', authorize.strict('super_admin'), clearData);

// Dynamic role→section permissions (super_admin only).
router.get('/permissions', authorize.strict('super_admin'), getPermissions);
router.put('/permissions/:role', authorize.strict('super_admin'), updateRolePermissions);

// ── أنواعُ المستخدمين المصنوعة ───────────────────────────────────────────────
// القراءةُ لمن يُنشئ المستخدمين — القائمةُ المنسدلة في صفحة المستخدمين تحتاجها،
// ولولا ذلك لصُنع نوعٌ لا يمكن تعيينُه لأحد. والصنعُ والحذفُ لصاحب النظام وحدَه:
// نوعٌ جديدٌ بابٌ جديدٌ في البيت.
router.get('/roles', authorize('super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager'), listCustomRoles);
router.post('/roles', authorize.strict('super_admin'), createCustomRole);
router.put('/roles/:key', authorize.strict('super_admin'), updateCustomRole);
router.delete('/roles/:key', authorize.strict('super_admin'), deleteCustomRole);

module.exports = router;
