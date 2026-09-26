const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());

const ctrl = require('../controllers/exportJobsController');
const authenticate = require('../middleware/auth');

// التصديرُ الكبيرُ يُطلَب من أكثرَ من قسم، فلا يُنسَب إلى قسمٍ واحد: كلُّ طلبٍ
// محجوزٌ على صاحبه (يقرأ ملفَّه وحدَه) وبُني بدوره هو — راجع exportJobsController.
router.use(authenticate);
router.get('/jobs', ctrl.list);
router.post('/jobs', ctrl.create);
router.get('/jobs/:id', ctrl.status);
router.get('/jobs/:id/download', ctrl.download);

module.exports = router;
