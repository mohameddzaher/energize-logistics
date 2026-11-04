const express = require('express');
const router = express.Router();
const { objectIdParam } = require('../utils/idParam');
const authenticate = require('../middleware/auth');
const ctrl = require('../controllers/sellingPriceRequestsController');

// Approver check is in the controller: approvers are a role list plus the top-management flag, which rbac cannot express.
router.param('id', objectIdParam());
router.use(authenticate);
router.get('/', ctrl.list);
router.get('/count', ctrl.count);
router.post('/:id/approve', ctrl.approve);
router.post('/:id/reject', ctrl.reject);

module.exports = router;
