const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));

const c = require('../controllers/lightTransportController');
const o = require('../controllers/lightTransportOrderController');
const authorize = require('../middleware/rbac');

// authenticate + sectionGate('B2C') are applied at mount time in server.js.
// Section roles first; users granted the section via the permissions matrix pass the same `authorize` (it reads `req.sectionAccess`); see middleware/sectionGate.
const EDIT = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager', 'it_specialist', ...require('../config/financeAuthority').FINANCE_FULL_ROLES];

// Section dashboard: one call computes staff, vehicles and housing together.
router.get('/overview', c.overview);
// Supervision accounts in the section; the supervisor field on web and mobile is built from them.
router.get('/supervisors', c.supervisors);
router.get('/employees', c.listEmployees);
router.get('/employees/:id', c.getEmployee);
// A rep's orders split by project, month by month, for his profile (b2cEntryController.repOrders).
router.get('/employees/:id/orders', require('../controllers/b2cEntryController').repOrders);
// Adding an employee creates his HR file, so it is limited to the sector manager, deputy, system admin and finance roles, not everyone granted the section.
router.post('/employees', authorize.strict('super_admin', 'b2c_manager', 'b2c_deputy', ...require('../config/financeAuthority').FINANCE_FULL_ROLES), c.createEmployee);
// Section project vehicles: a window onto the vehicle registry itself (see the controller).
router.get('/vehicles', c.listVehicles);
// People dropdown (actual leader and authorized person): section staff first, then HR.
router.get('/people', c.people);
router.put('/vehicles/:id', authorize.strict(...c.LT_VEHICLE_EDIT), c.updateVehicle);
router.put('/employees/:id', authorize(...EDIT), c.updateEmployee);
// Project transfer is the only way to change a rep's project; the controller decides who may (utils/b2cEntry.canTransfer).
router.post('/employees/:id/transfer-project', authorize(...EDIT), require('../controllers/b2cEntryController').transferProject);
// No employee deletion: the record is deactivated and its trail kept, as in HR.
router.post('/employees/:id/deactivate', authorize(...EDIT), c.deactivateEmployee);
// Assign an operations supervisor or a duty-check supervisor to several employees at once.
router.post('/employees/assign-supervisors', authorize(...EDIT), c.assignSupervisors);

// Light-transport custody: cash, purchase card and workshop.
// In/out entries; a transfer between two accounts is two entries in one click; see models/LtCustody.
const custody = require('../controllers/ltCustodyController');
// Custody is money: a section grant opens the section to project managers and supervisors, not custody. Only the owner roles or a role granted on the permissions screen pass (middleware/custodyGate).
const CUSTODY = require('../middleware/custodyGate')({ roles: () => custody.CUSTODY_ROLES, section: 'B2C', page: '/system/b2c/light-transport/custody' });
router.get('/custody', CUSTODY, custody.list);
router.get('/custody/rep', CUSTODY, custody.lookupRep);
router.post('/custody', CUSTODY, custody.create);
router.put('/custody/:id', CUSTODY, custody.update);      // The controller restricts this to the system admin and finance roles.
router.delete('/custody/:id', CUSTODY, custody.remove);

// User rental: counted in total reps on the section dashboard.
const rentals = require('../controllers/ltUserRentalController');
router.get('/user-rentals', rentals.list);
router.post('/user-rentals', authorize(...EDIT), rentals.create);
router.put('/user-rentals/:id', authorize(...EDIT), rentals.update);
router.post('/user-rentals/:id/end', authorize(...EDIT), rentals.end);
router.delete('/user-rentals/:id', authorize(...EDIT), rentals.remove);   // The controller restricts this to management.

router.get('/housing', c.listHousing);
router.post('/housing', authorize(...EDIT), c.saveHousing);
router.put('/housing/:id', authorize(...EDIT), c.saveHousing);
router.delete('/housing/:id', authorize(...EDIT), c.deleteHousing);

// Operating orders: their options are built on the server, not in the browser.
router.get('/orders/options', o.orderOptions);
router.get('/orders', o.listOrders);
router.post('/orders', authorize(...EDIT), o.createOrder);
router.post('/orders/:id/end', authorize(...EDIT), o.endOrder);
// Move a vehicle authorization on its own, without a new operating order; see `moveAuthorization`.
router.post('/authorization/move', authorize(...EDIT), o.moveAuthorization);

/**
 * Light-transport store.
 * The store mechanics live once in `ls2StoreController`: in/out entries, movements reversed rather than edited, balance after each movement, and a low-stock threshold. This section has its own store of items (engine head, gasket, bikes), so the same controller is called with `warehouse=light` instead of copying a second store that would drift.
 * The scope is enforced here, not left to the UI: the page calls the light-transport store route, so it cannot read or write the heavy-transport store even by mistake.
 */
const store = require('../controllers/ls2StoreController');
const lightStore = (handler) => (req, res) => {
  req.query = { ...req.query, warehouse: 'light' };
  if (req.body && typeof req.body === 'object') req.body.warehouse = 'light';
  return handler(req, res);
};
router.get('/store', lightStore(store.listItems));
router.get('/store/dashboard', lightStore(store.dashboard));
router.get('/store/movements', lightStore(store.listMovements));
router.get('/store/issue-reasons', lightStore(store.issueReasons));
router.post('/store', authorize(...EDIT), lightStore(store.createItem));
router.post('/store/bulk-create', authorize(...EDIT), lightStore(store.createItemsBulk));
router.get('/suppliers', lightStore(store.listSuppliers));
router.post('/suppliers', authorize(...EDIT), lightStore(store.createSupplier));
router.put('/suppliers/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.updateSupplier));
router.delete('/suppliers/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.deleteSupplier));
/**
 * Issuing from this store happens only through an issue request (طلب صرف), so the direct out actions are refused here; receipts stay open.
 * The heavy store keeps its direct issue: the rule lives in this route, not in the shared controller.
 */
const noDirectIssue = (req, res, next) => (String(req.body?.type || '') === 'out'
  ? res.status(400).json({ code: 'ISSUE_VIA_REQUEST', message: 'الصرف من مخزن النقل الخفيف يتمّ عبر «طلب صرف» فقط' })
  : next());
router.post('/store/bulk-movement', authorize(...EDIT), noDirectIssue, lightStore(store.addBulkMovement));
router.post('/store/movements/:movementId/reverse', authorize(...EDIT), lightStore(store.reverseMovement));
router.post('/store/:id/movement', objectIdParam('id'), authorize(...EDIT), noDirectIssue, lightStore(store.addMovement));

// Issue requests: saving one is the stock-out; cancelling reverses it on the record. Same writers as the store.
const issue = require('../controllers/storeIssueRequestController');
router.get('/store/issue-requests', lightStore(issue.list));
router.get('/store/issue-requests/:id', lightStore(issue.get));
router.get('/store/issue-requests/:id/pdf', lightStore(issue.pdf));
router.post('/store/issue-requests', authorize(...EDIT), lightStore(issue.create));
router.post('/store/issue-requests/:id/cancel', authorize(...EDIT), lightStore(issue.cancel));
router.put('/store/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.updateItem));
router.delete('/store/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.deleteItem));

module.exports = router;
