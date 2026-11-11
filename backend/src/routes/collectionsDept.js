const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
const ctrl = require('../controllers/collectionsDeptController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);

// Who reads the section. `sectionGate` is mounted above this prefix in server.js, so a user granted Collections from the permissions page also passes here (rbac reads req.sectionAccess).
const READ_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff',
  'operations_manager', 'operations_team_leader', 'cfo', 'accounting_manager', 'accountant',
];
// Who writes: the section owns its work and finance shares it.
// No narrower delete list: `authorize` also passes when `sectionGate` grants the section edit, and an edit grant passes every endpoint in it by design, so a narrower list prevents nothing and misleads readers into thinking delete is guarded. Deleting is low-risk anyway: a party with statements is deactivated, not deleted (see `deleteParty`), so what is erased is a row with no history. One list.
const EDIT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'collections_manager', 'collections_staff', 'cfo', 'accounting_manager',
];

router.get('/dashboard', authorize(...READ_ROLES), ctrl.dashboard);
router.get('/dashboard/filters', authorize(...READ_ROLES), ctrl.dashboardFilterOptions);

// Receivables: the tree, its rows and dispute state. A second board built on the invoice ledger, not operations statements; see the header of controllers/collectionsReceivablesController for why.
const recv = require('../controllers/collectionsReceivablesController');
router.get('/receivables/overview', authorize(...READ_ROLES), recv.overview);
router.get('/receivables/rows', authorize(...READ_ROLES), recv.rows);
// Column values for the receivables table filter, and the cases page, from the same rows.
router.get('/receivables/column-options', authorize(...READ_ROLES), recv.columnOptions);
router.get('/receivables/cases', authorize(...READ_ROLES), recv.cases);
router.put('/parties/:id/issue', authorize(...EDIT_ROLES), recv.setIssue);
// Before `/parties/:id`, or "filters" would be read as a party id.
router.get('/parties/filters', authorize(...READ_ROLES), ctrl.filterOptions);
router.get('/parties', authorize(...READ_ROLES), ctrl.listParties);
router.post('/parties', authorize(...EDIT_ROLES), ctrl.createParty);
router.get('/parties/:id', authorize(...READ_ROLES), ctrl.getPartyProfile);
router.put('/parties/:id', authorize(...EDIT_ROLES), ctrl.updateParty);
router.delete('/parties/:id', authorize(...EDIT_ROLES), ctrl.deleteParty);

// Follow-ups. "Due" comes before `/parties/:id/...` because it belongs to no particular party.
router.get('/follow-ups/due', authorize(...READ_ROLES), ctrl.dueFollowUps);
router.get('/parties/:id/follow-ups', authorize(...READ_ROLES), ctrl.listFollowUps);
router.post('/parties/:id/follow-ups', authorize(...EDIT_ROLES), ctrl.createFollowUp);
router.put('/follow-ups/:fuId', authorize(...EDIT_ROLES), ctrl.updateFollowUp);
router.delete('/follow-ups/:fuId', authorize(...EDIT_ROLES), ctrl.deleteFollowUp);
// Follow-ups on the statement itself, distinct from party follow-ups above: a log on the statement written by operations, customs and collections together (see controllers/workflowFollowUpController). Whoever reads the invoice may write a follow-up, so writing uses the read list; deleting is for the author or administration.
router.param('reportId', objectIdParam({ status: 400 }));
router.param('rfuId', objectIdParam({ status: 400 }));
const reportFollowUps = require('../controllers/workflowFollowUpController').collections;
router.get('/reports/:reportId/follow-ups', authorize(...READ_ROLES), reportFollowUps.list);
router.post('/reports/:reportId/follow-ups', authorize(...READ_ROLES), reportFollowUps.create);
router.delete('/reports/:reportId/follow-ups/:rfuId', authorize(...READ_ROLES), reportFollowUps.remove);

