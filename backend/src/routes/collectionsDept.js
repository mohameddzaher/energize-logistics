const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collectionsDeptController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);

// مَن يقرأ القسم. `sectionGate` مركَّبٌ فوق هذه البادئة في server.js، فمن مُنح
// «Collections» من صفحة الصلاحيّات يمرّ من هنا أيضًا (rbac يقرأ req.sectionAccess).
const READ_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff',
  'operations_manager', 'finance_manager', 'accountant',
];
// ومَن يكتب: القسمُ صاحبُ عمله، والمالُ يشاركه فيه.
//
// ── ولا قائمةَ أضيقُ منها للحذف ────────────────────────────────────────────
// كُتبت هنا أوّلًا قائمةٌ للحذف تقتصر على المدير، ثمّ أثبت الفحصُ الحيّ أنّ
// الموظّف يحذف بها: `authorize` تمرّ أيضًا حين يمنح `sectionGate` القسمَ
// تعديلًا — ومنحُ «تعديل» على قسمٍ يمرّ كلَّ نقطةٍ فيه بالتصميم. فقائمةٌ
// أضيقُ من منح القسم لا تمنع شيئًا؛ هي سطرٌ يقول ما لا يفعله، وذلك أسوأُ من
// غيابه: مَن يقرؤه يظنّ الحذفَ محروسًا.
//
// والحذفُ هنا ليس خطرًا يستحقّ حارسًا ثانيًا: مَن له كشوفٌ يُعطَّل ولا يُحذف
// (انظر `deleteParty`)، فالذي يُمحى فعلًا صفٌّ بلا تاريخ. فالقائمةُ واحدة.
const EDIT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff', 'finance_manager',
];

router.get('/dashboard', authorize(...READ_ROLES), ctrl.dashboard);
// قبل `/parties/:id` لا بعده: «filters» لو جاءت بعدَه قُرئت معرّفَ طرف.
router.get('/parties/filters', authorize(...READ_ROLES), ctrl.filterOptions);
router.get('/parties', authorize(...READ_ROLES), ctrl.listParties);
router.post('/parties', authorize(...EDIT_ROLES), ctrl.createParty);
router.get('/parties/:id', authorize(...READ_ROLES), ctrl.getPartyProfile);
router.put('/parties/:id', authorize(...EDIT_ROLES), ctrl.updateParty);
router.delete('/parties/:id', authorize(...EDIT_ROLES), ctrl.deleteParty);

// ── المتابعات ─────────────────────────────────────────────────────────────
// «المستحقّ» قبل `/parties/:id/...` لأنّه لا يخصّ طرفًا بعينه.
router.get('/follow-ups/due', authorize(...READ_ROLES), ctrl.dueFollowUps);
router.get('/parties/:id/follow-ups', authorize(...READ_ROLES), ctrl.listFollowUps);
router.post('/parties/:id/follow-ups', authorize(...EDIT_ROLES), ctrl.createFollowUp);
router.put('/follow-ups/:fuId', authorize(...EDIT_ROLES), ctrl.updateFollowUp);
router.delete('/follow-ups/:fuId', authorize(...EDIT_ROLES), ctrl.deleteFollowUp);

module.exports = router;
