const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const taskController = require('../controllers/taskController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

// ─── TASK MANAGEMENT ─────────────────────────────────────────

// Create tasks (batch) — Managers only
router.post(
  '/',
  authorize('super_admin', 'admin'),
  [
    body('tasks').isArray({ min: 1 }).withMessage('Tasks array is required'),
    body('tasks.*.assignedTo').isMongoId().withMessage('Valid collector ID required'),
    body('tasks.*.customer').isMongoId().withMessage('Valid customer ID required'),
    body('tasks.*.contactMethod').isIn(['call', 'whatsapp', 'visit', 'email', 'message']).withMessage('Valid contact method required'),
    body('tasks.*.dueDate').optional({ values: 'falsy' }),
  ],
  validate,
  taskController.createTasks
);

// Get all tasks (with filters) — Managers see all, employees see own
router.get('/', taskController.getTasks);

// Get my tasks (collector) — Any authenticated user
router.get('/my-tasks', taskController.getMyTasks);

// Get task stats (manager dashboard)
router.get('/stats', authorize('super_admin', 'admin'), taskController.getTaskStats);

// Get collector task stats (profile)
router.get('/collector-stats/:collectorId', taskController.getCollectorTaskStats);

// Follow-up tasks
router.get('/follow-ups', taskController.getFollowUpTasks);

// Low visit customers (dashboard widget)
router.get('/low-visit-customers', authorize('super_admin', 'admin', 'employee'), taskController.getLowVisitCustomers);

// Update task (status + edit fields)
router.put(
  '/:id',
  [
    body('status').optional().isIn(['pending', 'done', 'cancelled', 'postponed']),
    body('collectedAmount').optional().isFloat({ min: 0 }),
    body('actionNotes').optional().trim(),
    body('nextFollowUpDate').optional(),
    body('contactMethod').optional().isIn(['call', 'whatsapp', 'visit', 'email', 'message']),
    body('dueDate').optional(),
    body('assignedTo').optional().isMongoId(),
    body('customer').optional().isMongoId(),
  ],
  validate,
  taskController.updateTaskStatus
);

// Delete task — Managers only
router.delete('/:id', authorize('super_admin', 'admin'), taskController.deleteTask);

// ─── SUGGESTIONS ─────────────────────────────────────────────

// Generate suggestions — Managers only
router.post('/suggestions/generate', authorize('super_admin', 'admin'), taskController.generateSuggestions);

// Get suggestions — Managers only
router.get('/suggestions', authorize('super_admin', 'admin'), taskController.getSuggestions);

// Approve suggestion → Create task — Managers only
router.post(
  '/suggestions/:id/approve',
  authorize('super_admin', 'admin'),
  [
    body('contactMethod').optional().isIn(['call', 'whatsapp', 'visit', 'email', 'message']),
    body('dueDate').optional(),
  ],
  validate,
  taskController.approveSuggestion
);

// Dismiss suggestion — Managers only
router.put('/suggestions/:id/dismiss', authorize('super_admin', 'admin'), taskController.dismissSuggestion);

module.exports = router;
