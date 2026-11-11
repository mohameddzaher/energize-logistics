const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());

const ctrl = require('../controllers/customerRegistryController');
const authenticate = require('../middleware/auth');

// The customer registry is read from shipment orders, operations and sales alike; one screen in three places, so one read.
// Writes go through here too. Shipment-order endpoints are guarded by their own section, so opening the registry from operations returned 403 on the first edit: the page opened and the button failed (see page-api-map-subscreens). The same endpoints are re-exposed here with role guard only and executed by the same shipment-order controllers: one registry, not two.
const so = require('../controllers/shipmentOrdersController');
const authorize = require('../middleware/rbac');
// The sales manager edits. The registry is also opened from sales (three entry points to one registry) and the agreed customer price is sales work first, so the sales manager adds and edits like the operations manager; the rep reads but does not write, delete (customer deactivation) stays with the admin list, and price tiers are guarded in the controller. Reps edit customer data too, but prices are guarded in the controller for the operations manager and system admin only (customerRoutes.canEditPrices).
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'sales_manager', 'sales_rep',
  'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup', ...require('../config/roles').DATA_ROLES];
// Removing only hides the customer and adding the name again restores it, so the team can do it.
const REMOVE_ROLES = EDIT_ROLES.filter((r) => r !== 'sales_rep');

router.use(authenticate);
// Whoever is granted edit on shipment orders writes here as there. The screen shows edit buttons to users granted the section from the matrix (`canEditCustomers`) and this route has no section guard, so nothing was stamped and saves returned 403. The grant is stamped here; it grants and never restricts (see stampSection).
router.use(require('../middleware/sectionGate').stampSection('Shipment Orders'));
router.get('/', ctrl.list);
// Option lists (cities and form fields), read by the edit dialog in both sections.
router.get('/options', so.listFields);
// The list with its full routes; read by the price export and the edit dialog.
router.get('/full', so.listCustomers);
router.post('/', authorize(...EDIT_ROLES), so.createCustomer);
router.get('/:id', ctrl.profile);
// Value lists for the Excel-style filters on the customer file's trips table.
router.get('/:id/trip-filters', ctrl.tripFilterOptions);
router.put('/:id', authorize(...EDIT_ROLES), so.updateCustomer);
// Price tiers by vehicle count. Guarded in the controller: operations manager and system admin only.
router.put('/:id/route-tiers', ctrl.setRouteTiers);
router.delete('/:id', authorize(...REMOVE_ROLES), so.deleteCustomer);

module.exports = router;
