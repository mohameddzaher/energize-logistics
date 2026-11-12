/**
 * /api/operations-private: operations, private view.
 * The same operations manifests priced at our real selling price. Read for management, and writes only one column; see the controller header.
 * Who sees it: the margin is readable on every load here, so it is narrower than the operations workflow: management, those who own money anyway (finance manager and accounting) and the operations manager. Operations staff see the manifests on their own page but not what we earn on each.
 */
const express = require('express');

const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/operationsPrivateController');

const ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist',
  'operations_manager', 'operations_team_leader', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant',
];

router.use(authenticate);
router.use(require('../utils/dataOwnerIndex').preload);
// Search by driver iqama number or truck chassis, as in the operations workflow.
router.use((req, res, next) => (req.method === 'GET' ? require('../controllers/workflowController').primeRelatedSearch(req, res, next) : next()));
router.use(authorize(...ROLES));

router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
/** Analysis: dashboard cards and charts over the same manifests at our prices. Registered before `/:id`, like `/export`. */
router.get('/analytics', ctrl.analytics);
router.get('/analytics/filters', ctrl.analyticsFilters);
// Everything matching the filter at our prices, as an Excel file (or `format=json`). Before `/:id`.
router.get('/export', ctrl.exportRows);

/** The selling value is written on the manifest itself, the same way the workflow does (`workflowController.setSellingValue`): whoever owns the column there (SELLING_ROLES) writes it here, and anyone else gets 403 even if the page is open to them. It is pushed to the platform and recorded in the audit log with the writer's name. */
router.put('/:id', ctrl.updatePrice);

module.exports = router;
