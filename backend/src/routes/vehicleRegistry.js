const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record (404), not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));
router.param('docId', objectIdParam({ status: 400 }));
router.param('attId', objectIdParam({ status: 400 }));
const c = require('../controllers/vehicleRegistryController');
const authorize = require('../middleware/rbac');

// Vehicle registry: same permissions as the vehicles section (super_admin/admin/HR/accounting).
// authenticate + sectionGate('Vehicles') are applied at mount time in server.js.
// The section's own roles come first: the section is open with all its actions to whoever is granted it. They were missing from these lists, so the vehicles manager saw his section but could not edit it.
const EDIT = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'vehicles_manager', 'vehicles_team_leader', 'vehicles_staff',
  'hr_manager', 'hr_team_leader', 'hr_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'accountant'];
const ADMIN = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'vehicles_manager', 'vehicles_team_leader', 'hr_manager', 'hr_team_leader'];
// Editing, closing and deleting accidents: management, finance and the vehicles manager (the owner's call). `strict`: neither a section grant nor a page grant opens it, the list is everything. Recording a new accident and attaching its papers stay with the vehicles team.
const CLAIM_EDIT = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'cfo', 'accounting_manager', 'accounting_team_leader', 'vehicles_manager', 'vehicles_team_leader'];

router.get('/dashboard', c.dashboard);
// Overview: a card per column, each linking to a filtered page.
router.get('/overview', c.overview);
// Available filters and their values with counts, computed over what remains after the other filters.
router.get('/filters', c.filterOptions);
router.get('/document-types', c.documentTypes);
// Expiries with a days-ahead filter that the user types himself.
router.get('/expiring', c.expiring);
// Vehicle insurance policies: one policy covers several vehicles and its renewal applies to all of them.
// Section registers: owners, authorized persons, tracking providers, devices, fuel cards.
router.get('/registers', c.registers);
router.get('/insurance-policies', c.listInsurancePolicies);
router.post('/insurance-policies/:id/renew', authorize(...EDIT), c.renewInsurancePolicy);

// People search and registry plates; the section's forms are filled from them instead of typing by hand.
router.get('/person-lookup', c.personLookup);
// People dropdown for the authorized-person fields: HR first, then light-transport people who have no file.
router.get('/people', c.people);
router.get('/plate-options', c.plateOptions);
router.get('/claims', c.listClaims);
// One claim's file and its log. Before the generic `/:id` below, otherwise 'claims' would be read as a vehicle id and the server would answer not found.
router.get('/claims/:id', c.getClaim);
router.get('/claims/:id/audit', c.getClaimAudit);
router.post('/claims', authorize(...EDIT), c.createClaim);
router.put('/claims/:id', authorize.strict(...CLAIM_EDIT), c.updateClaim);
router.delete('/claims/:id', authorize.strict(...CLAIM_EDIT), c.deleteClaim);
// Claim papers: Najm report, damage photos, workshop quote and company letter.
router.post('/claims/:id/attachments', authorize(...EDIT), c.addClaimAttachments);
router.put('/claims/:id/attachments/:attId', authorize.strict(...CLAIM_EDIT), c.renameClaimAttachment);
router.delete('/claims/:id/attachments/:attId', authorize.strict(...CLAIM_EDIT), c.deleteClaimAttachment);
// Renew several documents at once with the same date.
router.post('/renew-bulk', authorize(...EDIT), c.renewBulk);
// One policy covering 198 vehicles is renewed in one action, not 198 separate ones; see renewShared.
router.post('/renew-shared', authorize(...EDIT), c.renewShared);
router.get('/corporate-policies', c.listCorporatePolicies);
router.post('/corporate-policies/:id/renew', authorize(...EDIT), c.renewCorporatePolicy);
// Ending the contract is a different action from renewing; it is recorded with its date and reason in the policy log.
router.post('/corporate-policies/:id/end', authorize(...EDIT), c.endCorporatePolicy);
router.post('/corporate-policies/:id/reopen', authorize(...EDIT), c.reopenCorporatePolicy);
// A policy is written and corrected, not only renewed, and the fidelity-insurance policy has a list of covered people.
router.post('/corporate-policies', authorize(...EDIT), c.createCorporatePolicy);
router.put('/corporate-policies/:id', authorize(...EDIT), c.updateCorporatePolicy);
router.delete('/corporate-policies/:id', authorize(...ADMIN), c.deleteCorporatePolicy);
router.post('/corporate-policies/:id/drivers', authorize(...EDIT), c.setPolicyDriver);
router.get('/alerts', c.alerts);
// Driver cards.
router.get('/driver-cards', c.listDriverCards);
router.post('/driver-cards', authorize(...ADMIN), c.createDriverCard);
router.put('/driver-cards/:id', authorize(...ADMIN), c.updateDriverCard);
router.delete('/driver-cards/:id', authorize(...ADMIN), c.deleteDriverCard);

router.get('/settings', c.getSettings);
router.put('/settings', authorize(...ADMIN), c.updateSettings);

// Vehicles whose service ended. Before `/:id`, otherwise 'archive' would be read as an id.
router.get('/archive', c.archiveList);

router.get('/', c.list);
router.post('/', authorize(...EDIT), c.create);
router.get('/:id', c.getOne);

// Vehicle files: license, insurance and card images.
router.get('/:id/documents', c.listVehicleDocuments);
router.post('/:id/documents', authorize(...EDIT), c.uploadVehicleDocument);
router.put('/documents/:docId', authorize(...EDIT), c.updateVehicleDocument);
router.delete('/documents/:docId', authorize(...EDIT), c.deleteVehicleDocument);
router.put('/:id', authorize(...EDIT), c.update);
// Renewal: updates the date and records the renewal in the vehicle log.
router.post('/:id/renew', authorize(...EDIT), c.renew);
// Petro App chip: install and removal, both recorded in the log. Removal is a condition of the employee's clearance, so it must not be a silent field clear.
router.post('/:id/fuel-card', authorize(...EDIT), c.fuelCardAction);
// An authorization is revoked and reassigned in one action that closes both records; see authorizationAction.
router.post('/:id/authorization', authorize(...EDIT), c.authorizationAction);
// End of service moves the vehicle to the archive (refused while authorized); restore brings it back. Same roles as editing.
router.post('/:id/end-service', authorize(...EDIT), c.endService);
router.post('/:id/restore', authorize(...EDIT), c.restoreService);
router.delete('/:id', authorize(...ADMIN), c.remove);

module.exports = router;
