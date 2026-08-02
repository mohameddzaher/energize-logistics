const express = require('express');
const router = express.Router();
const c = require('../controllers/vehicleRegistryController');
const authorize = require('../middleware/rbac');

// سجل المركبات — نفس صلاحيات قسم المركبات (super_admin/admin/HR/محاسبة).
// authenticate + sectionGate('Vehicles') مطبّقان عند التركيب في server.js.
const EDIT = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
const ADMIN = ['super_admin', 'admin', 'hr_manager'];

router.get('/dashboard', c.dashboard);
router.get('/alerts', c.alerts);
router.get('/settings', c.getSettings);
router.put('/settings', authorize(...ADMIN), c.updateSettings);

router.get('/', c.list);
router.post('/', authorize(...EDIT), c.create);
router.get('/:id', c.getOne);
router.put('/:id', authorize(...EDIT), c.update);
router.delete('/:id', authorize(...ADMIN), c.remove);

module.exports = router;
