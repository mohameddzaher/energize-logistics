const express = require('express');
const router = express.Router();
const c = require('../controllers/vehicleRegistryController');
const authorize = require('../middleware/rbac');

// سجل المركبات — نفس صلاحيات قسم المركبات (super_admin/admin/HR/محاسبة).
// authenticate + sectionGate('Vehicles') مطبّقان عند التركيب في server.js.
// أدوار القسم نفسه أول حاجة: القسم مفتوح **بالكامل بكل أكشناته** لمين اتفتح له.
// كانوا ناقصين من القوايم دي، فمدير المركبات كان بيشوف قسمه ومش قادر يعدّل فيه.
const EDIT = ['super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'finance_manager', 'accountant'];
const ADMIN = ['super_admin', 'admin', 'vehicles_manager', 'hr_manager'];

router.get('/dashboard', c.dashboard);
// نظرة شاملة: كارت لكل عمود، وكله بيوصّل لصفحة مفلترة.
router.get('/overview', c.overview);
// الفلاتر المتاحة وقيمها بأعدادها — محسوبة على ما تبقّى بعد بقيّة الفلاتر
router.get('/filters', c.filterOptions);
router.get('/document-types', c.documentTypes);
// الانتهاءات بفلتر «خلال كام يوم» اللي المستخدم بيكتبه هو.
router.get('/expiring', c.expiring);
// وثائق تأمين المركبات — وثيقة تغطّي عدة مركبات، وتجديدها يسري عليها كلها
// سجلّات القسم: المُلّاك · المفوَّضون · مزوّدو التتبّع · الأجهزة · شرائح الوقود
router.get('/registers', c.registers);
router.get('/insurance-policies', c.listInsurancePolicies);
router.post('/insurance-policies/:id/renew', authorize(...EDIT), c.renewInsurancePolicy);

router.get('/claims', c.listClaims);
router.post('/claims', authorize(...EDIT), c.createClaim);
router.put('/claims/:id', authorize(...EDIT), c.updateClaim);
router.delete('/claims/:id', authorize(...ADMIN), c.deleteClaim);
// تجديد أكتر من مستند مرة واحدة بنفس التاريخ
router.post('/renew-bulk', authorize(...EDIT), c.renewBulk);
router.get('/corporate-policies', c.listCorporatePolicies);
router.post('/corporate-policies/:id/renew', authorize(...EDIT), c.renewCorporatePolicy);
router.get('/alerts', c.alerts);
// ── بطاقاتُ السائقين ───────────────────────────────────────────────────────
router.get('/driver-cards', c.listDriverCards);
router.post('/driver-cards', authorize(...ADMIN), c.createDriverCard);
router.put('/driver-cards/:id', authorize(...ADMIN), c.updateDriverCard);
router.delete('/driver-cards/:id', authorize(...ADMIN), c.deleteDriverCard);

router.get('/settings', c.getSettings);
router.put('/settings', authorize(...ADMIN), c.updateSettings);

router.get('/', c.list);
router.post('/', authorize(...EDIT), c.create);
router.get('/:id', c.getOne);

// ── ملفّات المركبة: صور الرخصة والتأمين والبطاقة ──────────────────────────
router.get('/:id/documents', c.listVehicleDocuments);
router.post('/:id/documents', authorize(...EDIT), c.uploadVehicleDocument);
router.put('/documents/:docId', authorize(...EDIT), c.updateVehicleDocument);
router.delete('/documents/:docId', authorize(...EDIT), c.deleteVehicleDocument);
router.put('/:id', authorize(...EDIT), c.update);
// التجديد: بيحدّث التاريخ وبيقيّد التجديد في سجل المركبة.
router.post('/:id/renew', authorize(...EDIT), c.renew);
router.delete('/:id', authorize(...ADMIN), c.remove);

module.exports = router;
