const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const so = require('../controllers/shipmentOrdersController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// The shipment-orders trial section. Independent of /api/ops by design — see
// the ShipmentOrder model header.
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator',
  // The section's own team; it used to edit through the section grant alone, now explicit and includes the follow-up role.
  'shipment_orders_manager', 'shipment_orders_staff', 'shipment_orders_followup',
  // The data team creates and corrects shipments too.
  ...require('../config/roles').DATA_ROLES,
  // Sales and the vendors team work the section too, each on its own half (controller: ownedFields).
  ...require('../config/priceView').SALES_ROLES, ...require('../config/priceView').VENDOR_ROLES];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];

router.use(authenticate);

// Orders
router.get('/orders', so.listOrders);
// Column values with counts, for Excel-style column filters over a table paginated on the server.
router.get('/orders/filter-options', so.orderFilterOptions);
router.get('/orders/:id', so.getOrder); // the edit form loads ONE order directly
// Waybills of several orders in one file. Registered before `/orders/:id` so the parameterized route does not swallow it.
router.post('/orders/waybills.pdf', so.getWaybillsPdf);
router.post('/orders', authorize(...EDIT_ROLES), so.createOrder);
// One load split over several trucks; each truck is an independent order with its own waybill number. Registered before `/orders/:id` so the parameterized route does not swallow it.
router.post('/orders/batch', authorize(...EDIT_ROLES), so.createOrdersBatch);
router.get('/money-editors', so.moneyEditors);
router.put('/orders/:id', authorize(...EDIT_ROLES), so.updateOrder);
router.patch('/orders/:id/status', authorize(...EDIT_ROLES), so.patchStatus); // inline from the list
router.post('/orders/:id/note', authorize(...EDIT_ROLES), so.addNote); // Follow-up note without a status change.
router.put('/orders/:id/note/:logId', authorize(...EDIT_ROLES), so.editNote); // Its author or the section manager.
router.delete('/orders/:id/note/:logId', authorize(...EDIT_ROLES), so.deleteNote);
const { BRANCH_PAGE_EDITORS } = require('../config/shipmentBranchRoles');
router.get('/branch-access', authorize.strict(...BRANCH_PAGE_EDITORS), so.getBranchAccess);
router.put('/branch-access/:id', authorize.strict(...BRANCH_PAGE_EDITORS), so.setBranchAccess);
router.delete('/orders/:id', authorize.strict(...require('../services/shipmentOrderWorkflowLink').SHIPMENT_DELETE_ROLES), so.deleteOrder);

// Customers (their price-per-route lists feed the create form).
// Section analytics, before `/orders/:id` so the parameterized route does not swallow it.
// Section dashboard: one call for browser and phone, same analytics computation.
router.get('/dashboard', so.getDashboard);
router.get('/analytics', so.getAnalytics);
// The section's analytics page: one computation under every filter (controllers/shipmentInsightsController).
const insights = require('../controllers/shipmentInsightsController');
router.get('/insights', insights.insights);
router.get('/insights/options', insights.options);
// Sales and operations team, for the operational sales field.
router.get('/sales-reps', so.salesReps);
// Vendors and operations team, for the sourcing field (who found the carrier).
router.get('/sourcing-reps', so.sourcingReps);
// The operations manager's dashboard is also read here. It is the same one read in the private operations page: one computation and one endpoint (controllers/opsAnalyticsController), so no number differs between the two screens.
const opsAn = require('../controllers/opsAnalyticsController');
// The branch report carries revenue and profit together, so it is for readers who see both sides of the price.
const bothSides = (req, res, next) => {
  const v = require('../config/priceView').priceView(req.user);
  return v.sell && v.buy ? next() : res.status(403).json({ message: 'تقريرُ الفروع يجمع البيعَ والشراء — خارج صلاحيّتك', code: 'PRICE_SIDE' });
};
router.get('/ops-analytics', bothSides, opsAn.analytics);
router.get('/ops-analytics/filters', bothSides, opsAn.filters);
router.get('/ops-analytics/targets', opsAn.getTargets);
router.put('/ops-analytics/targets', authorize(...EDIT_ROLES), opsAn.setTargets);

// Waybill counter: readable by all, prioritized for whoever owns the section.
// Status vocabulary: readable by all, configured from the settings page via /api/lookups.
router.get('/statuses', so.listStatuses);
router.get('/counter', so.getCounter);
router.put('/counter', authorize(...ADMIN_ROLES), so.updateCounter);

router.get('/customers', so.listCustomers);
router.post('/customers', authorize(...EDIT_ROLES), so.createCustomer);
router.put('/customers/:id', authorize(...EDIT_ROLES), so.updateCustomer);
router.delete('/customers/:id', authorize(...ADMIN_ROLES), so.deleteCustomer);

// Suppliers & vehicles — the fleet register the create form reads and feeds.
router.get('/suppliers', so.listSuppliers);
router.post('/suppliers', authorize(...EDIT_ROLES), so.createSupplier);
router.put('/suppliers/:id', authorize(...EDIT_ROLES), so.updateSupplier);
router.delete('/suppliers/:id', authorize(...ADMIN_ROLES), so.deleteSupplier);
router.post('/suppliers/:id/merge', authorize.strict(...ADMIN_ROLES, 'shipment_orders_manager'), so.mergeSupplier); // Merging two vendors: by role only (strict), since it cannot be undone.
router.get('/vehicles', so.listVehicles);
// Full register counts; the header does not compute from the page received.
router.get('/fleet-summary', so.fleetSummary);
router.post('/vehicles', authorize(...EDIT_ROLES), so.createVehicle);
router.put('/vehicles/:id', authorize(...EDIT_ROLES), so.updateVehicle);
router.delete('/vehicles/:id', authorize(...ADMIN_ROLES), so.deleteVehicle);

// Drivers of the carriers' trucks, each with a file (iqama, operating card, sponsor), vendor and truck. Imported from the operations platform and corrected here.
router.get('/drivers', so.listDrivers);
router.post('/drivers', authorize(...EDIT_ROLES), so.createDriver);
router.put('/drivers/:id', authorize(...EDIT_ROLES), so.updateDriver);
router.delete('/drivers/:id', authorize(...ADMIN_ROLES), so.deleteDriver);

// Form fields (the settings page). Changing the form is an admin act.
router.get('/fields', so.listFields);
router.post('/fields', authorize(...ADMIN_ROLES), so.createField);
router.put('/fields/:id', authorize(...ADMIN_ROLES), so.updateField);
router.delete('/fields/:id', authorize(...ADMIN_ROLES), so.deleteField);
/**
 * Adding an option to an existing list is not a change to the model.
 * The function existed in the controller without a route, and the shipment form calls it from the add button under the lists, so the call returned 404 and the employee saw an add-failed message, and a new truck length was never saved.
 * Its permission is operations, not management: changing the form's shape (adding or removing a field) is an administrative decision, but 'a truck arrived with a length we have not recorded' is a daily fact for whoever books the load, and waiting for a manager would stop work.
 */
router.post('/fields/:id/options', authorize(...EDIT_ROLES), so.addFieldOption);

module.exports = router;
