/**
 * /api/marketing — the Marketing section (قسم التسويق).
 * Reads are open to any authenticated staff member (the dashboard and the
 * weekly report are things managers across the company ask to see); writes are
 * limited to the marketing team and the admin/IT tier.
 */
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/marketingController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'marketing_manager', 'marketing_specialist'];

router.use(authenticate);

// Analytics
router.get('/dashboard', ctrl.getDashboard);
router.get('/report', ctrl.getReport);

// Campaigns
router.get('/campaigns', ctrl.listCampaigns);
router.post('/campaigns', authorize(...EDIT_ROLES), ctrl.createCampaign);
router.get('/campaigns/:id', ctrl.getCampaign);
router.put('/campaigns/:id', authorize(...EDIT_ROLES), ctrl.updateCampaign);
router.delete('/campaigns/:id', authorize(...EDIT_ROLES), ctrl.deleteCampaign);

// Activities (the history log)
router.get('/activities', ctrl.listActivities);
router.post('/activities', authorize(...EDIT_ROLES), ctrl.createActivity);
router.put('/activities/:id', authorize(...EDIT_ROLES), ctrl.updateActivity);
router.delete('/activities/:id', authorize(...EDIT_ROLES), ctrl.deleteActivity);

module.exports = router;
