const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('fid', objectIdParam());
router.param('pid', objectIdParam());
router.param('did', objectIdParam());
const c = require('../controllers/vendorsMgmtController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { VENDOR_ROLES, VENDOR_LEADS } = require('../config/priceView');
const { TOP_ROLES } = require('../config/constants');

// Vendors management (mounted behind sectionGate('Vendors Management')). The team writes the register and its
// follow-ups; manager and team leader also own the approved price list and the targets.
const TEAM = [...TOP_ROLES, ...VENDOR_ROLES, 'operations_manager', 'operations_team_leader', 'operations_staff', ...require('../config/roles').DATA_ROLES];
const LEADS = [...TOP_ROLES, ...VENDOR_LEADS, 'operations_manager', 'operations_team_leader', 'data_manager'];

router.use(authenticate);
// Every endpoint is the team's; a role granted the section from the permissions matrix passes through the section stamp.
router.use(authorize(...TEAM));
router.get('/overview', c.overview);
router.get('/ranking', c.ranking);
router.get('/register-stats', c.registerStats);
router.get('/filter-options', c.filterOptions);
router.get('/daily', c.daily);
router.get('/alerts', c.alerts);
router.post('/alerts/state', authorize(...TEAM), c.setAlertState);
router.get('/route-search', c.routeSearch);
router.get('/compare', c.compare);
router.get('/approvals', c.listApprovals);
router.get('/approvers', c.getApprovers);
router.put('/approvers', authorize(...TEAM), c.saveApprovers);
router.get('/vendors', c.listVendors);
router.get('/vendors/by-name', c.getByName);
router.post('/vendors', authorize(...TEAM), c.createVendor);
router.get('/freelancers', c.listFreelancers);
router.post('/freelancers', authorize(...TEAM), c.createFreelancer);
router.get('/vendors/:id', c.getVendor);
router.put('/vendors/:id', authorize(...TEAM), c.updateVendor);
router.post('/vendors/:id/documents', authorize(...TEAM), c.addDocuments);
router.delete('/vendors/:id/documents/:did', authorize(...TEAM), c.removeDocument);
router.put('/vendors/:id/contract', authorize(...TEAM), c.saveContract);
// The decision is checked in the controller: operations manager, who holds its rights, or a delegated member.
router.post('/vendors/:id/approval', authorize(...TEAM), c.decideApproval);
router.post('/vendors/:id/resubmit', authorize(...TEAM), c.resubmitApproval);
router.delete('/vendors/:id/contract-files/:did', authorize(...TEAM), c.removeContractFile);
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
