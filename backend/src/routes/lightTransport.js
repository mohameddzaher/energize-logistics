const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam({ status: 400 }));

const c = require('../controllers/lightTransportController');
const o = require('../controllers/lightTransportOrderController');
const authorize = require('../middleware/rbac');

// authenticate + sectionGate('B2C') مطبَّقان عند التركيب في server.js.
// أدوارُ القسم أوّلًا، ومن مُنح القسمَ من مصفوفة الصلاحيّات يمرّ بـ`authorize`
// نفسِها (هي تقرأ `req.sectionAccess`) — راجع middleware/sectionGate.
const EDIT = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager', ...require('../config/financeAuthority').FINANCE_FULL_ROLES];

// لوحةُ القسم — نداءٌ واحدٌ يحسب الموظّفين والمركبات والسكن معًا.
router.get('/overview', c.overview);
// حساباتُ الإشراف في القسم — يُبنى منها حقلُ «المشرف» في الويب والهاتف.
router.get('/supervisors', c.supervisors);
router.get('/employees', c.listEmployees);
router.get('/employees/:id', c.getEmployee);
// أوردراتُه موزّعةً على مشاريعه شهرًا شهرًا — لملفّه (b2cEntryController.repOrders).
router.get('/employees/:id/orders', require('../controllers/b2cEntryController').repOrders);
// إضافةُ موظّفٍ تُنشئ ملفَّه في الموارد البشريّة — فهي لمدير القطاع ونائبه ومدير
// النظام (وأهل المال)، لا لكلّ مَن مُنح القسم.
router.post('/employees', authorize.strict('super_admin', 'b2c_manager', 'b2c_deputy', ...require('../config/financeAuthority').FINANCE_FULL_ROLES), c.createEmployee);
// مركباتُ مشاريع القسم — نافذةٌ على سجلّ المركبات نفسِه (راجع المتحكِّم).
router.get('/vehicles', c.listVehicles);
// منسدلةُ الأشخاص (القائد الفعلي والمفوَّض) — موظّفو القسم أوّلًا ثمّ الموارد البشريّة.
router.get('/people', c.people);
router.put('/vehicles/:id', authorize.strict(...c.LT_VEHICLE_EDIT), c.updateVehicle);
router.put('/employees/:id', authorize(...EDIT), c.updateEmployee);
// «نقل مشروع» — الطريقُ الوحيدُ لتغيير مشروع المندوب، ويحسم المتحكّمُ مَن يملكه
// (نائب مدير القطاع، مدير القسم، السوبر أدمن، الأدمن — utils/b2cEntry.canTransfer).
router.post('/employees/:id/transfer-project', authorize(...EDIT), require('../controllers/b2cEntryController').transferProject);
// لا حذفَ لموظّف — يُعطَّل السجلّ ويبقى أثرُه، كقاعدة الموارد البشريّة.
router.post('/employees/:id/deactivate', authorize(...EDIT), c.deactivateEmployee);
// إسنادُ مشرفٍ تشغيليٍّ أو مشرفِ تفقّدٍ لعدّة موظّفين دفعةً واحدة.
router.post('/employees/assign-supervisors', authorize(...EDIT), c.assignSupervisors);

// ── عهدةُ النقل الخفيف: الكاش وكارت المشتريات والورشة ──────────────────────
// قيودُ واردٍ وصادر، والتحويلُ بين حسابين قيدان بضغطة — راجع models/LtCustody.
const custody = require('../controllers/ltCustodyController');
// قائمتُها وحدَها تقرّر (`strict`): منحُ القسم يفتح القسمَ لمديري المشاريع ومشرفيه،
// والعهدةُ مالٌ لا تُفتَح إلّا لمدير القطاع ونائبه ومدير النظام وأهل المال.
const CUSTODY = authorize.strict(...custody.CUSTODY_ROLES);
router.get('/custody', CUSTODY, custody.list);
router.get('/custody/rep', CUSTODY, custody.lookupRep);
router.post('/custody', CUSTODY, custody.create);
router.put('/custody/:id', CUSTODY, custody.update);      // والمتحكِّمُ يحصره في مدير النظام وأهل المال
router.delete('/custody/:id', CUSTODY, custody.remove);

