const express = require('express');
const router = express.Router();
const kpi = require('../controllers/kpiController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);

// Executive KPI board — leadership only.
router.get('/overview', authorize('super_admin', 'admin', 'moderator'), kpi.getOverview);

module.exports = router;