// Invoices. The section works from these two pages: cash by statement, tax by invoice.
router.get('/invoices/filters', authorize(...READ_ROLES), ctrl.invoiceFilterOptions);
// Single-column values for column filters, computed in the database, not from the displayed page.
router.get('/invoices/:kind/column-options', authorize(...READ_ROLES), ctrl.invoiceColumnOptions);
// Account statement PDF of what is on screen; before `/invoices/tax/:invoiceNumber`, or "statement" would be read as an invoice number.
router.get('/invoices/:kind/statement', authorize(...READ_ROLES), ctrl.invoiceStatement);
// Emailing the statement to the customer from the collections mailbox; see controllers/collectionsMailController.
const mail = require('../controllers/collectionsMailController');
router.get('/invoices/:kind/send-draft', authorize(...READ_ROLES), mail.draft);
router.post('/invoices/:kind/send', authorize(...EDIT_ROLES), mail.send);
router.get('/email-template', authorize(...READ_ROLES), mail.getTemplate);
router.put('/email-template', authorize(...EDIT_ROLES), mail.saveTemplate);
router.get('/invoices/cash', authorize(...READ_ROLES), ctrl.cashInvoices);
router.get('/invoices/tax', authorize(...READ_ROLES), ctrl.taxInvoices);
// The number may contain dashes and spaces and is taken as is.
router.get('/invoices/tax/:invoiceNumber', authorize(...READ_ROLES), ctrl.taxInvoiceDetail);
router.post('/invoices/collect', authorize(...EDIT_ROLES), ctrl.recordCollection);
router.post('/invoices/collect-bulk', authorize(...EDIT_ROLES), ctrl.bulkCollect);
// Correcting a tax invoice amount (negative allowed), locked to what was written.
// Narrower than the section and not opened by a grant. Changing a debt amount is a financial decision, not daily collection work (owner decision): system admins, section manager, finance manager and accounts manager only. `strict` because plain `authorize` passes anyone granted the section edit, so a narrower list would block nobody (see EDIT_ROLES above).
router.put('/invoices/tax/:invoiceNumber/amount', authorize.strict(...ctrl.AMOUNT_EDIT_ROLES), ctrl.updateTaxInvoiceAmount);
// "Not collected": reverts a collection recorded by mistake; the reason is optional.
router.post('/invoices/uncollect', authorize(...EDIT_ROLES), ctrl.undoCollection);
// Partial collection payments: edited or removed individually; same route family as "not collected".
router.put('/invoices/payments', authorize(...EDIT_ROLES), ctrl.updatePayment);
router.post('/invoices/payments/remove', authorize(...EDIT_ROLES), ctrl.removePayment);
// Delivery is a step before collection; the agreed credit term is counted from it.
router.post('/invoices/deliver', authorize(...EDIT_ROLES), ctrl.recordDelivery);
// Collection breakdown: where the money came from, a list managed from section settings.
router.put('/invoices/detail', authorize(...EDIT_ROLES), ctrl.setCollectionDetail);
// A cash row is saved like any row the app saves: PUT on its id.
router.put('/invoices/cash/:id', authorize(...EDIT_ROLES), ctrl.updateCashInvoice);

// Invoice attachments. The invoice reader sees and downloads files and the writer uploads. Deleting is for the uploader or the section manager, guarded by the controller, not the role list (see its header). "counts" comes before `/:key`, or it would be read as an invoice number.
const att = require('../controllers/collectionsAttachmentsController');
router.get('/attachments/:kind/counts', authorize(...READ_ROLES), att.counts);
router.get('/attachments/:kind/:key', authorize(...READ_ROLES), att.list(EDIT_ROLES));
router.post('/attachments/:kind/:key', authorize(...EDIT_ROLES), att.upload);
router.delete('/attachments/:kind/:key/:fileId', authorize(...EDIT_ROLES), att.remove);

// Collections ledger: account register with aging, invoice ledger, alerts, plan and rating. Built on `CollectionInvoice`, not operations statements; see the controller header.
const ledger = require('../controllers/collectionsLedgerController');

router.get('/ledger/aging/filters', authorize(...READ_ROLES), ledger.agingFilters);
router.get('/ledger/aging', authorize(...READ_ROLES), ledger.aging);
router.get('/ledger/invoices/filters', authorize(...READ_ROLES), ledger.invoiceFilters);
router.get('/ledger/invoices', authorize(...READ_ROLES), ledger.invoices);

router.get('/ledger/alerts', authorize(...READ_ROLES), ledger.alerts);
router.post('/ledger/alerts/ack', authorize(...EDIT_ROLES), ledger.ackAlert);

router.get('/ledger/tasks', authorize(...READ_ROLES), ledger.listTasks);
router.post('/ledger/tasks', authorize(...EDIT_ROLES), ledger.createTask);
router.put('/ledger/tasks/:id', authorize(...EDIT_ROLES), ledger.updateTask);
router.delete('/ledger/tasks/:id', authorize(...EDIT_ROLES), ledger.deleteTask);

router.get('/ledger/team', authorize(...READ_ROLES), ledger.team);
router.put('/ledger/team/assign', authorize(...EDIT_ROLES), ledger.assignOfficer);
router.get('/ledger/performance', authorize(...READ_ROLES), ledger.performance);

router.get('/ledger/link-suggestions', authorize(...READ_ROLES), ledger.linkSuggestions);
router.post('/ledger/link-suggestions/:id', authorize(...EDIT_ROLES), ledger.decideLink);

module.exports = router;
