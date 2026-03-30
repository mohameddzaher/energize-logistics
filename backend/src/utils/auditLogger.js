const AuditLog = require('../models/AuditLog');

const logAudit = async ({ user, action, entity, entityId, changes, ipAddress }) => {
  try {
    await AuditLog.create({
      user: user._id || user,
      action,
      entity,
      entityId,
      changes,
      ipAddress,
    });
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

module.exports = logAudit;
