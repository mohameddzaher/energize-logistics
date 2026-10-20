/**
 * شكاوى Media Go — راجع controllers/mediagoComplaintController.
 *
 * يُركَّب في server.js على `/api/b2c/mediago-complaints` قبل موجّه القسم:
 * حارسُ «الأفراد» لأهل القسم، وحسابُ Media Go يمرّ إلى هذه القوائم وحدَها.
 *
 * والقوائمُ هنا تفتح، والمتحكّمُ يحسم الحدودَ داخلها (Media Go لا تُنشئ ولا
 * تحذف، ولا تختار من الحالات إلّا «قيد المعالجة» و«تمّ الإصلاح»).
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const c = require('../controllers/mediagoComplaintController');
const { MEDIAGO_ROLE } = require('../config/scopedRoles');

router.param('id', objectIdParam());
router.use(authenticate);

// القراءةُ والحالةُ والردّ: أهلُ القسم وحسابُ Media Go. ومن مُنح «الأفراد» من
// مصفوفة الصلاحيّات يمرّ بختم القسم (rbac) وإن لم يكن دورُه هنا.
const READ = [...c.CREATE_ROLES, MEDIAGO_ROLE];

router.get('/', authorize(...READ), c.list);
router.get('/meta', authorize(...READ), c.meta);
router.get('/motorcycles', authorize(...c.CREATE_ROLES), c.motorcycles);
router.post('/', authorize(...c.CREATE_ROLES), c.create);
router.get('/:id', authorize(...READ), c.getOne);
router.post('/:id/files', authorize(...c.CREATE_ROLES), c.addFiles);
router.patch('/:id/status', authorize(...READ), c.setStatus);
router.post('/:id/replies', authorize(...READ), c.reply);
router.delete('/:id', authorize.strict(...c.DELETE_ROLES), c.remove);

// لا يعبر شيءٌ من هنا إلى موجّه القسم: ما لم يُعرَف هنا غيرُ موجود.
router.use((req, res) => res.status(404).json({ message: 'Route not found' }));

module.exports = router;
