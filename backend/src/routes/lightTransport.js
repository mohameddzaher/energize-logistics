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

router.get('/employees', c.listEmployees);
router.get('/employees/:id', c.getEmployee);
router.post('/employees', authorize(...EDIT), c.createEmployee);
router.put('/employees/:id', authorize(...EDIT), c.updateEmployee);
// لا حذفَ لموظّف — يُعطَّل السجلّ ويبقى أثرُه، كقاعدة الموارد البشريّة.
router.post('/employees/:id/deactivate', authorize(...EDIT), c.deactivateEmployee);

router.get('/housing', c.listHousing);
router.post('/housing', authorize(...EDIT), c.saveHousing);
router.put('/housing/:id', authorize(...EDIT), c.saveHousing);
router.delete('/housing/:id', authorize(...EDIT), c.deleteHousing);

// أوامرُ التشغيل — وخياراتُها تُبنى في الخادم لا في المتصفّح.
router.get('/orders/options', o.orderOptions);
router.get('/orders', o.listOrders);
router.post('/orders', authorize(...EDIT), o.createOrder);
router.post('/orders/:id/end', authorize(...EDIT), o.endOrder);

module.exports = router;
