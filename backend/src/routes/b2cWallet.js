/** /api/b2c-wallet: custody wallets for B2C project managers. Separate route file and path so it cannot interfere with the existing B2C module. */
const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
router.param('managerId', objectIdParam());
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const c = require('../controllers/b2cWalletController');

const ALL = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead'];

router.use(authenticate);
// Custody is for project managers; the rep supervisor has none here.
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
