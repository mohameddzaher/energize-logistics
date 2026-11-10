const express = require('express');
const { SHIPMENT_DELETE_ROLES } = require('../services/shipmentOrderWorkflowLink');
const { body } = require('express-validator');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('customerId', objectIdParam());
const workflowController = require('../controllers/workflowController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
// Finance roles have on this page what the system admin has; see config/financeAuthority.
const { FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const validate = require('../middleware/validate');

router.use(authenticate);
// The data-owner filter reads wallet purchases, loaded before the condition is built. See utils/dataOwnerIndex.
router.use(require('../utils/dataOwnerIndex').preload);
// An iqama number or chassis in the search maps to its owners in the registers (utils/relatedPeopleSearch).
router.use((req, res, next) => (req.method === 'GET' ? workflowController.primeRelatedSearch(req, res, next) : next()));

// All workflow-related roles. Finance/collections staff (cfo, accounting_manager, accountant) are included so they can open the operations page, see the financial columns, and tick the accounting-review checkbox.
// Collections is included: the manifest is the collections work sheet, read for what is owed to and by us, and where the invoice and collection date are written. Blocking it meant dictating numbers to another department to type. Field permission is checked inside the controller, so page access grants nothing by itself; the roles here only decide who reaches the endpoint.
// IT was outside: the sidebar shows the operations page to the IT manager and specialist but every call returned 403, a dead link. Both roles are in `FULL_ACCESS_ROLES` (no barrier elsewhere), but this route has no `sectionGate`, so the dynamic grant that opens other routes for them does not cover it.
// Sales writes the selling value only (SELLING_ROLES; a rep through approval): it reaches the update and lock endpoints, and the controller refuses every other field.
const allWorkflowRoles = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'employee', 'operations_manager', 'operations_staff',
  'moderator', 'cfo', 'accounting_manager', 'accountant',
  'collections_manager', 'collections_staff',
  // Vendors manager and team leader work the sheet like operations (purchase side only).
  ...require('../config/priceView').VENDOR_LEADS,
];
// Readers: the data team and shipment follow-up open every manifest in full
// (minus what the controller strips: selling price, invoice amounts).
// Sales and the vendors officers read it too: sales without the purchase side, vendors without the selling value (config/priceView).
const sellingWriters = [...allWorkflowRoles, ...require('../config/priceView').SALES_ROLES];
const readWorkflowRoles = [...allWorkflowRoles, ...require('../config/roles').DATA_ROLES, 'shipment_orders_followup', 'fleet_manager', 'fleet_supervisor',
  ...require('../config/priceView').SALES_ROLES, ...require('../config/priceView').VENDOR_ROLES];

// List & export
router.get('/export', authorize(...readWorkflowRoles), workflowController.exportWorkflows);
router.get('/permissions', authorize(...readWorkflowRoles), workflowController.getFieldPermissions);
router.get('/stats', authorize(...readWorkflowRoles), workflowController.getWorkflowStats);
// Values for one column filter, computed in the database. Must come before `/:id`, otherwise 'filters' is read as a record id and the server returns 404 on every list open.
router.get('/filters', authorize(...readWorkflowRoles), workflowController.filterOptions);
// The four invoice checks (gap in the sequence, missing manifest, value difference, customer name), also before `/:id`. Money is checked inside the controller (canSeeMoney).
router.get('/invoice-checks', authorize(...readWorkflowRoles), workflowController.invoiceChecks);
router.get('/invoice-checks/:kind', authorize(...readWorkflowRoles), workflowController.invoiceCheckList);
// Linking a manifest to a customs transaction. Search is before `/:id`. Link permission is checked inside the controller (canLinkCustoms).
router.get('/customs-search', authorize(...readWorkflowRoles), workflowController.customsSearch);
router.get('/customer-names', authorize(...readWorkflowRoles), workflowController.customerNames);
router.put('/:id/customs-link', authorize(...allWorkflowRoles), workflowController.setCustomsLink);
router.delete('/:id/customs-link', authorize(...allWorkflowRoles), workflowController.clearCustomsLink);

// Payment types. A customer's type is readable by whoever opens the operations page but writable only by whoever manages it: flipping a customer's type changes where all his manifests are invoiced. Must come before `/:id`.
const paymentTypes = require('../controllers/paymentTypesController');
const PT_WRITE = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'moderator', 'cfo', 'accounting_manager', 'collections_manager'];
router.get('/payment-types', authorize(...readWorkflowRoles), paymentTypes.list);
router.put('/payment-types/:id', authorize(...PT_WRITE), paymentTypes.update);
router.post('/payment-types/apply', authorize(...PT_WRITE), paymentTypes.applyAll);
// Unify a customer's manifests to his type: it overrides an existing per-manifest value, so it is requested explicitly for one customer.
router.post('/payment-types/:id/unify', authorize(...PT_WRITE), paymentTypes.unifyCustomer);
router.get('/', authorize(...readWorkflowRoles), workflowController.getWorkflows);

// Bulk delete
router.post('/bulk-delete', authorize.strict(...SHIPMENT_DELETE_ROLES), workflowController.bulkDelete);
// Bulk update. Open to anyone who edits a single row: permission is checked at the field level inside the endpoint, so nobody gains in bulk what they lack singly.
router.post('/bulk-update', authorize(...allWorkflowRoles), workflowController.bulkUpdate);
// Upload invoice data from Excel (shipping order to manifest): preview then write. See importInvoices.
router.post('/import-invoices', authorize(...allWorkflowRoles), workflowController.importInvoices);

// Bulk import (must be before /:id routes)
router.post(
  '/bulk-import',
  authorize('super_admin', 'moderator', ...FINANCE_FULL_ROLES),
  [body('rows').isArray({ min: 1 }).withMessage('rows must be a non-empty array')],
  validate,
  workflowController.bulkImport
);

// Pending invoices by customer (must be before /:id)
router.get('/pending-by-customer/:customerId', authorize(...readWorkflowRoles), workflowController.getPendingByCustomer);

router.get('/:id', authorize(...readWorkflowRoles), workflowController.getWorkflow);

// Manifest follow-ups. Whoever opens the manifest may write a follow-up on it; deletion is for its author or management (inside the controller). The log is read from the customs transaction page and the collections invoice; see controllers/workflowFollowUpController.
router.param('fuId', objectIdParam());
const followUps = require('../controllers/workflowFollowUpController').operations;
router.get('/:id/follow-ups', authorize(...readWorkflowRoles), followUps.list);
router.post('/:id/follow-ups', authorize(...allWorkflowRoles), followUps.create);
router.delete('/:id/follow-ups/:fuId', authorize(...allWorkflowRoles), followUps.remove);

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
router.put('/:id', authorize(...sellingWriters), workflowController.updateWorkflow);

// Order status: written in the operations platform, then comes back to us (see the function).
router.patch('/:id/application-status', authorize(...readWorkflowRoles), workflowController.updateApplicationStatus);

// Stage transitions
router.put(
  '/:id/stage',
  authorize(...allWorkflowRoles),
  [body('stage').isIn(['draft', 'submitted_to_ops', 'ops_completed', 'submitted_to_collections', 'completed'])],
  validate,
  workflowController.updateStage
);

// Row locking
router.post('/:id/lock', authorize(...sellingWriters), workflowController.lockWorkflow);
router.post('/:id/unlock', authorize(...sellingWriters), workflowController.unlockWorkflow);

// Delete (super_admin only)
router.delete('/:id', authorize.strict(...SHIPMENT_DELETE_ROLES), workflowController.deleteWorkflow);

module.exports = router;
