const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
router.param('docId', objectIdParam({ status: 400 }));
const hr = require('../controllers/hrController');
const hrm = require('../controllers/hrMasterController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const STAFF = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'hr_manager', 'hr_team_leader', 'hr_specialist'];

router.use(authenticate);

// HR master: the overview and each group's pages. A card per column with counters required / not required / entered, each number opening its people. Filling happens here or on the employee page, both through the same endpoint, so "required" clears the same way.
// Why `authorize` on reads too: these screens return residence, passport and IBAN numbers and every employee's salary. They had no role restriction, and the section guard lets roles with no stake in the section through ("widen, never narrow"), so any account, including partner portal accounts (ordinary users), could read the whole employment file in one request.
router.get('/master/overview', authorize(...STAFF), hrm.overview);
router.get('/master/field-config', authorize(...STAFF), hrm.fieldConfig);
router.get('/master/choices', authorize(...STAFF), hrm.choices);
// Available filters and their values with counts, computed over what remains after the other filters.
router.get('/master/filters', authorize(...STAFF), hrm.filterOptions);
router.get('/master/expiring', authorize(...STAFF), hrm.expiring);
// Department analysis: a row per department with its figures, reading the same filter as the board.
router.get('/master/by-department', authorize(...STAFF), hrm.byDepartment);

// Finance follow-up: residency and work-permit fees (read) and the section's requests to finance. The same rows finance sees, with payment state; payment is recorded there, not here.
const hrf = require('../controllers/hrFinanceController');
router.get('/finance-follow/docs', authorize(...STAFF), hrf.hrDocs);
router.get('/finance-follow/options', authorize(...STAFF), hrf.options);
router.get('/finance-requests', authorize(...STAFF), hrf.hrRequests);
router.post('/finance-requests', authorize(...STAFF), hrf.createRequest);

// Official forms and letters. Reading is for whoever is granted the HR section (not four hand-written roles): the section guard before it decides, so anyone given the section from the matrix reads the papers. Upload, edit and archive are for section staff.
const hrForms = require('../controllers/hrFormsController');
router.get('/forms', hrForms.list);
router.post('/forms/:id/downloaded', hrForms.countDownload);
router.post('/forms', authorize(...STAFF), hrForms.create);
router.put('/forms/:id', authorize(...STAFF), hrForms.update);
router.delete('/forms/:id', authorize(...STAFF), hrForms.remove);
// Master: one row per employee with all columns. Registered before `records/:group` since it is more specific in shape and they do not overlap.
router.get('/master/grid', authorize(...STAFF), hrm.grid);
router.get('/master/grid/options', authorize(...STAFF), hrm.gridOptions);
router.get('/master/records/:group', authorize(...STAFF), hrm.records);
router.get('/master/employees/:id/fields', authorize(...STAFF), hrm.employeeFields);
router.patch('/master/employees/:id/fields', authorize(...STAFF), hrm.updateFields);
// Renewal, individual and bulk. `renew-bulk` comes before any route with an id so it is not read as an employee id.
router.post('/master/renew-bulk', authorize(...STAFF), hrm.renewBulk);
router.post('/master/renew', authorize(...STAFF), hrm.renew);

// ── Self-service (any authenticated user) ────────────────────────────────────
// Defined first so they aren't shadowed by the staff :id routes below.
router.get('/me/profile', hr.getMyProfile);
router.get('/me/team', hr.getMyTeam);
router.get('/me/leaves', hr.listMyLeaves);
router.post('/me/leaves', hr.createMyLeave);
router.patch('/me/leaves/:id/cancel', hr.cancelMyLeave);
// The requester's reply to an inquiry from any station; restarts the chain from the start. It lives here, not in the staff section, because the replier is the employee himself and the controller guard checks he owns the request. See replyToLeave.
router.post('/me/leaves/:id/reply', hr.replyToLeave);
// Edit and delete while nobody has acted on the request; the guard is in the controller, not here.
router.put('/me/leaves/:id', hr.updateMyLeave);
router.delete('/me/leaves/:id', hr.deleteMyLeave);
router.get('/me/requests', hr.listMyRequests);
router.post('/me/requests', hr.createMyRequest);
router.put('/me/requests/:id', hr.updateMyRequest);
router.delete('/me/requests/:id', hr.deleteMyRequest);
router.get('/team/leaves', hr.listTeamLeaves);
// A manager files leave for someone under him (utils/leaveTeam); the controller checks the person is his.
router.get('/team/leave-members', hr.listLeaveTeamMembers);
router.post('/team/leaves', hr.createTeamLeave);

// Approvals inbox: whoever holds a station in the chain reads what awaits them. No `authorize`: the controller builds the query from the reader's stations, so someone with none sees nothing. See utils/leaveChain.inboxFilter.
router.get('/leaves/inbox', hr.listLeaveInbox);
router.get('/leaves/inbox/count', hr.leaveInboxCount);

// Leave types: anyone can read the active list (for the request dropdown);
// only staff can mutate.
router.get('/leave-types', hr.listLeaveTypes);
router.post('/leave-types', authorize(...STAFF), hr.createLeaveType);
router.put('/leave-types/:id', authorize(...STAFF), hr.updateLeaveType);
router.delete('/leave-types/:id', authorize(...STAFF), hr.deleteLeaveType);

// Leave/request actions usable by managers (non-staff) too — the controller
// enforces who may act.
router.patch('/leaves/:id/decision', hr.decideLeave);
router.post('/requests/:id/reply', hr.replyRequest);

// Employee profile read is allowed for the owner; controller enforces it.
router.get('/employees/:id', hr.getEmployee);

// ── HR back-office (staff only) ──────────────────────────────────────────────
router.get('/dashboard', authorize(...STAFF), hr.getDashboard);
router.get('/options', authorize(...STAFF), hr.getOptions);

router.get('/employees', authorize(...STAFF), hr.listEmployees);
router.get('/employees-search', authorize(...STAFF), hr.searchEmployees);
router.post('/employees', authorize(...STAFF), hr.createEmployee);
router.put('/employees/:id', authorize(...STAFF), hr.updateEmployee);
router.delete('/employees/:id', authorize(...STAFF), hr.deleteEmployee);

// Profile actions (staff): renew a document, end of service, reactivate, history.
router.post('/employees/:id/renew', authorize(...STAFF), hr.renewDocument);
// Asked before opening the termination dialog: what does this employee hold, and which department clears it?
router.get('/employees/:id/clearance', authorize(...STAFF), hr.employeeClearance);
router.post('/employees/:id/terminate', authorize(...STAFF), hr.terminateEmployee);
router.post('/employees/:id/reactivate', authorize(...STAFF), hr.reactivateEmployee);
// Working vs sister company; "not working" is end of service. See setWorkStatus.
router.post('/employees/:id/work-status', authorize(...STAFF), hr.setWorkStatus);
router.post('/employees/:id/sponsor', authorize(...STAFF), hr.sponsorEmployee);
// Archive: end of service, then out of the system, then archive. See hrArchiveController.
const hrArchive = require('../controllers/hrArchiveController');
router.get('/archive', authorize(...STAFF), hrArchive.list);
router.post('/employees/:id/exit-system', authorize(...STAFF), hrArchive.exitSystem);
router.post('/employees/:id/return-system', authorize(...STAFF), hrArchive.returnSystem);
router.get('/employees/:id/audit', authorize(...STAFF), hr.getEmployeeAudit);

// Employee documents (file uploads — base64 data URL in JSON).
router.get('/employees/:id/documents', authorize(...STAFF), hr.listDocuments);
router.post('/employees/:id/documents', authorize(...STAFF), hr.uploadDocument);
router.put('/documents/:docId', authorize(...STAFF), hr.updateDocument);
router.delete('/documents/:docId', authorize(...STAFF), hr.deleteDocument);

router.get('/contracts', authorize(...STAFF), hr.listContracts);
router.post('/contracts', authorize(...STAFF), hr.createContract);
router.put('/contracts/:id', authorize(...STAFF), hr.updateContract);
// Renewal closes the current contract and creates one after it, and carries over unused leave balance.
router.post('/contracts/:id/renew', authorize(...STAFF), hr.renewContract);
router.post('/contracts/:id/terminate', authorize(...STAFF), hr.terminateContract);
router.delete('/contracts/:id', authorize(...STAFF), hr.deleteContract);

// Section settings: document-expiry alert thresholds.
router.get('/settings', authorize(...STAFF), hr.getHrSettings);
router.put('/settings', authorize(...STAFF), hr.updateHrSettings);

router.get('/leaves', authorize(...STAFF), hr.listLeaves);
router.get('/leave-register', authorize(...STAFF), hr.leaveRegister);
// Recording a leave that actually happened; before the parameterized route, or `/:id` would swallow it.
router.post('/leaves/backdated', authorize(...STAFF), hr.createBackdatedLeave);
router.get('/leaves/:id/sheet.pdf', hr.getLeaveSheet); // official sheet PDF, same on web and mobile; access checked in controller
router.get('/leaves/:id', hr.getLeave); // single leave + signatures (for the PDF); access checked in controller
// HR record correction: edit date, type or reason, or delete the leave.
router.put('/leaves/:id', authorize(...STAFF), hr.updateLeave);
router.delete('/leaves/:id', authorize(...STAFF), hr.deleteLeave);
router.post('/leaves/:id/return', authorize(...STAFF), hr.recordLeaveReturn);
router.post('/leaves/:id/extend', authorize(...STAFF), hr.extendLeave);
router.post('/leaves/:id/no-show', authorize(...STAFF), hr.markLeaveNoShow);

router.get('/requests', authorize(...STAFF), hr.listRequests);
router.patch('/requests/:id/status', authorize(...STAFF), hr.updateRequestStatus);

// Company licenses & subscriptions, staff only.
router.get('/licenses', authorize(...STAFF), hr.listLicenses);
router.post('/licenses', authorize(...STAFF), hr.createLicense);
router.put('/licenses/:id', authorize(...STAFF), hr.updateLicense);
router.delete('/licenses/:id', authorize(...STAFF), hr.deleteLicense);

router.get('/assets', authorize(...STAFF), hr.listAssets);
router.post('/assets', authorize(...STAFF), hr.createAsset);
router.put('/assets/:id', authorize(...STAFF), hr.updateAsset);
router.post('/assets/:id/return', authorize(...STAFF), hr.returnAsset);
router.delete('/assets/:id', authorize(...STAFF), hr.deleteAsset);

// HR's own store, a separate shelf from the IT store, in the same Asset collection. Handing an item out turns the same document into custody.
router.get('/stock', authorize(...STAFF), hr.listStock);
router.post('/stock', authorize(...STAFF), hr.createStock);
router.put('/stock/:id', authorize(...STAFF), hr.updateStock);
router.delete('/stock/:id', authorize(...STAFF), hr.deleteStock);
router.post('/stock/:id/assign', authorize(...STAFF), hr.assignFromStock);

module.exports = router;
