/** /api/crm-vendors: CRM Vendors. Separate route file and path so it cannot interfere with the existing CRM module. Same access tier as CRM. */
const express = require('express');
const router = express.Router();

// A malformed id in the URL means no record, not a server error; see utils/idParam.
const { objectIdParam } = require('../utils/idParam');
router.param('id', objectIdParam());
const c = require('../controllers/crmVendorController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { CRM_STAFF_ROLES, CRM_ADMIN_ROLES } = require('../config/constants');

router.use(authenticate);
router.use(authorize(...CRM_STAFF_ROLES));

router.get('/options', c.options);
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', authorize(...CRM_ADMIN_ROLES), c.remove);

module.exports = router;
