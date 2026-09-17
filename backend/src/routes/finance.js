/**
 * /api/finance — الإدارة الماليّة: مالُ كلّ قسمٍ في موضعٍ واحد.
 * القراءةُ وحدَها؛ كلُّ كتابةٍ تبقى في قسمها. راجع controllers/financeController.
 */
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const finance = require('../controllers/financeController');

const ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'finance_manager', 'accountant'];

router.get('/overview', authorize(...ROLES), finance.overview);
router.get('/departments/:dept', authorize(...ROLES), finance.department);

module.exports = router;
