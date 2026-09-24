const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());

const ctrl = require('../controllers/customerRegistryController');
const authenticate = require('../middleware/auth');

// سجلُّ العملاء يُقرأ من قسمَي «طلبات الشحنات» و«التشغيل» معًا — الشاشةُ
// واحدةٌ في الموضعين، فالقراءةُ واحدةٌ كذلك (القراءةُ فقط؛ التعديلُ يبقى في
// نقاط طلبات الشحنات).
// ── والكتابةُ تمرّ من هنا أيضًا ─────────────────────────────────────────────
// نقاطُ «طلبات الشحنات» محروسةٌ بقسمها، فمن يفتح السجلَّ من قسم التشغيل كان
// يُردّ ٤٠٣ عند أوّل تعديل — الصفحةُ تُفتح والزرُّ لا يعمل (راجع
// page-api-map-subscreens). فتُعاد النقاطُ نفسُها هنا بحارس الأدوار وحدَه،
// وتنفّذها متحكّماتُ طلبات الشحنات ذاتُها — سجلٌّ واحدٌ لا اثنان.
const so = require('../controllers/shipmentOrdersController');
const authorize = require('../middleware/rbac');
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];

router.use(authenticate);
router.get('/', ctrl.list);
// قوائمُ الخيارات (المدن وحقولُ النموذج) — يقرؤها مربّعُ التعديل في القسمين.
router.get('/options', so.listFields);
// القائمةُ بمساراتها كاملةً — يقرؤها تصديرُ الأسعار ومربّعُ التعديل.
router.get('/full', so.listCustomers);
router.post('/', authorize(...EDIT_ROLES), so.createCustomer);
router.get('/:id', ctrl.profile);
router.put('/:id', authorize(...EDIT_ROLES), so.updateCustomer);
router.delete('/:id', authorize(...ADMIN_ROLES), so.deleteCustomer);

module.exports = router;
