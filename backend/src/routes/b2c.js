const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const b2cController = require('../controllers/b2cController');
const duty = require('../controllers/b2cDutyController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { denyRepSupervisor: noSup } = require('../middleware/b2cGuards');

router.use(authenticate);

// Project managers currently have the same access as heads.
const READ = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'];
// Rep supervisor: the two check screens only, over his own reps (decided by the controller). The check screens are for both supervisor kinds: the operational one sees them, and for the check supervisor they are his whole job.
const DUTY = [...READ, 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];
const WRITE = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'];
const ADMIN_WRITE = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'b2c_manager', 'b2c_team_leader', 'b2c_deputy', 'b2c_project_lead'];

// Projects
router.get('/projects', authorize(...READ), b2cController.getProjects);
router.post('/projects', noSup, authorize(...ADMIN_WRITE), b2cController.createProject);
router.put('/projects/:id', noSup, authorize(...ADMIN_WRITE), b2cController.updateProject);
router.delete('/projects/:id', noSup, authorize(...ADMIN_WRITE), b2cController.deleteProject);

// Reps
router.get('/reps', authorize(...READ), b2cController.getReps);
router.post('/reps', noSup, authorize(...WRITE), b2cController.createRep);
router.get('/reps/diagnose', authorize(...READ), b2cController.diagnoseReps);
router.get('/system-diagnostic', authorize(...READ), b2cController.getSystemDiagnostic);
router.put('/reps/:id', noSup, authorize(...WRITE), b2cController.updateRep);
router.delete('/reps/:id', noSup, authorize(...WRITE), b2cController.deleteRep);

// Start-of-shift check. The guard only opens the screen; who sees and writes which rep is decided in the controller from `B2CRep.supervisor`, not the role. A project manager with no assigned reps opens the screen and sees nobody, which is correct.
router.get('/duty/my-reps', authorize(...DUTY), duty.myReps);
router.post('/duty', authorize(...DUTY), duty.submit);
// Static routes before `/:id` so 'analytics' is not read as an id.
router.get('/duty/analytics', authorize(...DUTY), duty.analytics);
router.get('/duty/missing', authorize(...DUTY), duty.missing);
router.get('/duty/supervisors', authorize(...DUTY), duty.supervisors);
router.post('/duty/assign', noSup, authorize(...WRITE), duty.assign);
router.get('/duty', authorize(...DUTY), duty.list);
router.get('/duty/:id', authorize(...DUTY), duty.getOne);
router.patch('/duty/:id/review', authorize(...READ), duty.review);

// Daily orders: read only. Writing happens only through order entry (/entry).
router.get('/daily-orders', authorize(...READ), b2cController.getDailyOrders);

// Order entry: orders are typed in the system, not in sheets. A project manager or supervisor sees and writes their projects; administration sees all (decided by the controller, utils/b2cEntry). See b2cEntryController.
const entry = require('../controllers/b2cEntryController');
const ENTRY = require('../utils/b2cEntry').ENTRY_ROLES;
router.get('/entry', authorize(...ENTRY), entry.list);
router.put('/entry', authorize(...ENTRY), entry.save);
router.get('/entry/managers', authorize(...ENTRY), entry.managers);
router.put('/entry/managers/:userId', authorize(...ENTRY), entry.setManagerProjects);
// Order sheets (one Google Sheet per project), read every minute. See b2cOrderSheetController.
const orderSheets = require('../controllers/b2cOrderSheetController');
router.get('/order-sheets', authorize(...ENTRY), orderSheets.list);
router.get('/order-sheets/script', authorize(...ENTRY), orderSheets.script);
// Rep order in the sheet and the section officers' email (protection editors); officers only.
router.put('/order-sheets/heads', authorize(...ENTRY), orderSheets.setHeads);
router.post('/order-sheets', authorize(...ENTRY), orderSheets.create);
router.delete('/order-sheets/:id', authorize(...ENTRY), orderSheets.remove);
router.post('/order-sheets/:id/sync', authorize(...ENTRY), orderSheets.syncNow);
// Amazon rep follow-up: attendance (only absence is written). See b2cAttendanceController.
const attendance = require('../controllers/b2cAttendanceController');
router.get('/attendance', authorize(...ENTRY), attendance.list);
router.put('/attendance', authorize(...ENTRY), attendance.save);

// Dashboard / analytics
router.get('/dashboard', authorize(...READ), b2cController.getDashboardSummary);
router.get('/months', authorize(...READ), b2cController.getMonthsAvailable);
router.get('/reps/:id/profile', authorize(...READ), b2cController.getRepProfile);
router.get('/evaluations', authorize(...READ), b2cController.getRepEvaluations);
router.get('/day-details', authorize(...READ), b2cController.getDayDetails);

// Google Sheets sync and Excel upload were removed. They wrote orders, identified the rep by sheet name and merged similar ones. A backup of the sheets is in backups/b2c-sheets-2026-10-19 on the server.

module.exports = router;
