/**
 * المحتوى الإعلانيّ — راجع controllers/mediagoAdController.
 * يُركَّب في server.js على `/api/b2c/mediago-ads` كشكاوى Media Go: حارسُ «الأفراد»
 * لأهل القسم، وحسابُ Media Go يمرّ إلى هذه القوائم وحدَها، والمتحكّمُ يحسم ما لكلٍّ.
 */
const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const c = require('../controllers/mediagoAdController');
const { MEDIAGO_ROLE } = require('../config/scopedRoles');

router.param('id', objectIdParam());
router.param('itemId', objectIdParam());
router.param('fileId', objectIdParam());
router.use(authenticate);

const READ = [...c.OUR_ROLES, MEDIAGO_ROLE];

router.get('/', authorize(...READ), c.list);
router.get('/meta', authorize(...READ), c.meta);
router.get('/vehicles', authorize(...READ), c.vehicles);
router.post('/', authorize(...READ), c.create);
router.get('/:id', authorize(...READ), c.getOne);
router.post('/:id/items/:itemId/files', authorize(...c.OUR_ROLES), c.addItemFiles);
router.delete('/:id/items/:itemId/files/:fileId', authorize(...c.OUR_ROLES), c.removeItemFile);
router.patch('/:id/items/:itemId', authorize(...c.OUR_ROLES), c.updateItem);
router.post('/:id/files', authorize(...c.OUR_ROLES), c.addFiles);
router.delete('/:id/files/:fileId', authorize(...c.OUR_ROLES), c.removeFile);
router.post('/:id/deliver', authorize(...c.OUR_ROLES), c.deliver);
router.patch('/:id/status', authorize(...READ), c.setStatus);
router.post('/:id/replies', authorize(...READ), c.reply);
router.delete('/:id', authorize(...c.OUR_ROLES), c.remove);

router.use((req, res) => res.status(404).json({ message: 'Route not found' }));
module.exports = router;
