/**
 * /api/contracts — قسم إدارة العقود: سجل موردي 3PL بعقودهم ومرفقاتهم، تحليل
 * التشغيل الشهري، سجل تنشيط الموردين الجدد، وعقود بقية الأقسام (عملاء إدارة
 * الأسطول وB2C…). Reads are open to the section (sectionGate in server.js);
 * writes are the contracts team + admin tier.
 */
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contractsController');
const authorize = require('../middleware/rbac');

const EDIT_ROLES = ['super_admin', 'admin', 'contracts_manager', 'it_manager', 'it_specialist'];
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
