const express = require('express');
const router = express.Router();
const b2cController = require('../controllers/b2cController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// PUBLIC webhook for Google Apps Script — no JWT auth (Apps Script can't carry one).
// Authentication is via the shared `secret` in the body or `X-Sync-Secret` header.
// This MUST be declared BEFORE router.use(authenticate) so it bypasses auth.
router.post('/google-sheet/webhook', b2cController.googleSheetWebhook);

router.use(authenticate);

// Roles allowed to read B2C data
const READ = ['super_admin', 'admin', 'b2c_head', 'b2c_project_manager'];
// Roles allowed to write B2C data (per requirement: project managers see/do same as head for now)
const WRITE = ['super_admin', 'admin', 'b2c_head', 'b2c_project_manager'];
// Only super_admin / b2c_head can manage projects (configuration)
const ADMIN_WRITE = ['super_admin', 'admin', 'b2c_head'];

// Projects
router.get('/projects', authorize(...READ), b2cController.getProjects);
router.post('/projects', authorize(...ADMIN_WRITE), b2cController.createProject);
router.put('/projects/:id', authorize(...ADMIN_WRITE), b2cController.updateProject);
router.delete('/projects/:id', authorize(...ADMIN_WRITE), b2cController.deleteProject);

// Reps
router.get('/reps', authorize(...READ), b2cController.getReps);
router.post('/reps', authorize(...WRITE), b2cController.createRep);
router.post('/reps/bulk-resolve', authorize(...WRITE), b2cController.bulkResolveReps);
router.put('/reps/:id', authorize(...WRITE), b2cController.updateRep);
router.delete('/reps/:id', authorize(...WRITE), b2cController.deleteRep);

// Daily orders
router.get('/daily-orders', authorize(...READ), b2cController.getDailyOrders);
router.post('/daily-orders', authorize(...WRITE), b2cController.upsertDailyOrder);
router.post('/daily-orders/bulk', authorize(...WRITE), b2cController.bulkUpsertDailyOrders);
router.delete('/daily-orders/:id', authorize(...WRITE), b2cController.deleteDailyOrder);

// Dashboard / analytics
router.get('/dashboard', authorize(...READ), b2cController.getDashboardSummary);
router.get('/months', authorize(...READ), b2cController.getMonthsAvailable);
router.get('/reps/:id/profile', authorize(...READ), b2cController.getRepProfile);
router.get('/evaluations', authorize(...READ), b2cController.getRepEvaluations);
router.get('/day-details', authorize(...READ), b2cController.getDayDetails);
router.get('/uploads', authorize(...READ), b2cController.getUploadHistory);

// Cleanup — destructive; only super_admin and b2c_head can wipe data
router.post('/cleanup', authorize('super_admin', 'admin', 'b2c_head'), b2cController.cleanupB2CData);

// Google Sheet sync configuration + manual trigger
router.get('/google-sheet/config', authorize(...READ), b2cController.getSheetConfig);
router.put('/google-sheet/config', authorize('super_admin', 'admin', 'b2c_head'), b2cController.updateSheetConfig);
router.post('/google-sheet/sync-now', authorize('super_admin', 'admin', 'b2c_head'), b2cController.syncSheetNow);
router.get('/google-sheet/setup-script', authorize('super_admin', 'admin', 'b2c_head'), b2cController.getSheetSetupScript);

module.exports = router;
