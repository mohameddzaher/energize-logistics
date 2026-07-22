const express = require('express');
const router = express.Router();
const fleet = require('../controllers/fleetController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// إدارة الأسطول — our own trucks. Same role set as the shipment-orders trial.
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations', 'moderator'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];

router.use(authenticate);

// Shipments (الحمولات)
router.get('/shipments', fleet.listShipments);
router.post('/shipments', authorize(...EDIT_ROLES), fleet.createShipment);
router.get('/shipments/:id', fleet.getShipment); // details + the full event log
router.put('/shipments/:id', authorize(...EDIT_ROLES), fleet.updateShipment);
router.patch('/shipments/:id/status', authorize(...EDIT_ROLES), fleet.patchStatus);
router.post('/shipments/:id/followups', authorize(...EDIT_ROLES), fleet.addFollowUp);
router.delete('/shipments/:id', authorize(...ADMIN_ROLES), fleet.deleteShipment);

// Drivers — assignment changes route through the two-seat rule in the controller
router.get('/drivers', fleet.listDrivers);
router.post('/drivers', authorize(...EDIT_ROLES), fleet.createDriver);
router.put('/drivers/:id', authorize(...EDIT_ROLES), fleet.updateDriver);
router.delete('/drivers/:id', authorize(...ADMIN_ROLES), fleet.deleteDriver);

// Vehicles
router.get('/vehicles', fleet.listVehicles);
router.post('/vehicles', authorize(...EDIT_ROLES), fleet.createVehicle);
router.put('/vehicles/:id', authorize(...EDIT_ROLES), fleet.updateVehicle);
router.delete('/vehicles/:id', authorize(...ADMIN_ROLES), fleet.deleteVehicle);

// Customers
router.get('/customers', fleet.listCustomers);
router.post('/customers', authorize(...EDIT_ROLES), fleet.createCustomer);
router.put('/customers/:id', authorize(...EDIT_ROLES), fleet.updateCustomer);
router.delete('/customers/:id', authorize(...ADMIN_ROLES), fleet.deleteCustomer);

// Dashboard
router.get('/dashboard', fleet.getDashboard);

module.exports = router;
