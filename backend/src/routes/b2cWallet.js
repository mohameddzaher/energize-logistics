/**
 * /api/b2c-wallet — custody (عهدة) wallets for B2C project managers.
 * Separate route file + path so it can't interfere with the existing B2C module.
 */
const express = require('express');
const router = express.Router();

// معرّفٌ مشوَّهٌ في الرابط = لا سجلّ، لا عطلٌ في الخادم — راجع utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('managerId', objectIdParam());
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const c = require('../controllers/b2cWalletController');

const ALL = ['super_admin', 'admin', 'b2c_manager', 'b2c_project_lead'];

router.use(authenticate);
// العهدةُ لمديري المشاريع — ومشرفُ المناديب لا عهدةَ له هنا.
router.use((req, res, next) => (require('../middleware/b2cGuards').isRepSupervisor(req.user)
  ? res.status(403).json({ message: 'عهد المشاريع لمديري المشاريع ومدير القطاع فقط' })
  : next()));
router.use(authorize(...ALL));

router.get('/managers', authorize(...c.MANAGER_ROLES), c.managers);
router.get('/me', c.myWallet);
router.post('/', c.create);
router.patch('/:id', c.update); // ACL (manager or creator) enforced in controller
router.delete('/:id', c.remove); // ACL (manager or creator) enforced in controller
router.get('/:managerId', c.walletOf);

module.exports = router;
