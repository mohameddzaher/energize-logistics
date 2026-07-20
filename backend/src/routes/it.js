const express = require('express');
const router = express.Router();
const it = require('../controllers/itController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

router.use(authenticate);

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', it.getDashboard);

// ── Tickets ─────────────────────────────────────────────────────────────────
// /tickets/recurring MUST be declared before /tickets/:id, otherwise the param
// route swallows "recurring" and treats it as an id.
router.get('/tickets/recurring', it.getRecurring);
router.get('/tickets', it.listTickets);
router.post('/tickets', authorize(...EDIT_ROLES), it.createTicket);
router.get('/tickets/:id', it.getTicket);
router.put('/tickets/:id', authorize(...EDIT_ROLES), it.updateTicket);
router.delete('/tickets/:id', authorize(...EDIT_ROLES), it.deleteTicket);

// ── Custody (العهد) — writes into the shared HR Asset collection ────────────
router.get('/custody', it.listCustody);
router.post('/custody', authorize(...EDIT_ROLES), it.createCustody);
router.put('/custody/:id', authorize(...EDIT_ROLES), it.updateCustody);
router.post('/custody/:id/return', authorize(...EDIT_ROLES), it.returnCustody);
router.delete('/custody/:id', authorize(...EDIT_ROLES), it.deleteCustody);

// Employee picker for the custody modal (/api/hr/employees is HR-roles only).
router.get('/employees', it.listEmployees);

// ── Systems & services ──────────────────────────────────────────────────────
router.get('/systems', it.listSystems);
router.post('/systems', authorize(...EDIT_ROLES), it.createSystem);
router.put('/systems/:id', authorize(...EDIT_ROLES), it.updateSystem);
router.delete('/systems/:id', authorize(...EDIT_ROLES), it.deleteSystem);

module.exports = router;
