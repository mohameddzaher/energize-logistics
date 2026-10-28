/**
 * /api/customer-requests — Operations' «التواصل مع العملاء»: requests sent from
 * the customer portal, answered in the system or by email.
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { objectIdParam } = require('../utils/idParam');
const c = require('../controllers/customerRequestsController');

router.param('id', objectIdParam());
router.use(authenticate);
const ROLES = ['super_admin', 'admin', 'operations_manager', 'operations_staff', 'moderator'];

router.get('/', authorize(...ROLES), c.list);
router.get('/unread-count', authorize(...ROLES), c.unreadCount);
router.get('/mailboxes', authorize(...ROLES), c.mailboxes);
router.get('/:id', authorize(...ROLES), c.one);
router.post('/:id/reply', authorize(...ROLES), c.reply);
router.post('/:id/email', authorize(...ROLES), c.email);
router.patch('/:id/status', authorize(...ROLES), c.setStatus);

module.exports = router;
