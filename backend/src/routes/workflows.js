const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const workflowController = require('../controllers/workflowController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

// All workflow-related roles. Finance/collections staff (finance_manager,
// accountant) are included so they can open the operations page, see the
// financial columns, and tick the accounting-review checkbox.
//
// ── وقسمُ التحصيل معهم ────────────────────────────────────────────────────
// الكشفُ هو ورقةُ عملِ التحصيل: منه يُقرأ ما لنا وما علينا، وفيه تُكتب الفاتورةُ
// وتاريخُ التحصيل. ومنعُه من الصفحة كان يعني أن يُملي أرقامَه على قسمٍ آخر
// ليكتبها له. وصلاحيّةُ الحقل تُفحص داخل المتحكّم، فدخولُ الصفحة لا يمنح شيئًا
// بذاته — والأدوارُ هنا هي مَن يصل إلى النقطة أصلًا.
//
// ── وتقنيةُ المعلومات كانت خارجَها ────────────────────────────────────────
// الشريطُ الجانبيّ يعرض صفحةَ التشغيل لمدير تقنية المعلومات ولأخصائيّه، وكلُّ
// نداءٍ فيها يردّ ٤٠٣ — رابطٌ ميّتٌ منذ كُتب. والدوران في `FULL_ACCESS_ROLES`
// أي بلا حاجزٍ في كلّ قسمٍ آخر؛ وهذا المسارُ بلا `sectionGate` فلا يشملهما
// المنحُ الديناميّ الذي يفتحه لهما في غيره.
const allWorkflowRoles = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'employee', 'operations_manager', 'operations_staff',
  'moderator', 'finance_manager', 'accountant',
  'collections_manager', 'collections_staff',
];

// List & export
router.get('/export', authorize(...allWorkflowRoles), workflowController.exportWorkflows);
router.get('/permissions', authorize(...allWorkflowRoles), workflowController.getFieldPermissions);
router.get('/stats', authorize(...allWorkflowRoles), workflowController.getWorkflowStats);
// قيم فلتر عمودٍ واحد — تُحسب في القاعدة. لا بدّ أن تسبق `/:id` وإلا قُرئت
// «filters» على أنها معرّف سجلّ فردّ الخادم 404 على كل فتحةٍ للقائمة.
router.get('/filters', authorize(...allWorkflowRoles), workflowController.filterOptions);
router.get('/', authorize(...allWorkflowRoles), workflowController.getWorkflows);

// Bulk delete
router.post('/bulk-delete', authorize('super_admin'), workflowController.bulkDelete);
// ── تحديثٌ جماعيّ ──────────────────────────────────────────────────────────
// مفتوحٌ لكلّ من يعدّل صفًّا واحدًا: الصلاحيّةُ تُفحص على مستوى **الحقل** داخل
// النقطة نفسِها، فلا يكسب أحدٌ بالجملة ما لا يملكه بالمفرد.
router.post('/bulk-update', authorize(...allWorkflowRoles), workflowController.bulkUpdate);

// Bulk import (must be before /:id routes)
router.post(
  '/bulk-import',
  authorize('super_admin', 'moderator'),
  [body('rows').isArray({ min: 1 }).withMessage('rows must be a non-empty array')],
  validate,
  workflowController.bulkImport
);

// Pending invoices by customer (must be before /:id)
router.get('/pending-by-customer/:customerId', authorize(...allWorkflowRoles), workflowController.getPendingByCustomer);

router.get('/:id', authorize(...allWorkflowRoles), workflowController.getWorkflow);

// Create (all workflow roles — field-level permissions handled in controller)
router.post(
  '/',
  authorize(...allWorkflowRoles),
  [
    body('customerName').optional().trim(),
    body('serviceType').optional().trim(),
  ],
  validate,
  workflowController.createWorkflow
);

// Update (field-level permissions handled in controller)
router.put('/:id', authorize(...allWorkflowRoles), workflowController.updateWorkflow);

// Stage transitions
router.put(
  '/:id/stage',
  authorize(...allWorkflowRoles),
  [body('stage').isIn(['draft', 'submitted_to_ops', 'ops_completed', 'submitted_to_collections', 'completed'])],
  validate,
  workflowController.updateStage
);

// Row locking
router.post('/:id/lock', authorize(...allWorkflowRoles), workflowController.lockWorkflow);
router.post('/:id/unlock', authorize(...allWorkflowRoles), workflowController.unlockWorkflow);

// Delete (super_admin only)
router.delete('/:id', authorize('super_admin'), workflowController.deleteWorkflow);

module.exports = router;
