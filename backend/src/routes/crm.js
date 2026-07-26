const express = require('express');
const router = express.Router();
const crm = require('../controllers/crmController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { CRM_STAFF_ROLES } = require('../config/constants');

const STAFF = CRM_STAFF_ROLES;

router.use(authenticate);

// The BD team links opportunities to CRM companies — they need to READ the
// companies list (only). Declared before the section-wide CRM staff wall.
router.get('/companies', authorize(...STAFF, 'bd_manager', 'bd_specialist'), crm.listCompanies);

router.use(authorize(...STAFF));

// Meta
router.get('/options', crm.getOptions);
router.get('/dashboard', crm.getDashboard);
router.get('/calendar', crm.getCalendar);
router.get('/customers-search', crm.searchCustomers);

// Companies
router.get('/companies', crm.listCompanies);
router.get('/companies/:id', crm.getCompany);
router.post('/companies', crm.createCompany);
router.put('/companies/:id', crm.updateCompany);
router.patch('/companies/:id/rate', crm.rateCompany);
router.delete('/companies/:id', crm.deleteCompany);

// Contacts
router.get('/contacts', crm.listContacts);
router.post('/contacts', crm.createContact);
router.put('/contacts/:id', crm.updateContact);
router.delete('/contacts/:id', crm.deleteContact);

// Activities
router.get('/activities', crm.listActivities);
router.post('/activities', crm.createActivity);
router.put('/activities/:id', crm.updateActivity);
router.delete('/activities/:id', crm.deleteActivity);

// Tasks
router.get('/tasks', crm.listTasks);
router.post('/tasks', crm.createTask);
router.put('/tasks/:id', crm.updateTask);
router.delete('/tasks/:id', crm.deleteTask);

// Deals
router.get('/deals', crm.listDeals);
router.post('/deals', crm.createDeal);
router.put('/deals/:id', crm.updateDeal);
router.patch('/deals/:id/move', crm.moveDeal);
router.delete('/deals/:id', crm.deleteDeal);

module.exports = router;
