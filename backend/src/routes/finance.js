/** /api/finance: financial management, every section's money in one place. Read-only; every write stays in its own section. See controllers/financeController. */
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const finance = require('../controllers/financeController');

const ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'];

router.get('/overview', authorize(...ROLES), finance.overview);
router.get('/departments/:dept', authorize(...ROLES), finance.department);

// Residency and work-permit fees, and HR requests. The only write in finance is recording that fees were paid and answering a request; the renewal itself stays in the employee file in HR. See controllers/hrFinanceController.
const hrf = require('../controllers/hrFinanceController');
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
router.get('/hr-docs', authorize(...ROLES), hrf.financeDocs);
router.get('/hr-docs/options', authorize(...ROLES), hrf.options);
router.get('/hr-docs/summary', authorize(...ROLES), hrf.summary);
router.post('/hr-docs/pay', authorize(...hrf._PAY_ROLES), hrf.markPaid);
// Undo is for finance managers only; neither a section grant nor a page grant opens it.
router.post('/hr-docs/unpay', authorize.strict(...hrf._UNDO_ROLES), hrf.undoPaid);
router.get('/hr-requests', authorize(...ROLES), hrf.financeRequests);
router.patch('/hr-requests/:id', authorize(...hrf._PAY_ROLES), hrf.answerRequest);

module.exports = router;
