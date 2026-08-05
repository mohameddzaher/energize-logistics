const express = require('express');
const router = express.Router();
const p = require('../controllers/procurementController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const STAFF = ['super_admin', 'admin', 'procurement_manager', 'procurement_staff'];

router.use(authenticate);
router.use(authorize(...STAFF));

router.get('/options', p.getOptions);
router.get('/dashboard', p.getDashboard);

// Purchase requests
router.get('/requests', p.listPRs);
router.post('/requests', p.createPR);
router.put('/requests/:id', p.updatePR);
router.post('/requests/:id/submit', p.submitPR);
router.patch('/requests/:id/decision', p.decidePR);
router.post('/requests/:id/convert', p.convertPR);
router.delete('/requests/:id', p.deletePR);

// Purchase orders
router.get('/orders', p.listPOs);
router.post('/orders', p.createPO);
router.put('/orders/:id', p.updatePO);
router.post('/orders/:id/receive', p.receivePO);
router.delete('/orders/:id', p.deletePO);

// Vendor bills (A/P)
router.get('/bills', p.listBills);
router.post('/bills', p.createBill);
router.post('/bills/:id/pay', p.payBill);
router.delete('/bills/:id', p.deleteBill);

module.exports = router;
