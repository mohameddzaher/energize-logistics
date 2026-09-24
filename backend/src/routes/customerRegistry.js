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
router.use(authenticate);
router.get('/', ctrl.list);
router.get('/:id', ctrl.profile);

module.exports = router;
