const express = require('express');
const router = express.Router();
const { clearData } = require('../controllers/adminController');
const {
  getPermissions, updateRolePermissions,
  listCustomRoles, createCustomRole, updateCustomRole, deleteCustomRole,
} = require('../controllers/permissionController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(authenticate);
// These routes cannot be opened by a matrix grant. `authorize.strict` ignores section stamps and page grants because this is the matrix itself: anyone granted the roles-and-permissions screen could give themselves everything. Data wipe is irreversible too.
router.post('/clear-data', authorize.strict('super_admin'), clearData);

// Dynamic role→section permissions (super_admin only).
router.get('/permissions', authorize.strict('super_admin'), getPermissions);
router.put('/permissions/:role', authorize.strict('super_admin'), updateRolePermissions);

// Custom user types. Reading is open to those who create users, since the users-page dropdown needs it, otherwise a type could be made but not assigned. Creating and deleting is system owner only, as a new type is a new access path.
router.get('/roles', authorize('super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'hr_manager'), listCustomRoles);
router.post('/roles', authorize.strict('super_admin'), createCustomRole);
router.put('/roles/:key', authorize.strict('super_admin'), updateCustomRole);
router.delete('/roles/:key', authorize.strict('super_admin'), deleteCustomRole);

module.exports = router;
