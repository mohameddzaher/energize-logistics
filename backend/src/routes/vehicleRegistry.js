const express = require('express');
const router = express.Router();
const c = require('../controllers/vehicleRegistryController');
const authorize = require('../middleware/rbac');

// سجل المركبات — نفس صلاحيات قسم المركبات (super_admin/admin/HR/محاسبة).
// authenticate + sectionGate('Vehicles') مطبّقان عند التركيب في server.js.
const EDIT = ['super_admin', 'admin', 'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
const ADMIN = ['super_admin', 'admin', 'hr_manager'];

router.get('/dashboard', c.dashboard);
// نظرة شاملة: كارت لكل عمود، وكله بيوصّل لصفحة مفلترة.
router.get('/overview', c.overview);
router.get('/document-types', c.documentTypes);
// الانتهاءات بفلتر «خلال كام يوم» اللي المستخدم بيكتبه هو.
router.get('/expiring', c.expiring);
router.get('/claims', c.listClaims);
router.get('/corporate-policies', c.listCorporatePolicies);
router.post('/corporate-policies/:id/renew', authorize(...EDIT), c.renewCorporatePolicy);
router.get('/alerts', c.alerts);
router.get('/settings', c.getSettings);
router.put('/settings', authorize(...ADMIN), c.updateSettings);

router.get('/', c.list);
router.post('/', authorize(...EDIT), c.create);
router.get('/:id', c.getOne);
router.put('/:id', authorize(...EDIT), c.update);
// التجديد: بيحدّث التاريخ وبيقيّد التجديد في سجل المركبة.
router.post('/:id/renew', authorize(...EDIT), c.renew);
router.delete('/:id', authorize(...ADMIN), c.remove);

module.exports = router;
