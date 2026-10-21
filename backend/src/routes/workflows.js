const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('customerId', objectIdParam());
const workflowController = require('../controllers/workflowController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
// أهلُ المال يملكون في هذه الصفحة ما يملكه مديرُ النظام — راجع config/financeAuthority.
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const validate = require('../middleware/validate');

router.use(authenticate);
// فلترُ «مسؤول البيانات» يقرأ مشترياتِ المحفظة — تُحمَّل قبل بناء الشرط. راجع utils/dataOwnerIndex.
router.use(require('../utils/dataOwnerIndex').preload);

// All workflow-related roles. Finance/collections staff (cfo, accounting_manager,
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
//
// والمبيعاتُ خرجت منهم: دخلتها لقيمة البيع وحدَها، ثمّ قُصرت القيمةُ على
// المال والتحصيل والتشغيل (صاحبُ الشركة، ٢٠٢٦/١٠/٢١). راجع SELLING_ROLES.
const allWorkflowRoles = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'employee', 'operations_manager', 'operations_staff',
  'moderator', 'cfo', 'accounting_manager', 'accountant',
  'collections_manager', 'collections_staff',
];

// List & export
router.get('/export', authorize(...allWorkflowRoles), workflowController.exportWorkflows);
router.get('/permissions', authorize(...allWorkflowRoles), workflowController.getFieldPermissions);
router.get('/stats', authorize(...allWorkflowRoles), workflowController.getWorkflowStats);
// قيم فلتر عمودٍ واحد — تُحسب في القاعدة. لا بدّ أن تسبق `/:id` وإلا قُرئت
// «filters» على أنها معرّف سجلّ فردّ الخادم 404 على كل فتحةٍ للقائمة.
router.get('/filters', authorize(...allWorkflowRoles), workflowController.filterOptions);
// فحوصُ الفواتير الأربع (ناقصٌ في التسلسل · كشفٌ غير موجود · فرقُ قيمة · اسمُ عميل) —
// قبل `/:id` أيضًا. والمالُ يُفحص داخل المتحكّم (canSeeMoney).
router.get('/invoice-checks', authorize(...allWorkflowRoles), workflowController.invoiceChecks);
router.get('/invoice-checks/:kind', authorize(...allWorkflowRoles), workflowController.invoiceCheckList);
// ── ربطُ الكشف بمعاملة تخليص ─────────────────────────────────────────────────
// البحثُ قبل `/:id`. وصلاحيّةُ الربط تُفحص داخل المتحكّم (canLinkCustoms).
router.get('/customs-search', authorize(...allWorkflowRoles), workflowController.customsSearch);
router.put('/:id/customs-link', authorize(...allWorkflowRoles), workflowController.setCustomsLink);
router.delete('/:id/customs-link', authorize(...allWorkflowRoles), workflowController.clearCustomsLink);

// ── أنواعُ الدفع ────────────────────────────────────────────────────────────
// صفةُ العميل تُقرأ لمن يفتح صفحةَ التشغيل، ولا تُكتب إلّا لمن يديرها: قلبُ
// صفةِ عميلٍ يغيّر أين تُفوتَر كشوفُه كلُّها. ولا بدّ أن تسبق `/:id`.
const paymentTypes = require('../controllers/paymentTypesController');
const PT_WRITE = ['super_admin', 'admin', 'operations_manager', 'moderator', 'cfo', 'accounting_manager', 'collections_manager'];
router.get('/payment-types', authorize(...allWorkflowRoles), paymentTypes.list);
router.put('/payment-types/:id', authorize(...PT_WRITE), paymentTypes.update);
router.post('/payment-types/apply', authorize(...PT_WRITE), paymentTypes.applyAll);
// توحيدُ كشوف عميلٍ على صفته — نقضُ دليلٍ قائم، فيُطلَب صراحةً لعميلٍ بعينه.
router.post('/payment-types/:id/unify', authorize(...PT_WRITE), paymentTypes.unifyCustomer);
router.get('/', authorize(...allWorkflowRoles), workflowController.getWorkflows);

// Bulk delete
router.post('/bulk-delete', authorize('super_admin', ...FINANCE_FULL_ROLES), workflowController.bulkDelete);
// ── تحديثٌ جماعيّ ──────────────────────────────────────────────────────────
// مفتوحٌ لكلّ من يعدّل صفًّا واحدًا: الصلاحيّةُ تُفحص على مستوى **الحقل** داخل
// النقطة نفسِها، فلا يكسب أحدٌ بالجملة ما لا يملكه بالمفرد.
router.post('/bulk-update', authorize(...allWorkflowRoles), workflowController.bulkUpdate);
// رفعُ بيانات الفواتير من إكسل (امر الشحن ← الكشف) — معاينةٌ ثمّ كتابة. راجع importInvoices.
router.post('/import-invoices', authorize(...allWorkflowRoles), workflowController.importInvoices);

// Bulk import (must be before /:id routes)
router.post(
  '/bulk-import',
  authorize('super_admin', 'moderator', ...FINANCE_FULL_ROLES),
  [body('rows').isArray({ min: 1 }).withMessage('rows must be a non-empty array')],
  validate,
  workflowController.bulkImport
);

// Pending invoices by customer (must be before /:id)
router.get('/pending-by-customer/:customerId', authorize(...allWorkflowRoles), workflowController.getPendingByCustomer);

router.get('/:id', authorize(...allWorkflowRoles), workflowController.getWorkflow);

// ── متابعاتُ الكشف ───────────────────────────────────────────────────────────
// مَن يفتح الكشفَ يكتب عليه متابعة؛ والحذفُ لصاحبها أو للإدارة (داخل المتحكّم).
// والسجلُّ نفسُه يُقرأ من صفحة معاملة التخليص ومن فاتورة التحصيل — راجع
// controllers/workflowFollowUpController.
router.param('fuId', objectIdParam());
const followUps = require('../controllers/workflowFollowUpController').operations;
router.get('/:id/follow-ups', authorize(...allWorkflowRoles), followUps.list);
router.post('/:id/follow-ups', authorize(...allWorkflowRoles), followUps.create);
router.delete('/:id/follow-ups/:fuId', authorize(...allWorkflowRoles), followUps.remove);

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

// حالةُ الطلب — تُكتب في منصّة التشغيل ثمّ تعود إلينا (راجع الدالّة).
router.patch('/:id/application-status', authorize(...allWorkflowRoles), workflowController.updateApplicationStatus);

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
router.delete('/:id', authorize('super_admin', ...FINANCE_FULL_ROLES), workflowController.deleteWorkflow);

module.exports = router;
