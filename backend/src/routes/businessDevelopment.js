const express = require('express');
const router = express.Router();
const bd = require('../controllers/bdController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const constants = require('../config/constants');

// Read access: the BD team plus the commercial leadership that consumes these
// numbers (sales/CRM managers). Write access is the BD team + IT/admin tier.
// Sourced from config/constants when present, with an inline fallback so this
// router keeps loading if the shared constants have not been extended yet.
const STAFF_ROLES = constants.BD_STAFF_ROLES || [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'bd_manager', 'bd_specialist',
  'sales_manager', 'crm_manager', 'operations_manager',
];
const EDIT_ROLES = constants.BD_ADMIN_ROLES || [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'bd_manager', 'bd_specialist',
];

router.use(authenticate);
router.use(authorize(...STAFF_ROLES));

// Dashboard
router.get('/dashboard', bd.getDashboard);

// Opportunities
router.get('/opportunities', bd.listOpportunities);
router.post('/opportunities', authorize(...EDIT_ROLES), bd.createOpportunity);
router.get('/opportunities/:id', bd.getOpportunity);
router.put('/opportunities/:id', authorize(...EDIT_ROLES), bd.updateOpportunity);
router.delete('/opportunities/:id', authorize(...EDIT_ROLES), bd.deleteOpportunity);

// Partners
router.get('/partners', bd.listPartners);
router.post('/partners', authorize(...EDIT_ROLES), bd.createPartner);
router.get('/partners/:id', bd.getPartner);
router.put('/partners/:id', authorize(...EDIT_ROLES), bd.updatePartner);
router.delete('/partners/:id', authorize(...EDIT_ROLES), bd.deletePartner);

// Tenders
router.get('/tenders', bd.listTenders);
router.post('/tenders', authorize(...EDIT_ROLES), bd.createTender);
router.get('/tenders/:id', bd.getTender);
router.put('/tenders/:id', authorize(...EDIT_ROLES), bd.updateTender);
router.delete('/tenders/:id', authorize(...EDIT_ROLES), bd.deleteTender);

// Activities (polymorphic log across all three record types)
router.get('/activities', bd.listActivities);
router.post('/activities', authorize(...EDIT_ROLES), bd.createActivity);
router.put('/activities/:id', authorize(...EDIT_ROLES), bd.updateActivity);
router.delete('/activities/:id', authorize(...EDIT_ROLES), bd.deleteActivity);

module.exports = router;
