const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const workflowController = require('../controllers/workflowController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const validate = require('../middleware/validate');

router.use(authenticate);

// All workflow-related roles
const allWorkflowRoles = ['super_admin', 'admin', 'employee', 'operations_manager', 'operations', 'moderator'];

// List & export
router.get('/export', authorize(...allWorkflowRoles), workflowController.exportWorkflows);
router.get('/permissions', authorize(...allWorkflowRoles), workflowController.getFieldPermissions);
router.get('/', authorize(...allWorkflowRoles), workflowController.getWorkflows);

// Bulk delete
router.post('/bulk-delete', authorize('super_admin'), workflowController.bulkDelete);

// Bulk import (must be before /:id routes)
router.post(
  '/bulk-import',
  authorize('super_admin', 'moderator'),
  [body('rows').isArray({ min: 1 }).withMessage('rows must be a non-empty array')],
  validate,
  workflowController.bulkImport
);

// Pending invoices by customer (must be before /:id)
router.get('/pending-by-customer/:customerId', authorize(...allWorkflowRoles), workflowController.getPendingByCustomer);

router.get('/:id', authorize(...allWorkflowRoles), workflowController.getWorkflow);

// Create (all workflow roles — field-level permissions handled in controller)
router.post(
  '/',
  authorize(...allWorkflowRoles),
  [
    body('customerName').optional().trim(),
    body('serviceType').optional().trim(),
  ],
  validate,
  workflowController.createWorkflow
);

// Update (field-level permissions handled in controller)
router.put('/:id', authorize(...allWorkflowRoles), workflowController.updateWorkflow);

// Stage transitions
router.put(
  '/:id/stage',
  authorize(...allWorkflowRoles),
  [body('stage').isIn(['draft', 'submitted_to_ops', 'ops_completed', 'submitted_to_collections', 'completed'])],
  validate,
  workflowController.updateStage
);

// Row locking
router.post('/:id/lock', authorize(...allWorkflowRoles), workflowController.lockWorkflow);
router.post('/:id/unlock', authorize(...allWorkflowRoles), workflowController.unlockWorkflow);

// Delete (super_admin only)
router.delete('/:id', authorize('super_admin'), workflowController.deleteWorkflow);

module.exports = router;
