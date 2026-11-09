/** /api/contracts: contracts management section. 3PL vendor register with contracts and attachments, monthly operations analysis, new-vendor activation register, and other sections' contracts (fleet customers, B2C, ...). Reads are open to the section (sectionGate in server.js); writes are the contracts team and admin tier. */
const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('attId', objectIdParam());
const ctrl = require('../controllers/contractsController');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'contracts_manager', 'contracts_staff', 'it_manager', 'it_specialist',
  // Sales (customer contracts) and the vendors team (carrier contracts) work the section in full.
  'sales_manager', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'];
const E = authorize(...EDIT_ROLES);

router.get('/dashboard', ctrl.getDashboard);
router.get('/analysis', ctrl.getAnalysis);

router.get('/vendors', ctrl.listVendors);
router.post('/vendors', E, ctrl.createVendor);
router.get('/vendors/:id', ctrl.getVendor);
router.patch('/vendors/:id', E, ctrl.updateVendor);
router.delete('/vendors/:id', E, ctrl.deleteVendor);
router.post('/vendors/:id/attachments', E, ctrl.addVendorAttachment);
router.delete('/vendors/:id/attachments/:attId', E, ctrl.removeVendorAttachment);

// Customers: the other side of each deal. "suggestions" comes before "/:id", or it would be read as an id.
router.get('/customers/suggestions', ctrl.customerSuggestions);
router.get('/customers', ctrl.listCustomers);
router.post('/customers', E, ctrl.createCustomer);
router.get('/customers/:id', ctrl.getCustomer);
router.patch('/customers/:id', E, ctrl.updateCustomer);
router.delete('/customers/:id', E, ctrl.deleteCustomer);
router.post('/customers/:id/attachments', E, ctrl.addCustomerAttachment);
router.delete('/customers/:id/attachments/:attId', E, ctrl.removeCustomerAttachment);

router.get('/utilisation', ctrl.listUtilisation);
router.post('/utilisation', E, ctrl.upsertUtilisation);
router.delete('/utilisation/:id', E, ctrl.deleteUtilisation);

router.get('/prospects', ctrl.listProspects);
router.post('/prospects', E, ctrl.createProspect);
router.patch('/prospects/:id', E, ctrl.updateProspect);
router.delete('/prospects/:id', E, ctrl.deleteProspect);
router.post('/prospects/:id/convert', E, ctrl.convertProspect);

router.get('/agreements', ctrl.listDeptContracts);
router.post('/agreements', E, ctrl.createDeptContract);
router.patch('/agreements/:id', E, ctrl.updateDeptContract);
router.delete('/agreements/:id', E, ctrl.deleteDeptContract);
router.post('/agreements/:id/attachments', E, ctrl.addDeptContractAttachment);
router.delete('/agreements/:id/attachments/:attId', E, ctrl.removeDeptContractAttachment);

module.exports = router;
