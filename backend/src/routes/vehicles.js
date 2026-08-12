const express = require('express');
const router = express.Router();
const vehicle = require('../controllers/vehicleController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// Vehicles & Authorizations (المركبات والتفاويض) — shared by super admin, HR and
// Accounting. Delete operations are further restricted to the admin tier inside
// the controller.
// أدوار القسم نفسه لازم تكون هنا — من غيرها مدير المركبات بيشوف التفاويض
// ومش قادر يعمل فيها حاجة، وهو صاحب القسم.
const STAFF = ['super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];

router.use(authenticate);

// An employee may read THEIR OWN authorizations/accidents history — it feeds
// the Vehicles tab of their own profile, which the HR router explicitly lets
// them open. Declared before the section-wide staff wall; everything else
// stays staff-only.
router.get('/by-employee/:employeeId', async (req, res, next) => {
  if (STAFF.includes(req.user.role)) return next();
  try {
    const Employee = require('../models/Employee');
    const emp = await Employee.findById(req.params.employeeId).select('user').lean();
    if (emp && emp.user && String(emp.user) === String(req.user._id)) return next();
  } catch (e) { /* invalid id → fall through to 403 */ }
  return res.status(403).json({ message: 'Insufficient permissions' });
}, vehicle.getEmployeeHistory);

router.use(authorize(...STAFF));

// ── Static collection routes (must precede the /:id param routes) ─────────────
router.get('/dashboard', vehicle.getDashboard);
router.get('/employees', vehicle.searchEmployees);
router.get('/authorizations', vehicle.listAuthorizations);
router.get('/accidents', vehicle.listAccidents);

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
