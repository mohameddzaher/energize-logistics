const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('attId', objectIdParam());
const ctrl = require('../controllers/customsClearanceController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'];

router.use(authenticate);

router.get('/', ctrl.getClearances);
// Must stay ABOVE '/:id' or the param route swallows it.
router.get('/analytics', ctrl.getAnalytics);
router.get('/filters', ctrl.getFilterOptions);

// ── أطرافُ التخليص: العملاءُ ووكلاءُ الشحن ─────────────────────────────────
// قبل `/:id` لا بعده: «parties» لو جاءت بعدَه قُرئت معرّفَ معاملة.
router.get('/parties', ctrl.listParties);
router.post('/parties', authorize(...EDIT_ROLES), ctrl.createParty);
router.get('/parties/:id', ctrl.getPartyProfile);
router.put('/parties/:id', authorize(...EDIT_ROLES), ctrl.updateParty);
router.delete('/parties/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteParty);
// ── العقود: قبل `/:id` كذلك ────────────────────────────────────────────────
// ── نقاطُ المجموعة قبل `/:id` ─────────────────────────────────────────────
const FINANCE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'];

router.get('/settings', ctrl.getSettings);
router.put('/settings', authorize('super_admin', 'admin', 'it_manager', 'customs_manager'), ctrl.updateSettings);
router.get('/upcoming-alerts', ctrl.upcomingAlerts);
// طلباتُ الصرف: يقرؤها التخليصُ ليتابع طلبَه، وتقرّر فيها الماليّةُ وحدَها.
router.get('/payment-requests', ctrl.listPaymentRequests);

router.get('/contracts', ctrl.listContracts);
router.post('/contracts', authorize(...EDIT_ROLES), ctrl.createContract);
router.put('/contracts/:id', authorize(...EDIT_ROLES), ctrl.updateContract);
router.delete('/contracts/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteContract);
router.post('/contracts/:id/files', authorize(...EDIT_ROLES), ctrl.addContractFiles);
router.delete('/contracts/:id/files/:attId', authorize(...EDIT_ROLES), ctrl.deleteContractFile);

router.get('/:id', ctrl.getClearance);

router.post('/', authorize(...EDIT_ROLES), ctrl.createClearance);
router.put('/:id', authorize(...EDIT_ROLES), ctrl.updateClearance);
router.delete('/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteClearance);

// مرفقات المعاملة — ورقُ كلِّ مرحلة يُرفَع مع المعاملة نفسِها.
// ── مراحلُ السداد ──────────────────────────────────────────────────────────
// إدخالٌ لكلّ مرّة: المرحلةُ نفسُها تُضاف مرّاتٍ (الرسومُ على دفعتين، الإرجاعُ
// لحاويتين). والقائمةُ التي تُختار منها من إعدادات القسم.
router.post('/:id/payment-stages', authorize(...EDIT_ROLES), ctrl.addPaymentStage);
router.put('/:id/payment-stages/:entryId', authorize(...EDIT_ROLES), ctrl.updatePaymentStage);
router.delete('/:id/payment-stages/:entryId', authorize(...EDIT_ROLES), ctrl.deletePaymentStage);
// الإقفال — لا يمرّ قبل «فاتورة النقل» بتاريخٍ ومرفق. راجع completeClearance.
router.patch('/:id/complete', authorize(...EDIT_ROLES), ctrl.completeClearance);
// تحويلُ معاملةٍ قادمةٍ إلى جارية.
router.patch('/:id/activate', authorize(...EDIT_ROLES), ctrl.activateClearance);
// قرارُ الإدارة الماليّة على طلبِ صرف — لها وحدَها.
router.patch('/:id/payment-stages/:entryId/decision', authorize(...FINANCE_ROLES), ctrl.decidePaymentStage);

// ملاحظاتُ المعاملة — تُضاف من الجدول ومن داخل المعاملة، وآخرُها يُعرض.
router.post('/:id/notes', authorize(...EDIT_ROLES), ctrl.addNote);
router.delete('/:id/notes/:noteId', authorize(...EDIT_ROLES), ctrl.deleteNote);

router.post('/:id/attachments', authorize(...EDIT_ROLES), ctrl.addAttachments);
router.put('/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.updateAttachment);
router.delete('/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.deleteAttachment);

module.exports = router;
