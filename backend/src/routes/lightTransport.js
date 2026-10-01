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
const EDIT = ['super_admin', 'admin', 'b2c_manager', 'b2c_project_lead', 'it_manager'];

// لوحةُ القسم — نداءٌ واحدٌ يحسب الموظّفين والمركبات والسكن معًا.
router.get('/overview', c.overview);
// حساباتُ الإشراف في القسم — يُبنى منها حقلُ «المشرف» في الويب والهاتف.
router.get('/supervisors', c.supervisors);
router.get('/employees', c.listEmployees);
router.get('/employees/:id', c.getEmployee);
router.post('/employees', authorize(...EDIT), c.createEmployee);
router.put('/employees/:id', authorize(...EDIT), c.updateEmployee);
// لا حذفَ لموظّف — يُعطَّل السجلّ ويبقى أثرُه، كقاعدة الموارد البشريّة.
router.post('/employees/:id/deactivate', authorize(...EDIT), c.deactivateEmployee);
// إسنادُ مشرفٍ تشغيليٍّ أو مشرفِ تفقّدٍ لعدّة موظّفين دفعةً واحدة.
router.post('/employees/assign-supervisors', authorize(...EDIT), c.assignSupervisors);

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
router.post('/store/bulk-movement', authorize(...EDIT), lightStore(store.addBulkMovement));
router.post('/store/movements/:movementId/reverse', authorize(...EDIT), lightStore(store.reverseMovement));
router.post('/store/:id/movement', objectIdParam('id'), authorize(...EDIT), lightStore(store.addMovement));
router.put('/store/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.updateItem));
router.delete('/store/:id', objectIdParam('id'), authorize(...EDIT), lightStore(store.deleteItem));

module.exports = router;
