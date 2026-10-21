/**
 * /api/finance — الإدارة الماليّة: مالُ كلّ قسمٍ في موضعٍ واحد.
 * القراءةُ وحدَها؛ كلُّ كتابةٍ تبقى في قسمها. راجع controllers/financeController.
 */
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const finance = require('../controllers/financeController');

const ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'];

router.get('/overview', authorize(...ROLES), finance.overview);
router.get('/departments/:dept', authorize(...ROLES), finance.department);

// ── رسومُ الإقامات ورخص العمل، وطلباتُ الموارد البشريّة ─────────────────────
// هنا كتابةٌ واحدةٌ في الماليّة: تسجيلُ أنّ الرسوم دُفعت، وجوابُ طلب. التجديدُ
// نفسُه يبقى في ملفّ الموظّف بالموارد البشريّة. راجع controllers/hrFinanceController.
const hrf = require('../controllers/hrFinanceController');
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
router.get('/hr-docs', authorize(...ROLES), hrf.financeDocs);
router.get('/hr-docs/options', authorize(...ROLES), hrf.options);
router.get('/hr-docs/summary', authorize(...ROLES), hrf.summary);
router.post('/hr-docs/pay', authorize(...hrf._PAY_ROLES), hrf.markPaid);
// والتراجعُ لمديري الماليّة وحدَهم — لا يفتحه منحُ القسم ولا تأشيرةُ صفحة.
router.post('/hr-docs/unpay', authorize.strict(...hrf._UNDO_ROLES), hrf.undoPaid);
router.get('/hr-requests', authorize(...ROLES), hrf.financeRequests);
router.patch('/hr-requests/:id', authorize(...hrf._PAY_ROLES), hrf.answerRequest);

module.exports = router;
