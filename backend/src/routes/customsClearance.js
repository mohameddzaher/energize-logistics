const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('attId', objectIdParam());
const ctrl = require('../controllers/customsClearanceController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
// Pricing, the invoice and the parties card are read only inside the Customs
// section (QA sweep 2026-10-27) — see middleware/sectionGate requireSectionAccess.
const customsOnly = require('../middleware/sectionGate').requireSectionAccess('Customs');

const EDIT_ROLES = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'];

router.use(authenticate);

router.get('/', ctrl.getClearances);
// Must stay ABOVE '/:id' or the param route swallows it.
router.get('/analytics', ctrl.getAnalytics);
// Section operations dashboard: for the whole team, with no financial figures.
router.get('/dashboard', ctrl.getDashboard);
// Clearance statement numbers: which exist in the operations workflow.
router.get('/release-sheets', ctrl.releaseSheets);
router.get('/filters', ctrl.getFilterOptions);

// Clearance parties: customers and shipping agents. Before `/:id`, or "parties" would be read as a transaction id.
router.get('/parties', ctrl.listParties);
router.post('/parties', authorize(...EDIT_ROLES), ctrl.createParty);
router.get('/parties/:id', ctrl.getPartyProfile);
router.put('/parties/:id', authorize(...EDIT_ROLES), ctrl.updateParty);
router.delete('/parties/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteParty);
router.post('/parties/:id/attachments', authorize(...EDIT_ROLES), ctrl.addPartyAttachments);
router.put('/parties/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.updatePartyAttachment);
router.delete('/parties/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.deletePartyAttachment);
// Contracts, also before `/:id`.
// Group endpoints before `/:id`.
const FINANCE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'];

router.get('/settings', ctrl.getSettings);
router.put('/settings', authorize('super_admin', 'admin', 'it_manager', 'customs_manager'), ctrl.updateSettings);
router.get('/upcoming-alerts', ctrl.upcomingAlerts);
// Disbursement requests: clearance reads them to follow its request; only finance decides.
router.get('/payment-requests', ctrl.listPaymentRequests);
// Invoicing requests: sent by clearance, answered by finance.
router.get('/invoice-requests', ctrl.listInvoiceRequests);
// Customer invoices. Payment stages are what we pay; these are what we invoice, written at closing and read here. The list serves finance and clearance together, so reads use the section guard only.
router.get('/invoices', ctrl.listClearanceInvoices);

router.get('/contracts', ctrl.listContracts);
router.post('/contracts', authorize(...EDIT_ROLES), ctrl.createContract);
router.put('/contracts/:id', authorize(...EDIT_ROLES), ctrl.updateContract);
router.delete('/contracts/:id', authorize('super_admin', 'admin', 'customs_manager'), ctrl.deleteContract);
router.post('/contracts/:id/files', authorize(...EDIT_ROLES), ctrl.addContractFiles);
router.delete('/contracts/:id/files/:attId', authorize(...EDIT_ROLES), ctrl.deleteContractFile);

router.get('/:id', ctrl.getClearance);
// One transaction's invoice, computed from its line items; see utils/customsInvoice.
router.get('/:id/invoice', customsOnly, ctrl.getClearanceInvoice);
// Operations statements linked to the transaction, with invoicing and collection state; see services/customsOpsLink.
router.get('/:id/ops-reports', ctrl.getOpsReports);
// Follow-ups on the linked statement: whoever sees the transaction sees its statements and may write a follow-up; deleting is for the author or administration. The statement must be linked to this same transaction.
router.param('reportId', objectIdParam());
router.param('fuId', objectIdParam());
const opsFollowUps = require('../controllers/workflowFollowUpController').customs;
router.get('/:id/ops-reports/:reportId/follow-ups', opsFollowUps.list);
router.post('/:id/ops-reports/:reportId/follow-ups', opsFollowUps.create);
router.delete('/:id/ops-reports/:reportId/follow-ups/:fuId', opsFollowUps.remove);

router.post('/', authorize(...EDIT_ROLES), ctrl.createClearance);
router.put('/:id', authorize(...EDIT_ROLES), ctrl.updateClearance);
// Transaction deletion is for the section manager and staff alike (owner request); the deletion is recorded in the audit log with who deleted and the transaction number.
router.delete('/:id', authorize('super_admin', 'admin', 'customs_manager', 'customs_officer'), ctrl.deleteClearance);

// Transaction attachments: each stage's papers are uploaded with the transaction.
// Payment stages: one entry per occurrence, since the same stage is added several times (fees in two payments, return for two containers). The pick list comes from section settings.
// Customer contract prices: read for the transaction screen, and "fill from contract".
router.get('/:id/contract-pricing', customsOnly, ctrl.getContractPricing);
router.post('/:id/apply-contract', authorize(...EDIT_ROLES), ctrl.applyContractPricing);
router.post('/:id/payment-stages', authorize(...EDIT_ROLES), ctrl.addPaymentStage);
router.put('/:id/payment-stages/:entryId', authorize(...EDIT_ROLES), ctrl.updatePaymentStage);
router.delete('/:id/payment-stages/:entryId', authorize(...EDIT_ROLES), ctrl.deletePaymentStage);
// Invoicing and closing are separate actions: the invoice is issued without waiting for the transport invoice, and the transaction is finished when it is attached. See issueInvoice and settleClosure.
router.patch('/:id/invoice', authorize(...EDIT_ROLES), ctrl.issueInvoice);
router.post('/:id/transport-invoice', authorize(...EDIT_ROLES), ctrl.receiveTransportInvoice);
router.patch('/:id/complete', authorize(...EDIT_ROLES), ctrl.completeClearance);
// Mark a stage of the clearance cycle, with its rules (two mutually exclusive paths, stages that close).
router.patch('/:id/stage', authorize(...EDIT_ROLES), ctrl.setStage);
// Convert an upcoming transaction to in-progress.
router.patch('/:id/activate', authorize(...EDIT_ROLES), ctrl.activateClearance);
// Finance decision on a disbursement request; finance only.
router.patch('/:id/payment-stages/:entryId/decision', authorize(...FINANCE_ROLES), ctrl.decidePaymentStage);
// Its answer to an invoicing request: invoiced (with the invoice), returned, or rejected.
router.patch('/:id/invoice-request/decision', authorize(...FINANCE_ROLES), ctrl.decideInvoiceRequest);

// Transaction notes: added from the table and from inside the transaction; the latest is shown.
router.post('/:id/notes', authorize(...EDIT_ROLES), ctrl.addNote);
router.delete('/:id/notes/:noteId', authorize(...EDIT_ROLES), ctrl.deleteNote);

router.get('/:id/parties-card', customsOnly, ctrl.getClearanceParties);   // Customer, agent, carrier and their attachments.
router.post('/:id/attachments', authorize(...EDIT_ROLES), ctrl.addAttachments);
router.put('/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.updateAttachment);
router.delete('/:id/attachments/:attId', authorize(...EDIT_ROLES), ctrl.deleteAttachment);

module.exports = router;
