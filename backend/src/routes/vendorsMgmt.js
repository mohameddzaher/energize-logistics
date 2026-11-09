const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('fid', objectIdParam());
router.param('pid', objectIdParam());
const c = require('../controllers/vendorsMgmtController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { VENDOR_ROLES, VENDOR_LEADS } = require('../config/priceView');
const { TOP_ROLES } = require('../config/constants');

// Vendors management (mounted behind sectionGate('Vendors Management')). The team writes the register and its
// follow-ups; manager and team leader also own the approved price list and the targets.
const TEAM = [...TOP_ROLES, ...VENDOR_ROLES, 'operations_manager', ...require('../config/roles').DATA_ROLES];
const LEADS = [...TOP_ROLES, ...VENDOR_LEADS, 'operations_manager', 'data_manager'];

router.use(authenticate);
// Every endpoint is the team's; a role granted the section from the permissions matrix passes through the section stamp.
router.use(authorize(...TEAM));
router.get('/overview', c.overview);
router.get('/filter-options', c.filterOptions);
router.get('/daily', c.daily);
router.get('/alerts', c.alerts);
router.post('/alerts/state', authorize(...TEAM), c.setAlertState);
router.get('/route-search', c.routeSearch);
router.get('/compare', c.compare);
router.get('/vendors', c.listVendors);
router.get('/vendors/by-name', c.getByName);
router.post('/vendors', authorize(...TEAM), c.createVendor);
router.get('/vendors/:id', c.getVendor);
router.put('/vendors/:id', authorize(...TEAM), c.updateVendor);
router.get('/follow-ups', c.listFollowUps);
router.get('/vendors/:id/follow-ups', c.listFollowUps);
router.post('/vendors/:id/follow-ups', authorize(...TEAM), c.addFollowUp);
router.delete('/follow-ups/:fid', authorize(...TEAM), c.deleteFollowUp);
router.get('/prices', c.listPrices);
router.post('/prices', authorize(...LEADS), c.savePrice);
router.put('/prices/:pid', authorize(...LEADS), c.savePrice);
router.delete('/prices/:pid', authorize(...LEADS), c.deletePrice);
router.get('/settings', c.getSettings);
router.put('/settings', authorize(...LEADS), c.saveSettings);

module.exports = router;
