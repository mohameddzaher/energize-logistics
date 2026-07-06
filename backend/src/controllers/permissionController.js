const RolePermission = require('../models/RolePermission');
const { SECTION_KEYS, ACCESS_LEVELS, ALL_ROLES } = require('../config/sections');
const { effectivePermissions, invalidate } = require('../utils/permissions');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

// GET /api/admin/permissions — the full matrix for the super_admin page.
exports.getPermissions = async (req, res) => {
  try {
    const permissions = {};
    for (const role of ALL_ROLES) {
      permissions[role] = await effectivePermissions(role);
    }
    res.json({ sections: SECTION_KEYS, roles: ALL_ROLES, accessLevels: ACCESS_LEVELS, permissions });
  } catch (error) {
    console.error('getPermissions error:', error);
    res.status(500).json({ message: 'Failed to load permissions' });
  }
};

// PUT /api/admin/permissions/:role — replace one role's section access map.
exports.updateRolePermissions = async (req, res) => {
  try {
    const { role } = req.params;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ message: 'Unknown role' });
    if (role === 'super_admin') return res.status(400).json({ message: 'super_admin always has full access' });

    const input = req.body?.sections || {};
    const sections = {};
    for (const [key, level] of Object.entries(input)) {
      if (!SECTION_KEYS.includes(key)) continue;
      if (!ACCESS_LEVELS.includes(level)) continue;
      sections[key] = level;
    }

    await RolePermission.findOneAndUpdate(
      { role },
      { $set: { sections, updatedBy: req.user._id } },
      { upsert: true, new: true }
    );
    invalidate(role);

    await logAudit({
      user: req.user._id,
      action: 'update_role_permissions',
      entity: 'RolePermission',
      entityId: role,
      changes: { after: sections },
      ipAddress: req.ip,
    }).catch(() => {});

    // Live update: every connected client of this role refetches /me so its
    // sidebar + access reflect the change without re-login.
    try { emitToAll('permissions:updated', { role }); } catch (e) {}

    const permissions = await effectivePermissions(role);
    res.json({ role, permissions });
  } catch (error) {
    console.error('updateRolePermissions error:', error);
    res.status(500).json({ message: 'Failed to update permissions' });
  }
};
