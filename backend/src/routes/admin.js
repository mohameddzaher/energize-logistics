const express = require('express');
const router = express.Router();
const { clearData } = require('../controllers/adminController');
const { getPermissions, updateRolePermissions } = require('../controllers/permissionController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);
router.post('/clear-data', authorize('super_admin'), clearData);

// Dynamic role→section permissions (super_admin only).
router.get('/permissions', authorize('super_admin'), getPermissions);
router.put('/permissions/:role', authorize('super_admin'), updateRolePermissions);

module.exports = router;
