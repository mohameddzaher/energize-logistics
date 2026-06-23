const express = require('express');
const router = express.Router();
const vehicle = require('../controllers/vehicleController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// Vehicles & Authorizations (المركبات والتفاويض) — shared by super admin, HR and
// Accounting. Delete operations are further restricted to the admin tier inside
// the controller.
const STAFF = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];

router.use(authenticate);
router.use(authorize(...STAFF));

// ── Static collection routes (must precede the /:id param routes) ─────────────
router.get('/dashboard', vehicle.getDashboard);
router.get('/employees', vehicle.searchEmployees);
router.get('/authorizations', vehicle.listAuthorizations);
router.get('/accidents', vehicle.listAccidents);
router.get('/by-employee/:employeeId', vehicle.getEmployeeHistory);

router.put('/authorizations/:authId', vehicle.updateAuthorization);
router.delete('/authorizations/:authId', vehicle.deleteAuthorization);
router.put('/accidents/:accId', vehicle.updateAccident);
router.delete('/accidents/:accId', vehicle.deleteAccident);

// ── Vehicles CRUD ─────────────────────────────────────────────────────────────
router.get('/', vehicle.listVehicles);
router.post('/', vehicle.createVehicle);
router.get('/:id', vehicle.getVehicle);
router.put('/:id', vehicle.updateVehicle);
router.delete('/:id', vehicle.deleteVehicle);

// ── Authorization lifecycle (per vehicle) ─────────────────────────────────────
router.post('/:id/authorize', vehicle.authorizeVehicle);
router.post('/:id/transfer', vehicle.transferVehicle);
router.post('/:id/revoke', vehicle.revokeVehicle);

// ── Accidents (per vehicle) ───────────────────────────────────────────────────
router.post('/:id/accidents', vehicle.createAccident);

module.exports = router;
