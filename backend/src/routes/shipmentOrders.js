const express = require('express');
const router = express.Router();
const so = require('../controllers/shipmentOrdersController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// The shipment-orders trial section. Independent of /api/ops by design — see
// the ShipmentOrder model header.
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations', 'moderator'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];

router.use(authenticate);

// Orders
router.get('/orders', so.listOrders);
router.post('/orders', authorize(...EDIT_ROLES), so.createOrder);
router.put('/orders/:id', authorize(...EDIT_ROLES), so.updateOrder);
router.patch('/orders/:id/status', authorize(...EDIT_ROLES), so.patchStatus); // inline from the list
router.delete('/orders/:id', authorize(...ADMIN_ROLES), so.deleteOrder);

// Customers (their price-per-route lists feed the create form)
router.get('/customers', so.listCustomers);
router.post('/customers', authorize(...EDIT_ROLES), so.createCustomer);
router.put('/customers/:id', authorize(...EDIT_ROLES), so.updateCustomer);
router.delete('/customers/:id', authorize(...ADMIN_ROLES), so.deleteCustomer);

// Suppliers & vehicles — the fleet register the create form reads and feeds.
router.get('/suppliers', so.listSuppliers);
router.post('/suppliers', authorize(...EDIT_ROLES), so.createSupplier);
router.put('/suppliers/:id', authorize(...EDIT_ROLES), so.updateSupplier);
router.delete('/suppliers/:id', authorize(...ADMIN_ROLES), so.deleteSupplier);
router.get('/vehicles', so.listVehicles);
router.post('/vehicles', authorize(...EDIT_ROLES), so.createVehicle);
router.put('/vehicles/:id', authorize(...EDIT_ROLES), so.updateVehicle);
router.delete('/vehicles/:id', authorize(...ADMIN_ROLES), so.deleteVehicle);

// Form fields (the settings page). Changing the form is an admin act.
router.get('/fields', so.listFields);
router.post('/fields', authorize(...ADMIN_ROLES), so.createField);
router.put('/fields/:id', authorize(...ADMIN_ROLES), so.updateField);
router.delete('/fields/:id', authorize(...ADMIN_ROLES), so.deleteField);

module.exports = router;
