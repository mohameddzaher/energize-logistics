const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);
router.get('/', authorize('super_admin', 'admin'), auditController.getAuditLogs);
router.get('/options', authorize('super_admin', 'admin'), auditController.getAuditOptions);

module.exports = router;
