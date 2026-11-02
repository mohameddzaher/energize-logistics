const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const fleet = require('../controllers/fleetController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// Fleet management: our own trucks. fleet_manager runs the section; fleet_supervisor works only his assigned trucks (scoped in the controller).
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'];

router.use(authenticate);

// Main board: every truck as a card, grouped by supervisor, with the automatic late/arrived/moving state and the maintenance flags.
router.get('/board', fleet.getBoard);
// Assignment: who the supervisors are, and moving a truck between them.
router.get('/supervisors', fleet.listSupervisors);
router.patch('/vehicles/:id/supervisor', authorize(...ADMIN_ROLES), fleet.assignVehicleSupervisor);
router.post('/vehicles/assign-supervisor-bulk', authorize(...ADMIN_ROLES), fleet.assignVehicleSupervisorBulk);
// The truck's two seats: first and second driver in one call. The supervisor assigns them from the truck row, not the drivers page, since his question is who is on this truck.
router.patch('/vehicles/:id/drivers', authorize(...EDIT_ROLES), fleet.setVehicleDrivers);

// Maintenance requests: fleet asks and Location Solutions decides. The decision is not here because whoever owns maintenance authorizes its postponement; see routes/ls2.
const fleetRequests = require('../controllers/fleetRequestController');
router.get('/requests', fleetRequests.list);
router.post('/requests', authorize(...EDIT_ROLES), fleetRequests.create);

// Shipments (loads)
router.get('/shipments', fleet.listShipments);
router.post('/shipments', authorize(...EDIT_ROLES), fleet.createShipment);
router.get('/shipments/:id/waybill.pdf', fleet.getWaybillPdf); // Waybill PDF, same file as the web.
// Waybills for several shipments in one file, instead of rendering each in the browser.
router.post('/shipments/waybills.pdf', fleet.getWaybillsPdf);
router.get('/shipments/:id', fleet.getShipment); // details + the full event log
router.put('/shipments/:id', authorize(...EDIT_ROLES), fleet.updateShipment);
router.patch('/shipments/:id/status', authorize(...EDIT_ROLES), fleet.patchStatus);
router.post('/shipments/:id/followups', authorize(...EDIT_ROLES), fleet.addFollowUp);
router.delete('/shipments/:id', authorize(...ADMIN_ROLES), fleet.deleteShipment);

// Drivers — assignment changes route through the two-seat rule in the controller
router.get('/drivers', fleet.listDrivers);
// "Link to employee": HR candidates for the driver, and linking or unlinking his file.
router.get('/drivers/hr-candidates', authorize(...EDIT_ROLES), fleet.driverHrCandidates);
router.patch('/drivers/:id/employee', authorize(...EDIT_ROLES), fleet.setDriverEmployee);
router.post('/drivers', authorize(...EDIT_ROLES), fleet.createDriver);
router.put('/drivers/:id', authorize(...EDIT_ROLES), fleet.updateDriver);
router.delete('/drivers/:id', authorize(...ADMIN_ROLES), fleet.deleteDriver);

// Expected arrivals and empty trucks come from one call because they are two faces of one decision: what is arriving, and which truck covers what did not.
router.get('/arrivals', fleet.getArrivals);
// Load analysis over a period, with each load's expenses and each driver's expense total.
router.get('/loads-analysis', fleet.getLoadsAnalysis);

// Vehicles.
// Vehicle status: live figures of our trucks in their section (tyres and their temperature, coolant temperature, maintenance, alerts), read from `Ls2Vehicle` itself: one source, no copy.
router.get('/health', fleet.getFleetHealth);
// Driver expenses. Reading is for anyone who opens the section; marking paid is a financial act, limited to accounts and administration. The fleet supervisor sees what is due but does not decide it was paid.
const EXPENSE_PAY_ROLES = ['super_admin', 'admin', 'it_manager', 'cfo', 'accounting_manager', 'accountant', 'fleet_manager', 'operations_manager'];
router.get('/driver-expenses', fleet.getDriverExpenses);
// strict: the section 'edit' a supervisor holds is not the right to mark money paid.
router.patch('/driver-expenses/paid', authorize.strict(...EXPENSE_PAY_ROLES), fleet.setDriverExpensePaid);

router.get('/vehicles', fleet.listVehicles);
// Analysis of one truck over a period, limited to its supervisor (checked in the controller).
router.get('/vehicles/:id/analytics', fleet.getVehicleAnalytics);
router.post('/vehicles', authorize(...EDIT_ROLES), fleet.createVehicle);
router.put('/vehicles/:id', authorize(...EDIT_ROLES), fleet.updateVehicle);
router.delete('/vehicles/:id', authorize(...ADMIN_ROLES), fleet.deleteVehicle);

// Customers
router.get('/customers', fleet.listCustomers);
router.get('/customers/filters', fleet.customerFilterOptions);
router.get('/customers/:id/profile', fleet.getCustomerProfile); // Customer and his full trip history.
router.post('/customers', authorize(...EDIT_ROLES), fleet.createCustomer);
router.put('/customers/:id', authorize(...EDIT_ROLES), fleet.updateCustomer);
router.delete('/customers/:id', authorize(...ADMIN_ROLES), fleet.deleteCustomer);
router.post('/customers/:id/restore', authorize(...ADMIN_ROLES), fleet.restoreCustomer);

// Dashboard + rich analytics
router.get('/dashboard', fleet.getDashboard);
router.get('/analytics', fleet.getAnalytics);
// Driver performance rating: the business-side driver scorecard (loads, income, on-time arrival, follow-up discipline). Telemetry-side scoring lives in /api/ls2/drivers/performance.
router.get('/driver-kpis', fleet.getDriverKpis); // ?from&to | ?month=YYYY-MM

// Section settings (Friday bonus amount, default monthly target).
// Vehicle logs: a vehicle's monthly log covers its whole month, not one shipment. The static route comes before the parameterized one, or `/:id` would swallow it.
router.get('/vehicle-logs/summary', fleet.getVehicleLogsSummary);
router.get('/vehicle-logs', fleet.getVehicleLog);
router.post('/vehicle-logs', authorize(...EDIT_ROLES), fleet.createVehicleLog);
router.put('/vehicle-logs/:id', authorize(...EDIT_ROLES), fleet.updateVehicleLog);
router.delete('/vehicle-logs/:id', authorize(...EDIT_ROLES), fleet.deleteVehicleLog);


router.get('/config', fleet.getConfig);
router.put('/config', authorize(...ADMIN_ROLES), fleet.updateConfig);

module.exports = router;
