/**
 * Media Go complaints; see controllers/mediagoComplaintController.
 * Mounted in server.js at `/api/b2c/mediago-complaints` before the section router: the individuals guard admits section staff, and the Media Go account reaches only these lists.
 * The lists here open access and the controller sets the limits inside them (Media Go cannot create or delete, and can only choose the in-progress and fixed statuses).
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

// Read, status and reply: section staff and the Media Go account. Users granted the individuals section in the permissions matrix pass through the section stamp (rbac) even if their role is not listed here.
const READ = [...c.CREATE_ROLES, MEDIAGO_ROLE];

router.get('/', authorize(...READ), c.list);
router.get('/meta', authorize(...READ), c.meta);
router.get('/motorcycles', authorize(...c.CREATE_ROLES), c.motorcycles);
router.post('/', authorize(...c.CREATE_ROLES), c.create);
router.get('/:id', authorize(...READ), c.getOne);
router.post('/:id/files', authorize(...c.CREATE_ROLES), c.addFiles);
router.patch('/:id/status', authorize(...READ), c.setStatus);
router.post('/:id/replies', authorize(...READ), c.reply);
router.put('/:id', authorize.strict(...c.EDIT_ROLES), c.update);
router.delete('/:id', authorize.strict(...c.DELETE_ROLES), c.remove);

// Nothing from here falls through to the section router: anything not defined here does not exist.
router.use((req, res) => res.status(404).json({ message: 'Route not found' }));

module.exports = router;
