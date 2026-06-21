const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customsClearanceController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'];

router.use(authenticate);

router.get('/', ctrl.getClearances);
router.get('/:id', ctrl.getClearance);

router.post('/', authorize(...EDIT_ROLES), ctrl.createClearance);
router.put('/:id', authorize(...EDIT_ROLES), ctrl.updateClearance);
router.delete('/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteClearance);

module.exports = router;
