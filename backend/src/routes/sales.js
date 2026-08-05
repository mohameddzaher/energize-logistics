const express = require('express');
const router = express.Router();
const sales = require('../controllers/salesController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const STAFF = ['super_admin', 'admin', 'sales_manager', 'sales_rep', 'operations_manager', 'operations_staff'];

router.use(authenticate);
router.use(authorize(...STAFF));

router.get('/options', sales.getOptions);
router.get('/dashboard', sales.getDashboard);
router.get('/performance', sales.getPerformance);
router.get('/pipeline', sales.getPipeline);

router.get('/targets', sales.listTargets);
router.post('/targets', sales.createTarget);
router.put('/targets/:id', sales.updateTarget);
router.delete('/targets/:id', sales.deleteTarget);

module.exports = router;
