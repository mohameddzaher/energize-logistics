const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('employeeId', objectIdParam());
const it = require('../controllers/itController');
const emails = require('../controllers/companyEmailController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist'];

router.use(authenticate);

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', it.getDashboard);

// Company email (@energize-logistics.com): Hostinger mailboxes, not system logins.
// The only route that returns a password is /reveal, and every use is logged.
router.get('/emails', emails.list);
router.get('/emails/employees', emails.searchEmployees);   // Registered before /emails/:id.
// Export with passwords: same permission as reveal, and recorded in the audit log.
router.get('/emails/export', authorize(...EDIT_ROLES), emails.exportWithPasswords);
router.post('/emails', authorize(...EDIT_ROLES), emails.create);
router.post('/emails/:id/reveal', authorize(...EDIT_ROLES), emails.revealPassword);
router.put('/emails/:id', authorize(...EDIT_ROLES), emails.update);
router.delete('/emails/:id', authorize(...EDIT_ROLES), emails.remove);

// ── Tickets ─────────────────────────────────────────────────────────────────
// /tickets/recurring MUST be declared before /tickets/:id, otherwise the param
// route swallows "recurring" and treats it as an id.
router.get('/tickets/recurring', it.getRecurring);
router.get('/tickets', it.listTickets);
router.post('/tickets', authorize(...EDIT_ROLES), it.createTicket);
router.get('/tickets/:id', it.getTicket);
router.put('/tickets/:id', authorize(...EDIT_ROLES), it.updateTicket);
router.delete('/tickets/:id', authorize(...EDIT_ROLES), it.deleteTicket);

// Custody: writes into the shared HR Asset collection.
router.get('/custody', it.listCustody);
router.post('/custody', authorize(...EDIT_ROLES), it.createCustody);
router.put('/custody/:id', authorize(...EDIT_ROLES), it.updateCustody);
router.post('/custody/:id/return', authorize(...EDIT_ROLES), it.returnCustody);
router.delete('/custody/:id', authorize(...EDIT_ROLES), it.deleteCustody);

// Movements. Each one moves the Asset and appends to its AssetEvent trail.
// The two GETs must sit above nothing else — they are distinct paths, but
// /custody/:id/history has to be declared before any broader /custody/:id use.
// The whole movement log, searchable (declared before /custody/:id paths).
router.get('/custody/events', it.custodyEvents);
router.get('/custody/:id/history', it.custodyHistory);
router.get('/custody/by-employee/:employeeId', it.custodyByEmployee);
router.post('/custody/:id/transfer', authorize(...EDIT_ROLES), it.transferCustody);
// Sale: the item leaves our ownership but keeps a trail of who bought it, for how much and when.
router.post('/custody/:id/sell', authorize(...EDIT_ROLES), it.sellCustody);
// Returning a sold item to stock cancels the sale and refunds the price; the log keeps both.
router.post('/custody/:id/unsell', authorize(...EDIT_ROLES), it.unsellCustody);
// Damaged is now a single action and both routes point to one handler. /retire stays exposed because installed mobile versions still call it.
router.post('/custody/:id/report', authorize(...EDIT_ROLES), it.markFaulty);
router.post('/custody/:id/retire', authorize(...EDIT_ROLES), it.markFaulty);
router.post('/custody/handover', authorize(...EDIT_ROLES), it.handoverCustody);

// Stock: unassigned items waiting on the shelf. Same Asset collection; a stock item simply has no holder yet.
router.get('/stock', it.listStock);
router.post('/stock', authorize(...EDIT_ROLES), it.createStock);
router.put('/stock/:id', authorize(...EDIT_ROLES), it.updateStock);
router.delete('/stock/:id', authorize(...EDIT_ROLES), it.deleteStock);
router.post('/stock/:id/assign', authorize(...EDIT_ROLES), it.assignFromStock);

// Employee picker for the custody modal (/api/hr/employees is HR-roles only).
router.get('/employees', it.listEmployees);

// Lists for the report form: the real departments and who may be assigned to resolve.
router.get('/departments', it.listDepartments);
router.get('/assignees', it.listAssignees);

// ── Systems & services ──────────────────────────────────────────────────────
router.get('/systems', it.listSystems);
router.post('/systems', authorize(...EDIT_ROLES), it.createSystem);
router.put('/systems/:id', authorize(...EDIT_ROLES), it.updateSystem);
router.delete('/systems/:id', authorize(...EDIT_ROLES), it.deleteSystem);

module.exports = router;
