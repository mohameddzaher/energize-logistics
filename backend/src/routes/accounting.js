const express = require('express');
const router = express.Router();
const acc = require('../controllers/accountingController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const STAFF = ['super_admin', 'admin', 'finance_manager', 'accountant'];

router.use(authenticate);
router.use(authorize(...STAFF));

router.get('/options', acc.getOptions);
router.get('/dashboard', acc.getDashboard);
router.post('/sync', acc.sync);

// Chart of accounts
router.get('/accounts', acc.listAccounts);
router.post('/accounts', acc.createAccount);
router.put('/accounts/:id', acc.updateAccount);
router.delete('/accounts/:id', acc.deleteAccount);

// Journal
router.get('/journal', acc.listJournal);
router.post('/journal', acc.createJournal);
router.delete('/journal/:id', acc.deleteJournal);

// Reports
router.get('/ledger/:id', acc.getLedger);
router.get('/trial-balance', acc.getTrialBalance);
router.get('/profit-loss', acc.getProfitAndLoss);
router.get('/receivables', acc.getReceivables);
router.get('/payables', acc.getPayables);

module.exports = router;
