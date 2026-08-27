const express = require('express');
const router = express.Router();
const fleet = require('../controllers/fleetController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// إدارة الأسطول — our own trucks. fleet_manager runs the section;
// fleet_supervisor works his ASSIGNED trucks only (scoped in the controller).
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'fleet_manager', 'fleet_supervisor'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager', 'fleet_manager'];

router.use(authenticate);

// اللوحة الرئيسية — every truck as a card, grouped by supervisor, with the
// automatic late/arrived/moving state and the maintenance flags.
router.get('/board', fleet.getBoard);
// Assignment: who the supervisors are, and moving a truck between them.
router.get('/supervisors', fleet.listSupervisors);
router.patch('/vehicles/:id/supervisor', authorize(...ADMIN_ROLES), fleet.assignVehicleSupervisor);
router.post('/vehicles/assign-supervisor-bulk', authorize(...ADMIN_ROLES), fleet.assignVehicleSupervisorBulk);

// Shipments (الحمولات)
router.get('/shipments', fleet.listShipments);
router.post('/shipments', authorize(...EDIT_ROLES), fleet.createShipment);
router.get('/shipments/:id/waybill.pdf', fleet.getWaybillPdf); // البوليصة PDF — نفس ملف الويب
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

// المتوقع للوصول + السيارات الفاضية — الجدولان يخرجان من نداءٍ واحد لأنهما
// وجهان لقرارٍ واحد: ما الذي يصل، وبأيّ سيارةٍ نغطّي ما لم يصل.
router.get('/arrivals', fleet.getArrivals);
// تحليل الحمولات عبر فترة — بمصروف كل حمولة ومجموع مصروف كل سائق.
router.get('/loads-analysis', fleet.getLoadsAnalysis);

// Vehicles
router.get('/vehicles', fleet.listVehicles);
// تحليل سيارةٍ بعينها عبر فترة — محصورٌ بمشرفها (يُتحقَّق داخل المتحكّم).
router.get('/vehicles/:id/analytics', fleet.getVehicleAnalytics);
router.post('/vehicles', authorize(...EDIT_ROLES), fleet.createVehicle);
router.put('/vehicles/:id', authorize(...EDIT_ROLES), fleet.updateVehicle);
router.delete('/vehicles/:id', authorize(...ADMIN_ROLES), fleet.deleteVehicle);

// Customers
router.get('/customers', fleet.listCustomers);
router.get('/customers/filters', fleet.customerFilterOptions);
router.get('/customers/:id/profile', fleet.getCustomerProfile); // العميل + سجل رحلاته الكامل
router.post('/customers', authorize(...EDIT_ROLES), fleet.createCustomer);
router.put('/customers/:id', authorize(...EDIT_ROLES), fleet.updateCustomer);
router.delete('/customers/:id', authorize(...ADMIN_ROLES), fleet.deleteCustomer);
router.post('/customers/:id/restore', authorize(...ADMIN_ROLES), fleet.restoreCustomer);

// Dashboard + rich analytics
router.get('/dashboard', fleet.getDashboard);
router.get('/analytics', fleet.getAnalytics);
// تقييم أداء السائقين — the business-side driver scorecard (loads, income,
// on-time arrival, follow-up discipline). Telemetry-side scoring lives in
// /api/ls2/drivers/performance.
router.get('/driver-kpis', fleet.getDriverKpis); // ?from&to | ?month=YYYY-MM

// Section settings (Friday bonus amount, default monthly target)
router.get('/config', fleet.getConfig);
router.put('/config', authorize(...ADMIN_ROLES), fleet.updateConfig);

module.exports = router;
