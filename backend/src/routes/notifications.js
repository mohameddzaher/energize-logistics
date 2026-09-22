const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const notificationController = require('../controllers/notificationController');
const authenticate = require('../middleware/auth');

router.use(authenticate);

router.get('/', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);
router.put('/read-all', notificationController.markAllAsRead);

module.exports = router;