// ── تأجيرُ اليوزرات — يُعَدّ في «إجمالي المناديب» في لوحة القسم ──────────────
const rentals = require('../controllers/ltUserRentalController');
router.get('/user-rentals', rentals.list);
router.post('/user-rentals', authorize(...EDIT), rentals.create);
router.put('/user-rentals/:id', authorize(...EDIT), rentals.update);
router.post('/user-rentals/:id/end', authorize(...EDIT), rentals.end);
router.delete('/user-rentals/:id', authorize(...EDIT), rentals.remove);   // والمتحكِّمُ يحصره في الإدارة

router.get('/housing', c.listHousing);
router.post('/housing', authorize(...EDIT), c.saveHousing);
router.put('/housing/:id', authorize(...EDIT), c.saveHousing);
router.delete('/housing/:id', authorize(...EDIT), c.deleteHousing);

// أوامرُ التشغيل — وخياراتُها تُبنى في الخادم لا في المتصفّح.
router.get('/orders/options', o.orderOptions);
router.get('/orders', o.listOrders);
router.post('/orders', authorize(...EDIT), o.createOrder);
router.post('/orders/:id/end', authorize(...EDIT), o.endOrder);
// نقلُ تفويضِ مركبةٍ وحدَه — بلا أمرِ تشغيلٍ جديد. راجع `moveAuthorization`.
router.post('/authorization/move', authorize(...EDIT), o.moveAuthorization);

/**
 * ── مخزنُ النقل الخفيف ──────────────────────────────────────────────────────
 *
 * آليّةُ المخزن مكتوبةٌ مرّةً في `ls2StoreController` — وارد وصادر، حركةٌ لا
 * تُعدَّل بل تُعكَس، رصيدٌ بعد كلّ حركة، وعتبةُ نقص. ولهذا القسم مخزنُه
 * بأصنافه (رأسُ موتورٍ وجوانٌ ودرّاجات)، فيُنادى الكونترولرُ نفسُه بنطاق
 * `warehouse=light` بدل نسخِ مخزنٍ ثانٍ يفترق عن الأوّل أوّلَ تعديل.
 *
 * والنطاقُ يُفرَض هنا لا يُترَك للواجهة: الصفحةُ تنادي `/api/light-transport/
 * store` فلا تستطيع — ولو بخطأ — أن تقرأ مخزنَ النقل الثقيل أو تكتب فيه.
 */
const store = require('../controllers/ls2StoreController');
const lightStore = (handler) => (req, res) => {
  req.query = { ...req.query, warehouse: 'light' };
  if (req.body && typeof req.body === 'object') req.body.warehouse = 'light';
  return handler(req, res);
};
router.get('/store', lightStore(store.listItems));
router.get('/store/dashboard', lightStore(store.dashboard));
router.get('/store/movements', lightStore(store.listMovements));
router.post('/store', authorize(...EDIT), lightStore(store.createItem));
router.post('/store/bulk-create', authorize(...EDIT), lightStore(store.createItemsBulk));
router.get('/suppliers', lightStore(store.listSuppliers));
router.post('/suppliers', authorize(...EDIT), lightStore(store.createSupplier));
router.put('/suppliers/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.updateSupplier));
router.delete('/suppliers/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.deleteSupplier));
router.post('/store/bulk-movement', authorize(...EDIT), lightStore(store.addBulkMovement));
router.post('/store/movements/:movementId/reverse', authorize(...EDIT), lightStore(store.reverseMovement));
router.post('/store/:id/movement', objectIdParam('id'), authorize(...EDIT), lightStore(store.addMovement));
router.put('/store/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.updateItem));
router.delete('/store/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.deleteItem));

module.exports = router;
