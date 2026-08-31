const express = require('express');
const router = express.Router();
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
router.get('/:id', ctrl.getClearance);

router.post('/', authorize(...EDIT_ROLES), ctrl.createClearance);
router.put('/:id', authorize(...EDIT_ROLES), ctrl.updateClearance);
router.delete('/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteClearance);

// مرفقات المعاملة — ورقُ كلِّ مرحلة يُرفَع مع المعاملة نفسِها.
router.post('/:id/attachments', authorize(...EDIT_ROLES), ctrl.addAttachments);
router.put('/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.updateAttachment);
router.delete('/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.deleteAttachment);

module.exports = router;
