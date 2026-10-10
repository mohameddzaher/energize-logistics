const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());

const ctrl = require('../controllers/customerRegistryController');
const authenticate = require('../middleware/auth');

// سجلُّ العملاء يُقرأ من أقسام «طلبات الشحنات» و«التشغيل» و«المبيعات» معًا —
// الشاشةُ واحدةٌ في المواضع الثلاثة، فالقراءةُ واحدةٌ كذلك.
// ── والكتابةُ تمرّ من هنا أيضًا ─────────────────────────────────────────────
// نقاطُ «طلبات الشحنات» محروسةٌ بقسمها، فمن يفتح السجلَّ من قسم التشغيل كان
// يُردّ ٤٠٣ عند أوّل تعديل — الصفحةُ تُفتح والزرُّ لا يعمل (راجع
// page-api-map-subscreens). فتُعاد النقاطُ نفسُها هنا بحارس الأدوار وحدَه،
// وتنفّذها متحكّماتُ طلبات الشحنات ذاتُها — سجلٌّ واحدٌ لا اثنان.
const so = require('../controllers/shipmentOrdersController');
const authorize = require('../middleware/rbac');
// ── ومديرُ المبيعات يعدّل ────────────────────────────────────────────────────
// السجلُّ صار يُفتح من قسم المبيعات أيضًا (ثلاثةُ أبوابٍ على سجلٍّ واحد)،
// والسعرُ المتّفقُ عليه مع العميل عملُ المبيعات قبل غيرها. فمديرُ المبيعات
// يضيف ويعدّل كمدير العمليّات؛ والمندوبُ يقرأ ولا يكتب، والحذفُ (إيقافُ
// العميل) يبقى لقائمة الإدارة، وشرائحُ السعر لحارسها في المتحكِّم.
// والمندوبُ يعدّل بياناتِ العميل كذلك — والأسعارُ ليست منها: يحرسها المتحكِّم
// لمدير العمليّات ومدير النظام وحدَهما (customerRoutes.canEditPrices).
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_staff', 'moderator', 'sales_manager', 'sales_rep'];
const ADMIN_ROLES = ['super_admin', 'admin', 'it_manager', 'operations_manager'];

router.use(authenticate);
// ── ومن مُنح «تعديلَ طلبات الشحنات» يكتب هنا كما يكتب هناك ─────────────────
// الشاشةُ تُظهر أزرارَ التعديل لمن مُنح القسمَ من المصفوفة (`canEditCustomers`)،
// وهذا المسارُ بلا حارس قسمٍ فلا يُختَم عليه شيء: يظهر الزرُّ ويُردّ الحفظُ ٤٠٣.
// فيُختَم المنحُ هنا — يمنح ولا يمنع (راجع stampSection).
router.use(require('../middleware/sectionGate').stampSection('Shipment Orders'));
router.get('/', ctrl.list);
// قوائمُ الخيارات (المدن وحقولُ النموذج) — يقرؤها مربّعُ التعديل في القسمين.
router.get('/options', so.listFields);
// القائمةُ بمساراتها كاملةً — يقرؤها تصديرُ الأسعار ومربّعُ التعديل.
router.get('/full', so.listCustomers);
router.post('/', authorize(...EDIT_ROLES), so.createCustomer);
router.get('/:id', ctrl.profile);
router.put('/:id', authorize(...EDIT_ROLES), so.updateCustomer);
// شرائحُ السعر بعدد السيارات — الحارسُ في المتحكِّم: مديرُ العمليّات ومديرُ النظام وحدَهما.
router.put('/:id/route-tiers', ctrl.setRouteTiers);
router.delete('/:id', authorize(...ADMIN_ROLES), so.deleteCustomer);

module.exports = router;
