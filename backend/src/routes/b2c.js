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

// Project managers currently have the same access as heads.
const READ = ['super_admin', 'admin', 'b2c_head', 'b2c_project_manager'];
const WRITE = ['super_admin', 'admin', 'b2c_head', 'b2c_project_manager'];
const ADMIN_WRITE = ['super_admin', 'admin', 'b2c_head', 'b2c_project_manager'];

// Projects
router.get('/projects', authorize(...READ), b2cController.getProjects);
router.post('/projects', authorize(...ADMIN_WRITE), b2cController.createProject);
router.put('/projects/:id', authorize(...ADMIN_WRITE), b2cController.updateProject);
router.delete('/projects/:id', authorize(...ADMIN_WRITE), b2cController.deleteProject);

// Reps
router.get('/reps', authorize(...READ), b2cController.getReps);
router.post('/reps', authorize(...WRITE), b2cController.createRep);
router.post('/reps/bulk-resolve', authorize(...WRITE), b2cController.bulkResolveReps);
router.post('/reps/reconcile', authorize(...ADMIN_WRITE), b2cController.reconcileReps);
router.get('/reps/diagnose', authorize(...READ), b2cController.diagnoseReps);
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
router.post('/cleanup', authorize(...ADMIN_WRITE), b2cController.cleanupB2CData);

// Google Sheet sync — list, CRUD, per-config sync trigger and setup script.
router.get('/google-sheet/configs', authorize(...READ), b2cController.getSheetConfigs);
router.post('/google-sheet/configs', authorize(...ADMIN_WRITE), b2cController.createSheetConfig);
router.put('/google-sheet/configs/:id', authorize(...ADMIN_WRITE), b2cController.updateSheetConfig);
router.delete('/google-sheet/configs/:id', authorize(...ADMIN_WRITE), b2cController.deleteSheetConfig);
router.post('/google-sheet/configs/:id/sync-now', authorize(...ADMIN_WRITE), b2cController.syncSheetNow);
router.get('/google-sheet/configs/:id/setup-script', authorize(...ADMIN_WRITE), b2cController.getSheetSetupScript);

module.exports = router;
